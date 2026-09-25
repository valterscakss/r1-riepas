import { api, bad } from '@/server/http';
import { parseWorkbook } from '@/domain/excel/import';
import { replaceAll } from '@/server/repo/records';

/**
 * Excel import (admin): parse the workbook in memory and REPLACE all storage
 * rows. ?dryRun=1 returns what would be imported without touching the database.
 * The file itself is never stored.
 */
export const POST = api('admin', async ({ req, query }) => {
  let file: FormDataEntryValue | null = null;
  try { file = (await req.formData()).get('file'); } catch { /* not multipart */ }
  if (!(file instanceof File)) throw bad('No file uploaded (field name: file)');
  let parsed;
  try {
    parsed = parseWorkbook(Buffer.from(await file.arrayBuffer()), {
      dummyPhone: process.env.ANONYMIZE_PHONES === 'true' ? (process.env.DUMMY_PHONE || '01010101010') : null,
    });
  } catch {
    throw bad('Could not read the file as an .xlsx workbook');
  }
  if (!parsed.records.length) throw bad('Neatpazina nevienu derīgu lapu. Pārbaudi, vai fails ir tajā pašā formātā (VIETA, AUTO NR., IZMĒRS…).');
  if (query.get('dryRun') === '1' || query.get('preview') === '1') {
    const sample = parsed.records.slice(0, 8).map((r) => ({
      season: r.season, location: r.location, plate: r.plate, makeModel: r.makeModel, customerName: r.customerName,
      size1: r.size1, size2: r.size2, brand: r.brand, quantity: r.quantity, status: r.status,
    }));
    return { ok: true, dryRun: true, sample, ...parsed.summary };
  }
  const imported = await replaceAll(parsed.records);
  return { ok: true, ...parsed.summary, imported };
});
