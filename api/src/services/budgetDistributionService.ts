import { BudgetKind, Prisma, VehicleClassification } from '@prisma/client';
import { createHash } from 'node:crypto';
import prisma, { Tx } from '../lib/prisma';
import { getAuditContext } from '../lib/auditContext';
import { BadRequest } from '../middlewares/errorHandler';
import {
  AssignBudgetInput,
  BudgetDistributionTarget,
  DistributeBudgetInput,
  DistributeTargetBudgetInput,
  MAX_BUDGET_DISTRIBUTIONS,
} from '../validators/budgetValidator';
import { lockOpenBudgetPeriod } from './budgetPeriodLock';

const CLASSIFICATIONS: VehicleClassification[] = ['POLICIAL', 'ESTATAL', 'VIAL'];
const MAX_MONTHLY_CENTS = 99_999_999_999_999n; // NUMERIC(14,2)
const UPSERT_BATCH_SIZE = 250;

export interface DistributionTargetCounts {
  all: number;
  unassigned: number;
  byClassification: Record<VehicleClassification, number>;
}

export interface BudgetAllocation {
  vehicleId: number;
  baseAmount: number;
}

export function moneyAmountToCents(amount: number): bigint {
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(cents / 100 - amount) > 1e-9) {
    throw BadRequest('El monto debe tener como máximo dos decimales');
  }
  return BigInt(cents);
}

export function decimalTextToCents(value: string): bigint {
  const match = value.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw BadRequest('Monto de presupuesto inválido');
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
}

/**
 * Reparte usando centavos enteros. En modo TOTAL distribuye el residuo de un
 * centavo entre los primeros IDs, por lo que la suma escrita siempre coincide
 * exactamente con el monto solicitado.
 */
export function buildBudgetAllocations(
  vehicleIds: number[],
  mode: 'TOTAL' | 'PER_UNIT',
  amount: number,
): BudgetAllocation[] {
  if (vehicleIds.length === 0) throw BadRequest('No hay vehículos activos para el criterio seleccionado');

  const inputCents = moneyAmountToCents(amount);
  const count = BigInt(vehicleIds.length);
  const totalCents = mode === 'TOTAL' ? inputCents : inputCents * count;
  if (totalCents > MAX_MONTHLY_CENTS) {
    throw BadRequest('La distribución excede el máximo monetario permitido para un mes');
  }

  if (mode === 'PER_UNIT') {
    const baseAmount = Number(inputCents) / 100;
    return vehicleIds.map((vehicleId) => ({ vehicleId, baseAmount }));
  }

  const baseCents = inputCents / count;
  const remainder = inputCents % count;
  return vehicleIds.map((vehicleId, index) => ({
    vehicleId,
    baseAmount: Number(baseCents + (BigInt(index) < remainder ? 1n : 0n)) / 100,
  }));
}

export async function getDistributionTargetCounts(
  kind: BudgetKind,
  year: number,
  month: number,
): Promise<DistributionTargetCounts> {
  const [all, unassigned, grouped] = await Promise.all([
    prisma.vehicle.count({ where: { isActive: true } }),
    prisma.vehicle.count({
      where: {
        isActive: true,
        vehicleBudgets: { none: { kind, year, month } },
      },
    }),
    prisma.vehicle.groupBy({
      by: ['classification'],
      where: { isActive: true },
      _count: { _all: true },
    }),
  ]);

  const byClassification = Object.fromEntries(
    CLASSIFICATIONS.map((classification) => [classification, 0]),
  ) as Record<VehicleClassification, number>;
  for (const row of grouped) byClassification[row.classification] = row._count._all;

  return { all, unassigned, byClassification };
}

export async function lockMonthlyPoolCents(
  tx: Tx,
  kind: BudgetKind,
  year: number,
  month: number,
): Promise<bigint | null> {
  const rows = await tx.$queryRaw<Array<{ totalAmount: string }>>`
    SELECT "totalAmount"::text
    FROM monthly_budgets
    WHERE kind = ${kind}::"BudgetKind" AND year = ${year} AND month = ${month}
    FOR UPDATE
  `;
  return rows.length === 0 ? null : decimalTextToCents(rows[0].totalAmount);
}

async function assertPoolCapacity(
  tx: Tx,
  kind: BudgetKind,
  year: number,
  month: number,
  targetIds: number[],
  replacementCents: bigint,
  poolCents: bigint | null,
): Promise<void> {
  if (poolCents == null) return;
  // Se cuentan también filas de unidades inactivas: la baja ya redujo cada
  // presupuesto abierto a su porción consumida. Excluirlas aquí liberaría dos
  // veces ese dinero y permitiría gastar por encima del pote mensual.
  const aggregate = await tx.vehicleBudget.aggregate({
    where: {
      kind,
      year,
      month,
      NOT: { vehicleId: { in: targetIds } },
    },
    _sum: { baseAmount: true },
  });
  const otherCents = decimalTextToCents(String(aggregate._sum.baseAmount ?? 0));
  if (otherCents + replacementCents > poolCents) {
    throw BadRequest(
      'La asignación excede el pote mensual. Refresca los datos e intenta de nuevo.',
    );
  }
}

async function validateReplacementAgainstSpent(
  tx: Tx,
  kind: BudgetKind,
  year: number,
  month: number,
  allocations: Array<{ vehicleId: number; cents: bigint }>,
): Promise<Map<number, boolean>> {
  const existing = await tx.vehicleBudget.findMany({
    where: {
      kind,
      year,
      month,
      vehicleId: { in: allocations.map((item) => item.vehicleId) },
    },
    select: {
      vehicleId: true,
      rolloverIn: true,
      spentAmount: true,
    },
  });
  const byVehicle = new Map(existing.map((row) => [row.vehicleId, row]));
  const cutOffByVehicle = new Map<number, boolean>();

  for (const allocation of allocations) {
    const state = byVehicle.get(allocation.vehicleId);
    const rolloverCents = state
      ? decimalTextToCents(String(state.rolloverIn))
      : 0n;
    const spentCents = state
      ? decimalTextToCents(String(state.spentAmount))
      : 0n;
    const availableCents = allocation.cents + rolloverCents - spentCents;
    if (availableCents < 0n) {
      throw BadRequest(
        `La nueva asignación de la unidad ${allocation.vehicleId} es menor que su gasto ya registrado`,
      );
    }
    cutOffByVehicle.set(allocation.vehicleId, availableCents === 0n);
  }

  return cutOffByVehicle;
}

function centsToDecimalText(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

/**
 * Escritura set-based en lotes acotados. Mantiene el lock de periodo una sola
 * vez, pero evita un round-trip y un UPSERT de Prisma por vehículo.
 */
async function upsertBudgetAllocationsInBatches(
  tx: Tx,
  input: { kind: BudgetKind; year: number; month: number },
  allocations: Array<{ vehicleId: number; cents: bigint }>,
  cutOffByVehicle: Map<number, boolean>,
  userId: number,
): Promise<void> {
  for (let offset = 0; offset < allocations.length; offset += UPSERT_BATCH_SIZE) {
    const batch = allocations.slice(offset, offset + UPSERT_BATCH_SIZE);
    const values = batch.map((item) => Prisma.sql`(
      ${item.vehicleId},
      ${input.kind}::"BudgetKind",
      ${input.year},
      ${input.month},
      ${centsToDecimalText(item.cents)}::numeric,
      ${cutOffByVehicle.get(item.vehicleId) ?? false},
      ${userId},
      ${userId},
      NOW(),
      NOW()
    )`);

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO vehicle_budgets
        ("vehicleId", kind, year, month, "baseAmount", "isCutOff", "createdBy", "updatedBy", "createdAt", "updatedAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("vehicleId", kind, year, month)
      DO UPDATE SET
        "baseAmount" = EXCLUDED."baseAmount",
        "isCutOff" = EXCLUDED."isCutOff",
        "updatedBy" = EXCLUDED."updatedBy",
        "updatedAt" = NOW()
    `);
  }

  const totalCents = allocations.reduce((sum, item) => sum + item.cents, 0n);
  const digest = createHash('sha256');
  for (const item of allocations) digest.update(`${item.vehicleId}:${item.cents};`);
  const auditContext = getAuditContext();
  await tx.auditLog.create({
    data: {
      userId,
      action: 'BULK_UPSERT',
      resource: 'VehicleBudget',
      after: {
        kind: input.kind,
        year: input.year,
        month: input.month,
        count: allocations.length,
        totalBaseAmount: centsToDecimalText(totalCents),
      },
      metadata: {
        batchSize: UPSERT_BATCH_SIZE,
        allocationDigestSha256: digest.digest('hex'),
      },
      ipAddress: auditContext?.ipAddress,
      userAgent: auditContext?.userAgent,
      requestId: auditContext?.requestId,
    },
  });
}

async function lockExplicitActiveVehicleIds(tx: Tx, vehicleIds: number[]): Promise<void> {
  const uniqueIds = [...new Set(vehicleIds)];
  if (uniqueIds.length !== vehicleIds.length) {
    throw BadRequest('Cada vehículo debe aparecer una sola vez en la distribución');
  }
  const rows = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT id
    FROM vehicles
    WHERE id IN (${Prisma.join(uniqueIds)})
      AND "isActive" = true
    ORDER BY id
    FOR UPDATE
  `);
  if (rows.length !== uniqueIds.length) {
    throw BadRequest('La asignación contiene vehículos inexistentes o dados de baja');
  }
}

async function lockTargetVehicleIds(
  tx: Tx,
  kind: BudgetKind,
  year: number,
  month: number,
  target: BudgetDistributionTarget,
): Promise<number[]> {
  let rows: Array<{ id: number }>;

  if (target.mode === 'ALL') {
    rows = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT v.id
      FROM vehicles v
      WHERE v."isActive" = true
      ORDER BY v.id
      FOR UPDATE OF v
    `;
  } else if (target.mode === 'UNASSIGNED') {
    rows = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT v.id
      FROM vehicles v
      WHERE v."isActive" = true
        AND NOT EXISTS (
          SELECT 1
          FROM vehicle_budgets vb
          WHERE vb."vehicleId" = v.id
            AND vb.kind = ${kind}::"BudgetKind"
            AND vb.year = ${year}
            AND vb.month = ${month}
        )
      ORDER BY v.id
      FOR UPDATE OF v
    `;
  } else {
    rows = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT v.id
      FROM vehicles v
      WHERE v."isActive" = true
        AND v.classification = ${target.classification}::"VehicleClassification"
      ORDER BY v.id
      FOR UPDATE OF v
    `;
  }

  return rows.map((row) => row.id);
}

export async function distributeBudgetToTargetInTransaction(
  tx: Tx,
  input: DistributeTargetBudgetInput,
  userId: number,
) {
  const { kind, year, month, target, allocation } = input;

  // Un único lock coordina altas, distribuciones, edición del pote y cierre.
  await lockOpenBudgetPeriod(tx, kind, year, month);
  const poolCents = await lockMonthlyPoolCents(tx, kind, year, month);

  const targetIds = await lockTargetVehicleIds(tx, kind, year, month, target);
  if (targetIds.length > MAX_BUDGET_DISTRIBUTIONS) {
    throw BadRequest(
      `El criterio selecciona más de ${MAX_BUDGET_DISTRIBUTIONS} unidades; divide la operación por clasificación`,
    );
  }
  const allocations = buildBudgetAllocations(targetIds, allocation.mode, allocation.amount);
  const centAllocations = allocations.map((item) => ({
    vehicleId: item.vehicleId,
    cents: moneyAmountToCents(item.baseAmount),
  }));
  const distributionCents = allocations.reduce(
    (sum, item) => sum + moneyAmountToCents(item.baseAmount),
    0n,
  );
  const cutOffByVehicle = await validateReplacementAgainstSpent(
    tx,
    kind,
    year,
    month,
    centAllocations,
  );

  await assertPoolCapacity(
    tx,
    kind,
    year,
    month,
    targetIds,
    distributionCents,
    poolCents,
  );

  await upsertBudgetAllocationsInBatches(
    tx,
    { kind, year, month },
    centAllocations,
    cutOffByVehicle,
    userId,
  );

  return {
    count: allocations.length,
    totalAmount: Number(distributionCents) / 100,
  };
}

export function distributeBudgetToTarget(input: DistributeTargetBudgetInput, userId: number) {
  return prisma.$transaction((tx) => distributeBudgetToTargetInTransaction(tx, input, userId));
}

/** Asignación individual con las mismas invariantes que la distribución masiva. */
export function assignBudgetToVehicle(input: AssignBudgetInput, userId: number) {
  return prisma.$transaction(async (tx) => {
    const { vehicleId, kind, year, month } = input;
    const amountCents = moneyAmountToCents(input.baseAmount);

    await lockOpenBudgetPeriod(tx, kind, year, month);
    const poolCents = await lockMonthlyPoolCents(tx, kind, year, month);
    await lockExplicitActiveVehicleIds(tx, [vehicleId]);
    const cutOffByVehicle = await validateReplacementAgainstSpent(
      tx,
      kind,
      year,
      month,
      [{ vehicleId, cents: amountCents }],
    );
    await assertPoolCapacity(tx, kind, year, month, [vehicleId], amountCents, poolCents);

    const baseAmount = Number(amountCents) / 100;
    return tx.vehicleBudget.upsert({
      where: { vehicleId_kind_year_month: { vehicleId, kind, year, month } },
      create: {
        vehicleId,
        kind,
        year,
        month,
        baseAmount,
        isCutOff: cutOffByVehicle.get(vehicleId) ?? false,
        createdBy: userId,
        updatedBy: userId,
      },
      update: {
        baseAmount,
        isCutOff: cutOffByVehicle.get(vehicleId) ?? false,
        updatedBy: userId,
      },
    });
  });
}

/**
 * Contrato heredado de distribución explícita. Se conserva por compatibilidad,
 * pero ya no calcula con floats ni acepta IDs repetidos/inactivos.
 */
export function distributeExplicitBudgets(input: DistributeBudgetInput, userId: number) {
  const vehicleIds = input.distributions.map((item) => item.vehicleId);
  const normalized = input.distributions.map((item) => ({
    vehicleId: item.vehicleId,
    cents: moneyAmountToCents(item.baseAmount),
  }));
  const totalCents = normalized.reduce((sum, item) => sum + item.cents, 0n);
  if (totalCents > MAX_MONTHLY_CENTS) {
    throw BadRequest('La distribución excede el máximo monetario permitido para un mes');
  }

  return prisma.$transaction(async (tx) => {
    const { kind, year, month } = input;
    await lockOpenBudgetPeriod(tx, kind, year, month);
    const poolCents = await lockMonthlyPoolCents(tx, kind, year, month);
    await lockExplicitActiveVehicleIds(tx, vehicleIds);
    const cutOffByVehicle = await validateReplacementAgainstSpent(
      tx,
      kind,
      year,
      month,
      normalized,
    );
    await assertPoolCapacity(tx, kind, year, month, vehicleIds, totalCents, poolCents);

    await upsertBudgetAllocationsInBatches(
      tx,
      { kind, year, month },
      normalized,
      cutOffByVehicle,
      userId,
    );

    return { count: normalized.length };
  });
}
