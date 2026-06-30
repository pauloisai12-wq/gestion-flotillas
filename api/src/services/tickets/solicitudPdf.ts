// api/src/services/tickets/solicitudPdf.ts
// Genera (on-demand, síncrono) el PDF de la "Solicitud de mantenimiento".
// Se regenera SIEMPRE desde los datos → refleja el estatus actual (Pendiente/Autorizado).
// Implementado con React.createElement (sin JSX) para NO tocar el tsconfig del backend.

import React from 'react';
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { UserRole, FailureCategory, MaintenanceTicketStatus } from '@prisma/client';
import type { SolicitudData } from './queries';

const el = React.createElement;

const PUESTO_POR_ROL: Record<UserRole, string> = {
  ADMIN: 'Administrador',
  SUPERVISOR_VEHICLES: 'Supervisor de Vehículos',
  SUPERVISOR_FUEL: 'Supervisor de Combustible',
  SUPERVISOR_MAINTENANCE: 'Supervisor de Mantenimiento',
  EXECUTOR: 'Ejecutor',
  WORKSHOP: 'Taller',
  REVISOR_QA: 'Revisor',
};

const CATEGORIA_FALLA: Record<FailureCategory, string> = {
  ENGINE: 'Motor',
  TRANSMISSION: 'Transmisión',
  BRAKES: 'Frenos',
  ELECTRICAL: 'Sistema eléctrico',
  BODY_PAINT: 'Carrocería y pintura',
  TIRES_SUSPENSION: 'Llantas y suspensión',
  AC_CLIMATE: 'Aire acondicionado / clima',
  PREVENTIVE: 'Mantenimiento preventivo',
  OTHER: 'Otro',
};

function fmtDate(value: Date | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function estatusAutorizacion(status: MaintenanceTicketStatus, approvedAt: Date | null): string {
  if (approvedAt) return 'Autorizado';
  if (status === 'REJECTED_BY_ADMIN' || status === 'REJECTED_FINAL') return 'Rechazado';
  return 'Pendiente';
}

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: 'Helvetica', color: '#1a1a1a' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 2,
    borderBottomColor: '#1a1a1a',
    paddingBottom: 8,
    marginBottom: 14,
  },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  subtitle: { fontSize: 9, color: '#666666', marginTop: 2 },
  metaBox: { alignItems: 'flex-end' },
  metaFolio: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  metaDate: { fontSize: 9, color: '#444444', marginTop: 2 },
  section: { marginBottom: 12 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    backgroundColor: '#f0f0f0',
    padding: 4,
    marginBottom: 6,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '50%', marginBottom: 4, flexDirection: 'row' },
  cellFull: { width: '100%', marginBottom: 4, flexDirection: 'row' },
  label: { fontFamily: 'Helvetica-Bold', marginRight: 4 },
  value: { flex: 1 },
  detail: { padding: 6, borderWidth: 1, borderColor: '#dddddd', minHeight: 50 },
  signatures: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 36 },
  sigBlock: { width: '45%' },
  sigLine: { borderTopWidth: 1, borderTopColor: '#1a1a1a', marginBottom: 4, paddingTop: 4 },
  sigName: { fontFamily: 'Helvetica-Bold' },
  sigRole: { fontSize: 9, color: '#444444' },
  sigMeta: { fontSize: 9, color: '#444444', marginTop: 2 },
});

function field(label: string, value: string, full = false) {
  return el(
    View,
    { style: full ? styles.cellFull : styles.cell },
    el(Text, { style: styles.label }, label),
    el(Text, { style: styles.value }, value || '—'),
  );
}

function SolicitudDocument(data: SolicitudData) {
  const v = data.vehicle;
  const elaboro = data.requestedBy;
  const autoriza = data.approvedByAdmin;
  const estatus = estatusAutorizacion(data.status, data.approvedAt);
  const odometro =
    data.odometerStatus === 'NF'
      ? 'No funciona'
      : data.reportedOdometer != null
        ? `${data.reportedOdometer} km`
        : '—';

  return el(
    Document,
    { title: `Solicitud ${data.folio ?? data.id}`, author: 'Gestión de Flotillas' },
    el(
      Page,
      { size: 'LETTER', style: styles.page },
      // ── Encabezado ────────────────────────────────────────────────
      el(
        View,
        { style: styles.header },
        el(
          View,
          {},
          el(Text, { style: styles.title }, 'SOLICITUD DE MANTENIMIENTO'),
          el(Text, { style: styles.subtitle }, 'Gestión de Flotillas'),
        ),
        el(
          View,
          { style: styles.metaBox },
          el(Text, { style: styles.metaFolio }, `Folio: ${data.folio ?? '—'}`),
          el(Text, { style: styles.metaDate }, `Fecha: ${fmtDate(data.createdAt)}`),
        ),
      ),
      // ── Datos de la unidad ────────────────────────────────────────
      el(
        View,
        { style: styles.section },
        el(Text, { style: styles.sectionTitle }, 'DATOS DE LA UNIDAD'),
        el(
          View,
          { style: styles.grid },
          field('Núm. económico:', v.economicNumber),
          field('CIV:', v.civ ?? '—'),
          field('Placa:', v.plate),
          field('Serie (VIN):', v.vin ?? '—'),
          field('Marca / Modelo / Año:', `${v.brand} ${v.model} ${v.year}`, true),
        ),
      ),
      // ── Detalle de la solicitud ───────────────────────────────────
      el(
        View,
        { style: styles.section },
        el(Text, { style: styles.sectionTitle }, 'DETALLE DE LA SOLICITUD'),
        el(
          View,
          { style: styles.grid },
          field('Categoría:', CATEGORIA_FALLA[data.failureCategory]),
          field('Odómetro:', odometro),
        ),
        el(View, { style: styles.detail }, el(Text, {}, data.description)),
      ),
      // ── Firmas: Elaboró / Autoriza ────────────────────────────────
      el(
        View,
        { style: styles.signatures },
        el(
          View,
          { style: styles.sigBlock },
          el(View, { style: styles.sigLine }),
          el(Text, { style: styles.sigName }, elaboro.fullName),
          el(Text, { style: styles.sigRole }, PUESTO_POR_ROL[elaboro.role]),
          el(Text, { style: styles.sigMeta }, `Elaboró · ${fmtDate(data.createdAt)}`),
        ),
        el(
          View,
          { style: styles.sigBlock },
          el(View, { style: styles.sigLine }),
          el(Text, { style: styles.sigName }, autoriza ? autoriza.fullName : ' '),
          el(Text, { style: styles.sigRole }, autoriza ? PUESTO_POR_ROL[autoriza.role] : 'Autorizador'),
          el(
            Text,
            { style: styles.sigMeta },
            `Autoriza · Estatus: ${estatus}${data.approvedAt ? ' · ' + fmtDate(data.approvedAt) : ''}`,
          ),
        ),
      ),
    ),
  );
}

export function renderSolicitudPdf(data: SolicitudData): Promise<Buffer> {
  return renderToBuffer(SolicitudDocument(data) as React.ReactElement);
}
