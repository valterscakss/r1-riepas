import { api } from '@/server/http';
import { priceWith, rimFromNote } from '@/domain/pricing';
import { loadPricing } from '@/server/services';
import { listRecords, updateRecord } from '@/server/repo/records';

/**
 * Reprice sets still in storage with the current rules. Released orders keep
 * what the customer was actually charged. ?dryRun=1 only reports.
 */
export const POST = api('admin', async ({ query }) => {
  const cfg = await loadPricing();
  const dryRun = query.get('dryRun') === '1';
  const targets = (await listRecords()).filter((r) => r.status === 'active' || r.status === 'prepared');
  let changed = 0, unchanged = 0, skipped = 0;
  const sample: Array<{ plate: string | null; size: string | null; from: string | null; to: string }> = [];
  for (const r of targets) {
    const { total, width } = priceWith(cfg, r.size1, rimFromNote(r.rimNote), r.size2);
    if (!width) { skipped++; continue; }
    const next = String(total);
    if ((r.feeEur ?? '') === next) { unchanged++; continue; }
    if (sample.length < 8) sample.push({ plate: r.plate, size: r.size1, from: r.feeEur, to: next });
    if (!dryRun) await updateRecord(r.id, { feeEur: next });
    changed++;
  }
  return { ok: true, dryRun, changed, unchanged, skipped, total: targets.length, sample };
});
