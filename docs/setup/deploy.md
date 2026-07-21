# Deploying the R1 Tires app

The app is a self-contained Node service with an embedded SQLite database. It needs
no external database or third-party service. This guide covers Render (easiest);
the included `app/Dockerfile` works for any container host (Railway, Fly.io, etc.).

---

## Option 1 — Render (recommended, no Docker knowledge needed)

The repo ships a Blueprint at `render.yaml`.

1. Push this branch to GitHub (already done) and sign in at <https://render.com>.
2. **New → Blueprint** → connect this repository → Render reads `render.yaml`.
3. Confirm and deploy. Render runs `npm ci` then `npm start` in `app/`.
4. When it's live you get a URL like `https://r1-tires.onrender.com`.
   - Check `‹url›/api/health` → should say `sqlite (…)`.
   - Open `‹url›/` for the app.

### Data persistence (important)
`render.yaml` mounts a **disk** at `/data` and points `DB_FILE=/data/r1.db`, so the
database survives redeploys. **Disks require a paid instance (`starter`+).**
- On the **free** plan there is no disk → the database resets on every deploy. Fine
  to *demo* with the built-in synthetic sample, not for real data.
- For real use, keep `plan: starter` (or higher) so `/data` persists.

---

## Option 2 — Any Docker host

```bash
cd app
docker build -t r1-tires .
docker run -p 3000:3000 -v r1data:/data -e DB_FILE=/data/r1.db r1-tires
# → http://localhost:3000
```
Mount a volume at `/data` so the SQLite file persists.

---

## Loading your real data (and a GDPR note)

A fresh deploy seeds from the **synthetic sample** (`app/data/sample-seed.json`) so
the app is never empty. Your real customer data is **not** in git (it's personal
data). To load it onto a host you control:

1. Locally, generate the seed from the workbook (one time):
   ```bash
   npm install
   npm run import:emit-seed        # writes app/data/real-seed.json
   ```
2. Get that file onto the server's `/data` disk (e.g. Render Shell, or an initial
   deploy that reads it), and set `SEED_FILE=/data/real-seed.json`. It seeds once,
   on first boot into an empty database.

**Before putting real customer data on any host, decide deliberately:** this is
personal data under GDPR. Prefer an EU region, restrict who can reach the URL, and
add the staff login below. Hosting ~1,600 customers' details on a third-party server
is a conscious data-processing choice, not a default.

---

## Security before go-live (do not skip for real data)

The app currently has **no authentication** — anyone with the URL can read and edit.
Before real customer data goes on a public URL, at minimum one of:
- put it behind your network / a VPN / IP allowlist, **or**
- add the staff login (the `users` table and auth are already designed in
  `db/migrations/001_init.sql`; wiring login into the app is the recommended next
  task).

See `docs/phase-1/requirements-review.md` for the full security checklist.
