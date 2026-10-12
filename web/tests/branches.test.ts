import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { closeDb, freshDb } from './db';
import { call, login, makeUser } from './api';
import { POST as intake } from '@/app/api/intake/route';
import { GET as getRec } from '@/app/api/storage/[id]/route';
import { POST as release } from '@/app/api/storage/[id]/release/route';
import { GET as events, POST as comment } from '@/app/api/storage/[id]/events/route';
import { GET as storage } from '@/app/api/storage/route';
import { GET as stats } from '@/app/api/stats/route';
import { GET as tasks, POST as order } from '@/app/api/tasks/route';
import { GET as history } from '@/app/api/history/route';
import { GET as activity } from '@/app/api/activity/route';
import { POST as createContainer, GET as listContainers } from '@/app/api/containers/route';
import { PATCH as editContainer } from '@/app/api/containers/[id]/route';
import { POST as renameSpot } from '@/app/api/spots/[code]/rename/route';
import { POST as importRoute } from '@/app/api/import/route';
import { GET as myBranches, POST as addBranch } from '@/app/api/branches/route';
import { GET as allBranches } from '@/app/api/branches/all/route';
import { PATCH as editBranch } from '@/app/api/branches/[id]/route';
import { GET as userBranches, PUT as putUserBranches } from '@/app/api/users/[username]/branches/route';

afterAll(closeDb);

let admin = '', staff = '', second = '';
const as = (cookie: string, branch?: string) => ({ cookie, headers: branch ? { 'x-branch': branch } : undefined });

beforeEach(async () => {
  await freshDb();
  await makeUser('boss', 'admin');
  await makeUser('juris', 'staff');
  admin = await login('boss');
  staff = await login('juris');
  // Shop 1 exists from the migration; add shop 2 and give each its own rack.
  second = String((await call(addBranch, '/api/branches', { cookie: admin, body: { name: 'Jūrmala' } })).body.branch.id);
  await call(createContainer, '/api/containers', { ...as(admin, '1'), body: { prefix: 'A', rows: 1, cols: 3 } });
  await call(createContainer, '/api/containers', { ...as(admin, second), body: { prefix: 'D', rows: 1, cols: 3 } });
});

const take = (cookie: string, branch: string, body: object) => call(intake, '/api/intake', { ...as(cookie, branch), body });

describe('branches', () => {
  it('lists the branches a user may open and which one the request works in', async () => {
    const r = await call(myBranches, '/api/branches', as(staff));
    expect(r.body).toEqual({ branches: [{ id: '1', name: 'Filiāle 1' }, { id: second, name: 'Jūrmala' }], active: '1' });
    expect((await call(myBranches, '/api/branches', as(staff, second))).body.active).toBe(second);
  });

  it('keeps each shop\'s sets, places and jobs apart', async () => {
    const a = await take(staff, '1', { plate: 'AA1111' });
    const d = await take(staff, second, { plate: 'DD2222' });
    expect(a.body).toMatchObject({ location: 'A1', branchId: '1' });
    expect(d.body).toMatchObject({ location: 'D1', branchId: second });

    const list = (b: string) => call(storage, '/api/storage', as(staff, b));
    expect((await list('1')).body.records.map((r: { plate: string }) => r.plate)).toEqual(['AA1111']);
    expect((await list(second)).body.records.map((r: { plate: string }) => r.plate)).toEqual(['DD2222']);

    expect((await call(listContainers, '/api/containers', as(admin, '1'))).body.containers.map((c: { prefix: string }) => c.prefix)).toEqual(['A']);
    const st = await call(stats, '/api/stats', as(staff, second));
    expect(JSON.stringify(st.body)).toContain('D1');
    expect(JSON.stringify(st.body)).not.toContain('A1');

    // Each intake queued a "put it in its place" job in its own shop.
    expect((await call(tasks, '/api/tasks', as(staff, '1'))).body.tasks.map((t: { plate: string }) => t.plate)).toEqual(['AA1111']);
    await call(order, '/api/tasks', { ...as(staff, second), body: { text: '4× Nokian' } });
    expect((await call(tasks, '/api/tasks', as(staff, '1'))).body.open).toBe(1);
    expect((await call(tasks, '/api/tasks', as(staff, second))).body.open).toBe(2);
  });

  it('refuses a record reached by id from another shop', async () => {
    const d = await take(staff, second, { plate: 'DD2222' });
    const id = d.body.id;
    expect((await call(getRec, '/', { ...as(staff, '1'), params: { id } })).status).toBe(404);
    expect((await call(release, '/', { ...as(staff, '1'), params: { id }, body: {} })).status).toBe(404);
    expect((await call(events, '/', { ...as(staff, '1'), params: { id } })).status).toBe(404);
    expect((await call(comment, '/', { ...as(staff, '1'), params: { id }, body: { comment: 'x' } })).status).toBe(404);
    // …and it is untouched where it belongs.
    expect((await call(getRec, '/', { ...as(staff, second), params: { id } })).body.status).toBe('active');
  });

  it('does not leak the other shop\'s history or activity', async () => {
    await take(staff, '1', { plate: 'AA1111' });
    await take(staff, second, { plate: 'DD2222' });
    const h = await call(history, '/api/history', as(admin, '1'));
    expect(h.body.events.every((e: { plate: string | null }) => e.plate === 'AA1111')).toBe(true);
    const act = await call(activity, '/api/activity', as(admin, second));
    expect(act.body.events.every((e: { plate: string | null }) => e.plate === 'DD2222')).toBe(true);
  });

  it('ignores an X-Branch the user may not open', async () => {
    await call(putUserBranches, '/', { cookie: admin, params: { username: 'juris' }, body: { branches: ['1'] } });
    expect((await call(myBranches, '/api/branches', as(staff, second))).body).toEqual({ branches: [{ id: '1', name: 'Filiāle 1' }], active: '1' });
    await take(staff, second, { plate: 'XX9999' }); // lands in shop 1 despite the header
    expect((await call(storage, '/api/storage', as(admin, second))).body.records).toEqual([]);
    expect((await call(storage, '/api/storage', as(admin, '1'))).body.records.map((r: { plate: string }) => r.plate)).toEqual(['XX9999']);
  });

  it('rack letters are unique across shops', async () => {
    const dup = await call(createContainer, '/api/containers', { ...as(admin, second), body: { prefix: 'A', rows: 1, cols: 2 } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toContain('citā filiālē');
    // A place name that starts with the other shop's rack letter would make a slip ambiguous.
    const d = (await call(listContainers, '/api/containers', as(admin, second))).body.containers[0];
    const r = await call(editContainer, '/', { ...as(admin, second), params: { id: d.id }, body: { rows: 1, cols: 3, names: JSON.stringify({ 0: 'A9' }) } });
    expect(r.status).toBe(409);
    await take(staff, second, { plate: 'DD2222' });
    const ren = await call(renameSpot, '/', { ...as(admin, second), params: { code: 'D1' }, body: { name: 'A7' } });
    expect(ren.status).toBe(409);
  });

  it('administers branches: rename, switch off, never the last one', async () => {
    expect((await call(addBranch, '/api/branches', { cookie: staff, body: { name: 'X' } })).status).toBe(403);
    expect((await call(addBranch, '/api/branches', { cookie: admin, body: { name: '' } })).status).toBe(400);
    expect((await call(editBranch, '/', { cookie: admin, params: { id: second }, body: { name: 'Ventspils' } })).body.branch.name).toBe('Ventspils');
    expect((await call(editBranch, '/', { cookie: admin, params: { id: second }, body: { active: false } })).status).toBe(200);
    expect((await call(myBranches, '/api/branches', as(staff))).body.branches.map((b: { id: string }) => b.id)).toEqual(['1']);
    expect((await call(allBranches, '/api/branches/all', as(admin))).body.branches).toHaveLength(2);
    expect((await call(editBranch, '/', { cookie: admin, params: { id: '1' }, body: { active: false } })).status).toBe(400);
    expect((await call(editBranch, '/', { cookie: admin, params: { id: '999' }, body: { name: 'Z' } })).status).toBe(404);
  });

  it('stores a user\'s branch access; ticking every branch means no restriction', async () => {
    const put = (branches: unknown) => call(putUserBranches, '/', { cookie: admin, params: { username: 'juris' }, body: { branches } });
    expect((await put([second])).body.branches).toEqual([second]);
    expect((await call(userBranches, '/', { cookie: admin, params: { username: 'juris' } })).body.branches).toEqual([second]);
    expect((await put(['1', second])).body.branches).toBeNull();
    expect((await put([])).status).toBe(400);
    expect((await put(['999'])).status).toBe(400);
    expect((await call(putUserBranches, '/', { cookie: admin, params: { username: 'nobody' }, body: { branches: ['1'] } })).status).toBe(404);
    expect((await call(userBranches, '/', { cookie: staff, params: { username: 'juris' } })).status).toBe(403);
  });
});

describe('import into one shop', () => {
  const HEADER = ['VIETA', 'AUTO NR.', 'NOSAUKUMS', 'VĀRDS', 'TELEFONA NR.', 'IZMĒRS', 'NOSAUKUMS', 'SKAITS', 'DISKI', 'SAŅEMŠANAS DATUMS', 'IZSNIEGŠANAS DATUMS', 'PIEZĪMES'];
  function workbook() {
    const wb = XLSX.utils.book_new();
    // The old season mentions A1–A3 and a rack that no longer exists (Z); the new one only A1, A2.
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER,
      ['A1', 'OLD111', 'VW', 'Anna', null, '205/55/16', 'Nokian', '4', null, '01.10.2022', '01.04.2023', null],
      ['Z1', 'OLD222', 'VW', 'Bruno', null, '205/55/16', 'Nokian', '4', null, '02.10.2022', '02.04.2023', null]]), '2022 RUDENS');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER,
      ['A1', 'NEW111', 'VW', 'Cecilija', null, '205/55/16', 'Nokian', '4', null, '01.10.2025', null, null],
      ['A2', 'BRĪVS', null, null, null, null, null, null, null, null, null, null]]), '2025 RUDENS');
    const fd = new FormData();
    fd.append('file', new Blob([XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })]), 'r1.xlsx');
    return fd;
  }

  it('replaces only the shop you are in', async () => {
    await take(staff, second, { plate: 'DD2222' });
    await take(staff, '1', { plate: 'AA1111' });
    const r = await call(importRoute, '/api/import', { ...as(admin, '1'), form: workbook() });
    expect(r.status).toBe(200);
    expect(r.body.imported).toBe(4);
    const plates = async (b: string) => (await call(storage, '/api/storage', as(admin, b))).body.records.map((x: { plate: string | null }) => x.plate).sort();
    expect(await plates('1')).toEqual([null, 'NEW111', 'OLD111', 'OLD222'].sort());
    expect(await plates(second)).toEqual(['DD2222']);
  });

  it('previews what each season would do to the racks, then applies the chosen one', async () => {
    // Rack Z is drawn in shop 1 although only the 2022 sheet ever mentioned it.
    await call(createContainer, '/api/containers', { ...as(admin, '1'), body: { prefix: 'Z', rows: 1, cols: 2 } });
    const dry = await call(importRoute, '/api/import?dryRun=1', { ...as(admin, '1'), form: workbook() });
    const by = Object.fromEntries(dry.body.seasons.map((s: { name: string }) => [s.name, s]));
    expect(by['2025 RUDENS']).toMatchObject({ rows: 2, places: 2, active: 1, free: 1 });
    expect(by['2025 RUDENS'].racks.deleted).toEqual(['Z']);
    expect(by['2022 RUDENS'].racks.deleted).toEqual([]);

    const real = await call(importRoute, '/api/import?placeSeason=' + encodeURIComponent('2025 RUDENS'), { ...as(admin, '1'), form: workbook() });
    expect(real.body.placeSeason).toBe('2025 RUDENS');
    expect(real.body.racks.deleted).toEqual(['Z']);
    const racks = (await call(listContainers, '/api/containers', as(admin, '1'))).body.containers;
    expect(racks.map((c: { prefix: string }) => c.prefix)).toEqual(['A']);
    // The place map follows the chosen sheet: Z1 (released in 2023, old season) is gone, A1/A2 stay.
    const st = JSON.stringify((await call(stats, '/api/stats', as(admin, '1'))).body);
    expect(st).toContain('A2');
    expect(st).not.toContain('Z1');
    expect((await call(importRoute, '/api/import?placeSeason=NOPE', { ...as(admin, '1'), form: workbook() })).status).toBe(400);
  });
});
