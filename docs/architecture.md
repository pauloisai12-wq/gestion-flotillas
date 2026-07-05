# Architecture Overview

This project is a Docker Compose application with three main runtime areas:

- `api/`: Node.js, Express, TypeScript, Prisma, PostgreSQL, Redis/BullMQ.
- `web/`: Next.js frontend served as a production standalone build.
- `worker/`: Python reporting worker that reads from PostgreSQL/Redis and writes shared report files.

Persistent data lives in PostgreSQL plus shared storage volumes/bind mounts for uploads and reports. Public HTTP traffic goes through Caddy to the web service, and the web service proxies API calls to `api`.

Review-sensitive boundaries:

- Public and auth routes are mounted in `api/src/index.ts`.
- JWT authorization is handled by API middlewares and role checks.
- `qa_externa` device ingestion uses a separate Bearer API-key guard under `/api/qa-externa`.
- Database schema and migrations live under `api/prisma`.
- Uploaded files and generated reports are served only through authenticated routes or controlled static mounts.
