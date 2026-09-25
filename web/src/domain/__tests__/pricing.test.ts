import { describe, expect, it } from 'vitest';
import { cleanPricing, DEFAULT_PRICING, overlapError, priceWith, rimFromNote } from '../pricing';

describe('priceWith', () => {
  it('prices by width tier × rim multiplier', () => {
    expect(priceWith(DEFAULT_PRICING, '225/45/17', 'none').total).toBe(20);
    expect(priceWith(DEFAULT_PRICING, '225/45/17', 'aluminum').total).toBe(26);
    expect(priceWith(DEFAULT_PRICING, '205/55/16', 'steel').total).toBe(18);
  });

  it('lets the wider tire of a staggered set decide', () => {
    expect(priceWith(DEFAULT_PRICING, '245/40/19', 'none', '275/35/19').total).toBe(25);
  });

  it('is zero for an unreadable size and falls to the last tier above every range', () => {
    expect(priceWith(DEFAULT_PRICING, null, 'none').total).toBe(0);
    const cfg = { ...DEFAULT_PRICING, tiers: [{ from: 0, to: 200, price: 10 }] };
    expect(priceWith(cfg, '315/35/20', 'none').total).toBe(10);
  });
});

describe('cleanPricing', () => {
  it('falls back to defaults for garbage and sorts tiers', () => {
    expect(cleanPricing(null)).toEqual(DEFAULT_PRICING);
    const c = cleanPricing({ tiers: [{ from: 300, to: 999, price: '40' }, { from: 0, to: 299, price: 9.999 }], rims: { none: 1, steel: -3, aluminum: 2 } });
    expect(c.tiers).toEqual([{ from: 0, to: 299, price: 10 }, { from: 300, to: 999, price: 40 }]);
    expect(c.rims).toEqual({ none: 1, steel: 1.2, aluminum: 2 });
  });

  it('reports overlapping ranges', () => {
    expect(overlapError(cleanPricing({ tiers: [{ from: 0, to: 220, price: 1 }, { from: 215, to: 999, price: 2 }] }))).toBe('Diapazoni pārklājas: 0–220 un 215–999');
    expect(overlapError(DEFAULT_PRICING)).toBeNull();
  });
});

it('reads the rim kind from a DISKI note', () => {
  expect(rimFromNote('4 Lietie diski')).toBe('aluminum');
  expect(rimFromNote('Tērauda')).toBe('steel');
  expect(rimFromNote('4 JAUNAS')).toBe('none');
});
