# R1 Tires — Tire Storage Management System

Phase 1 MVP that replaces the Excel-based tire-storage workflow with a database,
fast intake/retrieval, and SMS codes. Built **from the real source workbook**, not
only the spec — see the data review below.

## Status

Early foundation. What exists today:

- **Planning & review** — `docs/phase-1/`
  - `requirements-review.md` — production-readiness / security / GDPR critique of the SRS
  - `build-plan.md` — phased, verifiable increments (security & backups from day one)
  - `integration-api-plan.md` — external-system integrations & our API surface
  - `data-model-from-excel.md` — what the real spreadsheet contains vs. the SRS
- **Schema** — `db/migrations/001_init.sql` (Postgres 14+), derived from the real data
- **Migration importer** — `tools/import/importer.ts`, a validated **dry-run** over
  the source workbook producing a reconciliation report

## Migration dry-run

```bash
npm install
npm run import:report   # reads the workbook, writes data/output/reconciliation.json
```

No database writes — it parses, normalizes, validates, and quarantines bad rows so
the migration can be reviewed before a real load. Latest run: 9,644 tire sets,
0 hard errors (see `data-model-from-excel.md`).

## Tech stack (per SRS §11.1)

Node.js 18+ · PostgreSQL 14+ · React 18+ · TypeScript. Hosting (AWS vs. a leaner
managed EU stack) is an open decision — see `build-plan.md`.

## Repository layout

```
db/migrations/     SQL schema migrations
tools/import/      Excel migration importer (dry-run)
docs/phase-1/      Requirements review, build plan, integration plan, data model
data/              Local migration in/out (gitignored; never commit customer data)
```

## Data handling

The source workbook holds real customer data and is **never committed**
(`.gitignore` excludes `data/source/` and importer output). Treat all exports as
personal data under GDPR.
