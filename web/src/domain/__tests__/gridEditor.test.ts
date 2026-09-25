import { describe, expect, it } from 'vitest';
import { adoptShape, applySize, assignCodes, blank, cellString, fitResize, moveRow, namesOf, noCells, pack, paintCell, reflow, shift, type GridState } from '../gridEditor';

/** A 2×3 rack D1..D6 with D5 holding tires. */
function rack(): GridState {
  const s = blank(2, 3);
  return { ...s, codes: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'], occ: [false, false, false, false, true, false] };
}

describe('codes', () => {
  it('keeps carried codes and gives new cells the lowest free number', () => {
    const s = { ...blank(1, 4), codes: ['D2', null, 'X9', null] };
    expect(assignCodes(s, 'D')).toEqual(['D2', 'D1', 'X9', 'D3']);
    expect(namesOf(s, 'D')).toEqual({ 0: 'D2', 1: 'D1', 2: 'X9', 3: 'D3' });
  });
});

describe('resizing never loses a place', () => {
  it('keeps cells in place when the grid only grows', () => {
    const s = fitResize(rack(), 2, 4) as GridState;
    expect(cellString(s)).toBe('11101110');
    expect(s.codes[5]).toBe('D5');
    expect(s.occ[5]).toBe(true);
  });

  it('re-wraps in reading order when a place would fall off', () => {
    const s = fitResize(rack(), 3, 2) as GridState;
    expect(s.codes).toEqual(['D1', 'D2', 'D3', 'D4', 'D5', 'D6']);
    expect(reflow(rack(), 1, 5)).toBe('small:6/5');
  });

  it('lets a brand-new rack take any size', () => {
    const r = applySize(blank(4, 20), 2, 20, 'rows');
    expect('state' in r && [r.state.rows, r.state.cols, r.state.cells.length]).toEqual([2, 20, 40]);
  });

  it('grows the other dimension instead of dropping places', () => {
    const r = applySize(rack(), 1, 4, 'cols');
    expect('state' in r && [r.state.rows, r.state.cols]).toEqual([2, 4]);
    const r2 = applySize(rack(), 1, 3, 'rows');
    expect('state' in r2 && [r2.state.rows, r2.state.cols]).toEqual([1, 6]);
    expect(applySize(rack(), 99, 99, 'rows')).toEqual({ error: 'Pārāk liels konteiners (maks. 600 rūtiņas)' });
  });
});

describe('editing the drawing', () => {
  it('slides the drawing but not off the edge', () => {
    const s = { ...rack(), cells: [true, true, false, true, true, false] };
    const moved = shift(s, 0, 1)!;
    expect(cellString(moved)).toBe('011011');
    expect(moved.codes[2]).toBe('D2');
    expect(shift(moved, 0, 1)).toBeNull();
  });

  it('moves a whole row with its codes and tires', () => {
    const s = moveRow(rack(), 1, -1) as GridState;
    expect(s.codes).toEqual(['D4', 'D5', 'D6', 'D1', 'D2', 'D3']);
    expect(s.occ[1]).toBe(true);
    expect(moveRow(rack(), 0, -1)).toBe('edge');
    const zoned = { ...rack(), zones: [{ name: 'Z', cap: 2, cells: [2, 5] }] };
    expect(moveRow(zoned, 0, 1)).toBe('zone:Z');
  });

  it('refuses to switch off a place that holds tires', () => {
    expect(paintCell(rack(), 4, false, -1).cells[4]).toBe(true);
    expect(paintCell(rack(), 3, false, -1).cells[3]).toBe(false);
    expect(noCells(rack()).cells).toEqual([false, false, false, false, true, false]);
  });

  it('assigns cells to the selected zone, moving them out of another', () => {
    let s: GridState = { ...rack(), zones: [{ name: 'A', cap: 2, cells: [0] }, { name: 'B', cap: 2, cells: [] }] };
    s = paintCell(s, 0, true, 1);
    expect(s.zones.map((z) => z.cells)).toEqual([[], [0]]);
    s = paintCell(s, 0, true, 1);
    expect(s.zones[1].cells).toEqual([]);
  });

  it('packs gaps shut keeping numbers', () => {
    const s = pack({ ...rack(), cells: [true, false, true, true, false, true] });
    expect(cellString(s)).toBe('111100');
    expect(s.codes.slice(0, 4)).toEqual(['D1', 'D3', 'D4', 'D6']);
  });
});

describe('adoptShape', () => {
  it('takes another rack’s form, keeping places where the form has cells', () => {
    const s = adoptShape(rack(), { rows: 2, cols: 4, drawn: '11101111' }) as GridState;
    expect([s.rows, s.cols]).toEqual([2, 4]);
    expect(s.codes[5]).toBe('D5');
  });

  it('refuses a form too small for the places', () => {
    expect(adoptShape(rack(), { rows: 1, cols: 3, drawn: null })).toBe('room:6/3');
    expect(adoptShape(rack(), { rows: null, cols: 3, drawn: null })).toBe('empty');
  });
});
