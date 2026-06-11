// Operaciones CRUD de operadores
import prisma from '../lib/prisma';
import { OperatorInput } from '../validators/operatorValidator';
import { NotFound, Conflict } from '../middlewares/errorHandler';

interface OperatorQuery {
  page?: number;
  limit?: number;
  search?: string;
}

export async function getAllOperators(query: OperatorQuery) {
  const page = query.page || 1;
  const limit = query.limit || 20;
  const skip = (page - 1) * limit;

  const where: any = {};

  if (query.search) {
    where.OR = [
      { fullName: { contains: query.search, mode: 'insensitive' } },
      { licenseNumber: { contains: query.search, mode: 'insensitive' } },
      { phone: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const [operators, total] = await Promise.all([
    prisma.operator.findMany({
      where,
      skip,
      take: limit,
      orderBy: { fullName: 'asc' },
      include: {
        _count: {
          select: { assignments: true, fuelLoads: true },
        },
      },
    }),
    prisma.operator.count({ where }),
  ]);

  return {
    data: operators,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getOperatorById(id: number) {
  const operator = await prisma.operator.findUnique({
    where: { id },
    include: {
      assignments: {
        include: {
          vehicle: { select: { id: true, plate: true, economicNumber: true } },
        },
        orderBy: { startDate: 'desc' },
        take: 10,
      },
      _count: {
        select: { assignments: true, fuelLoads: true },
      },
    },
  });

  if (!operator) throw NotFound('Operador');
  return operator;
}

export async function createOperator(data: OperatorInput) {
  const existing = await prisma.operator.findUnique({
    where: { licenseNumber: data.licenseNumber },
  });
  if (existing) {
    throw Conflict(`Ya existe un operador con la licencia "${data.licenseNumber}"`);
  }

  return prisma.operator.create({
    data: {
      employeeNumber: data.employeeNumber,
      fullName: data.fullName,
      licenseNumber: data.licenseNumber,
      licenseType: data.licenseType,
      licenseExpiresAt: new Date(data.licenseExpiresAt),
      phone: data.phone || null,
      email: data.email || null,
      isActive: data.isActive ?? true,
    },
  });
}

export async function updateOperator(id: number, data: OperatorInput) {
  await getOperatorById(id);

  const existing = await prisma.operator.findFirst({
    where: { licenseNumber: data.licenseNumber, NOT: { id } },
  });
  if (existing) {
    throw Conflict(`Ya existe otro operador con la licencia "${data.licenseNumber}"`);
  }

  return prisma.operator.update({
    where: { id },
    data: {
      fullName: data.fullName,
      licenseNumber: data.licenseNumber,
      licenseType: data.licenseType,
      licenseExpiresAt: new Date(data.licenseExpiresAt),
      phone: data.phone || null,
      email: data.email || null,
      isActive: data.isActive,
    },
  });
}

export async function deleteOperator(id: number) {
  const operator = await getOperatorById(id);

  if (operator._count.fuelLoads > 0) {
    throw Conflict('No se puede eliminar: el operador tiene cargas de combustible registradas');
  }

  await prisma.vehicleAssignment.deleteMany({ where: { operatorId: id } });
  return prisma.operator.delete({ where: { id } });
}