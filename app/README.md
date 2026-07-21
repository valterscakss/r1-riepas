# R1 Tires — data-entry app

A small web app for tire-storage **intake** and **search / retrieval**. It has a
pluggable datastore and picks one automatically:

| Priority | When | Backend |
| :- | :- | :- |
| 1 | `DATABASE_URL` set | **Postgres / Supabase** (production — see `../docs/setup/vercel-supabase.md`) |
| 2 | `SHEET_ID` + `SHEET_TAB` set | Google Sheets (opt-in) |
| 3 | otherwise | **SQLite** (self-contained local dev) |

## Run locally (no cloud credentials)

Uses a local SQLite database seeded with realistic data immediately.

```bash
cd app
npm install
npm run dev            # http://localhost:3000
```

By default it loads `app/data/sample-seed.json` (synthetic, safe to commit).
To run against the **real** data instead, generate a local seed from the workbook
(gitignored — contains customer data):

```bash
# from the repo root
npm install
npm run import:emit-seed          # writes app/data/real-seed.json
SEED_FILE=data/real-seed.json npm --prefix app run dev
```

## Connect the real Google Sheet (production)

1. Upload the workbook to Google Sheets (one tab per season, keep the 13-column
   layout).
2. In Google Cloud, create a **service account**, enable the **Google Sheets API**,
   and download a JSON key.
3. **Share the Sheet** with the service account's email address (Editor).
4. Configure the app and start it:

```bash
export SHEET_ID="<spreadsheet id from its URL>"
export SHEET_TAB="2025 RUDENS"     # the current season tab
export GOOGLE_SERVICE_ACCOUNT_JSON="$(cat service-account.json)"
npm --prefix app start
```

When `SHEET_ID` + `SHEET_TAB` are set, the app uses the Google Sheet; otherwise it
falls back to the local seed. The store in use is shown in the app header and at
`GET /api/health`.

## API

| Method | Path | Purpose |
| :- | :- | :- |
| GET | `/api/health` | Which store is active |
| GET | `/api/storage?status=active&q=AB1234` | List / search |
| GET | `/api/storage/:id` | One record |
| POST | `/api/intake` | Create an intake |
| POST | `/api/storage/:id/release` | Mark retrieved/released |

## Notes / known refinements

- The staggered second tire size sometimes lives in the notes column rather than
  `DISKI`; it is preserved either way and the staggered flag is set from the count
  (`2+2`). Tightening `size2` extraction is a follow-up.
- This app has no authentication yet — access is currently governed by who can
  reach the server and who the Sheet is shared with. Staff login/RBAC is a
  follow-up from the security review.
