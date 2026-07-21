# Deploy on Vercel + Supabase

This is the recommended stack: **Supabase** = managed Postgres (with automatic
backups and version history), **Vercel** = hosting. The app auto-detects Postgres
from `DATABASE_URL` and creates its table on first connect.

---

## Step 1 — Supabase (database)

1. Create a project at <https://supabase.com> (choose an **EU region** — the data is
   EU customer data). Set a database password.
2. Get the connection string: **Project → Settings → Database → Connection string →
   URI**. It looks like:
   `postgresql://postgres:[PASSWORD]@db.[ref].supabase.co:5432/postgres`
   - For serverless (Vercel), prefer the **connection pooler** URI (port `6543`) if
     offered — it handles many short-lived connections better.
3. (Optional) The table is created automatically by the app, but you can pre-create
   it by pasting `db/supabase/001_storage.sql` into the Supabase **SQL editor**.

## Step 2 — Load your data

From your machine (needs the source workbook once, to build the seed):

```bash
npm install
npm run import:emit-seed        # -> app/data/real-seed.json (gitignored)

cd app
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[ref].supabase.co:5432/postgres" \
  npm run load:supabase -- --file data/real-seed.json --truncate
```

This loads ~9,600 records in a few seconds. Re-running with `--truncate` replaces
them. (You can also import a CSV via the Supabase Table Editor if you prefer.)

## Step 3 — Vercel (hosting)

1. At <https://vercel.com> → **Add New → Project** → import this GitHub repo.
2. Set **Root Directory = `app`** (the app lives there; `app/vercel.json` routes
   everything to the Express handler).
3. Add an **Environment Variable**:
   - `DATABASE_URL` = your Supabase connection string (same as above).
4. **Deploy.** You get a URL like `https://r1-tires.vercel.app`.
   - Check `‹url›/api/health` → should say `postgres (supabase)`.
   - Open `‹url›/` for the app.

Because `DATABASE_URL` is set, the app uses Supabase automatically (not SQLite).

---

## Notes

- **Backups:** Supabase runs automated daily backups (and Point-in-Time Recovery on
  paid plans) — this is the backup story the requirements review asked for.
- **Security / GDPR:** the app still has **no staff login** — anyone with the URL can
  read/write. Before real customer data is on a public URL, add the login (the
  `users`/auth design is in `db/migrations/001_init.sql`) or restrict access. Keep
  Supabase in an EU region and its keys private. Never commit `DATABASE_URL`.
- **Local development** still works with zero setup (SQLite) when `DATABASE_URL` is
  not set: `cd app && npm install && npm run dev`.
- **Render** (`render.yaml`, `docs/setup/deploy.md`) remains as an alternative host
  if ever needed, but Vercel + Supabase is the primary path.
