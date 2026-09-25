import type { Perms } from './perms';
import { cellMap, parseNames, parseZones, type Container, type StorageRecord, type Zone } from './types';

/** A place code reconstructed from records: 1–4 letters + a number (A12, GR3). */
export const SPOT_RE = /^([A-ZĀ-Ž]{1,4})(\d{1,3})$/;

export interface Spot { code: string; c: string; n: number }
export type LayoutCell =
  | { code: string; zone?: { name: string; cap: number; span: number; hspan: number } }
  | { fill: true; code?: undefined }
  | null;

export interface SpotUniverse {
  spots: Spot[];
  /** code → the record currently holding it (zones below capacity are absent). */
  occupied: Map<string, StorageRecord>;
  all: StorageRecord[];
  defs: Container[];
  layouts: Map<string, LayoutCell[]>;
  zoneCaps: Map<string, number>;
  zoneLoad: Map<string, StorageRecord[]>;
}

const holdsSpot = (r: StorageRecord) => r.status === 'active' || r.status === 'prepared' || r.status === 'blocked';
// A row with real content outranks a bare placeholder; then the later intake;
// then the row touched most recently.
const substance = (r: StorageRecord) => (r.plate || r.size1 || r.customerName ? 1 : 0);
function current(a: StorageRecord, b: StorageRecord): StorageRecord {
  if (substance(a) !== substance(b)) return substance(a) > substance(b) ? a : b;
  const ad = a.intakeDate ?? '', bd = b.intakeDate ?? '';
  if (ad !== bd) return ad > bd ? a : b;
  return Number(a.id) > Number(b.id) ? a : b;
}

/**
 * Every place the shop has and who is in it: places mentioned by records plus
 * every cell of the drawn containers. A place carries rows from every season it
 * was ever used in, so the CURRENT holder is chosen explicitly.
 */
export function spotUniverse(all: StorageRecord[], defs: Container[]): SpotUniverse {
  const seen = new Map<string, Spot>();
  const occupied = new Map<string, StorageRecord>();
  for (const r of all) {
    const code = (r.location ?? '').toUpperCase();
    const m = code.match(SPOT_RE);
    if (!m) continue;
    if (!seen.has(code)) seen.set(code, { code, c: m[1], n: Number(m[2]) });
    if (!holdsSpot(r)) continue;
    const prev = occupied.get(code);
    occupied.set(code, prev ? current(prev, r) : r);
  }
  // Drawn containers: a place is numbered by its POSITION, and may carry a custom
  // name. `layouts` keeps grid order (null = hole) so the UI can draw the shape.
  const layouts = new Map<string, LayoutCell[]>();
  const zoneCaps = new Map<string, number>();
  for (const d of defs) {
    const map = cellMap(d);
    const names = parseNames(d.names);
    const zones = parseZones(d.zones);
    const zoneAt = new Map<number, { name: string; cap: number; first: number; size: number }>();
    for (const z of zones) {
      const cells = z.cells.filter((i) => i < map.length && map[i]).sort((a, b) => a - b);
      if (!cells.length) continue;
      const zi = { name: z.name, cap: z.cap, first: cells[0], size: cells.length };
      cells.forEach((i) => zoneAt.set(i, zi));
      zoneCaps.set(z.name, z.cap);
      if (!seen.has(z.name)) seen.set(z.name, { code: z.name, c: d.prefix, n: cells[0] + 1 });
    }
    const layout: LayoutCell[] = [];
    map.forEach((on, i) => {
      if (!on) { layout.push(null); return; }
      const z = zoneAt.get(i);
      if (z) {
        // The first zone cell renders the zone; the rest are 'fill' so the client
        // stretches the zone button across them.
        layout.push(i === z.first ? { code: z.name, zone: { name: z.name, cap: z.cap, span: z.size, hspan: 1 } } : { fill: true });
        return;
      }
      const code = (names[String(i)] || `${d.prefix}${i + 1}`).toUpperCase();
      layout.push({ code });
      if (!seen.has(code)) seen.set(code, { code, c: d.prefix, n: i + 1 });
    });
    // hspan: the run of the zone's own fill cells directly to its right in the row.
    layout.forEach((c, i) => {
      if (!c || !('zone' in c) || !c.zone) return;
      let h = 1;
      const row = Math.floor(i / d.cols);
      for (let j = i + 1; j < layout.length && Math.floor(j / d.cols) === row; j++) {
        const nx = layout[j];
        if (nx && 'fill' in nx && nx.fill) h++; else break;
      }
      c.zone.hspan = h;
    });
    layouts.set(d.prefix, layout);
  }
  const spots = [...seen.values()].sort((a, b) => a.c.localeCompare(b.c) || a.n - b.n);
  // A zone holds up to `cap` sets: it stays assignable until that many sit there.
  const zoneLoad = new Map<string, StorageRecord[]>();
  for (const r of all) {
    const code = (r.location ?? '').toUpperCase();
    if (!zoneCaps.has(code) || !holdsSpot(r)) continue;
    if (!zoneLoad.has(code)) zoneLoad.set(code, []);
    zoneLoad.get(code)!.push(r);
  }
  for (const [name, cap] of zoneCaps) {
    if ((zoneLoad.get(name) ?? []).length < cap) occupied.delete(name);
  }
  return { spots, occupied, all, defs, layouts, zoneCaps, zoneLoad };
}

/** The first place a new intake can go, or null when the shop is full. */
export function firstFreeSpot(u: SpotUniverse): string | null {
  return u.spots.find((s) => !u.occupied.has(s.code))?.code ?? null;
}

/**
 * The dashboard / spot-map payload. The map shows who sits where, so it goes out
 * under the same field rules as any record payload.
 */
export function statsView(u: SpotUniverse, perms: Perms, today: string) {
  const { spots, occupied, all, defs, layouts, zoneCaps, zoneLoad } = u;
  const custOf = (r: StorageRecord) => (perms['field.customer'] ? r.customerName : null);
  const smsOf = (r: StorageRecord) => (perms['field.sms'] ? r.smsCode : null);
  const defByPrefix = new Map(defs.map((d) => [d.prefix, d]));
  const zoneOf = (code: string) => zoneCaps.has(code);
  const spotView = (code: string, zone?: { name: string; cap: number; span: number; hspan: number }) => {
    if (zone) {
      const recs = zoneLoad.get(zone.name) ?? [];
      return {
        code: zone.name, zone: true, cap: zone.cap, count: recs.length, span: zone.span, hspan: zone.hspan,
        occ: recs.length >= zone.cap, reserved: false, blocked: false, hasRims: false,
        plates: recs.slice(0, 6).map((r) => r.plate).filter(Boolean),
        recs: recs.slice(0, 20).map((r) => ({ id: r.id, plate: r.plate, cust: custOf(r), size: r.size1, brand: r.brand, status: r.status })),
      };
    }
    const r = occupied.get(code);
    return r
      ? { code, occ: true, reserved: r.status === 'prepared', blocked: r.status === 'blocked', hasRims: !!r.rimNote, id: r.id, plate: r.plate, cust: custOf(r), brand: r.brand, size: r.size1, sms: smsOf(r), thread: r.threadDepth }
      : { code, occ: false };
  };
  const byC = new Map<string, { letter: string; spots: SpotView[]; occ: number; cap: number }>();
  for (const s of spots) {
    if (!byC.has(s.c)) byC.set(s.c, { letter: s.c, spots: [], occ: 0, cap: 0 });
    const g = byC.get(s.c)!;
    if (zoneOf(s.code)) {
      g.cap += zoneCaps.get(s.code)!;
      g.occ += Math.min((zoneLoad.get(s.code) ?? []).length, zoneCaps.get(s.code)!);
    } else {
      g.cap += 1;
      if (occupied.get(s.code)) g.occ++;
    }
    g.spots.push(zoneOf(s.code)
      ? spotView(s.code, { name: s.code, cap: zoneCaps.get(s.code)!, span: 0, hspan: 1 })
      : spotView(s.code));
  }
  const containers = [...byC.values()]
    .map((g) => {
      const d = defByPrefix.get(g.letter);
      // `cells` is the drawn grid in reading order (null = hole). Containers that
      // exist only because records mention them have no drawing: cells === spots.
      const layout = d ? layouts.get(d.prefix) : null;
      const cells = layout
        ? layout.map((c) => (c ? ('fill' in c && c.fill ? { zoneFill: true as const } : spotView(c.code!, 'zone' in c ? c.zone : undefined)) : null))
        : g.spots;
      return {
        ...g, cells, total: g.cap, cols: d?.cols ?? 4, rows: d?.rows ?? null,
        label: d?.label ?? null, defId: d?.id ?? null, drawn: d?.cells ?? null,
        zones: d ? parseZones(d.zones) : [] as Zone[], names: d?.names ?? null,
      };
    })
    .sort((a, b) => a.letter.localeCompare(b.letter));
  const totalCap = containers.reduce((a, c) => a + c.total, 0);
  const occ = containers.reduce((a, c) => a + c.occ, 0);
  const reserved = [...occupied.values()].filter((r) => r.status === 'prepared').length;
  const firstFree = spots.find((s) => !occupied.has(s.code) && !zoneOf(s.code));
  const revenue = all.filter((r) => r.status === 'active' && r.feeEur).reduce((a, r) => a + (parseFloat(r.feeEur!) || 0), 0);
  return {
    occ, total: totalCap, free: totalCap - occ, reserved,
    capPct: totalCap ? Math.round((occ / totalCap) * 100) : 0,
    todayIntakes: all.filter((r) => r.intakeDate === today).length,
    smsIssued: all.filter((r) => r.smsCode).length,
    revenueActive: perms['field.price'] ? Math.round(revenue * 100) / 100 : null,
    assignNext: firstFree?.code ?? null,
    containers,
  };
}

export type SpotView = {
  code: string; occ: boolean; zone?: boolean; cap?: number; count?: number; span?: number; hspan?: number;
  reserved?: boolean; blocked?: boolean; hasRims?: boolean; id?: string; plate?: string | null; cust?: string | null;
  brand?: string | null; size?: string | null; sms?: string | null; thread?: string | null;
  plates?: (string | null)[]; recs?: Array<{ id: string; plate: string | null; cust: string | null; size: string | null; brand: string | null; status: string }>;
};
export type StatsView = ReturnType<typeof statsView>;
export type ContainerView = StatsView['containers'][number];
export type CellView = ContainerView['cells'][number];
