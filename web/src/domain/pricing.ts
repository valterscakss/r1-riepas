/**
 * Storage prices. A tier matches the tire's WIDTH (the first number of 225/45/17),
 * inclusive at both ends; the widest tire of a staggered set decides. `rims`
 * multiplies the tier price when the set is stored on rims.
 */
export interface PricingTier { from: number; to: number; price: number }
export interface PricingConfig {
  tiers: PricingTier[];
  rims: { none: number; steel: number; aluminum: number };
}
export type RimKind = 'none' | 'steel' | 'aluminum';

export const DEFAULT_PRICING: PricingConfig = {
  tiers: [
    { from: 0, to: 215, price: 15 },
    { from: 216, to: 245, price: 20 },
    { from: 246, to: 275, price: 25 },
    { from: 276, to: 999, price: 30 },
  ],
  rims: { none: 1, steel: 1.2, aluminum: 1.3 },
};

/**
 * Coerce any payload into a valid config. Validation lives here so a bad payload
 * can never make the intake screen price things at zero.
 */
export function cleanPricing(raw: unknown): PricingConfig {
  const r = (raw ?? {}) as Partial<PricingConfig>;
  const num = (v: unknown, min: number, max: number, dflt: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
  };
  const tiers = (Array.isArray(r.tiers) ? r.tiers : [])
    .map((t) => ({
      from: Math.trunc(num((t as PricingTier)?.from, 0, 999, 0)),
      to: Math.trunc(num((t as PricingTier)?.to, 0, 999, 999)),
      price: Math.round(num((t as PricingTier)?.price, 0, 100000, 0) * 100) / 100,
    }))
    .filter((t) => t.to >= t.from)
    .sort((a, b) => a.from - b.from);
  const rims = (r.rims ?? {}) as PricingConfig['rims'];
  return {
    tiers: tiers.length ? tiers : DEFAULT_PRICING.tiers,
    rims: {
      none: num(rims.none, 0, 100, DEFAULT_PRICING.rims.none),
      steel: num(rims.steel, 0, 100, DEFAULT_PRICING.rims.steel),
      aluminum: num(rims.aluminum, 0, 100, DEFAULT_PRICING.rims.aluminum),
    },
  };
}

/** Overlapping ranges would make the price depend on row order — name the first clash. */
export function overlapError(cfg: PricingConfig): string | null {
  for (let i = 1; i < cfg.tiers.length; i++) {
    const a = cfg.tiers[i - 1], b = cfg.tiers[i];
    if (b.from <= a.to) return `Diapazoni pārklājas: ${a.from}–${a.to} un ${b.from}–${b.to}`;
  }
  return null;
}

export const widthOf = (size: string | null | undefined) => parseInt((size ?? '').slice(0, 3)) || 0;

/** First matching range; anything above every range falls to the last tier. */
export function tierFor(cfg: PricingConfig, width: number): PricingTier | null {
  return cfg.tiers.find((t) => width >= t.from && width <= t.to) ?? cfg.tiers[cfg.tiers.length - 1] ?? null;
}

export function rimMult(cfg: PricingConfig, rim: RimKind | string | null | undefined): number {
  return rim === 'aluminum' ? cfg.rims.aluminum : rim === 'steel' ? cfg.rims.steel : cfg.rims.none;
}

export function priceWith(cfg: PricingConfig, size: string | null, rim: RimKind | string | null, size2?: string | null) {
  const width = Math.max(widthOf(size), widthOf(size2 ?? null));
  if (!width) return { width: 0, base: 0, mult: 1, total: 0, tier: null as PricingTier | null };
  const tier = tierFor(cfg, width);
  const base = tier?.price ?? 0;
  const mult = rimMult(cfg, rim);
  return { width, base, mult, total: Math.round(base * mult * 100) / 100, tier };
}

/** Read the rim kind from a free-text DISKI note ("4 Lietie diski", "tērauda"). */
export function rimFromNote(note: string | null | undefined): RimKind {
  const n = note ?? '';
  return /alum|liet/i.test(n) ? 'aluminum' : /tērau|terau|dzelz/i.test(n) ? 'steel' : 'none';
}

export const rimLabel = (rim: RimKind): string | null =>
  rim === 'aluminum' ? 'Alumīnija diski' : rim === 'steel' ? 'Tērauda diski' : null;
