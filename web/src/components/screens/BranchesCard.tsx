'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errMsg, patch, post } from '@/client/api';
import { useDialogs } from '@/client/dialogs';
import { useToast } from '@/client/toast';
import type { Branch } from '@/domain/types';

/** Admin: the shops. Each has its own racks, sets and warehouse jobs. */
export function BranchesCard() {
  const dialogs = useDialogs();
  const toast = useToast();
  const q = useQuery({ queryKey: ['branches', 'all'], queryFn: () => api<{ branches: Branch[] }>('/api/branches/all') });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const list = q.data?.branches ?? [];
  const live = list.filter((b) => b.active).length;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast(ok); await q.refetch(); }
    catch (e) { await dialogs.alert(errMsg(e)); } finally { setBusy(false); }
  };
  const rename = (b: Branch, next: string) => {
    const v = next.trim();
    if (!v || v === b.name) return;
    void run(() => patch(`/api/branches/${b.id}`, { name: v }), 'Nosaukums saglabāts');
  };

  return (
    <div className="card pad">
      <h2 style={{ marginBottom: 4 }}>Filiāles</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.6 }}>
        Katrai filiālei ir savi konteineri, glabātās riepas un noliktavas uzdevumi. Lietotājam pieejamās filiāles norāda sadaļā <b>Lietotāji</b>. Konteineru burti ir unikāli visās filiālēs.
      </div>
      {list.map((b) => (
        <div key={b.id} className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'nowrap' }}>
          <input className="input" style={{ flex: 1, opacity: b.active ? 1 : 0.55 }} aria-label={`Filiāles ${b.id} nosaukums`} defaultValue={b.name} maxLength={40} disabled={busy}
            onBlur={(e) => rename(b, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          <button className="btn sm" disabled={busy || (b.active && live <= 1)} title={b.active && live <= 1 ? 'Vismaz vienai filiālei jāpaliek aktīvai' : undefined}
            onClick={() => void run(() => patch(`/api/branches/${b.id}`, { active: !b.active }), b.active ? 'Filiāle izslēgta' : 'Filiāle ieslēgta')}>
            {b.active ? 'Izslēgt' : 'Ieslēgt'}
          </button>
        </div>
      ))}
      {!list.length && <div className="muted" style={{ fontSize: 13 }}>{q.isLoading ? 'Ielādē…' : 'Nav filiāļu'}</div>}
      <form className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'nowrap' }} onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        void run(async () => { await post('/api/branches', { name: name.trim() }); setName(''); }, 'Filiāle pievienota');
      }}>
        <input className="input" style={{ flex: 1 }} placeholder="Jaunas filiāles nosaukums" aria-label="Jaunas filiāles nosaukums" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" disabled={busy || !name.trim()}>＋ Pievienot</button>
      </form>
    </div>
  );
}
