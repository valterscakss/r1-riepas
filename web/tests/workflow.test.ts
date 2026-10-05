import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, freshDb } from './db';
import { call, login, makeUser } from './api';
import { POST as intake } from '@/app/api/intake/route';
import { POST as prepare } from '@/app/api/storage/[id]/prepare/route';
import { POST as unprepare } from '@/app/api/storage/[id]/unprepare/route';
import { POST as release } from '@/app/api/storage/[id]/release/route';
import { GET as getRec, PATCH as editRec } from '@/app/api/storage/[id]/route';
import { GET as events, POST as comment } from '@/app/api/storage/[id]/events/route';
import { PATCH as editEvent, DELETE as delEvent } from '@/app/api/events/[id]/route';
import { GET as tasks, POST as order } from '@/app/api/tasks/route';
import { POST as taskDone } from '@/app/api/tasks/[id]/done/route';
import { GET as pending } from '@/app/api/pending/route';
import { GET as releaseLookup } from '@/app/api/release-lookup/route';
import { GET as lookup } from '@/app/api/lookup/route';
import { GET as stats } from '@/app/api/stats/route';
import { POST as block } from '@/app/api/spots/[code]/block/route';
import { POST as unblock } from '@/app/api/storage/[id]/unblock/route';
import { GET as history } from '@/app/api/history/route';
import { POST as createContainer } from '@/app/api/containers/route';

let cookie = '';
afterAll(closeDb);
beforeEach(async () => {
  await freshDb();
  await makeUser('juris', 'staff');
  cookie = await login('juris');
  // Places A1–A3.
  await makeUser('boss', 'admin');
  await call(createContainer, '/api/containers', { cookie: await login('boss'), body: { prefix: 'A', rows: 1, cols: 3 } });
});

const take = (body: object) => call(intake, '/api/intake', { cookie, body });

describe('intake', () => {
  it('takes a set into the first free place with a price, SMS code, history and a warehouse job', async () => {
    const r = await take({ plate: 'ab 1234', customerName: 'Anna', size1: '225/45/17', rim: 'aluminum', quantity: '4', brand: 'Nokian', notes: 'jaunas' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ plate: 'AB1234', location: 'A1', feeEur: '26', smsCode: 'R1TAB123', rimNote: 'Alumīnija diski', status: 'active' });
    expect(r.body.intakeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const ev = await call(events, '/', { cookie, params: { id: r.body.id } });
    expect(ev.body.events).toMatchObject([{ action: 'created', comment: 'jaunas', actor: 'juris' }]);
    const t = await call(tasks, '/api/tasks', { cookie });
    expect(t.body).toMatchObject({ open: 1, tasks: [{ kind: 'store', title: 'AB1234', location: 'A1', details: '4× Nokian 225/45/17 · Anna · Alumīnija diski' }] });
  });

  it('gives a second set of the same plate a different SMS code and the next place', async () => {
    await take({ plate: 'AB1234' });
    const r = await take({ plate: 'AB1234' });
    expect(r.body).toMatchObject({ location: 'A2', smsCode: 'R1TAB122' });
  });

  it('requires a plate', async () => {
    expect((await take({ customerName: 'X' })).status).toBe(400);
  });

  it('prefills from the plate history', async () => {
    await take({ plate: 'AB1234', customerName: 'Anna', phone: '+37120000000' });
    const r = await call(lookup, '/api/lookup?plate=ab1234', { cookie });
    expect(r.body).toMatchObject({ found: true, history: 1, suggestion: { customerName: 'Anna', phone: '+37120000000' } });
  });
});

describe('seasonal swap', () => {
  it('prepare → warehouse job → new tires into the same place → old set closed', async () => {
    const old = (await take({ plate: 'AB1234', size1: '205/55/16' })).body;
    const p = await call(prepare, '/', { cookie, params: { id: old.id }, body: { comment: 'klients brauc 15:00' } });
    expect(p.body).toMatchObject({ status: 'prepared', task: { kind: 'prepare', location: 'A1' } });
    expect(p.body.task.details).toContain('klients brauc 15:00');
    expect((await call(pending, '/api/pending', { cookie })).body.count).toBe(1);
    // The reserved place is still taken.
    expect((await call(stats, '/api/stats', { cookie })).body.assignNext).toBe('A2');

    const fresh = await take({ plate: 'AB1234', location: 'A1', releaseId: old.id, size1: '225/45/17' });
    expect(fresh.body.location).toBe('A1');
    expect((await call(getRec, '/', { cookie, params: { id: old.id } })).body.status).toBe('released');
    const oldEvents = (await call(events, '/', { cookie, params: { id: old.id } })).body.events.map((e: { action: string }) => e.action);
    expect(oldEvents).toEqual(['created', 'prepared', 'swapped']);
    // Only the new store job is still open.
    const open = (await call(tasks, '/api/tasks', { cookie })).body.tasks;
    expect(open.map((t: { kind: string; recordId: string }) => [t.kind, t.recordId])).toEqual([['store', fresh.body.id]]);
  });

  it('undoing a prepare closes its job', async () => {
    const old = (await take({ plate: 'X1' })).body;
    await call(prepare, '/', { cookie, params: { id: old.id } });
    await call(unprepare, '/', { cookie, params: { id: old.id } });
    expect((await call(getRec, '/', { cookie, params: { id: old.id } })).body.status).toBe('active');
    expect((await call(tasks, '/api/tasks', { cookie })).body.open).toBe(0);
  });
});

describe('release', () => {
  it('finds the set by SMS code, releases it and frees the place', async () => {
    const r = (await take({ plate: 'AB1234' })).body;
    const found = await call(releaseLookup, '/api/release-lookup?q=r1t%20ab123', { cookie });
    expect(found.body.results).toHaveLength(1);
    await call(release, '/', { cookie, params: { id: r.id }, body: { comment: 'paņēma' } });
    expect((await call(releaseLookup, '/api/release-lookup?q=AB1234', { cookie })).body.results).toHaveLength(0);
    expect((await call(stats, '/api/stats', { cookie })).body.assignNext).toBe('A1');
    expect((await call(tasks, '/api/tasks', { cookie })).body.open).toBe(0);
  });

  it('404s an unknown or malformed id', async () => {
    expect((await call(release, '/', { cookie, params: { id: '999' } })).status).toBe(404);
    expect((await call(release, '/', { cookie, params: { id: 'abc' } })).status).toBe(404);
  });
});

describe('blocking a place', () => {
  it('holds an empty place and lets it go again', async () => {
    const b = await call(block, '/', { cookie, params: { code: 'A2' } });
    expect(b.status).toBe(201);
    expect((await call(block, '/', { cookie, params: { code: 'A2' } })).status).toBe(409);
    expect((await call(block, '/', { cookie, params: { code: 'Q9' } })).status).toBe(404);
    expect((await call(stats, '/api/stats', { cookie })).body).toMatchObject({ occ: 1, assignNext: 'A1' });
    expect((await call(unblock, '/', { cookie, params: { id: b.body.id } })).status).toBe(200);
    expect((await call(stats, '/api/stats', { cookie })).body.occ).toBe(0);
  });
});

describe('edits and comments', () => {
  it('records old → new values of an edit in the history', async () => {
    const r = (await take({ plate: 'AB1', phone: '1' })).body;
    const e = await call(editRec, '/', { method: 'PATCH', cookie, params: { id: r.id }, body: { phone: '2', status: 'released', location: 'a 3' } });
    expect(e.body.record).toMatchObject({ phone: '2', location: 'A3', status: 'active' }); // status is not editable
    const ev = (await call(events, '/', { cookie, params: { id: r.id } })).body.events;
    expect(ev.at(-1)).toMatchObject({ action: 'edited', comment: 'Vieta: A1 → A3; Telefons: 1 → 2' });
  });

  it('lets comments be edited and deleted, but never the audit trail', async () => {
    const r = (await take({ plate: 'AB1' })).body;
    const c = await call(comment, '/', { cookie, params: { id: r.id }, body: { comment: ' skrāpējums ' } });
    expect(c.body.event).toMatchObject({ action: 'comment', comment: 'skrāpējums' });
    expect((await call(editEvent, '/', { method: 'PATCH', cookie, params: { id: c.body.event.id }, body: { comment: 'liels skrāpējums' } })).body.event.comment).toBe('liels skrāpējums');
    const created = (await call(events, '/', { cookie, params: { id: r.id } })).body.events[0];
    expect((await call(editEvent, '/', { method: 'PATCH', cookie, params: { id: created.id }, body: { comment: 'x' } })).status).toBe(403);
    expect((await call(delEvent, '/', { method: 'DELETE', cookie, params: { id: created.id } })).status).toBe(403);
    expect((await call(delEvent, '/', { method: 'DELETE', cookie, params: { id: c.body.event.id } })).status).toBe(200);
  });
});

describe('warehouse orders', () => {
  it('splits a typed order and ticks it off', async () => {
    const o = await call(order, '/api/tasks', { cookie, body: { text: '4× Nokian\nno A ceha', location: 'montāža' } });
    expect(o.body.task).toMatchObject({ kind: 'order', title: '4× Nokian', details: 'no A ceha', location: 'MONTĀŽA' });
    await call(taskDone, '/', { cookie, params: { id: o.body.task.id } });
    const done = await call(tasks, '/api/tasks?status=done', { cookie });
    expect(done.body).toMatchObject({ open: 0, tasks: [{ status: 'done', doneBy: 'juris' }] });
  });
});

it('pages the full history', async () => {
  for (let i = 0; i < 3; i++) await take({ plate: `P${i}` });
  const h = await call(history, '/api/history?types=created', { cookie });
  expect(h.body).toMatchObject({ total: 3, page: 1, pages: 1 });
  expect(h.body.events[0]).toMatchObject({ type: 'created', plate: 'P2', actor: 'juris' });
});
