import { describe, expect, it } from 'vitest';
import { ALL_ON, computePerms, diffFromDefaults, redactAll, redactEventComment, redactRecord, ROLE_DEFAULTS } from '../perms';
import { rec } from '../../../tests/fixtures';

describe('computePerms', () => {
  it('gives floor roles only their starting screens', () => {
    const p = computePerms('leja', null);
    expect(p['screen.spots']).toBe(true);
    expect(p['screen.warehouse']).toBe(true);
    expect(p['field.customer']).toBe(false);
    expect(p['act.operate']).toBe(false);
  });

  it('applies per-user overrides on top of the role', () => {
    const p = computePerms('warehouse', JSON.stringify({ 'field.phone': true, 'screen.table': false }));
    expect(p['field.phone']).toBe(true);
    expect(p['screen.table']).toBe(false);
  });

  it('keeps an admin all-on whatever the overrides say', () => {
    expect(computePerms('admin', JSON.stringify({ 'screen.home': false }))).toEqual(ALL_ON);
  });

  it('ignores junk in stored overrides', () => {
    expect(computePerms('staff', '{"screen.home": "no", "bogus": true}')).toEqual(ROLE_DEFAULTS.staff);
    expect(computePerms('staff', 'not json')).toEqual(ROLE_DEFAULTS.staff);
  });

  it('stores only deviations from the role defaults', () => {
    expect(diffFromDefaults('warehouse', { 'screen.warehouse': true, 'field.sms': true, 'act.edit': false })).toEqual({ 'field.sms': true });
  });
});

describe('redaction', () => {
  const r = rec({ phone: '+37120000000', customerName: 'Anna', feeEur: '20', smsCode: 'R1TAB123' });

  it('removes exactly the fields that are off', () => {
    const out = redactRecord(r, computePerms('leja', null));
    expect(out).toMatchObject({ phone: null, customerName: null, feeEur: null, smsCode: null });
    expect(r.phone).toBe('+37120000000'); // original untouched
  });

  it('returns the same objects when nothing is hidden', () => {
    const list = [r];
    expect(redactAll(list, ALL_ON)).toBe(list);
  });

  it('hides old/new values of hidden fields in edit summaries only', () => {
    const p = { ...ALL_ON, 'field.phone': false };
    const c = 'Telefons: +371111 → +371222; Vieta: A1 → A2 · zvanīja';
    expect(redactEventComment('edited', c, p)).toBe('Telefons: mainīts; Vieta: A1 → A2 · zvanīja');
    expect(redactEventComment('comment', 'Telefons: 123', p)).toBe('Telefons: 123');
    expect(redactEventComment('edited', c, ALL_ON)).toBe(c);
  });
});
