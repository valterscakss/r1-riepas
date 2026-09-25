import { SPOT_RE, type SpotUniverse } from './spots';
import { cellMap, parseNames, parseZones, type Container } from './types';

/** A result that is either a value or a user-facing error with its HTTP status. */
export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });
const ok = <T>(value: T) => ({ ok: true as const, value });

export const PREFIX_RE = /^[A-ZĀ-Ž]{1,4}$/;
export const PLACE_NAME_RE = /^[A-ZĀ-Ž0-9-]{1,10}$/;
const ZONE_NAME_RE = /^[A-ZĀ-Ž0-9-]{1,8}$/;
const validPlaceName = (n: string) => PLACE_NAME_RE.test(n) && /[A-ZĀ-Ž0-9]/.test(n);

/**
 * Validate a grid + drawn shape. `cells` is a '1'/'0' string, one char per grid
 * position; shorter input is padded with "present". A full grid stores no drawing.
 */
export function readGrid(b: { rows?: unknown; cols?: unknown; cells?: unknown }): Result<{ rows: number; cols: number; cells: string | null }> {
  const rows = Math.trunc(Number(b.rows));
  const cols = Math.trunc(Number(b.cols));
  if (!Number.isFinite(rows) || rows < 1 || rows > 99 || !Number.isFinite(cols) || cols < 1 || cols > 99) return fail(400, 'Rindas un kolonnas: 1–99');
  if (rows * cols > 600) return fail(400, 'Pārāk liels konteiners (maks. 600 rūtiņas)');
  const total = rows * cols;
  let cells: string | null = null;
  if (typeof b.cells === 'string' && b.cells.length) {
    const raw = b.cells.replace(/[^01]/g, '');
    cells = raw.length >= total ? raw.slice(0, total) : raw.padEnd(total, '1');
    if (!cells.includes('1')) return fail(400, 'Jāatzīmē vismaz viena vieta');
    if (!cells.includes('0')) cells = null;
  }
  return ok({ rows, cols, cells });
}

export function readPrefix(v: unknown): Result<string> {
  const prefix = String(v ?? '').toUpperCase().replace(/\s+/g, '');
  return PREFIX_RE.test(prefix) ? ok(prefix) : fail(400, 'Prefikss: 1–4 burti (piem. D)');
}

export type ContainerPatch = { label?: string | null; rows: number; cols: number; cells: string | null; names?: string | null; zones?: string | null };

/**
 * Redraw an existing container. Refuses to remove a place that currently holds
 * tires — the shape is a drawing of the rack, not a way to delete stock — and
 * refuses names that would merge two different places.
 */
export function planContainerEdit(def: Container, b: Record<string, unknown>, u: SpotUniverse): Result<ContainerPatch> {
  const grid = readGrid({ rows: b.rows ?? def.rows, cols: b.cols ?? def.cols, cells: b.cells });
  if (!grid.ok) return grid;
  const { rows, cols, cells } = grid.value;

  // Zones: each needs a valid unique name; its cells must be inside the grid and active.
  let zonesJson: string | null | undefined = undefined;
  if (b.zones !== undefined) {
    const zones = parseZones(typeof b.zones === 'string' ? b.zones : JSON.stringify(b.zones ?? []));
    const active = cellMap({ rows, cols, cells });
    const usedCell = new Set<number>();
    const usedName = new Set<string>();
    for (const z of zones) {
      if (!ZONE_NAME_RE.test(z.name)) return fail(400, `Zonas nosaukums "${z.name}": 1–8 burti/cipari`);
      if (usedName.has(z.name)) return fail(400, `Zonas nosaukums "${z.name}" atkārtojas`);
      usedName.add(z.name);
      for (const i of z.cells) {
        if (i >= active.length || !active[i]) return fail(400, `Zona "${z.name}" iezīmē neaktīvu rūtiņu`);
        if (usedCell.has(i)) return fail(400, 'Rūtiņa pieder divām zonām');
        usedCell.add(i);
      }
    }
    zonesJson = zones.length ? JSON.stringify(zones) : null;
  }

  let names = parseNames(def.names);
  const newZones = zonesJson !== undefined ? parseZones(zonesJson) : parseZones(def.zones);
  const zoneCells = new Set(newZones.flatMap((z) => z.cells));
  const activeMap = cellMap({ rows, cols, cells });
  // Codes this container was responsible for BEFORE the edit.
  const before = new Set((u.layouts.get(def.prefix) ?? []).flatMap((c) => (c && c.code ? [c.code] : [])));

  // `names` is the code each place carries, by position. The editor sends the whole
  // map on a redraw so a cell that moves takes its code along — every record on
  // that code still lands on the same physical place.
  let namesJson: string | null | undefined = undefined;
  if (b.names !== undefined) {
    let raw: unknown = b.names;
    if (typeof raw === 'string') { try { raw = raw.length ? JSON.parse(raw) : {}; } catch { raw = null; } }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(400, 'Nederīgs vietu nosaukumu saraksts');
    const next: Record<string, string> = {};
    const used = new Map<string, number>();
    for (const z of newZones) used.set(z.name, -1);
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const idx = Math.trunc(Number(k));
      // Entries for cells that are gone or swallowed by a zone simply don't apply.
      if (!Number.isFinite(idx) || idx < 0 || idx >= activeMap.length || !activeMap[idx] || zoneCells.has(idx)) continue;
      const name = String(v ?? '').toUpperCase().replace(/\s+/g, '');
      if (!validPlaceName(name)) return fail(400, `Vietas nosaukums "${name}": 1–10 burti/cipari/domuzīmes`);
      if (used.has(name)) return fail(409, `Nosaukums ${name} atkārtojas divām vietām`);
      used.set(name, idx);
      if (!before.has(name) && u.spots.some((s) => s.code === name)) return fail(409, `Vieta ${name} jau eksistē citur`);
      if (name !== `${def.prefix}${idx + 1}`) next[String(idx)] = name;
    }
    namesJson = Object.keys(next).length ? JSON.stringify(next) : null;
    names = next;
  }

  const survives = new Set<string>(newZones.map((z) => z.name));
  activeMap.forEach((on, i) => { if (on && !zoneCells.has(i)) survives.add((names[String(i)] || `${def.prefix}${i + 1}`).toUpperCase()); });
  // A zone below capacity is absent from `occupied` but records still live on it.
  const holds = (code: string) => u.occupied.has(code) || (u.zoneLoad.get(code)?.length ?? 0) > 0;
  const lost = [...before].filter((code) => holds(code) && !survives.has(code));
  if (lost.length) {
    return fail(409, `Šīs vietas ir aizņemtas un tās nevar noņemt: ${lost.slice(0, 12).join(', ')}${lost.length > 12 ? ` +${lost.length - 12}` : ''}`);
  }
  const label = b.label === undefined ? undefined : (typeof b.label === 'string' && b.label.trim() ? b.label.trim() : null);
  return ok({
    ...(label === undefined ? {} : { label }),
    ...(zonesJson === undefined ? {} : { zones: zonesJson }),
    ...(namesJson === undefined ? {} : { names: namesJson }),
    rows, cols, cells,
  });
}

export interface RenumberPlan {
  places: number;
  changed: number;
  /** Renames to apply IN ORDER; cycles go through temporary codes. */
  steps: Array<{ from: string; to: string }>;
  names: string | null;
}

/**
 * Hand out clean codes prefix1…prefixN in reading order, closing the gaps that
 * switching cells off leaves behind. Records move with their place; zones keep
 * their names and are skipped.
 */
export function planRenumber(def: Container, u: SpotUniverse, stampSeed = Date.now()): Result<RenumberPlan> {
  const names = parseNames(def.names);
  const zones = parseZones(def.zones);
  const zoneCells = new Set(zones.flatMap((z) => z.cells));
  const zoneNames = new Set(zones.map((z) => z.name));
  const plan: Array<{ idx: number; from: string; to: string }> = [];
  cellMap(def).forEach((on, i) => {
    if (!on || zoneCells.has(i)) return;
    const from = (names[String(i)] || `${def.prefix}${i + 1}`).toUpperCase();
    plan.push({ idx: i, from, to: `${def.prefix}${plan.length + 1}` });
  });
  if (!plan.length) return fail(400, 'Konteinerā nav numurējamu vietu');
  const mine = new Set(plan.map((p) => p.from));
  const clash = plan.find((p) => p.to !== p.from && (zoneNames.has(p.to) || (u.spots.some((s) => s.code === p.to) && !mine.has(p.to))));
  if (clash) return fail(409, `Numurs ${clash.to} jau pieder citai vietai`);

  // Order the renames so each lands on a code nothing is sitting on yet. Closing
  // gaps only frees numbers; custom names can form a cycle (A→B, B→A), and then
  // one place waits on a temporary code.
  const pending = new Map(plan.filter((p) => p.to !== p.from).map((p) => [p.from, p]));
  const held = new Set(pending.keys());
  const steps: Array<{ from: string; to: string }> = [];
  const tail: Array<{ from: string; to: string }> = [];
  const stamp = `TMP-${stampSeed.toString(36).toUpperCase()}`;
  while (pending.size) {
    const ready = [...pending.values()].filter((p) => !held.has(p.to));
    if (ready.length) {
      for (const p of ready) { steps.push({ from: p.from, to: p.to }); pending.delete(p.from); held.delete(p.from); }
      continue;
    }
    const p = pending.values().next().value!;
    const tmp = `${stamp}-${tail.length}`;
    steps.push({ from: p.from, to: tmp });
    tail.push({ from: tmp, to: p.to });
    pending.delete(p.from); held.delete(p.from);
  }
  const next: Record<string, string> = {};
  for (const p of plan) if (p.to !== `${def.prefix}${p.idx + 1}`) next[String(p.idx)] = p.to;
  return ok({
    places: plan.length,
    changed: plan.filter((p) => p.to !== p.from).length,
    steps: [...steps, ...tail],
    names: Object.keys(next).length ? JSON.stringify(next) : null,
  });
}

export interface RenamePlan { from: string; to: string; container: { id: string; names: string | null } | null }

/**
 * Rename one place. A place in a drawn container keeps its name by position, so
 * any valid name works; a place that exists only through records must stay
 * letters+number, or the map could not reconstruct it.
 */
export function planSpotRename(fromRaw: unknown, toRaw: unknown, u: SpotUniverse): Result<RenamePlan | null> {
  const from = String(fromRaw ?? '').toUpperCase().replace(/\s+/g, '');
  const to = String(toRaw ?? '').toUpperCase().replace(/\s+/g, '');
  if (!validPlaceName(to)) return fail(400, 'Nosaukums: 1–10 burti/cipari/domuzīmes (piem. B7 vai PLAUKTS-1)');
  if (from === to) return ok(null);
  if (!u.spots.some((s) => s.code === from)) return fail(404, 'Vieta nav atrasta');
  if (u.spots.some((s) => s.code === to)) return fail(409, `Vieta ${to} jau eksistē`);
  for (const d of u.defs) {
    const layout = u.layouts.get(d.prefix) ?? [];
    const idx = layout.findIndex((c) => c && c.code === from && !('zone' in c && c.zone));
    if (idx >= 0) {
      const names = parseNames(d.names);
      // Renaming back to the automatic code just clears the alias.
      if (to === `${d.prefix}${idx + 1}`) delete names[String(idx)]; else names[String(idx)] = to;
      return ok({ from, to, container: { id: d.id, names: Object.keys(names).length ? JSON.stringify(names) : null } });
    }
  }
  if (!SPOT_RE.test(to)) {
    return fail(400, 'Šī vieta nav uzzīmētā konteinerā, tāpēc nosaukumam jābūt burti+numurs (piem. B7). Brīvs nosaukums iespējams vietām, kuru konteiners ir izveidots sadaļā Novietnes.');
  }
  return ok({ from, to, container: null });
}
