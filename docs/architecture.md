# Architecture Overview

This project is a Docker Compose application with three main runtime areas:

- `api/`: Node.js, Express, TypeScript, Prisma, PostgreSQL, Redis/BullMQ.
- `web/`: Next.js frontend served as a production standalone build.
- `worker/`: Python worker that consumes report and QA-export jobs, reads from
  PostgreSQL/Redis and writes immutable artifacts to shared report storage.

Persistent data lives in PostgreSQL plus shared storage volumes for uploads and
reports. The supported production target is Hetzner Cloud through
`deploy-public.sh` and `docker-compose.public.yml`; the home-server profile is
legacy. Public HTTP traffic goes through Caddy to the web service, and the web
service proxies API calls to `api`. PostgreSQL, Redis, API and web do not publish
host ports in the public profile.

Heavy work is durable and asynchronous:

- report generation uses a PostgreSQL outbox and the BullMQ `reports` queue;
- QA exports use `data_jobs` plus the `data-jobs` queue and stream records in
  batches from the Python worker;
- vehicle imports use `data_jobs` plus `vehicle-imports`, with a bounded parser
  thread and batched identifier lookups;
- QA/ticket thumbnails use `media-processing` and private immutable caching.

The Python worker publishes a heartbeat consumed by its Docker healthcheck. The
host-side public monitor also checks containers, individual BullMQ queues, disk,
backup age and optional public HTTPS, and sends deduplicated webhook alerts.

Review-sensitive boundaries:

- Public and auth routes are mounted in `api/src/index.ts`.
- JWT authorization is handled by API middlewares and role checks.
- `qa_externa` device ingestion uses a separate Bearer API-key guard under `/api/qa-externa`.
- Database schema and migrations live under `api/prisma`.
- Uploaded files and generated reports are served only through authenticated routes or controlled static mounts.
- `api/prisma/migrations/20260715040000_data_jobs` defines the durable async-job
  state used by imports and QA exports.
- Operational recovery and alert drills are documented in `docs/runbook-hetzner.md`.

Vehicle deactivation is a fail-closed, soft-delete workflow. Operational fleet
counts, document alerts, rankings and current budget allocation views exclude
inactive vehicles. Historical facts do not: approved fuel amount, liters, load
count and efficiency remain in period totals after deactivation. An import may
deactivate an existing vehicle, but it cannot reactivate one. Deactivation is
rejected while any non-terminal maintenance ticket exists so a reserved amount
cannot become stranded or be released without an explicit business decision.
