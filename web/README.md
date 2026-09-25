# R1 Tires — Next.js app

The successor to the Express app in `../app`. Same database, same API paths and
JSON shapes; see `../docs/migration/nextjs-plan.md` for the migration plan.

## Local development

Requires Node 20+ and Docker.

```bash
cp .env.example .env.local      # then set AUTH_SECRET and ADMIN_PASSWORD
npm install
npm run db:up                   # Postgres 16 in Docker (also creates r1_test)
export DATABASE_URL=postgres://r1:r1@localhost:5432/r1
npm run db:migrate              # create / upgrade tables
npm run db:seed                 # synthetic sample data (only into an empty table)
npm run dev                     # http://localhost:3000
```

## Checks

```bash
npm run typecheck
npm run lint
npm test                        # uses TEST_DATABASE_URL (default: local r1_test)
npm run build
```

CI (`.github/workflows/web.yml`) runs the same four against a Postgres service.

## Database

- Schema: `src/server/db/schema.ts` (Drizzle), a 1:1 copy of the production tables.
- Migrations: `drizzle/`. `0000_baseline.sql` is idempotent, so it is safe on the
  existing Supabase database. New migrations: edit the schema, run
  `npm run db:generate`, review the SQL, commit.
- `npm run build` applies migrations first when `DATABASE_URL` is set, except on
  Vercel preview builds (production builds only).
- Production TLS: set `DATABASE_CA_CERT` to Supabase's root certificate for a
  verified connection.
