// /web/src/hooks/useMaintenanceTickets.ts
// Hooks de React Query para el flujo de tickets de mantenimiento.
// Único punto de acceso al API de tickets desde el frontend.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

// ═══════════════════════════════════════════════════════════════
// Tipos compartidos con el backend
// ═══════════════════════════════════════════════════════════════

export type MaintenanceTicketStatus =
  | 'PENDING_ADMIN_APPROVAL'
  | 'REJECTED_BY_ADMIN'
  | 'AWAITING_QUOTES'
  | 'REJECTED_FINAL'
  | 'APPROVED_FOR_REPAIR'
  | 'IN_REPAIR'
  | 'COMPLETED';

export type FailureCategory =
  | 'ENGINE'
  | 'TRANSMISSION'
  | 'BRAKES'
  | 'ELECTRICAL'
  | 'BODY_PAINT'
  | 'TIRES_SUSPENSION'
  | 'AC_CLIMATE'
  | 'PREVENTIVE'
  | 'OTHER';

export interface VehicleSummary {
  id: number;
  economicNumber: string;
  plate: string;
  vin?: string | null;
  civ?: string | null;
  brand?: string;
  model?: string;
  year?: number;
}

export interface UserSummary {
  id: number;
  fullName: string;
  email?: string;
}

export interface WorkshopSummary {
  id: number;
  legalName: string;
  tradeName?: string | null;
  rfc?: string;
  email?: string;
  phone?: string;
}

/** Resumen del ticket embebido dentro de una cotización (respuesta de /ticket-quotes/mine). */
export interface QuoteTicketSummary {
  id: number;
  status: MaintenanceTicketStatus;
  description: string;
  failureCategory: FailureCategory;
  createdAt: string;
  vehicle: VehicleSummary;
}

export interface TicketQuote {
  id: number;
  ticketId: number;
  workshopId: number;
  workshop?: WorkshopSummary;
  amount: string | number | null;
  pdfUrl: string | null;
  pdfFileName: string | null;
  diagnosisNotes: string | null;
  submittedAt: string | null;
  isWinner: boolean;
  declinedAt: string | null;
  declineReason: string | null;
  createdAt: string;
  updatedAt: string;
  /** Presente solo en la respuesta de /ticket-quotes/mine (vista del taller). */
  ticket?: QuoteTicketSummary;
}

export interface TicketAttachment {
  id: number;
  ticketId: number;
  fileUrl: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
}

export interface MaintenanceTicket {
  id: number;
  folio?: string | null;
  vehicleId: number;
  vehicle?: VehicleSummary;
  requestedById: number;
  requestedBy?: UserSummary;
  failureCategory: FailureCategory;
  description: string;
  reportedOdometer: number | null;
  odometerStatus: 'OK' | 'NF';
  status: MaintenanceTicketStatus;
  rejectionReason: string | null;
  rejectedAt: string | null;
  rejectedById: number | null;
  rejectedBy?: UserSummary | null;
  finalConcept: string | null;
  selectedQuoteId: number | null;
  selectedQuote?: TicketQuote | null;
  approvedByAdminId: number | null;
  approvedByAdmin?: UserSummary | null;
  approvedAt: string | null;
  repairStartedAt: string | null;
  repairCompletedAt: string | null;
  completedRecordId: number | null;
  createdAt: string;
  updatedAt: string;
  quotes?: TicketQuote[];
  attachments?: TicketAttachment[];
}

export interface BudgetContext {
  ticket: { id: number; vehicle: VehicleSummary };
  budget: {
    baseAmount: number;
    rolloverIn: number;
    spentAmount: number;
    available: number;
    isCutOff: boolean;
  } | null;
  quotes: Array<{
    id: number;
    workshop: string;
    amount: number | null;
    status: 'SUBMITTED' | 'DECLINED' | 'PENDING';
    fits: boolean | null;
  }>;
}

export interface ListFilters {
  status?: MaintenanceTicketStatus;
  vehicleId?: number;
  page?: number;
  limit?: number;
}

// ═══════════════════════════════════════════════════════════════
// Lecturas
// ═══════════════════════════════════════════════════════════════

export function useTickets(filters: ListFilters = {}) {
  return useQuery({
    queryKey: ['maintenance-tickets', filters],
    queryFn: async () => {
      const { data } = await api.get<{
        tickets: MaintenanceTicket[];
        total: number;
        page: number;
        limit: number;
      }>('/maintenance-tickets', { params: filters });
      return data;
    },
  });
}

export interface SearchTicketFilters {
  civ?: string;
  placa?: string;
  serie?: string;
  folio?: string;
  page?: number;
  limit?: number;
}

/** Búsqueda del revisor (ADMIN / SUP_MAINT) por CIV / placa / serie / folio. */
export function useSearchTickets(filters: SearchTicketFilters, enabled: boolean) {
  return useQuery({
    queryKey: ['maintenance-tickets', 'search', filters],
    queryFn: async () => {
      const { data } = await api.get<{
        tickets: MaintenanceTicket[];
        total: number;
        page: number;
        limit: number;
      }>('/maintenance-tickets/search', { params: filters });
      return data;
    },
    enabled,
  });
}

export function useTicket(id: number | null) {
  return useQuery({
    queryKey: ['maintenance-tickets', id],
    queryFn: async () => {
      const { data } = await api.get<MaintenanceTicket>(`/maintenance-tickets/${id}`);
      return data;
    },
    enabled: id !== null && id > 0,
  });
}

/** Contexto de presupuesto vs cotizaciones — usado por el admin al decidir. */
export function useBudgetContext(ticketId: number | null) {
  return useQuery({
    queryKey: ['maintenance-tickets', ticketId, 'budget-context'],
    queryFn: async () => {
      const { data } = await api.get<BudgetContext>(
        `/maintenance-tickets/${ticketId}/budget-context`,
      );
      return data;
    },
    enabled: ticketId !== null && ticketId > 0,
  });
}

/** Cotizaciones del taller logueado (solo role=WORKSHOP). */
export function useMyQuotes() {
  return useQuery({
    queryKey: ['my-quotes'],
    queryFn: async () => {
      const { data } = await api.get<{ quotes: TicketQuote[] }>('/ticket-quotes/mine');
      return data.quotes;
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// Mutaciones — Ejecutor
// ═══════════════════════════════════════════════════════════════

export interface CreateTicketInput {
  vehicleId: number;
  failureCategory?: FailureCategory;
  description: string;
  reportedOdometer?: number | null;
  odometerStatus?: 'OK' | 'NF';
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTicketInput) => {
      const { data } = await api.post<MaintenanceTicket>('/maintenance-tickets', input);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance-tickets'] });
    },
  });
}

export function useUploadAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ticketId, file }: { ticketId: number; file: File }) => {
      const fd = new FormData();
      fd.append('photo', file);
      const { data } = await api.post<TicketAttachment>(
        `/maintenance-tickets/${ticketId}/attachments`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['maintenance-tickets', vars.ticketId] });
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// Mutaciones — Admin
// ═══════════════════════════════════════════════════════════════

export function useRejectTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ticketId, rejectionReason }: { ticketId: number; rejectionReason: string }) => {
      const { data } = await api.post<MaintenanceTicket>(
        `/maintenance-tickets/${ticketId}/reject`,
        { rejectionReason },
      );
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['maintenance-tickets'] });
      qc.invalidateQueries({ queryKey: ['maintenance-tickets', vars.ticketId] });
    },
  });
}

export function useAssignWorkshops() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ticketId, workshopIds }: { ticketId: number; workshopIds: number[] }) => {
      const { data } = await api.post<MaintenanceTicket>(
        `/maintenance-tickets/${ticketId}/assign-workshops`,
        { workshopIds },
      );
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['maintenance-tickets'] });
      qc.invalidateQueries({ queryKey: ['maintenance-tickets', vars.ticketId] });
    },
  });
}

export function useApproveTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      ticketId: number;
      selectedQuoteId: number;
      finalConcept: string;
    }) => {
      const { data } = await api.post<MaintenanceTicket>(
        `/maintenance-tickets/${params.ticketId}/approve`,
        { selectedQuoteId: params.selectedQuoteId, finalConcept: params.finalConcept },
      );
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['maintenance-tickets'] });
      qc.invalidateQueries({ queryKey: ['maintenance-tickets', vars.ticketId] });
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// Mutaciones — Taller
// ═══════════════════════════════════════════════════════════════

export function useSubmitQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      quoteId: number;
      amount: number;
      diagnosisNotes?: string;
      pdf: File;
    }) => {
      const fd = new FormData();
      fd.append('amount', String(params.amount));
      if (params.diagnosisNotes) fd.append('diagnosisNotes', params.diagnosisNotes);
      fd.append('pdf', params.pdf);
      const { data } = await api.post<TicketQuote>(
        `/ticket-quotes/${params.quoteId}/submit`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-quotes'] });
      qc.invalidateQueries({ queryKey: ['maintenance-tickets'] });
    },
  });
}

export function useDeclineQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ quoteId, declineReason }: { quoteId: number; declineReason: string }) => {
      const { data } = await api.post<TicketQuote>(
        `/ticket-quotes/${quoteId}/decline`,
        { declineReason },
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-quotes'] });
      qc.invalidateQueries({ queryKey: ['maintenance-tickets'] });
    },
  });
}

export function useStartRepair() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ticketId: number) => {
      const { data } = await api.post<MaintenanceTicket>(
        `/maintenance-tickets/${ticketId}/start-repair`,
      );
      return data;
    },
    onSuccess: (_d, ticketId) => {
      qc.invalidateQueries({ queryKey: ['maintenance-tickets'] });
      qc.invalidateQueries({ queryKey: ['maintenance-tickets', ticketId] });
    },
  });
}

export interface CompleteRepairInput {
  serviceId: number;
  finalOdometer?: number | null;
  finalOdometerStatus?: 'OK' | 'NF';
  evidenceNotes?: string;
}

export function useCompleteRepair() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ticketId, ...input }: { ticketId: number } & CompleteRepairInput) => {
      const { data } = await api.post<MaintenanceTicket>(
        `/maintenance-tickets/${ticketId}/complete-repair`,
        input,
      );
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['maintenance-tickets'] });
      qc.invalidateQueries({ queryKey: ['maintenance-tickets', vars.ticketId] });
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// Utilidades de presentación (sin estado)
// ═══════════════════════════════════════════════════════════════

export const STATUS_LABELS: Record<MaintenanceTicketStatus, string> = {
  PENDING_ADMIN_APPROVAL: 'Pendiente aprobación',
  REJECTED_BY_ADMIN: 'Rechazado',
  AWAITING_QUOTES: 'Esperando cotizaciones',
  REJECTED_FINAL: 'Rechazado tras cotizar',
  APPROVED_FOR_REPAIR: 'Aprobado',
  IN_REPAIR: 'En reparación',
  COMPLETED: 'Completado',
};

export const CATEGORY_LABELS: Record<FailureCategory, string> = {
  ENGINE: 'Motor',
  TRANSMISSION: 'Transmisión',
  BRAKES: 'Frenos',
  ELECTRICAL: 'Sistema eléctrico',
  BODY_PAINT: 'Carrocería / Pintura',
  TIRES_SUSPENSION: 'Llantas / Suspensión',
  AC_CLIMATE: 'A/C',
  PREVENTIVE: 'Preventivo',
  OTHER: 'Otro',
};

// ── Vista del EJECUTOR ──────────────────────────────────────────
// El ejecutor no ve el detalle interno de cotizaciones; los 7 estados del
// sistema se agrupan en 4 que le importan a quien solicitó la reparación.
export type ExecutorStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'COMPLETED';

export function toExecutorStatus(s: MaintenanceTicketStatus): ExecutorStatus {
  switch (s) {
    case 'PENDING_ADMIN_APPROVAL':
    case 'AWAITING_QUOTES':
      return 'PENDING';
    case 'APPROVED_FOR_REPAIR':
    case 'IN_REPAIR':
      return 'ACCEPTED';
    case 'REJECTED_BY_ADMIN':
    case 'REJECTED_FINAL':
      return 'REJECTED';
    case 'COMPLETED':
      return 'COMPLETED';
  }
}

export const EXECUTOR_STATUS_LABELS: Record<ExecutorStatus, string> = {
  PENDING: 'Pendiente',
  ACCEPTED: 'Aceptado',
  REJECTED: 'No aceptado',
  COMPLETED: 'Finalizado',
};

export const EXECUTOR_STATUS_COLORS: Record<ExecutorStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  ACCEPTED: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  REJECTED: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  COMPLETED: 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-200',
};

/** Para `class=` con Tailwind. Mantenemos los colores aquí para que el badge sea consistente entre listas/cards/detalles. */
export const STATUS_COLORS: Record<MaintenanceTicketStatus, string> = {
  PENDING_ADMIN_APPROVAL: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  REJECTED_BY_ADMIN: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  AWAITING_QUOTES: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  REJECTED_FINAL: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  APPROVED_FOR_REPAIR: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  IN_REPAIR: 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200',
  COMPLETED: 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-200',
};
