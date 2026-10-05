-- Baseline: the schema the Express app created on first connect, written so it is
-- safe to run against the EXISTING production database. Every statement is
-- idempotent (IF NOT EXISTS), so on Supabase it only records this migration as
-- applied; on an empty database it builds the full schema. The snapshot in
-- meta/ describes the same end state, so later `drizzle-kit generate` runs diff
-- from here.

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
  intake_date   TEXT,
  release_date  TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE storage ADD COLUMN IF NOT EXISTS thread_depth TEXT;
--> statement-breakpoint
ALTER TABLE storage ADD COLUMN IF NOT EXISTS sms_code TEXT;
--> statement-breakpoint
ALTER TABLE storage ADD COLUMN IF NOT EXISTS fee_eur TEXT;
--> statement-breakpoint
ALTER TABLE storage ADD COLUMN IF NOT EXISTS prepared_date TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storage_plate ON storage (UPPER(plate));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storage_status ON storage (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storage_location ON storage (location);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS perms TEXT;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS containers (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  prefix     TEXT UNIQUE NOT NULL,
  label      TEXT,
  rows       INTEGER NOT NULL DEFAULT 1,
  cols       INTEGER NOT NULL DEFAULT 4,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE containers ADD COLUMN IF NOT EXISTS cells TEXT;
--> statement-breakpoint
ALTER TABLE containers ADD COLUMN IF NOT EXISTS names TEXT;
--> statement-breakpoint
ALTER TABLE containers ADD COLUMN IF NOT EXISTS zones TEXT;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS record_events (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id  TEXT NOT NULL,
  action     TEXT NOT NULL,
  comment    TEXT,
  actor      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_events_record ON record_events (record_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS tasks (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'order',
  record_id  TEXT,
  title      TEXT NOT NULL,
  details    TEXT,
  location   TEXT,
  plate      TEXT,
  status     TEXT NOT NULL DEFAULT 'open',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_by    TEXT,
  done_at    TIMESTAMPTZ
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tasks_record ON tasks (record_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS photos (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id  TEXT NOT NULL,
  mime       TEXT NOT NULL,
  data       BYTEA NOT NULL,
  bytes      INTEGER NOT NULL,
  width      INTEGER,
  height     INTEGER,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_photos_record ON photos (record_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint   TEXT PRIMARY KEY,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  username   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Legacy sheets wrote "BRĪVS" in the plate column for an empty place. Those rows
-- are spot placeholders, not stored sets. The Express app ran this on every start;
-- it is idempotent, so running it once more here is harmless.
UPDATE storage SET status = 'free', plate = NULL
 WHERE status = 'active' AND size1 IS NULL AND brand IS NULL AND customer_name IS NULL
   AND UPPER(BTRIM(COALESCE(plate, ''))) IN ('BRĪVS','BRIVS','BRĪVA','BRIVA','BRĪVI','TUKŠS','TUKSS','TUKŠA','TUKSA','FREE');
--> statement-breakpoint
-- Its opposite: AIZŅEMTS means the place is held with nothing recorded about it.
UPDATE storage SET status = 'blocked', plate = NULL
 WHERE status = 'active' AND size1 IS NULL AND brand IS NULL AND customer_name IS NULL
   AND UPPER(BTRIM(COALESCE(plate, ''))) IN ('AIZŅEMTS','AIZNEMTS','AIZŅEMTA','AIZNEMTA','REZERVĒTS','REZERVETS');
