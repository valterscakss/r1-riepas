# Deploy on Vercel + Supabase

**Supabase** = managed Postgres (EU region, automatic backups), **Vercel** =
hosting. The app is the Next.js project in `web/`. The old Express app in `app/`
still works against the same database until it is removed (see *Switching over*).

---

## Step 1 — Supabase (database)

1. Create a project at <https://supabase.com> in an **EU region** (it holds EU
   customer data) and set a database password.
2. **Project → Settings → Database → Connection string → URI.** For Vercel use
   the **connection pooler** URI (port `6543`) — serverless opens many
   short-lived connections.
3. Optional but recommended: download the **SSL certificate** on the same page
   and put its contents in `DATABASE_CA_CERT`, so the server certificate is
   verified (without it the link is encrypted but not verified).

Tables are created by the app's migrations (`web/drizzle/`), not by hand.

## Step 2 — Vercel (hosting)

1. <https://vercel.com> → **Add New → Project** → import this repository.
2. **Root Directory = `web`**. Framework preset: Next.js (detected).
3. Environment variables:

   | Key | Value |
   | :- | :- |
   | `DATABASE_URL` | Supabase pooler URI from Step 1 |
   | `AUTH_SECRET` | long random string (`openssl rand -base64 48`) — **the same value the Express app used**, so nobody is logged out at the switch |
   | `ADMIN_USERNAME` / `ADMIN_PASSWORD` | the first admin on an empty database; changing the password later resets that admin's password once |
   | `DATABASE_CA_CERT` | optional, see Step 1 |
   | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | optional, Web Push (`npx web-push generate-vapid-keys`) — the same keys as before keep existing phone subscriptions working |
   | `ANONYMIZE_PHONES` | optional, `true` while testing Excel imports |

4. **Deploy.** A production build first applies pending migrations, then builds.
   Preview deployments never migrate (they usually share the production
   `DATABASE_URL`, and an unmerged branch must not change its schema).
5. Check `‹url›/api/health` → `{"ok":true,"store":"postgres"}` and log in.

## Loading data

- From the workbook: log in as admin → **Tabula → ⭱ Importēt Excel**. It shows a
  dry-run preview before anything is replaced.
- From a seed file (`npm run import:emit-seed` at the repo root):
  `cd web && DATABASE_URL=… npm run db:seed -- --file ../app/data/real-seed.json`
  (loads into an empty table only; `--force` to add anyway).

## Switching over from the Express app

The Next.js app uses the **same tables, cookie name and token format**, so the
switch is a hosting change, not a data migration.

1. Take a Supabase backup (Database → Backups) — belt and braces.
2. In the existing Vercel project, set **Root Directory** from `app` to `web`,
   keep every environment variable, and redeploy. (Or create a second project
   on `web`, test it on its own URL against the same database, then move the
   domain.)
3. The first production build runs the baseline migration. It is idempotent on
   the existing schema: it only records itself as applied (plus the two
   BRĪVS/AIZŅEMTS clean-ups the old app ran on every start).
4. Check: log in, open Novietnes, Tabula, a record's photos, the Noliktava
   queue. Installed phones reopen on the new screens; old `/?view=…` links and
   notification clicks still land in the right place.
5. **Rollback:** set Root Directory back to `app` and redeploy. Nothing in the
   database needs undoing — the schema is unchanged.

Once the new app has run in production for a while, `app/` can be deleted.

## Notes

- **Backups:** Supabase runs daily backups; Point-in-Time Recovery on paid plans.
- **Local development:** Postgres in Docker — see `web/README.md`.
- **Self-hosting:** `web/Dockerfile` builds a standalone image that applies
  migrations on start; it needs `DATABASE_URL` and `AUTH_SECRET`.
