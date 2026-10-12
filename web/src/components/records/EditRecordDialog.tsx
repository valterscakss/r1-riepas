'use client';

import { useState } from 'react';
import { enc, patch } from '@/client/api';
import type { StorageRecord } from '@/domain/types';
import { notesOf, size2Of } from '@/domain/sizes';
import { FormDialog } from '../ui/FormDialog';

const FIELDS: Array<[keyof StorageRecord, string, boolean]> = [
  ['plate', 'Numurs', true], ['location', 'Vieta', true], ['customerName', 'Klients', false], ['phone', 'Telefons', true],
  ['size1', 'Izmērs', true], ['size2', '2. izmērs', true], ['brand', 'Ražotājs', false], ['quantity', 'Daudzums', false],
  ['makeModel', 'Auto', false], ['rimNote', 'Diski', false], ['threadDepth', 'Protektors (mm)', true], ['season', 'Sezona', false],
  ['intakeDate', 'Saņemts', true], ['releaseDate', 'Izsniegts', true],
];

/** Manual edit of the data fields; the server logs old → new in the history. */
export function EditRecordDialog({ r, done }: { r: StorageRecord; done: (v: StorageRecord | undefined) => void }) {
  const initial = Object.fromEntries(FIELDS.map(([k]) => [k, String((k === 'size2' ? size2Of(r) : r[k]) ?? '')]));
  const [form, setForm] = useState<Record<string, string>>({ ...initial, notes: notesOf(r) });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <FormDialog title="Rediģēt ierakstu" size="" onCancel={() => done(undefined)} onSubmit={async () => {
      const res = await patch<{ ok: boolean; record: StorageRecord }>(`/api/storage/${enc(r.id)}`, form);
      done(res.record);
    }}>
      <div className="modal-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {FIELDS.map(([k, label, mono]) => (
          <div key={k} className="field">
            <label htmlFor={`ed-${k}`}>{label}</label>
            <input id={`ed-${k}`} className={mono ? 'mono' : undefined} style={{ height: 38 }} value={form[k]} onChange={(e) => set(k, e.target.value)} />
          </div>
        ))}
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="ed-notes">Piezīmes</label>
          <input id="ed-notes" style={{ height: 38 }} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </div>
    </FormDialog>
  );
}
