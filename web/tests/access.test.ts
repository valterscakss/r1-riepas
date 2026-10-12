import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, freshDb } from './db';
import { call, login, makeUser } from './api';
import { POST as intake } from '@/app/api/intake/route';
import { GET as storage } from '@/app/api/storage/route';
import { GET as getRec } from '@/app/api/storage/[id]/route';
import { PATCH as editRec } from '@/app/api/storage/[id]/route';
import { GET as events } from '@/app/api/storage/[id]/events/route';
import { GET as stats } from '@/app/api/stats/route';
import { GET as customers } from '@/app/api/customers/route';
import { GET as history } from '@/app/api/history/route';
import { GET as activity } from '@/app/api/activity/route';
import { GET as vehicle } from '@/app/api/vehicle/route';
import { GET as tasks } from '@/app/api/tasks/route';
import { GET as exportRoute } from '@/app/api/export/[what]/route';
import { GET as users } from '@/app/api/users/route';
import { PUT as pricing } from '@/app/api/pricing/route';
import { POST as createContainer } from '@/app/api/containers/route';

let admin = '', leja = '', noliktava = '', staffNoPhone = '', recId = '';

afterAll(closeDb);
beforeAll(async () => {
  await freshDb();
  await makeUser('boss', 'admin');
  await makeUser('leja', 'leja');
  await makeUser('nol', 'warehouse');
  await makeUser('kase', 'staff', { 'field.phone': false, 'field.price': false });
  admin = await login('boss'); leja = await login('leja'); noliktava = await login('nol'); staffNoPhone = await login('kase');
  await call(createContainer, '/api/containers', { cookie: admin, body: { prefix: 'A', rows: 1, cols: 2 } });
  const r = await call(intake, '/api/intake', { cookie: admin, body: { plate: 'AB1234', customerName: 'Anna Ozola', phone: '+37129999999', size1: '225/45/17' } });
  recId = r.body.id;
  await call(editRec, '/', { method: 'PATCH', cookie: admin, params: { id: recId }, body: { phone: '+37128888888', customerName: 'Anna Bērziņa' } });
});

const leaks = (payload: unknown) => {
  const s = JSON.stringify(payload);
  return ['Anna', '+3712', 'R1TAB123'].filter((x) => s.includes(x));
};

describe('screen and action gates', () => {
  it('keeps floor roles out of desk screens and actions', async () => {
    expect((await call(intake, '/api/intake', { cookie: leja, body: { plate: 'X1' } })).status).toBe(403);
    expect((await call(customers, '/api/customers', { cookie: leja })).status).toBe(403);
    expect((await call(history, '/api/history', { cookie: noliktava })).status).toBe(403);
    expect((await call(activity, '/api/activity', { cookie: leja })).status).toBe(403);
    expect((await call(exportRoute, '/', { cookie: leja, params: { what: 'storage' } })).status).toBe(403);
  });

  it('keeps admin tools to admins', async () => {
    expect((await call(users, '/api/users', { cookie: staffNoPhone })).status).toBe(403);
    expect((await call(pricing, '/api/pricing', { method: 'PUT', cookie: staffNoPhone, body: {} })).status).toBe(403);
    expect((await call(users, '/api/users', { cookie: admin })).status).toBe(200);
  });

  it('lets every role work the warehouse queue', async () => {
    expect((await call(tasks, '/api/tasks', { cookie: leja })).status).toBe(200);
  });

  it('returns 401 without a session', async () => {
    expect((await call(stats, '/api/stats')).status).toBe(401);
  });
});

describe('field redaction', () => {
  it('hides names, phones and SMS codes from the leja role everywhere it can look', async () => {
    const payloads = await Promise.all([
      call(stats, '/api/stats', { cookie: leja }),
      call(storage, '/api/storage', { cookie: leja }),
      call(getRec, '/', { cookie: leja, params: { id: recId } }),
      call(events, '/', { cookie: leja, params: { id: recId } }),
      call(vehicle, '/api/vehicle?plate=AB1234', { cookie: leja }),
    ]);
    for (const p of payloads) {
      expect(p.status).toBe(200);
      expect(leaks(p.body)).toEqual([]);
    }
    // The plate itself is what the floor works from.
    expect(JSON.stringify(payloads[0].body)).toContain('AB1234');
  });

  it('scrubs hidden values from edit summaries but keeps the visible ones', async () => {
    const ev = (await call(events, '/', { cookie: staffNoPhone, params: { id: recId } })).body.events;
    expect(ev.find((e: { action: string }) => e.action === 'edited').comment).toBe('Klients: Anna Ozola → Anna Bērziņa; Telefons: mainīts');
  });

  it('hides prices and phones from a staff member without them, including exports and revenue', async () => {
    const s = await call(stats, '/api/stats', { cookie: staffNoPhone });
    expect(s.body.revenueActive).toBeNull();
    const rec = await call(getRec, '/', { cookie: staffNoPhone, params: { id: recId } });
    expect(rec.body).toMatchObject({ phone: null, feeEur: null, customerName: 'Anna Bērziņa' });
    const x = await call(exportRoute, '/', { cookie: staffNoPhone, params: { what: 'storage' } });
    expect(x.status).toBe(200);
    const XLSX = await import('xlsx');
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(XLSX.read(new Uint8Array(await x.res.arrayBuffer())).Sheets.Tabula);
    expect(rows[0]).toMatchObject({ 'Auto nr.': 'AB1234', Telefons: '', Cena: '' });
  });
});
