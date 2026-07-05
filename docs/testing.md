# Testing Instructions

Run the smallest relevant checks for the files changed.

API:

```bash
cd api
npm run test:migrations
npm run test:qa-ingest
npx prisma validate
npx tsc --noEmit
```

Web:

```bash
cd web
npm run lint
npx tsc --noEmit
npm run build
```

Worker:

```bash
cd worker
python -m py_compile main.py db.py generate_pdf.py generate_excel.py
```

`qa_externa` manual smoke test:

```bash
BASE_URL=http://localhost:3001 KEY="<device_api_key>" bash docs/qa-externa-smoke.sh
```

Before production deploys that run migrations, verify backups and confirm risky migrations in `_prisma_migrations`.
