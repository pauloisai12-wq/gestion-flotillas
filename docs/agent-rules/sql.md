# SQL Audit Checklist

- Map SQL entry points before deeper review: Prisma raw queries, psycopg2, pandas SQL, migrations, and materialized views.
- Reject string-built SQL with user input; require parameter binding.
- Check indexes for changed filters, joins, ordering, and uniqueness guarantees.
- Check migrations for destructive DDL/DML, lock risk, backfill safety, and rollback/restore strategy.
- Use read-only database access for inspection. Do not execute DML or DDL during audit.
