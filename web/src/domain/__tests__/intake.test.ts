import { describe, expect, it } from 'vitest';
import { buildIntake, makeSmsCode } from '../intake';
import { DEFAULT_PRICING } from '../pricing';
import { parseOrder, taskDetailsFor, taskNotice } from '../tasks';
import { rec } from '../../../tests/fixtures';

describe('makeSmsCode', () => {
  it('pads short plates and resolves collisions', () => {
    expect(makeSmsCode('AB1', new Set())).toBe('R1TAB1XX');
    expect(makeSmsCode('AB1234', new Set(['R1TAB123']))).toBe('R1TAB122');
  });
});

describe('buildIntake', () => {
  it('normalises the plate, prices the set and labels the rims', () => {
    const i = buildIntake({ plate: 'ab 12 34', size1: '225/45/17', rim: 'aluminum', threadDepth: 7.5 },
      { location: 'A3', pricing: DEFAULT_PRICING, smsCodes: new Set(), now: new Date('2025-10-05') });
    expect(i).toMatchObject({ plate: 'AB1234', location: 'A3', season: '2025 RUDENS', feeEur: '26', rimNote: 'Alumīnija diski', threadDepth: '7.5', smsCode: 'R1TAB123', intakeDate: null });
  });

  it('leaves the fee empty when there is no size', () => {
    expect(buildIntake({ plate: 'X1' }, { location: null, pricing: DEFAULT_PRICING, smsCodes: new Set(), now: new Date('2025-04-01') }))
      .toMatchObject({ feeEur: null, season: '2025 PAVASARIS', rimNote: null });
  });
});

describe('tasks', () => {
  it('splits an order into headline and detail', () => {
    expect(parseOrder('4× Nokian\nBMW X5 klientam\n')).toEqual({ title: '4× Nokian', details: 'BMW X5 klientam' });
  });

  it('describes a set for the warehouse and the notification', () => {
    const r = rec({ quantity: '4', brand: 'GY', size1: '205/55/16', customerName: 'Anna', rimNote: 'Lietie' });
    expect(taskDetailsFor(r)).toBe('4× Goodyear 205/55/16 · Anna · Lietie');
    expect(taskNotice({ kind: 'prepare', title: 'AB1', details: null, location: 'A1' })).toMatchObject({ title: 'R1 · Sagatavot riepas', body: 'Vieta A1 · AB1' });
  });
});
