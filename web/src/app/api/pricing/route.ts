import { api, bad } from '@/server/http';
import { cleanPricing, DEFAULT_PRICING, overlapError } from '@/domain/pricing';
import { loadPricing } from '@/server/services';
import { setSetting } from '@/server/repo/misc';

// The intake screen mirrors the rules live, so everyone who takes sets in may read them.
export const GET = api({ perm: 'act.operate' }, async () => ({ pricing: await loadPricing(), defaults: DEFAULT_PRICING }));

export const PUT = api('admin', async ({ body }) => {
  const cfg = cleanPricing(await body());
  const overlap = overlapError(cfg);
  if (overlap) throw bad(overlap);
  await setSetting('pricing', cfg);
  return { ok: true, pricing: cfg };
});
