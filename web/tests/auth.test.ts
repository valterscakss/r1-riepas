import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { closeDb, freshDb } from './db';
import { call, login, makeUser } from './api';
import { POST as loginRoute } from '@/app/api/login/route';
import { GET as me } from '@/app/api/me/route';
import { GET as users } from '@/app/api/users/route';
import { PATCH as editUser } from '@/app/api/users/[username]/route';
import { POST as changePassword } from '@/app/api/change-password/route';
import { resetIpFailures } from '@/server/auth';
import * as usersRepo from '@/server/repo/users';

afterAll(closeDb);
beforeEach(async () => { await freshDb(); resetIpFailures(); await makeUser('boss', 'admin'); await makeUser('anna', 'staff'); });

/** A token exactly as the Express app's jsonwebtoken produced it. */
function legacyToken(claims: object, secret = process.env.AUTH_SECRET!) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ ...claims, iat: now, exp: now + 3600 })}`;
  return `${head}.${createHmac('sha256', secret).update(head).digest('base64url')}`;
}

describe('login', () => {
  it('sets an httpOnly session cookie and returns perms', async () => {
    const r = await call(loginRoute, '/api/login', { body: { username: ' Anna ', password: 'password123' } });
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ username: 'anna', role: 'staff' });
    expect(r.res.headers.get('set-cookie')).toMatch(/^r1_session=.+; Path=\/; HttpOnly; SameSite=Lax/);
  });

  it('locks a username out after five failures', async () => {
    for (let i = 0; i < 5; i++) expect((await call(loginRoute, '/api/login', { body: { username: 'anna', password: 'nope' } })).status).toBe(401);
    const r = await call(loginRoute, '/api/login', { body: { username: 'anna', password: 'password123' } });
    expect(r.status).toBe(429);
    expect(r.body.error.message).toMatch(/Pārāk daudz/);
  });

  it('clears the failure count after a good login', async () => {
    for (let i = 0; i < 4; i++) await call(loginRoute, '/api/login', { body: { username: 'anna', password: 'nope' } });
    await login('anna');
    for (let i = 0; i < 4; i++) await call(loginRoute, '/api/login', { body: { username: 'anna', password: 'nope' } });
    expect((await call(loginRoute, '/api/login', { body: { username: 'anna', password: 'password123' } })).status).toBe(200);
  });
});

describe('sessions', () => {
  it('accepts tokens issued by the Express app, as cookie or bearer', async () => {
    const t = legacyToken({ id: '2', username: 'anna', name: 'Anna', role: 'staff' });
    expect((await call(me, '/api/me', { cookie: `r1_session=${t}` })).body.user.username).toBe('anna');
    expect((await call(me, '/api/me', { headers: { authorization: `Bearer ${t}` } })).status).toBe(200);
  });

  it('rejects forged, missing and wrong-secret tokens', async () => {
    expect((await call(me, '/api/me')).status).toBe(401);
    expect((await call(me, '/api/me', { cookie: `r1_session=${legacyToken({ username: 'boss', role: 'admin' }, 'other-secret')}` })).status).toBe(401);
  });

  it('takes the role from the database, not the token', async () => {
    // A token claiming admin for a staff user grants nothing extra…
    const forged = legacyToken({ id: '2', username: 'anna', name: 'Anna', role: 'admin' });
    expect((await call(users, '/api/users', { cookie: `r1_session=${forged}` })).status).toBe(403);
    // …and a demotion applies to an already-open session.
    await makeUser('second', 'admin');
    const cookie = await login('second');
    const bossCookie = await login('boss');
    await call(editUser, '/api/users/second', { method: 'PATCH', cookie: bossCookie, params: { username: 'second' }, body: { role: 'staff' } });
    expect((await call(users, '/api/users', { cookie })).status).toBe(403);
  });

  it('ends the session of a deleted user', async () => {
    const cookie = await login('anna');
    await usersRepo.deleteUser('anna');
    const { bustUser } = await import('@/server/http');
    bustUser('anna');
    expect((await call(me, '/api/me', { cookie })).status).toBe(401);
  });
});

it('changes your own password only with the current one', async () => {
  const cookie = await login('anna');
  expect((await call(changePassword, '/api/change-password', { cookie, body: { currentPassword: 'wrong', newPassword: 'newpassword1' } })).status).toBe(401);
  expect((await call(changePassword, '/api/change-password', { cookie, body: { currentPassword: 'password123', newPassword: 'short' } })).status).toBe(400);
  expect((await call(changePassword, '/api/change-password', { cookie, body: { currentPassword: 'password123', newPassword: 'newpassword1' } })).status).toBe(200);
  await login('anna', 'newpassword1');
});
