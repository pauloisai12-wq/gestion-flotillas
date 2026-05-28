// /api/src/services/maintenanceTicketService.ts
// Entry point del flujo de tickets de mantenimiento.
//
// El código real vive partido en api/src/services/tickets/:
//   - shared.ts      → TicketError, MAX_ATTACHMENTS, helpers internos
//   - createFlow.ts  → createTicket, addAttachment, rejectTicket, assignWorkshops
//   - quoteFlow.ts   → submitQuote, declineQuote
//   - approveFlow.ts → approveTicket, startRepair, completeRepair
//   - queries.ts     → getTicketById, listTickets, getBudgetContext
//
// Este archivo re-exporta la API pública sin cambios para no romper los
// `import * as ticketService from '../services/maintenanceTicketService'`
// que ya existen en routers y otros services.

export { TicketError } from './tickets/shared';

export {
  createTicket,
  addAttachment,
  rejectTicket,
  assignWorkshops,
} from './tickets/createFlow';

export { submitQuote, declineQuote } from './tickets/quoteFlow';

export {
  approveTicket,
  startRepair,
  completeRepair,
} from './tickets/approveFlow';

export {
  getTicketById,
  listTickets,
  getBudgetContext,
} from './tickets/queries';
