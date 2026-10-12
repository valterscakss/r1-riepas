import { expect, it } from 'vitest';
import { analytics } from '../analytics';
import { rec } from '../../../tests/fixtures';

it('tallies makes, sizes (incl. 2nd sizes from notes), brands and filters', () => {
  const recs = [
    rec({ season: '2025 RUDENS', makeModel: 'BMW X5', size1: '275/45R20', brand: 'conti', quantity: '2+2', notes: '305/40/20' }),
    rec({ season: '2024 PAVASARIS', makeModel: 'bmw 320', size1: '225/45/17', brand: 'Continental', status: 'released', isCompany: true }),
    rec({ season: 'VECIE', status: 'blocked' }),
  ];
  const a = analytics(recs);
  expect(a.total).toBe(2);
  expect(a.makes).toEqual([{ label: 'BMW', count: 2 }]);
  expect(a.brands).toEqual([{ label: 'Continental', count: 2 }]);
  expect(a.withSecondSize).toBe(1);
  expect(a.sizes.map((s) => s.label)).toEqual(['225/45/17', '275/45/20', '305/40/20']);
  expect(a.seasonOptions).toEqual(['2025 RUDENS', '2024 PAVASARIS']);
  expect(analytics(recs, { customer: 'company' }).total).toBe(1);
  expect(analytics(recs, { season: '2025 RUDENS', status: 'released' }).total).toBe(0);
});
