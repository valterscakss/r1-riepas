-- R1 Tires — Supabase (Postgres) storage table for the app.
-- The app creates this automatically on first connect; this file is for review
-- or to run manually in the Supabase SQL editor.
--
-- Flat operational table matching the app's StorageRecord. (The richer
-- normalized schema in db/migrations/001_init.sql is the target for a later,
-- fuller build; this is the pragmatic MVP shape the UI reads/writes.)

CREATE TABLE IF NOT EXISTS storage (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season        TEXT,
  location      TEXT,
  plate         TEXT,
  make_model    TEXT,
  customer_name TEXT,
  is_company    BOOLEAN NOT NULL DEFAULT false,
  phone         TEXT,
  size1         TEXT,
  brand         TEXT,
  quantity      TEXT,
  size2         TEXT,
  rim_note      TEXT,
  notes         TEXT,
  intake_date   TEXT,   -- ISO yyyy-mm-dd (kept as text to preserve source values)
  release_date  TEXT,   -- NULL / empty = still in storage
  status        TEXT NOT NULL DEFAULT 'active',  -- active | released
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_storage_plate    ON storage (UPPER(plate));
CREATE INDEX IF NOT EXISTS idx_storage_status   ON storage (status);
CREATE INDEX IF NOT EXISTS idx_storage_location ON storage (location);
