import { describe, expect, it } from 'vitest';
import { companySuggestions, editSummary, groupCustomers, histItem, plateLookup, plateSuggestions, readEditPatch, releaseMatches } from '../records';
import { rec } from '../../../tests/fixtures';

describe('lookups', () => {
  const recs = [
    rec({ plate: 'AB1234', customerName: 'Anna', intakeDate: '2024-10-01', status: 'released', notes: '275/40/19' }),
    rec({ plate: 'AB1234', customerName: 'Anna', intakeDate: '2025-10-01', smsCode: 'R1TAB123', location: 'A1' }),
    rec({ plate: 'XAB12', customerName: 'Bruno', intakeDate: '2025-01-01', status: 'released' }),
  ];

  it('prefills intake from the newest record of the plate', () => {
    const l = plateLookup(recs, 'AB1234');
    expect(l).toMatchObject({ found: true, history: 2, lastIntake: '2025-10-01', suggestion: { customerName: 'Anna' } });
    expect(plateLookup(recs, 'ZZ9').found).toBe(false);
  });

  it('suggests prefix matches first, then sets in storage', () => {
    expect(plateSuggestions(recs, 'ab 12').map((s) => s.plate)).toEqual(['AB1234', 'XAB12']);
    expect(plateSuggestions(recs, 'a')).toEqual([]);
  });

  it('finds sets to release by exact code, plate or place before partial matches', () => {
    const active = recs.filter((r) => r.status === 'active');
    expect(releaseMatches(active, 'r1t ab123').map((r) => r.plate)).toEqual(['AB1234']);
    expect(releaseMatches(active, 'a1').map((r) => r.location)).toEqual(['A1']);
    expect(releaseMatches(active, '1234').map((r) => r.plate)).toEqual(['AB1234']);
  });

  it('suggests each company once with its vehicle count', () => {
    const cos = [rec({ isCompany: true, customerName: 'SIA Serviss', plate: 'A1' }), rec({ isCompany: true, customerName: 'sia serviss ', plate: 'A2' })];
    expect(companySuggestions(cos, 'serv')).toEqual([{ name: 'SIA Serviss', phone: null, vehicles: 2, count: 2, last: null }]);
  });
});

describe('groupCustomers', () => {
  it('groups a company across vehicles and a person by real phone', () => {
    const g = groupCustomers([
      rec({ isCompany: true, customerName: 'SIA A', plate: 'P1' }),
      rec({ isCompany: true, customerName: 'SIA A', plate: 'P2' }),
      rec({ customerName: 'Jānis', phone: '+37129123456', plate: 'P3' }),
      rec({ customerName: 'Jānis', phone: '+37129123456', plate: 'P4' }),
    ]);
    expect(g.map((c) => [c.name, c.plates.length])).toEqual(expect.arrayContaining([['SIA A', 2], ['Jānis', 2]]));
  });

  it('never groups on the anonymised placeholder phone', () => {
    const g = groupCustomers([
      rec({ customerName: 'A', phone: '01010101010', plate: 'P1' }),
      rec({ customerName: 'B', phone: '01010101010', plate: 'P2' }),
      rec({ customerName: 'C', phone: '22222222', plate: 'P3' }),
      rec({ customerName: 'D', phone: '22222222', plate: 'P4' }),
    ]);
    expect(g).toHaveLength(4);
  });
});

it('splits a staggered set in history items', () => {
  expect(histItem(rec({ quantity: '2+2', brand: 'Pirelli', size1: '245/40/19', notes: 'aizm. 275/35/19' })))
    .toMatchObject({ tires: '2× Pirelli 245/40/19', tires2: '2× 275/35/19', size2: '275/35/19' });
});

describe('edits', () => {
  it('reads only allowlisted fields and normalises them', () => {
    expect(readEditPatch({ plate: ' ab 12 ', location: 'a 1', notes: '  ', status: 'released', isCompany: 1 }))
      .toEqual({ plate: 'AB12', location: 'A1', notes: null, isCompany: true });
  });

  it('summarises what changed', () => {
    const before = rec({ phone: '1', location: 'A1' });
    const after = { ...before, phone: '2', location: 'A1' };
    expect(editSummary(before, after, ['phone', 'location'], ' klients zvanīja ')).toBe('Telefons: 1 → 2 · klients zvanīja');
    expect(editSummary(before, before, ['phone'], null)).toBe('Rediģēti dati');
  });
});
