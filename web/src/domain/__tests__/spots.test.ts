import { describe, expect, it } from 'vitest';
import { firstFreeSpot, spotUniverse, statsView } from '../spots';
import { ALL_ON, computePerms } from '../perms';
import { container, rec } from '../../../tests/fixtures';

describe('spotUniverse', () => {
  it('picks the current holder of a place across seasons', () => {
    const old = rec({ location: 'A1', plate: 'OLD1', intakeDate: '2022-10-01' });
    const cur = rec({ location: 'A1', plate: 'NEW1', intakeDate: '2025-10-01' });
    const placeholder = rec({ location: 'A1', status: 'blocked', intakeDate: '2026-01-01' });
    const u = spotUniverse([cur, old, placeholder], []);
    expect(u.occupied.get('A1')?.plate).toBe('NEW1');
  });

  it('ignores released sets and non-place locations', () => {
    const u = spotUniverse([rec({ location: 'B2', status: 'released' }), rec({ location: 'GARĀŽA KREISĀ' })], []);
    expect(u.spots.map((s) => s.code)).toEqual(['B2']);
    expect(u.occupied.size).toBe(0);
  });

  it('lays out a drawn container with holes, custom names and a zone', () => {
    const d = container({ prefix: 'D', rows: 2, cols: 3, cells: '110111', names: JSON.stringify({ 1: 'PLAUKTS-1' }), zones: JSON.stringify([{ name: 'GRĪDA', cells: [4, 5], cap: 3 }]) });
    const u = spotUniverse([rec({ location: 'GRĪDA', plate: 'Z1' })], [d]);
    const layout = u.layouts.get('D')!;
    expect(layout[0]).toEqual({ code: 'D1' });
    expect(layout[1]).toEqual({ code: 'PLAUKTS-1' });
    expect(layout[2]).toBeNull();
    expect(layout[4]).toMatchObject({ code: 'GRĪDA', zone: { cap: 3, span: 2, hspan: 2 } });
    expect(layout[5]).toEqual({ fill: true });
    // One set in a zone of three: still assignable.
    expect(u.occupied.has('GRĪDA')).toBe(false);
    expect(u.zoneLoad.get('GRĪDA')).toHaveLength(1);
  });

  it('assigns the first free place, zones included', () => {
    const d = container({ prefix: 'A', rows: 1, cols: 2 });
    expect(firstFreeSpot(spotUniverse([rec({ location: 'A1', plate: 'X' })], [d]))).toBe('A2');
  });
});

describe('statsView', () => {
  const d = container({ prefix: 'A', rows: 1, cols: 3 });
  const all = [
    rec({ location: 'A1', plate: 'AB1', customerName: 'Anna', smsCode: 'R1TAB1XX', feeEur: '20', intakeDate: '2025-10-01' }),
    rec({ location: 'A2', plate: 'AB2', status: 'prepared', feeEur: '30' }),
  ];

  it('counts capacity and hands out the next place', () => {
    const s = statsView(spotUniverse(all, [d]), ALL_ON, '2025-10-01');
    expect(s).toMatchObject({ occ: 2, total: 3, free: 1, reserved: 1, capPct: 67, todayIntakes: 1, smsIssued: 1, revenueActive: 20, assignNext: 'A3' });
    expect(s.containers[0].cells[0]).toMatchObject({ code: 'A1', cust: 'Anna', sms: 'R1TAB1XX' });
  });

  it('does not reveal names, SMS codes or revenue to floor roles', () => {
    const s = statsView(spotUniverse(all, [d]), computePerms('leja', null), '2025-10-01');
    expect(s.revenueActive).toBeNull();
    expect(s.containers[0].cells[0]).toMatchObject({ code: 'A1', plate: 'AB1', cust: null, sms: null });
  });
});
