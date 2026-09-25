'use client';

import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, del, enc, errMsg } from '@/client/api';
import { useDialogs } from '@/client/dialogs';
import { useToast } from '@/client/toast';
import type { Photo } from '@/domain/types';

// 1280 px is plenty to read tread and damage, and keeps an upload in the low
// hundreds of KB — these rows live in the database.
const PHOTO_MAX = 1280, PHOTO_QUALITY = 0.8;

function readImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Neizdevās nolasīt attēlu')); };
    img.src = url;
  });
}

/** Downscale in the browser: a 4 MB phone photo lands as roughly 200 KB. */
async function shrink(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const img = await readImage(file);
  const scale = Math.min(1, PHOTO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', PHOTO_QUALITY));
  // A re-encode that grew the file isn't worth it — send the original.
  if (!blob || (blob.size >= file.size && file.type === 'image/jpeg')) return { blob: file, w: img.naturalWidth, h: img.naturalHeight };
  return { blob, w, h };
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/** Pictures of the set: tread, damage, the rims as handed in. "Uzņemt" opens the camera directly. */
export function RecordPhotos({ recordId, canEdit, onChange }: { recordId: string; canEdit: boolean; onChange: () => void }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const [big, setBig] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['photos', recordId], queryFn: () => api<{ photos: Array<Photo & { url: string }> }>(`/api/storage/${enc(recordId)}/photos`) });
  const photos = q.data?.photos ?? [];

  const upload = async (files: File[]) => {
    const list = files.filter((f) => f.type.startsWith('image/'));
    if (!list.length) { await dialogs.alert('Izvēlies attēla failu'); return; }
    let done = 0, failed = 0;
    setBusy(`Augšupielādē 0/${list.length}…`);
    for (const f of list) {
      try {
        const { blob, w, h } = await shrink(f);
        const fd = new FormData();
        fd.append('photo', blob, `${(f.name || 'foto').replace(/\.[^.]+$/, '')}.jpg`);
        fd.append('width', String(w)); fd.append('height', String(h));
        await api(`/api/storage/${enc(recordId)}/photos`, { method: 'POST', body: fd });
      } catch { failed++; }
      done++;
      setBusy(`Augšupielādē ${done}/${list.length}…`);
    }
    setBusy('');
    if (failed) await dialogs.alert(failed === list.length ? 'Neizdevās augšupielādēt' : `${failed} no ${list.length} bildēm neizdevās`);
    else toast(list.length === 1 ? 'Bilde pievienota' : `Pievienotas ${list.length} bildes`);
    void q.refetch(); onChange();
  };

  const remove = async (id: string) => {
    const c = await dialogs.confirm({ icon: 'warning', title: 'Dzēst bildi?', confirmText: 'Dzēst', danger: true });
    if (!c.ok) return;
    try { await del(`/api/photos/${enc(id)}`); void q.refetch(); } catch (e) { await dialogs.alert(errMsg(e, 'Neizdevās dzēst')); }
  };

  // Copy the FileList out before clearing the input: it is live.
  const onFiles = (el: HTMLInputElement | null) => { const fs = [...(el?.files ?? [])]; if (el) el.value = ''; if (fs.length) void upload(fs); };

  return (
    <div>
      <div className="label" style={{ marginBottom: 6 }}>Bildes{photos.length ? ` · ${photos.length}` : ''}</div>
      {q.isLoading && <div className="muted small">Ielādē bildes…</div>}
      {!!photos.length && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 8, marginBottom: 10 }}>
          {photos.map((p) => (
            <div key={p.id} style={{ position: 'relative' }}>
              <button type="button" onClick={() => setBig(p.url)} style={{ all: 'unset', cursor: 'zoom-in', display: 'block', width: '100%' }} aria-label="Palielināt bildi">
                {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API image */}
                <img src={p.url} alt="Riepu foto" title={`${kb(p.bytes)}${p.createdBy ? ` · ${p.createdBy}` : ''}`} loading="lazy"
                  style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', display: 'block' }} />
              </button>
              {canEdit && <button type="button" title="Dzēst bildi" onClick={() => remove(p.id)} style={{ position: 'absolute', top: 5, right: 5, width: 26, height: 26, borderRadius: 7, border: 0, background: 'oklch(0.2 0.02 260 / .6)', color: '#fff', fontSize: 13 }}>✕</button>}
            </div>
          ))}
        </div>
      )}
      {busy && <div style={{ color: 'var(--accent-2)', fontSize: 12, marginBottom: 8 }}>{busy}</div>}
      {canEdit && (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn dark" style={{ flex: 1, minWidth: 130 }} onClick={() => cam.current?.click()}>📷 Uzņemt bildi</button>
          <button type="button" className="btn" style={{ flex: 1, minWidth: 130 }} onClick={() => pick.current?.click()}>⭱ Izvēlēties failu</button>
          <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFiles(e.currentTarget)} />
          <input ref={pick} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.currentTarget)} />
        </div>
      )}
      {!photos.length && !q.isLoading && <div className="muted small" style={{ marginTop: 8 }}>Vēl nav bilžu. Nofotografē protektoru, bojājumus vai diskus — bilde paliks pie šī ieraksta.</div>}
      {big && (
        <div className="overlay top" style={{ background: 'oklch(0.15 0.02 260 / .88)' }} onClick={() => setBig(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API image */}
          <img src={big} alt="Riepu foto" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 12 }} />
          <button type="button" aria-label="Aizvērt" onClick={() => setBig(null)} style={{ position: 'absolute', top: 16, right: 16, width: 40, height: 40, borderRadius: 11, border: 0, background: 'oklch(1 0 0 / .16)', color: '#fff', fontSize: 20 }}>✕</button>
        </div>
      )}
    </div>
  );
}
