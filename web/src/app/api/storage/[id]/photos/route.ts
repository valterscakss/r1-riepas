import { api, bad, notFound } from '@/server/http';
import { getRecord } from '@/server/repo/records';
import { addPhoto, listPhotos, logEvent } from '@/server/repo/misc';

type P = { id: string };
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 8 * 1024 * 1024;

export const GET = api<P>('user', async ({ params }) => {
  const photos = await listPhotos(params.id);
  return { photos: photos.map((p) => ({ ...p, url: `/api/photos/${p.id}` })) };
});

/** Pictures of the set as handed in. The client downscales to ~1280 px first. */
export const POST = api<P>({ perm: 'act.media' }, async ({ params, req, actor }) => {
  let form: FormData;
  try { form = await req.formData(); } catch { throw bad('Fails nav pievienots'); }
  const file = form.get('photo');
  if (!(file instanceof File)) throw bad('Fails nav pievienots');
  if (!PHOTO_TYPES.has(file.type)) throw bad('Atļauti tikai JPG, PNG vai WEBP attēli');
  if (file.size > MAX_BYTES) throw bad('Bilde ir par lielu (maks. 8 MB)');
  const rec = await getRecord(params.id);
  if (!rec) throw notFound('Ieraksts nav atrasts');
  const num = (v: FormDataEntryValue | null) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null; };
  const photo = await addPhoto({
    recordId: rec.id, mime: file.type, data: Buffer.from(await file.arrayBuffer()),
    width: num(form.get('width')), height: num(form.get('height')), createdBy: actor,
  });
  await logEvent(rec.id, 'photo', null, actor);
  return Response.json({ ok: true, photo: { ...photo, url: `/api/photos/${photo.id}` } }, { status: 201 });
});
