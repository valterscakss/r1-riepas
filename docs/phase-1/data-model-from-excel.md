# Data Model — derived from the real workbook (`GLabasana.xlsx`)

This documents what the **actual** source spreadsheet contains, how it maps to the
schema in `db/migrations/001_init.sql`, and where reality diverges from the SRS.
It is the evidence behind the schema decisions and the migration importer
(`tools/import/importer.ts`).

## The workbook at a glance

- **61 sheets total.** One per season — `PAVASARIS` (spring) / `RUDENS` (autumn) —
  back to 2011, plus periodic `inventarizācija` (inventory) snapshots and legacy
  location areas (`MOLS`, `ALFA`, `A B C D konteineri`).
- **The format evolved.** 41 seasonal sheets span **9 different header layouts**.
  **15 recent sheets** use the modern 13-column layout (below) — including both
  active seasons (`2026 PAVASARIS`, `2025 RUDENS`). Older layouts are reported and
  deferred, not silently dropped.

### Modern 13-column layout

| Col | Header (LV) | Meaning | Maps to |
| :- | :- | :- | :- |
| VIETA | Location/spot | `A1`, `C42` | `storage_locations.code` |
| AUTO NR. | License plate | `GG1666` | `vehicles.license_plate` |
| NOSAUKUMS | Vehicle make/model | `BMW X5` | `vehicles.make_model` |
| VĀRDS | Customer name | person or company | `customers.name` |
| TELEFONA NR. | Phone | often missing/company | `customers.phone_*` |
| IZMĒRS | Tire size (primary) | `305/40/20` | `tires` pos 1 `.size` |
| NOSAUKUMS | Tire brand | `Pirelli` | `tires.brand` |
| SKAITS | Count | `4`, `2+2`, `3+1` | `tire_sets.quantity_*` |
| DISKI | Rims **or** 2nd size | `275/45/20` / `4 Lietie diski` | `tires` pos 2 / `rim_*` |
| PIEZĪMES | Notes | free text | `tire_sets.notes` |
| SAŅEMŠANAS DATUMS | Intake date | `11.10.2025.` | `tire_sets.intake_date` |
| IZSNIEGŠANAS DATUMS | Release date | blank = still stored | `tire_sets.release_date` |
| PARAKSTS | Signature | mostly blank | `tire_sets.signature_raw` |

## Where reality diverges from the SRS (and what we did)

1. **Phone is not an identifier.** Across the imported rows, **3,457 of 9,644 have no
   usable phone**, and thousands hold a company name in the phone column. The SRS
   made phone the unique primary key (FR-2.1.1) — that would reject a third of the
   data. → `phone_e164` is **nullable and non-unique**; the practical key is
   **license plate** (partial-unique when present) + **season**.
2. **Rims are free text, and the `DISKI` column is overloaded.** It holds either a
   **second tire size** (staggered 2+2 setups — 780 sets) or a rim note like
   `4 Lietie diski` (alloy) / `4 Dzelz diski` (steel). The SRS's clean
   none/alloy/steel enum doesn't fit. → we keep `rim_note` (raw) **and** a
   best-effort `rim_type` enum, and route a second size into a `tires` child row.
3. **Counts are not integers.** `2+2`, `3+1`, `3+2jaunas`, `5`. → `quantity_raw`
   preserves the original; `quantity_total` + `is_staggered` are parsed.
4. **Tire size formats vary** (`235/50/19`, `225/55R16`) with some garbage
   (`235/4019`, a phone number in a size cell). → one normalizer to canonical
   `W/A/D`, unparseable values **flagged** and kept raw, never dropped.
5. **SMS codes and thread depth don't exist in history.** Both are net-new Phase-1
   features → nullable columns, `NULL` for every migrated row.
6. **Provenance matters for a "0% loss" claim.** Every migrated row records its
   `source_sheet` + `source_row`, and anything non-clean lands in `import_issues`
   so reconciliation is auditable (SRS FR-2.5.1).

## Dry-run reconciliation (current)

Run: `npm run import:report` (writes `data/output/reconciliation.json`).

| Metric | Value |
| :- | :- |
| Sheets imported (modern layout) | 15 |
| Sheets skipped (older layouts) | 46 (reported) |
| Tire sets | 9,644 |
| Tires (incl. staggered 2nd size) | 7,863 |
| Active / Released | 3,122 / 6,522 |
| Staggered sets | 780 |
| Unique plates / locations / phones | 1,609 / 995 / 979 |
| Likely companies | 2,287 |
| Rows without plate / phone | 20 / 3,457 |
| Hard errors | **0** |
| Warnings / info (quarantined for review) | 1,423 / 2,101 |

## Migration scope decision (MVP)

- **In scope now:** the 15 modern-layout sheets → current + recent occupancy, which
  is what staff need on day one.
- **Deferred:** the 46 older-layout sheets (pre-2018 seasons, inventory snapshots,
  MOLS/ALFA legacy). They are historical; import them best-effort in a later pass
  once the current data is live and verified. The importer already lists exactly
  which sheets were skipped.

## Open questions raised by the data

1. **Same plate across seasons = one vehicle.** Confirm we dedupe vehicles by plate
   (and merge their season history) rather than creating a vehicle per row.
2. **Company detection heuristic** (all-caps name / non-numeric phone) needs a staff
   sanity check — it drives `is_company` and future invoicing.
3. **Which season is "current"?** Both `2026 PAVASARIS` and `2025 RUDENS` have active
   (un-released) rows — retrieval must search across open sets, not one season.
