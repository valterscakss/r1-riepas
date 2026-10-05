import { api, notFound } from '@/server/http';
import { deletePhoto, getPhoto } from '@/server/repo/misc';

type P = { id: string };

/** The image bytes. A new photo gets a new id, so they can be cached hard. */
export const GET = api<P>('user', async ({ params }) => {
  const p = await getPhoto(params.id);
  if (!p) throw notFound('Bilde nav atrasta');
  return new Response(new Uint8Array(p.data), {
    headers: { 'Content-Type': p.mime, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
  });
});

export const DELETE = api<P>({ perm: 'act.media' }, async ({ params }) => {
  if (!(await deletePhoto(params.id))) throw notFound('Bilde nav atrasta');
  return { ok: true };
});
