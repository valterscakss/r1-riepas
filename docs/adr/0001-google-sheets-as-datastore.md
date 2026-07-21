# ADR 0001 — Google Sheets as the MVP datastore

**Status:** Accepted (MVP) · **Date:** 2026-07-21

## Context

The business currently runs on an Excel workbook. For the MVP the owner chose to
keep the spreadsheet as the **system of record** — uploaded to Google Sheets — and
build a separate data-entry UI on top of it, rather than stand up a Postgres
database now.

## Decision

- **Datastore = a Google Sheet** that keeps the same 13-column layout the shop
  already uses (VIETA, AUTO NR., …, PARAKSTS). Staff can still open it in Sheets.
- **A separate web app** provides intake and search/retrieval, reading and writing
  rows via the Google Sheets API.
- The app talks to storage through a small **`Store` interface** with two adapters:
  - `SheetsStore` — production, backed by the Google Sheet.
  - `LocalStore` — a file-backed store seeded from the real workbook, so the UI
    runs in development without cloud credentials.
- The Postgres schema and migration importer already built are **retained**: the
  importer's normalization feeds the seed and could load Postgres later; the schema
  is the target if/when we outgrow Sheets.

## Consequences

**Good (why it fits an MVP):** no new infra; familiar tool for staff; Google
provides version history and backups; fast to ship; reversible.

**Trade-offs / risks (accepted for now):**
- Sheets is **not a real database**: weak concurrency control, no transactions,
  ~10M-cell / row limits, and API quotas. Fine at ~300 customers, not at scale.
- **Security/PII:** access is controlled by Google sharing, not app RBAC. The Sheet
  holds personal data — sharing must be tight (GDPR). The earlier
  `requirements-review.md` security items still apply and are only partially met.
- **No server-side validation guarantees** if someone edits the Sheet by hand.
- The app's `SheetsStore` needs a Google **service account** with Editor access to
  the Sheet (see `app/README.md`).

## Revisit when

Concurrent editing causes conflicts, data volume/latency degrades, or the security/
audit requirements (RBAC, audit log, field-level access) become firm — at which
point migrate to the Postgres schema in `db/migrations/` (the importer already
produces the normalized data for it).
