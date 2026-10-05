-- Branches (two shops in one app). Written like the baseline: every statement is
-- idempotent, because the Express app ships the same change and may already have
-- applied it to the live database. Row-for-row it matches what that app creates.

CREATE TABLE IF NOT EXISTS "branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "branches" text;
--> statement-breakpoint
ALTER TABLE "storage" ADD COLUMN IF NOT EXISTS "branch_id" integer;
--> statement-breakpoint
ALTER TABLE "containers" ADD COLUMN IF NOT EXISTS "branch_id" integer;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "branch_id" integer;
--> statement-breakpoint
-- The first shop already exists in real use: create it once, then adopt every row
-- that predates branches. All of this is a no-op on a database that has them.
INSERT INTO "branches" ("name") SELECT 'Filiāle 1' WHERE NOT EXISTS (SELECT 1 FROM "branches");
--> statement-breakpoint
UPDATE "storage"    SET "branch_id" = (SELECT MIN("id") FROM "branches") WHERE "branch_id" IS NULL;
--> statement-breakpoint
UPDATE "containers" SET "branch_id" = (SELECT MIN("id") FROM "branches") WHERE "branch_id" IS NULL;
--> statement-breakpoint
UPDATE "tasks"      SET "branch_id" = (SELECT MIN("id") FROM "branches") WHERE "branch_id" IS NULL;
