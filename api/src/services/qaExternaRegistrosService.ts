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
  thumbnailUrl: string;
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

export async function list(params: QaRegistrosListQuery) {
  const page = params.page || 1;
  const limit = params.limit || 20;
  const skip = (page - 1) * limit;

  const where: Prisma.QaExternaRegistroWhereInput = {};
  if (params.tipo) where.tipo = params.tipo;
  if (params.programa) where.programa = params.programa;
  if (params.dispositivo) where.dispositivoId = params.dispositivo;
  // Rango acotado SIEMPRE en UTC y con límite superior EXCLUSIVO, igual que la
  // exportación (qaExternaRegistrosRouter.ts:135-137). Antes se usaba
  // `new Date(dateTo + 'T23:59:59')`, que el motor interpreta en la hora LOCAL
  // del proceso: en un contenedor con TZ distinta de UTC el día pedido se
  // corría y se perdía o colaba la última hora de capturas. `new Date(dateFrom)`
  // sí era UTC, pero solo por accidente del formato AAAA-MM-DD.
  if (params.dateFrom || params.dateTo) {
    const dateToExclusive = params.dateTo ? new Date(`${params.dateTo}T00:00:00.000Z`) : null;
    if (dateToExclusive) dateToExclusive.setUTCDate(dateToExclusive.getUTCDate() + 1);
    where.capturadoAt = {
      ...(params.dateFrom ? { gte: new Date(`${params.dateFrom}T00:00:00.000Z`) } : {}),
      ...(dateToExclusive ? { lt: dateToExclusive } : {}),
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
      thumbnailUrl: `/api/qa-externa-registros/imagenes/${ri.imagen.programa}/${ri.imagen.sha256}/thumbnail`,
    })),
  }));

  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}
