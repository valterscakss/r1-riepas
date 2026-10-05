import { sql } from 'drizzle-orm';
import { bigint, boolean, customType, index, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * The production schema, table for table and column for column as the Express
 * app created it (see app/src/stores/postgresStore.ts). It is deliberately a 1:1
 * copy — dates and prices stay TEXT, ids stay BIGINT identity — so the Next.js
 * app runs against the existing Supabase database without a data migration.
 * Tightening the types is a separate, later step.
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow();

/** A shop. Racks, the sets on them and the warehouse jobs each belong to one. */
export const branches = pgTable('branches', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const storage = pgTable('storage', {
  id: id(),
  season: text('season'),
  location: text('location'),
  plate: text('plate'),
  makeModel: text('make_model'),
  customerName: text('customer_name'),
  isCompany: boolean('is_company').notNull().default(false),
  phone: text('phone'),
  size1: text('size1'),
  brand: text('brand'),
  quantity: text('quantity'),
  size2: text('size2'),
  rimNote: text('rim_note'),
  notes: text('notes'),
  intakeDate: text('intake_date'),
  releaseDate: text('release_date'),
  status: text('status').notNull().default('active'),
  createdAt: createdAt(),
  threadDepth: text('thread_depth'),
  smsCode: text('sms_code'),
  feeEur: text('fee_eur'),
  preparedDate: text('prepared_date'),
  branchId: integer('branch_id'),
}, (t) => [
  index('idx_storage_plate').on(sql`upper(${t.plate})`),
  index('idx_storage_status').on(t.status),
  index('idx_storage_location').on(t.location),
]);

export const users = pgTable('users', {
  id: id(),
  username: text('username').notNull().unique('users_username_key'),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('staff'),
  createdAt: createdAt(),
  perms: text('perms'),
  /** JSON array of branch ids the user may open; null = every branch. */
  branches: text('branches'),
});

export const containers = pgTable('containers', {
  id: id(),
  prefix: text('prefix').notNull().unique('containers_prefix_key'),
  label: text('label'),
  rows: integer('rows').notNull().default(1),
  cols: integer('cols').notNull().default(4),
  createdAt: createdAt(),
  cells: text('cells'),
  names: text('names'),
  zones: text('zones'),
  branchId: integer('branch_id'),
});

export const recordEvents = pgTable('record_events', {
  id: id(),
  recordId: text('record_id').notNull(),
  action: text('action').notNull(),
  comment: text('comment'),
  actor: text('actor'),
  createdAt: createdAt(),
}, (t) => [index('idx_events_record').on(t.recordId)]);

export const tasks = pgTable('tasks', {
  id: id(),
  kind: text('kind').notNull().default('order'),
  recordId: text('record_id'),
  title: text('title').notNull(),
  details: text('details'),
  location: text('location'),
  plate: text('plate'),
  status: text('status').notNull().default('open'),
  createdBy: text('created_by'),
  createdAt: createdAt(),
  doneBy: text('done_by'),
  doneAt: timestamp('done_at', { withTimezone: true, mode: 'string' }),
  branchId: integer('branch_id'),
}, (t) => [
  index('idx_tasks_status').on(t.status),
  index('idx_tasks_record').on(t.recordId),
]);

export const photos = pgTable('photos', {
  id: id(),
  recordId: text('record_id').notNull(),
  mime: text('mime').notNull(),
  data: bytea('data').notNull(),
  bytes: integer('bytes').notNull(),
  width: integer('width'),
  height: integer('height'),
  createdBy: text('created_by'),
  createdAt: createdAt(),
}, (t) => [index('idx_photos_record').on(t.recordId)]);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const pushSubs = pgTable('push_subs', {
  endpoint: text('endpoint').primaryKey(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  username: text('username'),
  createdAt: createdAt(),
});
