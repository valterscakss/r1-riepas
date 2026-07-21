# Connecting the app to Google Sheets (go-live)

This wires the data-entry app to a Google Sheet as its live database. ~15 minutes.
You do the two steps that need your Google account (I have no access to your Google
Cloud console or your Drive's sharing); the app is already built for it.

---

## Step A — Put the data in Google Sheets

1. Take the file **`R1_Tires_Storage.xlsx`** (sent to you in chat; a clean export of
   the current + previous season in the app's 13-column layout).
2. Go to <https://drive.google.com> → **New → File upload** → choose that file.
3. Double-click the uploaded file to open it, then **File → Save as Google Sheets**.
   This creates a *native* Google Sheet (the API needs a native sheet, not a raw
   `.xlsx`). Work with that native copy from here on.
4. From its URL, copy the **Spreadsheet ID** — the part between `/d/` and `/edit`:
   `https://docs.google.com/spreadsheets/d/`**`THIS_IS_THE_ID`**`/edit`
5. Note the **tab name** for the current season: `2026 PAVASARIS`.

## Step B — Create a service account + key (Google Cloud console)

1. Go to <https://console.cloud.google.com> and create or select a project
   (e.g. "R1 Tires").
2. **APIs & Services → Library** → search **"Google Sheets API"** → **Enable**.
3. **APIs & Services → Credentials → Create credentials → Service account**.
   - Name: `r1-sheets` → **Create and continue** → skip roles → **Done**.
4. Click the new service account → **Keys → Add key → Create new key → JSON**.
   A `.json` key file downloads. Keep it private (it's a credential — never commit it).
5. Copy the service account **email** (looks like
   `r1-sheets@your-project.iam.gserviceaccount.com`).

## Step C — Share the sheet with the service account

1. Open the Google Sheet from Step A → **Share**.
2. Paste the service account **email**, set role to **Editor**, untick "Notify
   people", **Share**.

   (Without this the app gets a 403 — the service account can only see sheets shared
   with it.)

## Step D — Run the app against the sheet

```bash
cd app
npm install

export SHEET_ID="<the id from Step A.4>"
export SHEET_TAB="2026 PAVASARIS"
export GOOGLE_SERVICE_ACCOUNT_JSON="$(cat /path/to/your-key.json)"

npm start        # http://localhost:3000
```

Verify:
- The app header (and `GET /api/health`) should read **`google-sheets (…)`**, not
  `local`.
- Search a plate you know is in the sheet → it appears.
- Do a **New intake** → a new row appears in the Google Sheet.
- **Release** a record → its `IZSNIEGŠANAS DATUMS` (release date) fills in on the sheet.

## Notes

- **Backups:** Google Sheets keeps full version history (File → Version history), and
  you can schedule Drive exports. That is the MVP backup story (see ADR 0001).
- **Security:** anyone the sheet is shared with can see customer data — keep sharing
  tight (GDPR). The app itself still has no staff login; that's the recommended next
  hardening step.
- **Deployment:** the commands above run it on one machine. To let staff reach it,
  deploy the `app/` service (any Node host) with the same three env vars set.
- **Multiple seasons:** the app reads one `SHEET_TAB` at a time. Change `SHEET_TAB`
  when the season rolls over. (Cross-season plate lookup on Sheets is a follow-up.)
