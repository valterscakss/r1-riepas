import { describe, expect, it } from 'vitest';
import { activityFeed, buildHistory } from '../history';
import { ALL_ON, computePerms } from '../perms';
import { ev, rec } from '../../../tests/fixtures';

describe('buildHistory', () => {
  const a = rec({ plate: 'A', customerName: 'Anna', intakeDate: '2025-10-01', releaseDate: '2026-12-01', quantity: '4', brand: 'GY', size1: '205/55/16' });
  const b = rec({ plate: 'B', intakeDate: '2025-09-01' });
  const events = [
    ev({ recordId: b.id, action: 'created', createdAt: '2025-09-01T08:30:00.000Z', actor: 'juris' }),
    ev({ recordId: a.id, action: 'edited', comment: 'Telefons: 1 → 2', createdAt: '2025-10-02 09:00:00' }),
  ];

  it('mixes logged events with date-derived ones, newest first, skipping future dates', () => {
    const h = buildHistory([a, b], events, ALL_ON, '2025-10-15');
    expect(h.map((e) => [e.type, e.plate])).toEqual([['edited', 'A'], ['in', 'A'], ['created', 'B']]);
    expect(h[1]).toMatchObject({ cust: 'Anna', tires: '4× Goodyear 205/55/16' });
  });

  it('filters by date range, type and text', () => {
    expect(buildHistory([a, b], events, ALL_ON, '2025-10-15', { from: '2025-10-01', to: '2025-10-01' }).map((e) => e.type)).toEqual(['in']);
    expect(buildHistory([a, b], events, ALL_ON, '2025-10-15', { types: ['created'] })).toHaveLength(1);
    expect(buildHistory([a, b], events, ALL_ON, '2025-10-15', { q: 'juris' })).toHaveLength(1);
  });

  it('applies field rules to names and edit summaries', () => {
    const h = buildHistory([a, b], events, computePerms('warehouse', null), '2025-10-15');
    expect(h.every((e) => e.cust === null)).toBe(true);
    expect(h[0].comment).toBe('Telefons: mainīts');
  });

  it('caps the dashboard feed at twelve', () => {
    const many = Array.from({ length: 20 }, (_, i) => rec({ plate: `P${i}`, intakeDate: '2025-01-01' }));
    expect(activityFeed(many, [], ALL_ON, '2025-10-01')).toHaveLength(12);
  });
});
