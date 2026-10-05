import type { Role, StorageRecord } from './types';

/**
 * Per-user permissions. Every screen, action and sensitive data field is a key an
 * admin can tick on or off per user; the role only supplies the DEFAULTS.
 *
 * Enforcement is server-side: endpoints are gated by permission, and record
 * payloads pass through redactRecord() so a user without `field.phone` never
 * receives a phone number at all — hiding it in the UI would not be protection.
 */
export const PERM_KEYS = [
  // Screens (sidebar sections)
  'screen.home', 'screen.warehouse', 'screen.intake', 'screen.release', 'screen.pending',
  'screen.spots', 'screen.customers', 'screen.table', 'screen.analytics', 'screen.history',
  // Actions
  'act.operate',  // intake / release / prepare / block — the physical workflows
  'act.edit',     // edit record data fields
  'act.media',    // add photos and comments to records
  'act.export',   // download Excel files
  // Sensitive data fields (redacted from every payload when off)
  'field.phone', 'field.customer', 'field.price', 'field.sms',
] as const;
export type PermKey = typeof PERM_KEYS[number];
export type Perms = Record<PermKey, boolean>;

export const ALL_ON = Object.freeze(Object.fromEntries(PERM_KEYS.map((k) => [k, true])) as Perms);
export const ALL_OFF = Object.freeze(Object.fromEntries(PERM_KEYS.map((k) => [k, false])) as Perms);

export const ROLE_DEFAULTS: Record<Role, Perms> = {
  admin: { ...ALL_ON },
  staff: { ...ALL_ON },
  warehouse: {
    ...ALL_OFF,
    'screen.warehouse': true,
    'screen.table': true,   // find any tire set in the full list…
    'act.media': true,      // …and add photos/comments to it
  },
  // The downstairs floor: the warehouse's start plus the spot map, since that is
  // what you work from when fetching and shelving sets.
  leja: {
    ...ALL_OFF,
    'screen.warehouse': true,
    'screen.table': true,
    'screen.spots': true,
    'act.media': true,
  },
};

/** Parse stored overrides; anything that is not a {key: boolean} map is ignored. */
export function parseOverrides(raw: string | null | undefined): Partial<Perms> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Perms> = {};
    for (const k of PERM_KEYS) if (typeof v?.[k] === 'boolean') out[k] = v[k] as boolean;
    return out;
  } catch { return {}; }
}

/**
 * Effective permissions = role defaults + per-user overrides. An admin is always
 * all-on regardless of overrides, so an admin cannot lock themselves out.
 */
export function computePerms(role: Role, overridesJson: string | null | undefined): Perms {
  if (role === 'admin') return { ...ALL_ON };
  return { ...(ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS.staff), ...parseOverrides(overridesJson) };
}

/** Keep only real deviations from the role defaults, so a role change later brings its new defaults. */
export function diffFromDefaults(role: Role, wanted: Record<string, unknown>): Partial<Perms> {
  const defaults = ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS.staff;
  const out: Partial<Perms> = {};
  for (const k of PERM_KEYS) if (typeof wanted[k] === 'boolean' && wanted[k] !== defaults[k]) out[k] = wanted[k] as boolean;
  return out;
}

const seesAllFields = (p: Perms) => p['field.phone'] && p['field.customer'] && p['field.price'] && p['field.sms'];

/** Strip the fields this user may not see. Never mutates the original. */
export function redactRecord<T extends Partial<StorageRecord>>(rec: T, perms: Perms): T {
  if (seesAllFields(perms)) return rec;
  const out = { ...rec };
  if (!perms['field.phone'] && 'phone' in out) out.phone = null;
  if (!perms['field.customer'] && 'customerName' in out) out.customerName = null;
  if (!perms['field.price'] && 'feeEur' in out) out.feeEur = null;
  if (!perms['field.sms'] && 'smsCode' in out) out.smsCode = null;
  return out;
}

export function redactAll<T extends Partial<StorageRecord>>(recs: T[], perms: Perms): T[] {
  return seesAllFields(perms) ? recs : recs.map((r) => redactRecord(r, perms));
}

/**
 * Labels an edit summary uses for the sensitive fields ("Telefons: a → b"). The
 * summary is plain text in the history, so values are cut out on the way out.
 */
const EDIT_FIELD_LABELS: Array<[string, PermKey]> = [
  ['Telefons', 'field.phone'], ['Klients', 'field.customer'], ['Cena', 'field.price'], ['SMS kods', 'field.sms'],
];

/** Hide the old → new values of sensitive fields in an 'edited' event's summary. */
export function redactEventComment(action: string, comment: string | null, perms: Perms): string | null {
  if (!comment || action !== 'edited') return comment;
  const hidden = EDIT_FIELD_LABELS.filter(([, k]) => !perms[k]).map(([label]) => label);
  if (!hidden.length) return comment;
  // Summary shape: "Label: old → new; Label: old → new · free comment".
  const [diffs, ...rest] = comment.split(' · ');
  const safe = diffs.split('; ').map((part) => {
    const label = hidden.find((l) => part.startsWith(`${l}: `));
    return label ? `${label}: mainīts` : part;
  }).join('; ');
  return [safe, ...rest].join(' · ');
}

// ---- Labels shared by the admin UI ----

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrators', staff: 'Personāls', warehouse: 'Noliktava', leja: 'Leja',
};
export const ROLE_OPTIONS: Array<[Role, string]> = [
  ['staff', 'Personāls'], ['warehouse', 'Noliktava (tikai uzdevumi)'], ['leja', 'Leja (tikai uzdevumi)'], ['admin', 'Administrators'],
];

export const PERM_GROUPS: Array<[string, Array<[PermKey, string]>]> = [
  ['Sadaļas', [['screen.home', 'Sākums'], ['screen.warehouse', 'Noliktava'], ['screen.intake', 'Jauna glabāšana'], ['screen.release', 'Izsniegt glabāšanu'], ['screen.pending', 'Sagatavotie'], ['screen.spots', 'Novietnes'], ['screen.customers', 'Klienti'], ['screen.table', 'Tabula'], ['screen.analytics', 'Analītika'], ['screen.history', 'Vēsture']]],
  ['Darbības', [['act.operate', 'Pieņemt / izsniegt / sagatavot'], ['act.edit', 'Rediģēt ierakstu datus'], ['act.media', 'Pievienot bildes un komentārus'], ['act.export', 'Eksportēt Excel']]],
  ['Redzamie dati', [['field.customer', 'Klientu vārdi'], ['field.phone', 'Telefona numuri'], ['field.price', 'Cenas'], ['field.sms', 'SMS kodi']]],
];
