import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { closeDb, freshDb } from './db';
import { call, login, makeUser } from './api';
import { POST as intake } from '@/app/api/intake/route';
import { GET as getRec } from '@/app/api/storage/[id]/route';
import { GET as stats } from '@/app/api/stats/route';
import { POST as createContainer, GET as listContainers } from '@/app/api/containers/route';
import { PATCH as editContainer, DELETE as deleteContainer } from '@/app/api/containers/[id]/route';
import { POST as renumber } from '@/app/api/containers/[id]/renumber/route';
import { POST as renameSpot } from '@/app/api/spots/[code]/rename/route';
import { GET as getPricing, PUT as putPricing } from '@/app/api/pricing/route';
import { POST as recalc } from '@/app/api/pricing/recalculate/route';
import { POST as importRoute } from '@/app/api/import/route';
import { GET as storage } from '@/app/api/storage/route';
import { GET as photos, POST as upload } from '@/app/api/storage/[id]/photos/route';
import { GET as photo, DELETE as delPhoto } from '@/app/api/photos/[id]/route';
import { POST as createUser, GET as listUsers } from '@/app/api/users/route';
import { PATCH as editUser, DELETE as deleteUser } from '@/app/api/users/[username]/route';
import { GET as getPerms, PUT as putPerms } from '@/app/api/users/[username]/perms/route';
import { POST as resetPw } from '@/app/api/users/[username]/reset/route';
import { POST as custType } from '@/app/api/customers/type/route';
import { GET as customers } from '@/app/api/customers/route';
import { GET as analytics } from '@/app/api/analytics/route';
import { GET as health } from '@/app/api/health/route';
import { ensureAdmin } from '@/server/auth';
import * as usersRepo from '@/server/repo/users';

let admin = '';
afterAll(closeDb);
beforeEach(async () => {
  await freshDb();
  await makeUser('boss', 'admin');
  admin = await login('boss');
});

const take = (body: object) => call(intake, '/api/intake', { cookie: admin, body });

describe('containers', () => {
  it('draws, guards, renumbers and deletes a rack', async () => {
    const c = await call(createContainer, '/api/containers', { cookie: admin, body: { prefix: 'd', rows: 1, cols: 4, cells: '1011', label: ' Ziema ' } });
    expect(c.status).toBe(201);
    expect(c.body.container).toMatchObject({ prefix: 'D', cells: '1011', label: 'Ziema' });
    expect((await call(createContainer, '/api/containers', { cookie: admin, body: { prefix: 'D', rows: 1, cols: 1 } })).status).toBe(409);
    const id = c.body.container.id;
    await take({ plate: 'X1', location: 'D4' });
    // Drawing D4 away while it holds tires is refused.
    expect((await call(editContainer, '/', { method: 'PATCH', cookie: admin, params: { id }, body: { cells: '1010' } })).body.error.message).toMatch(/D4/);
    // Renumbering moves the record with its place: D3→D2, D4→D3.
    const rn = await call(renumber, '/', { cookie: admin, params: { id } });
    expect(rn.body).toMatchObject({ ok: true, places: 3, changed: 2, renamed: 1 });
    const s = await call(stats, '/api/stats', { cookie: admin });
    expect(s.body.containers[0].cells.map((x: { code?: string } | null) => x?.code ?? null)).toEqual(['D1', null, 'D2', 'D3']);
    expect(s.body.containers[0].cells[3]).toMatchObject({ occ: true, plate: 'X1' });
    expect((await call(deleteContainer, '/', { method: 'DELETE', cookie: admin, params: { id } })).status).toBe(200);
    expect((await call(listContainers, '/api/containers', { cookie: admin })).body.containers).toEqual([]);
  });

  it('saves the numbers the editor showed, and refuses a zone name used elsewhere', async () => {
    const c = await call(createContainer, '/api/containers', { cookie: admin, body: { prefix: 'E', rows: 1, cols: 4, names: JSON.stringify({ 2: 'E1', 3: 'E2' }), zones: JSON.stringify([{ name: 'GRIDA', cells: [0, 1], cap: 3 }]) } });
    expect(c.status).toBe(201);
    const s = await call(stats, '/api/stats', { cookie: admin });
    expect(s.body.containers[0].cells.map((x: { code?: string } | null) => x?.code ?? null)).toEqual(['GRIDA', null, 'E1', 'E2']);
    const clash = await call(createContainer, '/api/containers', { cookie: admin, body: { prefix: 'F', rows: 1, cols: 2, zones: JSON.stringify([{ name: 'GRIDA', cells: [0], cap: 2 }]) } });
    expect(clash).toMatchObject({ status: 409, body: { error: { message: 'Vieta GRIDA jau eksistē citur' } } });
    // The half-made container is rolled back.
    expect((await call(listContainers, '/api/containers', { cookie: admin })).body.containers.map((x: { prefix: string }) => x.prefix)).toEqual(['E']);
  });

  it('renames a place and moves its records along', async () => {
    await call(createContainer, '/api/containers', { cookie: admin, body: { prefix: 'B', rows: 1, cols: 2 } });
    const r = (await take({ plate: 'X1', location: 'B2' })).body;
    const rn = await call(renameSpot, '/', { cookie: admin, params: { code: 'B2' }, body: { name: 'plaukts-1' } });
    expect(rn.body).toEqual({ ok: true, changed: 1, name: 'PLAUKTS-1' });
    expect((await call(getRec, '/', { cookie: admin, params: { id: r.id } })).body.location).toBe('PLAUKTS-1');
  });
});

describe('pricing', () => {
  it('saves rules, rejects overlaps and reprices stored sets after a dry run', async () => {
    const r = (await take({ plate: 'X1', size1: '225/45/17' })).body;
    expect(r.feeEur).toBe('20');
    expect((await call(putPricing, '/api/pricing', { method: 'PUT', cookie: admin, body: { tiers: [{ from: 0, to: 230, price: 10 }, { from: 220, to: 999, price: 20 }] } })).status).toBe(400);
    const cfg = { tiers: [{ from: 0, to: 999, price: 33 }], rims: { none: 1, steel: 1.2, aluminum: 1.3 } };
    expect((await call(putPricing, '/api/pricing', { method: 'PUT', cookie: admin, body: cfg })).body.pricing).toEqual(cfg);
    expect((await call(getPricing, '/api/pricing', { cookie: admin })).body.pricing).toEqual(cfg);
    const dry = await call(recalc, '/api/pricing/recalculate?dryRun=1', { cookie: admin });
    expect(dry.body).toMatchObject({ dryRun: true, changed: 1, sample: [{ plate: 'X1', from: '20', to: '33' }] });
    expect((await call(getRec, '/', { cookie: admin, params: { id: r.id } })).body.feeEur).toBe('20');
    await call(recalc, '/api/pricing/recalculate', { cookie: admin });
    expect((await call(getRec, '/', { cookie: admin, params: { id: r.id } })).body.feeEur).toBe('33');
  });
});

describe('excel import', () => {
  const workbook = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['VIETA', 'AUTO NR.', 'NOSAUKUMS', 'VĀRDS', 'TELEFONA NR.', 'IZMĒRS', 'NOSAUKUMS', 'SKAITS', 'DISKI', 'PIEZĪMES', 'SAŅEMŠANAS DATUMS', 'IZSNIEGŠANAS DATUMS'],
      ['A1', 'AB1234', 'BMW', 'Anna', 29123456, '225/45/17', 'Nokian', '4', null, null, '01.10.2025', null],
      ['A2', 'BRĪVS', null, null, null, null, null, null, null, null, null, null],
    ]), '2025 RUDENS');
    const fd = new FormData();
    fd.append('file', new Blob([XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })]), 'r1.xlsx');
    return fd;
  };

  it('previews without writing, then replaces the data', async () => {
    await take({ plate: 'OLD1' });
    const dry = await call(importRoute, '/api/import?dryRun=1', { cookie: admin, form: workbook() });
    expect(dry.body).toMatchObject({ ok: true, dryRun: true, parsed: 2, sheets: 1, sample: [{ plate: 'AB1234' }, { status: 'free' }] });
    expect((await call(storage, '/api/storage', { cookie: admin })).body.count).toBe(1);
    const real = await call(importRoute, '/api/import', { cookie: admin, form: workbook() });
    expect(real.body).toMatchObject({ ok: true, imported: 2 });
    const all = (await call(storage, '/api/storage', { cookie: admin })).body.records;
    expect(all.map((r: { plate: string | null }) => r.plate)).toEqual([null, 'AB1234']);
  });

  it('rejects a file that is not a workbook', async () => {
    const fd = new FormData();
    fd.append('file', new Blob(['hello']), 'x.txt');
    expect((await call(importRoute, '/api/import', { cookie: admin, form: fd })).status).toBe(400);
  });
});

describe('photos', () => {
  it('uploads, serves and deletes a photo, logging it in the history', async () => {
    const r = (await take({ plate: 'X1' })).body;
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const fd = new FormData();
    fd.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'a.jpg');
    fd.append('width', '1280'); fd.append('height', '960');
    const up = await call(upload, '/', { cookie: admin, params: { id: r.id }, form: fd });
    expect(up.status).toBe(201);
    expect(up.body.photo).toMatchObject({ bytes: 7, width: 1280, height: 960, url: `/api/photos/${up.body.photo.id}` });
    const got = await call(photo, '/', { cookie: admin, params: { id: up.body.photo.id } });
    expect(got.res.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await got.res.arrayBuffer())).toEqual(jpeg);
    expect((await call(photos, '/', { cookie: admin, params: { id: r.id } })).body.photos).toHaveLength(1);
    await call(delPhoto, '/', { method: 'DELETE', cookie: admin, params: { id: up.body.photo.id } });
    expect((await call(photos, '/', { cookie: admin, params: { id: r.id } })).body.photos).toHaveLength(0);
  });

  it('refuses non-images', async () => {
    const r = (await take({ plate: 'X1' })).body;
    const fd = new FormData();
    fd.append('photo', new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'a.svg');
    expect((await call(upload, '/', { cookie: admin, params: { id: r.id }, form: fd })).status).toBe(400);
  });
});

describe('user management', () => {
  it('creates users with valid names and passwords only', async () => {
    expect((await call(createUser, '/api/users', { cookie: admin, body: { username: 'Ja', name: 'J', password: 'password123' } })).status).toBe(400);
    expect((await call(createUser, '/api/users', { cookie: admin, body: { username: 'janis', name: 'Jānis', password: 'short' } })).status).toBe(400);
    const ok = await call(createUser, '/api/users', { cookie: admin, body: { username: 'janis', name: 'Jānis', role: 'root', password: 'password123' } });
    expect(ok.body.user).toEqual({ username: 'janis', name: 'Jānis', role: 'staff' });
    expect((await call(createUser, '/api/users', { cookie: admin, body: { username: 'janis', name: 'X', password: 'password123' } })).status).toBe(409);
    expect((await call(listUsers, '/api/users', { cookie: admin })).body.users.map((u: { username: string }) => u.username)).toEqual(['boss', 'janis']);
  });

  it('protects the last admin and the admin’s own role', async () => {
    expect((await call(editUser, '/', { method: 'PATCH', cookie: admin, params: { username: 'boss' }, body: { role: 'staff' } })).status).toBe(400);
    expect((await call(deleteUser, '/', { method: 'DELETE', cookie: admin, params: { username: 'boss' } })).status).toBe(400);
  });

  it('renaming yourself keeps you signed in', async () => {
    const r = await call(editUser, '/', { method: 'PATCH', cookie: admin, params: { username: 'boss' }, body: { username: 'chief', name: 'Chief' } });
    expect(r.body).toMatchObject({ changed: true, user: { username: 'chief' }, reauth: false });
    const cookie = r.res.headers.get('set-cookie')!.split(';')[0];
    expect((await call(listUsers, '/api/users', { cookie })).status).toBe(200);
  });

  it('stores only permission deviations, and they apply at once', async () => {
    await makeUser('nol', 'warehouse');
    const cookie = await login('nol');
    expect((await call(customers, '/api/customers', { cookie })).status).toBe(403);
    await call(putPerms, '/', { method: 'PUT', cookie: admin, params: { username: 'nol' }, body: { 'screen.customers': true, 'screen.warehouse': true } });
    expect((await call(getPerms, '/', { cookie: admin, params: { username: 'nol' } })).body.overrides).toEqual({ 'screen.customers': true });
    expect((await call(customers, '/api/customers', { cookie })).status).toBe(200);
    expect((await call(putPerms, '/', { method: 'PUT', cookie: admin, params: { username: 'boss' }, body: {} })).status).toBe(400);
  });

  it('resets a password', async () => {
    await makeUser('anna', 'staff');
    await call(resetPw, '/', { cookie: admin, params: { username: 'anna' }, body: { password: 'fresh-password' } });
    await login('anna', 'fresh-password');
  });
});

describe('initial admin', () => {
  it('seeds from ADMIN_PASSWORD once, then only resets when the value changes', async () => {
    await freshDb();
    process.env.ADMIN_USERNAME = 'root';
    process.env.ADMIN_PASSWORD = 'first-password';
    await ensureAdmin();
    await login('root', 'first-password');
    // A password chosen in the app survives a restart with the same env value…
    const { hashPassword } = await import('@/server/auth');
    await usersRepo.setPassword('root', await hashPassword('chosen-in-app'));
    await ensureAdmin();
    await login('root', 'chosen-in-app');
    // …while changing the env value resets it.
    process.env.ADMIN_PASSWORD = 'second-password';
    await ensureAdmin();
    await login('root', 'second-password');
    delete process.env.ADMIN_USERNAME; delete process.env.ADMIN_PASSWORD;
  });
});

it('reclassifies a customer everywhere and reports analytics', async () => {
  await take({ plate: 'A1', customerName: 'Sandijs' });
  await take({ plate: 'A2', customerName: 'sandijs' });
  expect((await call(custType, '/', { cookie: admin, body: { name: 'SANDIJS', isCompany: true } })).body).toEqual({ ok: true, changed: 2, isCompany: true });
  expect((await call(customers, '/api/customers?type=company', { cookie: admin })).body.customers).toHaveLength(1);
  expect((await call(analytics, '/api/analytics?customer=company', { cookie: admin })).body.total).toBe(2);
});

it('reports health', async () => {
  expect((await call(health, '/api/health')).body).toEqual({ ok: true, store: 'postgres' });
});
