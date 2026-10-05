import { api, bad } from '@/server/http';
import { setCustomerType } from '@/server/repo/records';

/**
 * Reclassify a whole customer at once. The importer guesses company vs private
 * and gets names like "Sandijs" wrong; hundreds of visits can't be fixed one by one.
 */
export const POST = api({ perm: 'screen.customers' }, async ({ body }) => {
  const b = await body();
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) throw bad('Trūkst klienta vārda');
  const isCompany = !!b.isCompany;
  return { ok: true, changed: await setCustomerType(name, isCompany), isCompany };
});
