import { api, bad } from '@/server/http';
import { parseWorkbook } from '@/domain/excel/import';
import { planRacks } from '@/domain/containers';
import { replaceAll } from '@/server/repo/records';
import { deleteContainer, listContainers, updateContainer, setSetting } from '@/server/repo/misc';
import { placeSeasonKey, placeSeasonOf } from '@/server/services';

/**
 * Excel import (admin): parse the workbook in memory and REPLACE the storage rows
 * of the branch you are working in (the other shop is untouched). ?dryRun=1
 * returns what would be imported without touching the database. The file itself
 * is never stored.
 *
 * Every sheet imports, but ONE season's sheet decides which places exist — the
 * one that describes the warehouse as it stands today (?placeSeason=<sheet>).
 */
export const POST = api('admin', async ({ req, query, branchId }) => {
  let file: FormDataEntryValue | null = null;
  let form: FormData | null = null;
  try { form = await req.formData(); file = form.get('file'); } catch { /* not multipart */ }
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

  const asked = String(query.get('placeSeason') ?? form?.get('placeSeason') ?? '').trim();
  const chosen = asked ? parsed.seasons.find((x) => x.name === asked) : null;
  if (asked && !chosen) throw bad(`Failā nav lapas "${asked}"`);

  const defs = await listContainers(branchId);
  if (query.get('dryRun') === '1' || query.get('preview') === '1') {
    const sample = parsed.records.slice(0, 8).map((r) => ({
      season: r.season, location: r.location, plate: r.plate, makeModel: r.makeModel, customerName: r.customerName,
      size1: r.size1, size2: r.size2, brand: r.brand, quantity: r.quantity, status: r.status,
    }));
    // What each season would do to the drawn racks, so the choice can be made with
    // the consequences in front of you rather than after the fact.
    const seasons = parsed.seasons.map((s) => {
      const plan = planRacks(defs, new Set(s.codes), parsed.records);
      return {
        name: s.name, rows: s.rows, places: s.places, active: s.active, free: s.free, held: s.held, released: s.released,
        racks: {
          deleted: plan.deleted.map((d) => d.prefix),
          trimmed: plan.trimmed.map((t) => ({ prefix: t.prefix, off: t.off, left: t.left })),
          kept: plan.kept,
          protected: plan.protectedCells.length,
        },
      };
    });
    return { ok: true, dryRun: true, sample, seasons, placeSeason: await placeSeasonOf(branchId), ...parsed.summary };
  }

  const imported = await replaceAll(parsed.records, branchId);
  let racks: { deleted: string[]; trimmed: string[]; protected: number } | undefined;
  if (chosen) {
    await setSetting(placeSeasonKey(branchId), chosen.name);
    // Reconcile AFTER the import: the records decide whether a place still holds tires.
    const plan = planRacks(defs, new Set(chosen.codes), parsed.records);
    for (const t of plan.trimmed) await updateContainer(t.id, { cells: t.cells, names: t.names });
    for (const d of plan.deleted) await deleteContainer(d.id);
    racks = {
      deleted: plan.deleted.map((d) => d.prefix),
      trimmed: plan.trimmed.map((t) => `${t.prefix} (−${t.off})`),
      protected: plan.protectedCells.length,
    };
  }
  return { ok: true, ...parsed.summary, imported, placeSeason: chosen?.name ?? null, racks };
});
