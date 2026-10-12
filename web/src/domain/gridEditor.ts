/**
 * The container shape editor's model. A rack is a rows × cols grid; each cell is
 * drawn (a place) or not. Every place carries its CODE (`codes`) and whether it
 * holds tires (`occ`) through every edit: resize the grid, slide the drawing,
 * reorder rows — the number travels with its cell, so the records already
 * pointing at that number still land on the same physical place. Nothing here
 * ever drops a place that holds tires.
 *
 * All functions are pure: they return a new state (or a reason they can't).
 */
export interface EditorZone { name: string; cap: number; cells: number[] }
export interface GridState {
  rows: number;
  cols: number;
  cells: boolean[];
  codes: Array<string | null>;
  occ: boolean[];
  zones: EditorZone[];
}

export const MAX_CELLS = 600;
const clone = (s: GridState): GridState => ({ ...s, cells: [...s.cells], codes: [...s.codes], occ: [...s.occ], zones: s.zones.map((z) => ({ ...z, cells: [...z.cells] })) });

export const total = (s: GridState) => s.rows * s.cols;
export const drawnCount = (s: GridState) => s.cells.reduce((a, v) => a + (v ? 1 : 0), 0);
export const zoneOf = (s: GridState, i: number) => s.zones.findIndex((z) => z.cells.includes(i));
export const cellString = (s: GridState) => s.cells.map((v) => (v ? '1' : '0')).join('');

/** A fresh w × h grid, every cell drawn and unnumbered. */
export function blank(rows: number, cols: number): GridState {
  const n = rows * cols;
  return { rows, cols, cells: Array(n).fill(true), codes: Array(n).fill(null), occ: Array(n).fill(false), zones: [] };
}

/**
 * Final code of every place: the one it already carries, else the lowest free
 * prefix+number. Undrawn cells and cells swallowed by a zone get null.
 */
export function assignCodes(s: GridState, prefix: string): Array<string | null> {
  const zc = new Set(s.zones.flatMap((z) => z.cells));
  const out: Array<string | null> = Array(s.cells.length).fill(null);
  const taken = new Set(s.zones.map((z) => z.name));
  s.cells.forEach((on, i) => { if (on && !zc.has(i) && s.codes[i]) { out[i] = s.codes[i]; taken.add(s.codes[i]!); } });
  let n = 1;
  s.cells.forEach((on, i) => {
    if (!on || zc.has(i) || out[i]) return;
    while (taken.has(prefix + n)) n++;
    out[i] = prefix + n; taken.add(prefix + n);
  });
  return out;
}

/** Only codes that differ from the automatic prefix+position need storing. */
export function namesOf(s: GridState, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  assignCodes(s, prefix).forEach((code, i) => { if (code && code !== prefix + (i + 1)) out[String(i)] = code; });
  return out;
}

/**
 * Change the grid size keeping each cell where it is (by row and column); cells
 * that fall outside are dropped, new ones start undrawn — or, with `keep` off,
 * a fresh all-drawn grid.
 */
export function resize(s0: GridState, rows: number, cols: number, keep: boolean): GridState {
  const s = clone(s0);
  const old = s.cells, oc = s.cols;
  const cells: boolean[] = [], codes: Array<string | null> = [], occ: boolean[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const src = keep && old.length && c < oc ? r * oc + c : -1;
    const live = src >= 0 && src < old.length;
    cells.push(keep && old.length ? (live ? !!old[src] : false) : true);
    codes.push(live ? (s.codes[src] || null) : null);
    occ.push(live ? !!s.occ[src] : false);
  }
  const remap = (i: number) => { const r = Math.floor(i / oc), c = i % oc; return r < rows && c < cols ? r * cols + c : -1; };
  const zones = keep && old.length
    ? s.zones.map((z) => ({ ...z, cells: z.cells.map(remap).filter((i) => i >= 0) }))
    : s.zones.map((z) => ({ ...z, cells: [] }));
  return { rows, cols, cells, codes, occ, zones };
}

/** Slide the whole drawing; null when a place would fall off the edge. */
export function shift(s: GridState, dr: number, dc: number): GridState | null {
  const R = s.rows, C = s.cols;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (!s.cells[r * C + c]) continue;
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= R || nc < 0 || nc >= C) return null;
  }
  const n = R * C;
  const cells = Array(n).fill(false), codes: Array<string | null> = Array(n).fill(null), occ = Array(n).fill(false);
  const map = new Map<number, number>();
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const i = r * C + c;
    if (!s.cells[i]) continue;
    const j = (r + dr) * C + (c + dc);
    cells[j] = true; codes[j] = s.codes[i] || null; occ[j] = !!s.occ[i]; map.set(i, j);
  }
  return { ...s, cells, codes, occ, zones: s.zones.map((z) => ({ ...z, cells: z.cells.map((i) => map.get(i) ?? -1).filter((i) => i >= 0) })) };
}

/**
 * Re-wrap every place into a grid of another size, in reading order, so
 * stretching the rack never drops one. A zone keeps its cells in one run.
 */
export function reflow(s: GridState, rows: number, cols: number): GridState | `small:${number}/${number}` {
  const R = Math.max(1, rows), C = Math.max(1, cols), n = R * C;
  const slots: Array<{ code: string | null; occ: boolean; zone: string | null }> = [];
  s.cells.forEach((on, i) => {
    if (!on) return;
    const zi = zoneOf(s, i);
    slots.push({ code: s.codes[i] || null, occ: !!s.occ[i], zone: zi >= 0 ? s.zones[zi].name : null });
  });
  if (slots.length > n) return `small:${slots.length}/${n}`;
  const cells = Array(n).fill(false), codes: Array<string | null> = Array(n).fill(null), occ = Array(n).fill(false);
  const zc = new Map<string, number[]>();
  slots.forEach((sl, j) => {
    cells[j] = true; codes[j] = sl.code; occ[j] = sl.occ;
    if (sl.zone) { if (!zc.has(sl.zone)) zc.set(sl.zone, []); zc.get(sl.zone)!.push(j); }
  });
  return { rows: R, cols: C, cells, codes, occ, zones: s.zones.map((z) => ({ ...z, cells: zc.get(z.name) ?? [] })) };
}

/** Resize without losing a place: keep positions when everything fits, else re-wrap. */
export function fitResize(s: GridState, rows: number, cols: number): GridState | `small:${number}/${number}` {
  const R = Math.max(1, rows), C = Math.max(1, cols), oc = s.cols;
  const drops = s.cells.some((on, i) => on && (Math.floor(i / oc) >= R || i % oc >= C));
  return drops ? reflow(s, R, C) : resize(s, R, C, true);
}

/** A plain block: the places fill the grid from the start in reading order, no holes. */
export function isSolid(s: GridState): boolean {
  const n = drawnCount(s);
  return s.cells.every((on, i) => on === i < n);
}

/** Drop empty rows left hanging under the drawing. */
export function trimRows(s: GridState): GridState {
  const last = s.cells.lastIndexOf(true);
  const need = Math.max(1, Math.floor(last / s.cols) + 1);
  if (need >= s.rows) return s;
  const n = need * s.cols;
  return { ...s, rows: need, cells: s.cells.slice(0, n), codes: s.codes.slice(0, n), occ: s.occ.slice(0, n) };
}

/**
 * Swap a whole row with its neighbour. The row's places travel with it — cells,
 * numbers and the tires on them — so reordering shelves never renames anything.
 */
export function moveRow(s: GridState, row: number, dir: -1 | 1): GridState | 'edge' | `zone:${string}` {
  const R = s.rows, C = s.cols, to = row + dir;
  if (row < 0 || row >= R || to < 0 || to >= R) return 'edge';
  for (const z of s.zones) {
    const rs = new Set(z.cells.map((i) => Math.floor(i / C)));
    if (rs.size > 1 && (rs.has(row) || rs.has(to))) return `zone:${z.name}`;
  }
  const n = clone(s);
  const swap = <T,>(arr: T[]) => { for (let c = 0; c < C; c++) { const a = row * C + c, b = to * C + c; [arr[a], arr[b]] = [arr[b], arr[a]]; } };
  swap(n.cells); swap(n.codes); swap(n.occ);
  n.zones.forEach((z) => { z.cells = z.cells.map((i) => { const r = Math.floor(i / C), c = i % C; return r === row ? to * C + c : r === to ? row * C + c : i; }); });
  return n;
}

/**
 * Take another container's form: exactly its rows, columns and drawing. This
 * container's places come along — staying put when the form has a cell there,
 * otherwise re-wrapping into it in reading order. Refused only when the form
 * has fewer cells than this container has places.
 */
export function adoptShape(s: GridState, src: { rows: number | null; cols: number; drawn: string | null }): GridState | 'empty' | 'big' | `room:${number}/${number}` {
  const R = Math.max(1, src.rows || 0), C = Math.max(1, src.cols || 0);
  if (!src.rows || !src.cols) return 'empty';
  if (R > 99 || C > 99 || R * C > MAX_CELLS) return 'big';
  const drawn = src.drawn || '';
  const on = (i: number) => (drawn.length > i ? drawn[i] === '1' : true);
  const oc = s.cols;
  const targets: number[] = [];
  for (let i = 0; i < R * C; i++) if (on(i)) targets.push(i);
  // Only real places have to be carried; a blank cell holds nothing and no number.
  const keep: Array<{ i: number; code: string | null; occ: boolean }> = [];
  s.cells.forEach((live, i) => { if (live && (s.codes[i] || s.occ[i] || zoneOf(s, i) >= 0)) keep.push({ i, code: s.codes[i] || null, occ: !!s.occ[i] }); });
  if (targets.length < keep.length) return `room:${keep.length}/${targets.length}`;
  const cells = Array(R * C).fill(false), codes: Array<string | null> = Array(R * C).fill(null), occ = Array(R * C).fill(false);
  targets.forEach((j) => { cells[j] = true; });
  const at = (k: number) => { const r = Math.floor(k / oc), c = k % oc; return r < R && c < C && on(r * C + c) ? r * C + c : -1; };
  const fits = keep.every((k) => at(k.i) >= 0);
  const moved = new Map<number, number>();
  keep.forEach((k, n) => { const j = fits ? at(k.i) : targets[n]; codes[j] = k.code; occ[j] = k.occ; moved.set(k.i, j); });
  return { rows: R, cols: C, cells, codes, occ, zones: s.zones.map((z) => ({ ...z, cells: z.cells.map((i) => moved.get(i) ?? -1).filter((i) => i >= 0) })) };
}

/**
 * The rows/cols inputs. A plain rack follows the dimension you typed and
 * re-wraps (set places per shelf; the shelves work themselves out); either way
 * the other dimension grows rather than letting a place fall off.
 */
export function applySize(s: GridState, rowsIn: number, colsIn: number, which: 'rows' | 'cols'): { state: GridState } | { error: string } {
  let r = Math.max(1, Math.min(99, Math.trunc(rowsIn) || 1));
  let c = Math.max(1, Math.min(99, Math.trunc(colsIn) || 1));
  // A rack still being drawn — no numbers, no tires, no zones — has nothing to
  // protect: the size you type is simply the new grid.
  if (!s.cells.some((on, i) => on && (s.codes[i] || s.occ[i] || zoneOf(s, i) >= 0))) {
    if (r * c > MAX_CELLS) return { error: 'Pārāk liels konteiners (maks. 600 rūtiņas)' };
    return { state: blank(r, c) };
  }
  const need = drawnCount(s), solid = isSolid(s);
  if (solid && which === 'cols') r = Math.max(1, Math.ceil(need / c));
  if (r * c < need) { if (which === 'cols') r = Math.ceil(need / c); else c = Math.ceil(need / r); }
  if (r > 99 || c > 99 || r * c > MAX_CELLS) return { error: 'Pārāk liels konteiners (maks. 600 rūtiņas)' };
  const res = solid ? reflow(s, r, c) : fitResize(s, r, c);
  if (typeof res === 'string') return { error: `Šajā izmērā ietilpst ${r * c} rūtiņas, bet vietu ir ${need}` };
  return { state: solid && which === 'cols' ? trimRows(res) : res };
}

/** Close the gaps: every place slides into reading order, keeping its number; places per shelf stay. */
export const pack = (s: GridState): GridState => {
  const res = reflow(s, Math.max(1, Math.ceil(drawnCount(s) / s.cols)), s.cols);
  return typeof res === 'string' ? s : res;
};

/**
 * Click or drag over a cell. With a zone selected the click adds/removes the
 * cell to that zone; otherwise it switches the place on/off — never off while
 * it holds tires, so the drawing can't show a state the server would refuse.
 */
export function paintCell(s: GridState, i: number, value: boolean, zoneSel: number): GridState {
  if (zoneSel >= 0) {
    if (!s.cells[i]) return s;
    const n = clone(s);
    const other = zoneOf(n, i);
    if (other >= 0 && other !== zoneSel) n.zones[other].cells = n.zones[other].cells.filter((x) => x !== i);
    const z = n.zones[zoneSel];
    z.cells = z.cells.includes(i) ? z.cells.filter((x) => x !== i) : [...z.cells, i];
    return n;
  }
  if (!value && s.occ[i]) return s;
  if (s.cells[i] === value) return s;
  const n = clone(s);
  n.cells[i] = value;
  if (!value) n.zones.forEach((z) => { z.cells = z.cells.filter((x) => x !== i); });
  return n;
}

/** Every cell on, or only those holding tires. */
export const allCells = (s: GridState): GridState => ({ ...clone(s), cells: s.cells.map(() => true) });
export function noCells(s: GridState): GridState {
  const n = clone(s);
  n.cells = n.cells.map((_, i) => !!n.occ[i]);
  n.zones.forEach((z) => { z.cells = z.cells.filter((i) => n.cells[i]); });
  return n;
}

export const ZONE_NAME_RE = /^[A-ZĀČĒĢĪĶĻŅŠŪŽ0-9-]{1,8}$/;
