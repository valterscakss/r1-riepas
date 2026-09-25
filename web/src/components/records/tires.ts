import { formBrand } from '@/domain/brands';

/** "4× Nokian 205/55/16 + 225/45/17" for the compact set cards. */
export function tiresOf(x: { brand: string | null; quantity: string | null; size: string | null; size2?: string | null }): string {
  const base = `${x.quantity ? `${x.quantity}× ` : ''}${formBrand(x.brand) || '—'}${x.size ? ` ${x.size}` : ''}`.trim() || '—';
  return base + (x.size2 ? ` + ${x.size2}` : '');
}
