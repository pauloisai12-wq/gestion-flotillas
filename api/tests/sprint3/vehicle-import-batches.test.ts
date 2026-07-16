import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  vehicleFindMany: vi.fn(),
  vehicleUpdate: vi.fn(),
  transaction: vi.fn(),
  executeRawUnsafe: vi.fn(),
  vehicleTypeFindMany: vi.fn(),
  operatorFindMany: vi.fn(),
  userFindFirst: vi.fn(),
}));

const tx = {
  $executeRawUnsafe: mocks.executeRawUnsafe,
  vehicle: { update: mocks.vehicleUpdate },
};

vi.mock('../../src/lib/prisma', () => ({
  default: {
    vehicle: { findMany: mocks.vehicleFindMany },
    vehicleType: { findMany: mocks.vehicleTypeFindMany },
    operator: { findMany: mocks.operatorFindMany },
    user: { findFirst: mocks.userFindFirst },
    $transaction: mocks.transaction,
  },
}));
vi.mock('../../src/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

import {
  ImportValidationError,
  importVehiclesFromBuffer,
  publicImportErrorMessage,
} from '../../src/services/vehicleImportService';

function workbookBuffer(headers: string[], row: Array<string | number>) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([headers, row]),
    'Flota',
  );
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

describe('límites y lotes de importación', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.vehicleTypeFindMany.mockResolvedValue([]);
    mocks.operatorFindMany.mockResolvedValue([]);
    mocks.userFindFirst.mockResolvedValue(null);
    mocks.executeRawUnsafe.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
  });

  it('rechaza el libro antes de consultar BD cuando rebasa el máximo', async () => {
    const rows: Array<Array<string | number>> = [
      ['Placa', 'No Economico', 'Expediente'],
    ];
    for (let i = 0; i < 101; i += 1) rows.push([`P-${i}`, `E-${i}`, `X-${i}`]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Flota');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    await expect(importVehiclesFromBuffer(buffer, { maxRows: 100 }))
      .rejects.toThrow('101 filas');
  });

  it('precarga identificadores en bloques de 500 sin findUnique por fila', () => {
    const source = fs.readFileSync(
      path.resolve('src/services/vehicleImportService.ts'),
      'utf8',
    );
    expect(source).toContain('const LOOKUP_BATCH_SIZE = 500');
    expect(source).toContain('where: { OR: where }');
    expect(source).not.toContain('prisma.vehicle.findUnique');
    expect(source).toContain('new ThreadWorker(FILE_PARSER_WORKER');
    expect(source).toContain('maxOldGenerationSizeMb: 256');
    expect(source).toContain('const PARSER_TIMEOUT_MS = 120_000');
    expect(source).toContain('void worker.terminate()');
    expect(source).toContain("new ImportValidationError('No se pudo leer el archivo Excel/CSV')");
    expect(source).toContain('deactivateVehicleInTransaction(tx, existing.id');
    expect(source).toContain("source: 'VEHICLE_IMPORT'");
    expect(source).toContain('isActive: expected.isActive');
    expect(source).toContain('updatedAt: expected.updatedAt');
  });

  it('preserva inactiva una unidad existente cuando la columna estatus falta', async () => {
    const updatedAt = new Date('2026-07-16T12:00:00.000Z');
    const existing = {
      id: 7,
      economicNumber: 'E-7',
      expedientNumber: null,
      plate: 'P-7',
      vin: null,
      isActive: false,
      updatedAt,
    };
    mocks.vehicleFindMany.mockResolvedValue([existing]);
    mocks.vehicleUpdate.mockImplementation(async ({ data }) => ({
      ...existing,
      ...data,
      updatedAt: new Date('2026-07-16T12:01:00.000Z'),
    }));

    const result = await importVehiclesFromBuffer(
      workbookBuffer(['Placa', 'No Economico'], ['P-7', 'E-7']),
    );

    expect(result).toMatchObject({ updated: 1, created: 0, errors: [] });
    expect(mocks.vehicleUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 7, isActive: false, updatedAt },
      data: expect.not.objectContaining({ isActive: expect.anything() }),
    }));
  });

  it('rechaza una reactivación explícita de una unidad existente inactiva', async () => {
    mocks.vehicleFindMany.mockResolvedValue([{
      id: 7,
      economicNumber: 'E-7',
      expedientNumber: null,
      plate: 'P-7',
      vin: null,
      isActive: false,
      updatedAt: new Date('2026-07-16T12:00:00.000Z'),
    }]);

    const result = await importVehiclesFromBuffer(
      workbookBuffer(
        ['Placa', 'No Economico', 'Estatus', 'Tipo'],
        ['P-7', 'E-7', 'ALTA', 'TIPO QUE NO DEBE CREARSE'],
      ),
    );

    expect(result.updated).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('intenta reactivar');
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.vehicleUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['No Economico', 'E-7'],
    ['Expediente', 'X-7'],
    ['Placa', 'P-7'],
    ['Serie', 'VIN-7'],
  ])(
    'no crea un duplicado activo si solo %s coincide con una unidad inactiva',
    async (header, value) => {
      mocks.vehicleFindMany.mockResolvedValue([{
        id: 7,
        economicNumber: 'E-7',
        expedientNumber: 'X-7',
        plate: 'P-7',
        vin: 'VIN-7',
        isActive: false,
        updatedAt: new Date('2026-07-16T12:00:00.000Z'),
      }]);

      const result = await importVehiclesFromBuffer(
        workbookBuffer([header], [value]),
      );

      expect(result).toMatchObject({ created: 0, updated: 0 });
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('coincide con una unidad dada de baja');
      expect(result.errors[0].message).toContain('dos identificadores coincidentes');
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.vehicleUpdate).not.toHaveBeenCalled();
    },
  );

  it('rechaza ALTA con una sola placa que coincide con una unidad inactiva', async () => {
    mocks.vehicleFindMany.mockResolvedValue([{
      id: 7,
      economicNumber: 'E-7',
      expedientNumber: 'X-7',
      plate: 'P-7',
      vin: 'VIN-7',
      isActive: false,
      updatedAt: new Date('2026-07-16T12:00:00.000Z'),
    }]);

    const result = await importVehiclesFromBuffer(
      workbookBuffer(['Placa', 'Estatus'], ['P-7', 'ALTA']),
    );

    expect(result).toMatchObject({ created: 0, updated: 0 });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('coincide con una unidad dada de baja');
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.vehicleUpdate).not.toHaveBeenCalled();
  });

  it('el CAS aborta el update si una baja concurrente cambió la unidad', async () => {
    const updatedAt = new Date('2026-07-16T12:00:00.000Z');
    mocks.vehicleFindMany.mockResolvedValue([{
      id: 7,
      economicNumber: 'E-7',
      expedientNumber: null,
      plate: 'P-7',
      vin: null,
      isActive: true,
      updatedAt,
    }]);
    mocks.vehicleUpdate.mockRejectedValue({ code: 'P2025' });

    const result = await importVehiclesFromBuffer(
      workbookBuffer(['Placa', 'No Economico'], ['P-7', 'E-7']),
    );

    expect(mocks.vehicleUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 7, isActive: true, updatedAt },
      data: expect.not.objectContaining({ isActive: expect.anything() }),
    }));
    expect(result.updated).toBe(0);
    expect(result.errors[0].message).toContain('cambió o fue dado de baja');
  });

  it('no expone mensajes internos de Prisma o rutas del servidor', () => {
    const internal = new Error(
      'Invalid prisma.vehicle.create() at /app/src/service.ts:88; password=secret',
    );
    const publicMessage = publicImportErrorMessage(internal, 'job');
    expect(publicMessage).toContain('error interno');
    expect(publicMessage).not.toContain('prisma');
    expect(publicMessage).not.toContain('/app/');
    expect(publicMessage).not.toContain('secret');

    expect(publicImportErrorMessage(
      new ImportValidationError('El archivo contiene demasiadas filas'),
      'job',
    )).toBe('El archivo contiene demasiadas filas');
  });
});
