/**
 * Canonical tire-brand names — collapses the shop's shorthand (GY, Conti, BS) so
 * analytics don't split one brand across spellings. Unknown brands keep their text.
 */
const BRAND_ALIASES: Record<string, string> = {
  GY: 'Goodyear', GOODYEAR: 'Goodyear', 'GOOD YEAR': 'Goodyear',
  CONTI: 'Continental', CONTINENTAL: 'Continental',
  BS: 'Bridgestone', BRIDGESTONE: 'Bridgestone', BRIDG: 'Bridgestone',
  MICH: 'Michelin', MICHELIN: 'Michelin',
  PIRELLI: 'Pirelli', NOKIAN: 'Nokian', HANKOOK: 'Hankook',
  YOKOHAMA: 'Yokohama', DUNLOP: 'Dunlop', SAVA: 'Sava',
  KUMHO: 'Kumho', NEXEN: 'Nexen', SAILUN: 'Sailun', TOYO: 'Toyo',
  MARSHAL: 'Marshal', MARSHALL: 'Marshal',
};

export function canonBrand(b: string | null | undefined): string | null {
  const t = (b ?? '').trim();
  if (!t) return null;
  return BRAND_ALIASES[t.toUpperCase()] ?? t;
}

/** Brands offered by the intake form's inline completion. */
export const BRANDS = ['Michelin', 'Continental', 'Nokian', 'Pirelli', 'Bridgestone', 'Goodyear', 'Hankook', 'Yokohama',
  'Dunlop', 'Kumho', 'Toyo', 'Falken', 'Vredestein', 'Sailun', 'Nexen', 'BFGoodrich', 'Firestone', 'Sava', 'Barum',
  'Matador', 'Fulda', 'Kleber', 'Gislaved', 'Laufenn', 'Triangle', 'Linglong'];

/** How the intake form writes a typed brand: the known spelling, else capitalised. */
export function formBrand(v: string | null | undefined): string {
  const t = (v || '').trim();
  if (!t) return t;
  return BRANDS.find((b) => b.toLowerCase() === t.toLowerCase()) || t.charAt(0).toUpperCase() + t.slice(1);
}

/** The first known brand the typed prefix completes to, if any. */
export function completeBrand(prefix: string): string | null {
  if (!prefix) return null;
  return BRANDS.find((b) => b.toLowerCase().startsWith(prefix.toLowerCase())) ?? null;
}
