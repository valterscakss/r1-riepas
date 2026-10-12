import { canonBrand } from './brands';
import { normSize, noteSize } from './sizes';
import type { StorageRecord } from './types';

export interface AnalyticsFilter { season?: string; status?: string; customer?: string; rims?: string }

/**
 * Aggregates for the Analītika screen: car makes/models, tire sizes, brands,
 * seasons and quantity types. Placeholder rows (blocked spots, BRĪVS markers)
 * hold no tires and would only skew the counts.
 */
export function analytics(records: StorageRecord[], f: AnalyticsFilter = {}) {
  const everything = records.filter((r) => r.status !== 'blocked' && r.status !== 'free');
  // Season options from the full set, so the dropdown is stable when filtered.
  // Year-prefixed seasons come first, newest first; oddly-named sheets last.
  const seasonOptions = [...new Set(everything.map((r) => (r.season ?? '').trim()).filter(Boolean))]
    .sort((a, b) => {
      const ya = /^\d{4}/.test(a), yb = /^\d{4}/.test(b);
      if (ya && yb) return b.localeCompare(a, 'lv');
      if (ya !== yb) return ya ? -1 : 1;
      return a.localeCompare(b, 'lv');
    });
  const season = (f.season ?? '').trim(), status = (f.status ?? '').trim(), customer = (f.customer ?? '').trim(), rims = (f.rims ?? '').trim();
  let all = everything;
  if (season) all = all.filter((r) => (r.season ?? '').trim() === season);
  if (status === 'active' || status === 'released' || status === 'prepared') all = all.filter((r) => r.status === status);
  if (customer === 'company') all = all.filter((r) => r.isCompany);
  else if (customer === 'private') all = all.filter((r) => !r.isCompany);
  if (rims === 'with') all = all.filter((r) => !!r.rimNote);
  else if (rims === 'without') all = all.filter((r) => !r.rimNote);

  const second = (r: StorageRecord) => (r.size2 ? normSize(r.size2) : noteSize(r.notes));
  const tally = (map: Map<string, number>, key: string | null | undefined) => {
    const k = (key ?? '').trim();
    if (k) map.set(k, (map.get(k) ?? 0) + 1);
  };
  const top = (map: Map<string, number>, n = 15) =>
    [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([label, count]) => ({ label, count }));

  const makes = new Map<string, number>(), models = new Map<string, number>(), sizes = new Map<string, number>();
  const brands = new Map<string, number>(), seasons = new Map<string, number>(), quantities = new Map<string, number>();
  let withSecond = 0;
  for (const r of all) {
    if (r.makeModel) {
      tally(models, r.makeModel);
      tally(makes, r.makeModel.trim().split(/\s+/)[0].toUpperCase());
    }
    const s1 = normSize(r.size1);
    if (s1) tally(sizes, s1);
    const s2 = second(r);
    if (s2) { tally(sizes, s2); withSecond++; }
    tally(brands, canonBrand(r.brand));
    tally(seasons, r.season);
    if (r.quantity) tally(quantities, r.quantity.trim());
  }
  return {
    total: all.length,
    active: all.filter((r) => r.status === 'active').length,
    prepared: all.filter((r) => r.status === 'prepared').length,
    released: all.filter((r) => r.status === 'released').length,
    withSecondSize: withSecond,
    seasonOptions, selectedSeason: season,
    filters: { status, customer, rims },
    makes: top(makes), models: top(models), sizes: top(sizes),
    brands: top(brands), seasons: top(seasons, 30), quantities: top(quantities),
  };
}
export type Analytics = ReturnType<typeof analytics>;
