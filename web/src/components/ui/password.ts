/** Strong random password from an unambiguous alphabet (no 0/O, 1/l/I). */
export function genPassword(len = 12): string {
  const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', L = 'abcdefghijkmnopqrstuvwxyz', D = '23456789', SY = '!@#$%*?-_';
  const all = U + L + D + SY;
  const rnd = (n: number) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  const out = [U[rnd(U.length)], L[rnd(L.length)], D[rnd(D.length)], SY[rnd(SY.length)]];
  while (out.length < len) out.push(all[rnd(all.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = rnd(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}

/** "Jānis Bērziņš" → "janisberzins" as a username suggestion. */
export const slugUser = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 20);
