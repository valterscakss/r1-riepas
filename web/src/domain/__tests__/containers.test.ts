import { describe, expect, it } from 'vitest';
import { planContainerEdit, planRenumber, planSpotRename, readGrid } from '../containers';
import { spotUniverse } from '../spots';
import { container, rec } from '../../../tests/fixtures';

describe('readGrid', () => {
  it('validates size and stores no drawing for a full grid', () => {
    expect(readGrid({ rows: 2, cols: 3, cells: '111111' })).toEqual({ ok: true, value: { rows: 2, cols: 3, cells: null } });
    expect(readGrid({ rows: 2, cols: 3, cells: '10' })).toEqual({ ok: true, value: { rows: 2, cols: 3, cells: '101111' } });
    expect(readGrid({ rows: 0, cols: 3 })).toMatchObject({ ok: false, status: 400 });
    expect(readGrid({ rows: 30, cols: 30 })).toMatchObject({ ok: false, error: 'Pārāk liels konteiners (maks. 600 rūtiņas)' });
    expect(readGrid({ rows: 1, cols: 2, cells: '00' })).toMatchObject({ ok: false, error: 'Jāatzīmē vismaz viena vieta' });
  });
});

describe('planContainerEdit', () => {
  const d = container({ prefix: 'D', rows: 1, cols: 4 });

  it('refuses to remove a place that holds tires', () => {
    const u = spotUniverse([rec({ location: 'D4', plate: 'X' })], [d]);
    const r = planContainerEdit(d, { rows: 1, cols: 3 }, u);
    expect(r).toMatchObject({ ok: false, status: 409, error: 'Šīs vietas ir aizņemtas un tās nevar noņemt: D4' });
  });

  it('lets an occupied place move when its code travels with it', () => {
    const u = spotUniverse([rec({ location: 'D4', plate: 'X' })], [d]);
    // Two rows of two: D4 now sits at position 1 and keeps its code via names.
    const r = planContainerEdit(d, { rows: 2, cols: 2, names: JSON.stringify({ 0: 'D1', 1: 'D4', 2: 'D2', 3: 'D3' }) }, u);
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.value.names!)).toEqual({ 1: 'D4', 2: 'D2', 3: 'D3' });
  });

  it('refuses a name that already belongs to another container', () => {
    const other = container({ prefix: 'E', rows: 1, cols: 1 });
    const u = spotUniverse([], [d, other]);
    expect(planContainerEdit(d, { names: JSON.stringify({ 0: 'E1' }) }, u)).toMatchObject({ ok: false, error: 'Vieta E1 jau eksistē citur' });
  });

  it('validates zones', () => {
    const u = spotUniverse([], [d]);
    expect(planContainerEdit(d, { cells: '1110', zones: JSON.stringify([{ name: 'Z', cells: [3], cap: 2 }]) }, u))
      .toMatchObject({ ok: false, error: 'Zona "Z" iezīmē neaktīvu rūtiņu' });
    expect(planContainerEdit(d, { zones: JSON.stringify([{ name: 'Z', cells: [0], cap: 2 }, { name: 'Y', cells: [0], cap: 2 }]) }, u))
      .toMatchObject({ ok: false, error: 'Rūtiņa pieder divām zonām' });
  });
});

describe('planRenumber', () => {
  it('closes gaps in reading order and moves records with their place', () => {
    const d = container({ prefix: 'A', rows: 1, cols: 4, cells: '1011' });
    const r = planRenumber(d, spotUniverse([], [d]), 1);
    expect(r).toMatchObject({ ok: true, value: { places: 3, changed: 2 } });
    if (r.ok) {
      expect(r.value.steps).toEqual([{ from: 'A3', to: 'A2' }, { from: 'A4', to: 'A3' }]);
      expect(JSON.parse(r.value.names!)).toEqual({ 2: 'A2', 3: 'A3' });
    }
  });

  it('breaks a naming cycle through a temporary code', () => {
    const d = container({ prefix: 'A', rows: 1, cols: 2, names: JSON.stringify({ 0: 'A2', 1: 'A1' }) });
    const r = planRenumber(d, spotUniverse([], [d]), 35);
    expect(r.ok && r.value.steps).toEqual([{ from: 'A2', to: 'TMP-Z-0' }, { from: 'A1', to: 'A2' }, { from: 'TMP-Z-0', to: 'A1' }]);
  });

  it('never takes a number that belongs to someone else', () => {
    const d = container({ prefix: 'A', rows: 1, cols: 2, cells: '01' });
    const u = spotUniverse([rec({ location: 'A1', plate: 'X' })], [d]);
    expect(planRenumber(d, u)).toMatchObject({ ok: false, status: 409, error: 'Numurs A1 jau pieder citai vietai' });
  });
});

describe('planSpotRename', () => {
  const d = container({ prefix: 'B', rows: 1, cols: 2 });

  it('stores a drawn place name by position; renaming back clears it', () => {
    const u = spotUniverse([], [d]);
    expect(planSpotRename('b2', 'plaukts-1', u)).toEqual({ ok: true, value: { from: 'B2', to: 'PLAUKTS-1', container: { id: d.id, names: '{"1":"PLAUKTS-1"}' } } });
    const renamed = { ...d, names: '{"1":"PLAUKTS-1"}' };
    expect(planSpotRename('PLAUKTS-1', 'B2', spotUniverse([], [renamed]))).toMatchObject({ ok: true, value: { container: { names: null } } });
  });

  it('requires letters+number for a place known only from records', () => {
    const u = spotUniverse([rec({ location: 'C5', plate: 'X' })], []);
    expect(planSpotRename('C5', 'KAKTS', u)).toMatchObject({ ok: false, status: 400 });
    expect(planSpotRename('C5', 'C6', u)).toMatchObject({ ok: true, value: { container: null } });
  });

  it('rejects unknown places and taken names', () => {
    const u = spotUniverse([], [d]);
    expect(planSpotRename('Q1', 'Q2', u)).toMatchObject({ ok: false, status: 404 });
    expect(planSpotRename('B1', 'B2', u)).toMatchObject({ ok: false, status: 409 });
  });
});
