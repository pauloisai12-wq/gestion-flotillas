# Testing Instructions

Run the smallest relevant checks for the files changed.

API:

```bash
cd api
npm run test:sprint1-security
npm run test:sprint2
npm run test:sprint3
npm run benchmark:sprint3
npm run test:config-refs
npm run test:migrations
npm run test:qa-ingest
npm run test:uploads
npx prisma validate
npx tsc --noEmit
npm run build
```

Web:

```bash
cd web
npm run lint
npx tsc --noEmit
npm run build
npm run test:e2e
```

Worker:

```bash
cd worker
python -m py_compile main.py db.py generate_pdf.py generate_excel.py \
  generate_qa_export.py qa_export_policy.py artifact_storage.py \
  generate_encuestas_export.py encuestas_export_policy.py \
  worker_health.py healthcheck.py
python -m unittest discover -s tests -p "test_*.py" -v
python benchmarks/benchmark_qa_export_streaming.py 10000
```

Operations (Linux/CI):

```bash
python3 -m unittest discover -s scripts/ops/tests -p "test_*.py" -v
python3 scripts/ops/public_monitor.py --check
python3 scripts/ops/validate_public_compose.py --check
bash scripts/ops/backup-public.sh --check
bash scripts/ops/operation-lock.sh --check
bash scripts/ops/restore-drill-public.sh --check
bash scripts/ops/alert-drill-public.sh --check
docker compose --env-file .env.public.example -p flotillas \
  -f docker-compose.yml -f docker-compose.public.yml config --quiet
```

`qa_externa` manual smoke test:

```bash
BASE_URL=http://localhost:3001 KEY="<device_api_key>" bash docs/qa-externa-smoke.sh
```

Before production deploys that run migrations, follow `docs/runbook-hetzner.md`,
verify the encrypted off-site backup, and confirm risky migrations in
`_prisma_migrations`. A real alert drill and a restore drill against a recovered
off-site bundle are host checks; local `--check` modes do not claim those results.
