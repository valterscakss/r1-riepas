-- R1 Tires — Phase 1 MVP initial schema
-- Postgres 14+
--
-- This schema is derived from the REAL source workbook (GLabasana.xlsx), not the
-- idealized SRS. Key deviations from the SRS, with evidence, are documented in
-- docs/phase-1/data-model-from-excel.md. The most important:
--   * phone is NOT unique and NOT required (35% of rows lack a usable phone).
--   * rim info is free text / a second tire size, not a clean enum.
--   * sms_code and thread depth are new features — null for all migrated rows.
--   * every migrated row keeps its provenance (source_sheet, source_row).

BEGIN;

-- ---------------------------------------------------------------------------
-- Staff / auth (from SRS §12.1 — not present in the Excel)
-- ---------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'staff', 'read_only');

CREATE TABLE users (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone          VARCHAR(32) UNIQUE NOT NULL,
  name           VARCHAR(255) NOT NULL,
  password_hash  TEXT NOT NULL,
  role           user_role NOT NULL DEFAULT 'staff',
  status         VARCHAR(16) NOT NULL DEFAULT 'active',   -- active | disabled
  failed_login_count INT NOT NULL DEFAULT 0,
  locked_until   TIMESTAMPTZ,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Seasons (one Excel sheet per season, e.g. "2025 RUDENS")
-- ---------------------------------------------------------------------------
CREATE TYPE season_term AS ENUM ('spring', 'autumn');  -- PAVASARIS | RUDENS

CREATE TABLE seasons (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          VARCHAR(64) UNIQUE NOT NULL,   -- normalized, e.g. "2025 RUDENS"
  term          season_term,
  year          INT,
  source_sheet  VARCHAR(128),                  -- original sheet title (provenance)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Customers — phone is nullable and NOT unique (see data review)
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          VARCHAR(255),                  -- VĀRDS: person or company display name
  is_company    BOOLEAN NOT NULL DEFAULT false,
  company_name  VARCHAR(255),
  phone_e164    VARCHAR(20),                   -- normalized when parseable; may be NULL
  phone_raw     VARCHAR(64),                   -- exactly what was in the sheet
  email         VARCHAR(255),
  tax_id        VARCHAR(50),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Non-unique index: phone is a lookup hint, not an identifier.
CREATE INDEX idx_customers_phone ON customers(phone_e164);
CREATE INDEX idx_customers_name  ON customers(lower(name));

-- ---------------------------------------------------------------------------
-- Vehicles — license plate is the primary practical key (but can be missing)
-- ---------------------------------------------------------------------------
CREATE TABLE vehicles (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id    BIGINT REFERENCES customers(id),
  license_plate  VARCHAR(20),                  -- normalized (upper, no spaces); may be NULL
  make_model     VARCHAR(255),                 -- NOSAUKUMS / "Marka, modelis", e.g. "BMW X5"
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Unique only when a plate is present (partial unique index).
CREATE UNIQUE INDEX uq_vehicles_plate ON vehicles(license_plate) WHERE license_plate IS NOT NULL;
CREATE INDEX idx_vehicles_customer ON vehicles(customer_id);

-- ---------------------------------------------------------------------------
-- Storage locations (VIETA, e.g. "A1") — physical spots, reused every season
-- ---------------------------------------------------------------------------
CREATE TABLE storage_locations (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code           VARCHAR(20) UNIQUE NOT NULL,  -- normalized "A1"
  container      VARCHAR(8),                   -- "A".."D" (and MOLS/ALFA legacy areas)
  spot_number    INT,
  status         VARCHAR(16) NOT NULL DEFAULT 'available',  -- available | occupied
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_locations_status    ON storage_locations(status);
CREATE INDEX idx_locations_container ON storage_locations(container);

-- ---------------------------------------------------------------------------
-- Tire sets — one row per Excel data row (the core storage record)
-- ---------------------------------------------------------------------------
CREATE TYPE tire_set_status AS ENUM ('active', 'released', 'archived');
CREATE TYPE rim_type AS ENUM ('none', 'alloy', 'steel', 'unknown');

CREATE TABLE tire_sets (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season_id      BIGINT REFERENCES seasons(id),
  customer_id    BIGINT REFERENCES customers(id),
  vehicle_id     BIGINT REFERENCES vehicles(id),
  location_id    BIGINT REFERENCES storage_locations(id),
  location_code_raw VARCHAR(32),              -- original VIETA text (provenance)

  quantity_raw   VARCHAR(32),                  -- SKAITS as written: "4", "2+2", "3+1"
  quantity_total INT,                          -- best-effort parsed total
  is_staggered   BOOLEAN NOT NULL DEFAULT false, -- "2+2" style front/rear split

  rim_note       VARCHAR(255),                 -- free text: "4 Lietie diski" etc.
  rim_type       rim_type NOT NULL DEFAULT 'unknown',

  notes          TEXT,                         -- PIEZĪMES
  intake_date    DATE,                         -- SAŅEMŠANAS DATUMS
  release_date   DATE,                         -- IZSNIEGŠANAS DATUMS (NULL = still stored)
  signature_raw  VARCHAR(255),                 -- PARAKSTS (mostly empty in history)
  status         tire_set_status NOT NULL DEFAULT 'active',

  -- New Phase-1 features — NULL for every migrated (historical) row
  sms_code               VARCHAR(20),
  intake_thread_depth_mm DECIMAL(4,2),
  storage_fee_eur        DECIMAL(8,2),

  -- Provenance back to the source workbook
  source_sheet   VARCHAR(128),
  source_row     INT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- sms_code unique only when set (new intakes); migrated rows are NULL.
CREATE UNIQUE INDEX uq_tire_sets_sms_code ON tire_sets(sms_code) WHERE sms_code IS NOT NULL;
CREATE INDEX idx_tire_sets_vehicle  ON tire_sets(vehicle_id);
CREATE INDEX idx_tire_sets_customer ON tire_sets(customer_id);
CREATE INDEX idx_tire_sets_location ON tire_sets(location_id);
CREATE INDEX idx_tire_sets_status   ON tire_sets(status);
CREATE INDEX idx_tire_sets_season   ON tire_sets(season_id);

-- ---------------------------------------------------------------------------
-- Tires — child rows (supports staggered 2+2 and per-tire thread depth for SMS)
-- IZMĒRS -> position 1; a 2nd size found in DISKI -> position 2.
-- ---------------------------------------------------------------------------
CREATE TABLE tires (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tire_set_id    BIGINT NOT NULL REFERENCES tire_sets(id) ON DELETE CASCADE,
  position       SMALLINT NOT NULL DEFAULT 1,  -- 1 = primary, 2 = secondary (staggered)
  size           VARCHAR(20),                  -- normalized "235/50/19"
  size_raw       VARCHAR(32),                  -- original text (provenance)
  brand          VARCHAR(100),                 -- NOSAUKUMS / Riepas nosauk.
  quantity       INT,
  intake_thread_depth_mm    DECIMAL(4,2),      -- new feature (NULL for migrated)
  retrieval_thread_depth_mm DECIMAL(4,2)
);
CREATE INDEX idx_tires_set ON tires(tire_set_id);

-- ---------------------------------------------------------------------------
-- Audit log (SRS §6.1 / §12.7)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action       VARCHAR(50) NOT NULL,           -- intake | retrieval | data_modified | login ...
  user_id      BIGINT REFERENCES users(id),
  tire_set_id  BIGINT REFERENCES tire_sets(id),
  customer_id  BIGINT REFERENCES customers(id),
  changes      JSONB,
  ip_address   VARCHAR(64),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_tire_set  ON audit_log(tire_set_id);
CREATE INDEX idx_audit_created   ON audit_log(created_at);

-- ---------------------------------------------------------------------------
-- Import issues — quarantine for rows the migration could not cleanly import
-- ---------------------------------------------------------------------------
CREATE TABLE import_issues (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_sheet VARCHAR(128),
  source_row   INT,
  severity     VARCHAR(16) NOT NULL,           -- error | warning | info
  field        VARCHAR(64),
  message      TEXT NOT NULL,
  raw_values   JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_import_issues_severity ON import_issues(severity);

COMMIT;
