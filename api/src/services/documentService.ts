// Operaciones CRUD de documentos vehiculares con semáforo
import prisma from '../lib/prisma';
import { DocumentInput } from '../validators/documentValidator';
import { NotFound, Conflict } from '../middlewares/errorHandler';

/**
 * Calcula el estado del semáforo basado en la fecha de vencimiento.
 */
function calculateTrafficLight(expiresAt: Date): 'GREEN' | 'YELLOW' | 'RED' {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfExpiry = new Date(expiresAt);
  startOfExpiry.setHours(0, 0, 0, 0);
  const diffDays = Math.round((startOfExpiry.getTime() - startOfToday.getTime()) / 86400000);

  if (diffDays < 0) return 'RED';      // ya venció (antes de hoy)
  if (diffDays <= 30) return 'YELLOW'; // vence hoy o dentro de 30 días
  return 'GREEN';
}

/**
 * Traduce el tipo de documento al español.
 */
function docTypeLabel(type: string): string {
  const map: Record<string, string> = {
    INVOICE: 'Factura',
    INSURANCE: 'Póliza de seguro',
    VERIFICATION: 'Verificación vehicular',
    CIRCULATION_CARD: 'Tarjeta de circulación',
  };
  return map[type] || type;
}

/**
 * Obtener todos los documentos de un vehículo con semáforo calculado.
 */
export async function getDocumentsByVehicle(vehicleId: number) {
  const documents = await prisma.document.findMany({
    where: { vehicleId },
    orderBy: { expiresAt: 'asc' },
  });

  // Agregar semáforo calculado a cada documento
  return documents.map((doc) => ({
    ...doc,
    trafficLight: calculateTrafficLight(doc.expiresAt),
    typeLabel: docTypeLabel(doc.type),
  }));
}

/**
 * Obtener un documento por ID.
 */
export async function getDocumentById(id: number) {
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) throw NotFound('Documento');
  return {
    ...doc,
    trafficLight: calculateTrafficLight(doc.expiresAt),
    typeLabel: docTypeLabel(doc.type),
  };
}

/**
 * Crear un nuevo documento.
 * Valida que no exista ya un documento del mismo tipo vigente para ese vehículo.
 */
export async function createDocument(
  data: DocumentInput,
  file?: { filename: string; originalname: string }
) {
  // Verificar que el vehículo existe
  const vehicle = await prisma.vehicle.findUnique({ where: { id: data.vehicleId } });
  if (!vehicle) throw NotFound('Vehículo');

  // Verificar que no exista un documento del mismo tipo ya vigente
  const existing = await prisma.document.findFirst({
    where: {
      vehicleId: data.vehicleId,
      type: data.type,
      expiresAt: { gt: new Date() },
    },
  });

  if (existing) {
    throw Conflict(
      `Ya existe un documento de tipo "${docTypeLabel(data.type)}" vigente para este vehículo. ` +
      `Vence el ${existing.expiresAt.toLocaleDateString('es-MX')}. ` +
      `Puede editarlo o esperar a que venza.`
    );
  }

  const doc = await prisma.document.create({
    data: {
      vehicleId: data.vehicleId,
      type: data.type,
      issuedAt: new Date(data.issuedAt),
      expiresAt: new Date(data.expiresAt),
      fileUrl: file ? `/uploads/documents/${file.filename}` : null,
      fileName: file ? file.originalname : null,
      notes: data.notes || null,
    },
  });

  return {
    ...doc,
    trafficLight: calculateTrafficLight(doc.expiresAt),
    typeLabel: docTypeLabel(doc.type),
  };
}

/**
 * Actualizar un documento (renovar vigencia, cambiar archivo).
 */
export async function updateDocument(
  id: number,
  data: DocumentInput,
  file?: { filename: string; originalname: string }
) {
  const existing = await getDocumentById(id);

  const updateData: any = {
    type: data.type,
    issuedAt: new Date(data.issuedAt),
    expiresAt: new Date(data.expiresAt),
    notes: data.notes || null,
  };

  // Solo actualizar archivo si se envió uno nuevo
  if (file) {
    updateData.fileUrl = `/uploads/documents/${file.filename}`;
    updateData.fileName = file.originalname;
  }

  const doc = await prisma.document.update({
    where: { id },
    data: updateData,
  });

  return {
    ...doc,
    trafficLight: calculateTrafficLight(doc.expiresAt),
    typeLabel: docTypeLabel(doc.type),
  };
}

/**
 * Eliminar un documento.
 */
export async function deleteDocument(id: number) {
  await getDocumentById(id);
  return prisma.document.delete({ where: { id } });
}

/**
 * Resumen de documentos de un vehículo para la tabla principal.
 * Retorna el peor estado (RED > YELLOW > GREEN).
 */
export async function getVehicleDocSummary(vehicleId: number) {
  const docs = await getDocumentsByVehicle(vehicleId);

  if (docs.length === 0) return { total: 0, worst: 'NONE' as const, details: [] };

  let worst: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
  for (const doc of docs) {
    if (doc.trafficLight === 'RED') { worst = 'RED'; break; }
    if (doc.trafficLight === 'YELLOW') worst = 'YELLOW';
  }

  return {
    total: docs.length,
    worst,
    details: docs.map((d) => ({
      type: d.type,
      typeLabel: d.typeLabel,
      trafficLight: d.trafficLight,
      expiresAt: d.expiresAt,
    })),
  };
}