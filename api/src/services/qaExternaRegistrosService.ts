// Servicio del lado REVISOR_QA: lista registros qa_externa (paginado + filtros)
// y devuelve el set completo para exportar a ZIP. Refleja el patrón de
// fuelLoadService (where-building, Promise.all([findMany, count]), DTO + shape
// { data, pagination }).

import prisma from '../lib/prisma';
import { Prisma, QaExternaTipo, QaExternaPrograma } from '@prisma/client';

interface QaRegistrosListQuery {
  page?: number;
  limit?: number;
  tipo?: QaExternaTipo;
  programa?: QaExternaPrograma;
  dispositivo?: number;
  dateFrom?: string;
  dateTo?: string;
}

/** Imagen resumida en el DTO del listado (sin la ruta interna). */
export interface QaRegistroImagenDto {
  sha256: string;
  programa: QaExternaPrograma;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
}

/** Registro serializado para el listado del revisor. */
export interface QaRegistroDto {
  id: number;
  clienteRegistroId: string;
  identificadorApp: string;
  tipo: QaExternaTipo;
  programa: QaExternaPrograma;
  lat: number;
  lng: number;
  accuracy: number | null;
  capturadoAt: Date;
  notas: string | null;
  createdAt: Date;
  dispositivo: { id: number; identificador: string };
  imagenes: QaRegistroImagenDto[];
}

/** Fila cruda con relaciones para el listado y el export (tipada por Prisma). */
export type QaRegistroWithRelations = Prisma.QaExternaRegistroGetPayload<{
  include: {
    dispositivo: { select: { id: true; identificador: true } };
    imagenes: { include: { imagen: true } };
  };
}>;

export async function list(params: QaRegistrosListQuery) {
  const page = params.page || 1;
  const limit = params.limit || 20;
  const skip = (page - 1) * limit;

  const where: Prisma.QaExternaRegistroWhereInput = {};
  if (params.tipo) where.tipo = params.tipo;
  if (params.programa) where.programa = params.programa;
  if (params.dispositivo) where.dispositivoId = params.dispositivo;
  if (params.dateFrom || params.dateTo) {
    where.capturadoAt = {
      ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
      ...(params.dateTo ? { lte: new Date(params.dateTo + 'T23:59:59') } : {}),
    };
  }

  const [rows, total] = await Promise.all([
    prisma.qaExternaRegistro.findMany({
      where,
      skip,
      take: limit,
      orderBy: { capturadoAt: 'desc' },
      include: {
        dispositivo: { select: { id: true, identificador: true } },
        imagenes: { include: { imagen: true } },
      },
    }),
    prisma.qaExternaRegistro.count({ where }),
  ]);

  const data: QaRegistroDto[] = rows.map((row) => ({
    id: row.id,
    clienteRegistroId: row.clienteRegistroId,
    identificadorApp: row.identificadorApp,
    tipo: row.tipo,
    programa: row.programa,
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy,
    capturadoAt: row.capturadoAt,
    notas: row.notas,
    createdAt: row.createdAt,
    dispositivo: { id: row.dispositivo.id, identificador: row.dispositivo.identificador },
    imagenes: row.imagenes.map((ri) => ({
      sha256: ri.imagen.sha256,
      programa: ri.imagen.programa,
      mime: ri.imagen.mime,
      bytes: ri.imagen.bytes,
      width: ri.imagen.width,
      height: ri.imagen.height,
    })),
  }));

  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

/** Todos los registros (sin paginar) con relaciones, para construir el ZIP. */
export async function getAllForExport(
  programa: QaExternaPrograma,
): Promise<QaRegistroWithRelations[]> {
  return prisma.qaExternaRegistro.findMany({
    where: { programa },
    orderBy: { capturadoAt: 'desc' },
    include: {
      dispositivo: { select: { id: true, identificador: true } },
      imagenes: { include: { imagen: true } },
    },
  });
}
