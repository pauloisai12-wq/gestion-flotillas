# Linux Readiness Checklist

- Do not modify or restart host services during audit.
- Check Compose service names, healthchecks, restart policies, dependency ordering, and migration one-shots.
- Check environment variables against `api/src/config/env.ts`.
- Check persistence for PostgreSQL, Redis, uploads, reports, Caddy data, and backups.
- Check exposed ports, Caddy routing, TLS mode, `TRUST_PROXY`, CORS, log rotation, memory, and CPU limits.
- Treat backup and restore verification as release blockers for production data changes.
