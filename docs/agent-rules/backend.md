# Backend Audit Checklist

- Review only changed backend files and nearby call sites first.
- Check Express route order, auth middleware, role checks, validation, and error handling.
- Check Prisma calls for missing transactions, unbounded reads, unsafe raw SQL, and data consistency.
- Check BullMQ/jobs for retries, concurrency, idempotency, and graceful shutdown.
- Check upload/download paths for size limits, path traversal defenses, and sensitive-data exposure.
- Prefer `npm run build`, `npx tsc --noEmit`, `npx prisma validate`, dependency audit, and configured security checks when available.
