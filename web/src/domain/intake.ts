import { priceWith, rimLabel, type PricingConfig, type RimKind } from './pricing';
import { seasonOf } from './format';
import { normCode, type IntakeInput } from './types';

/**
 * The customer's release code: R1T + plate, 8 characters, padded with X; a
 * collision swaps the last character(s) for a counter.
 */
export function makeSmsCode(plate: string, existing: Set<string>): string {
  let code = (`R1T${plate.replace(/[^A-Z0-9]/g, '')}`).slice(0, 8).padEnd(8, 'X');
  let n = 2;
  while (existing.has(code)) code = (code.slice(0, 7) + n++).slice(0, 8);
  return code;
}

export interface IntakeBody {
  plate?: unknown; location?: unknown; rim?: unknown; size1?: unknown; size2?: unknown; season?: unknown;
  makeModel?: unknown; customerName?: unknown; isCompany?: unknown; phone?: unknown; brand?: unknown;
  quantity?: unknown; rimNote?: unknown; notes?: unknown; intakeDate?: unknown; threadDepth?: unknown; releaseId?: unknown;
}

const s = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));

/**
 * Build the new record from the intake form. Only the plate is required; the
 * place is given or the first free one; price = width tier × rim multiplier.
 */
export function buildIntake(b: IntakeBody, ctx: { location: string | null; pricing: PricingConfig; smsCodes: Set<string>; now: Date }): IntakeInput {
  const plate = normCode(b.plate);
  const rim: RimKind = b.rim === 'aluminum' || b.rim === 'steel' ? b.rim : 'none';
  const { total } = priceWith(ctx.pricing, s(b.size1), rim, s(b.size2));
  return {
    season: s(b.season) ?? seasonOf(ctx.now),
    location: ctx.location,
    plate,
    makeModel: s(b.makeModel),
    customerName: s(b.customerName),
    isCompany: Boolean(b.isCompany),
    phone: s(b.phone),
    size1: s(b.size1),
    brand: s(b.brand),
    quantity: s(b.quantity),
    size2: s(b.size2),
    rimNote: s(b.rimNote) ?? rimLabel(rim),
    notes: s(b.notes),
    intakeDate: s(b.intakeDate), // null → the repository stamps today
    threadDepth: b.threadDepth ? String(b.threadDepth) : null,
    smsCode: makeSmsCode(plate, ctx.smsCodes),
    feeEur: total ? String(total) : null,
  };
}
