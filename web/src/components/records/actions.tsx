'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { enc, errMsg, post } from '@/client/api';
import { useDialogs } from '@/client/dialogs';
import { useToast } from '@/client/toast';
import { useRefresh } from '@/client/queries';

export interface SetRef { id: string; plate?: string | null; loc?: string | null }

const Plate = ({ r, place = true }: { r: SetRef; place?: boolean }) => (
  <><b className="mono">{r.plate || ''}</b>{place && r.loc ? <> · vieta {r.loc}</> : null}</>
);

/** Where the intake form opens: prefilled plate/place, or completing a swap. */
export function intakeHref(o: { plate?: string | null; spot?: string | null; swap?: string | null }): string {
  const p = new URLSearchParams();
  if (o.plate) p.set('plate', o.plate);
  if (o.spot) p.set('spot', o.spot);
  if (o.swap) p.set('swap', o.swap);
  const q = p.toString();
  return `/jauna-glabasana${q ? `?${q}` : ''}`;
}

/**
 * The physical workflows, each with its confirmation, as every screen offers
 * them: release, prepare for a swap, close without new tires, put back, unblock,
 * and the swap itself (which continues on the intake form).
 */
export function useRecordActions() {
  const dialogs = useDialogs();
  const toast = useToast();
  const refresh = useRefresh();
  const router = useRouter();

  const run = useCallback(async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok); } catch (e) { await dialogs.alert(errMsg(e)); return false; } finally { void refresh(); }
    return true;
  }, [dialogs, refresh, toast]);

  /** After a release, staff usually take the other season's tires in right away. */
  const offerReintake = useCallback(async (r: SetRef) => {
    if (!r.plate) return;
    const c = await dialogs.confirm({
      icon: 'success', title: 'Riepas izsniegtas', confirmText: 'Jā, pieņemt', cancelText: 'Vēlāk',
      body: <>Pieņemt <b className="mono">{r.plate}</b> pretējās sezonas riepas tagad?<br /><span className="muted" style={{ fontSize: 13 }}>Vieta <b>{r.loc || '—'}</b> tikko atbrīvojās.</span></>,
    });
    if (c.ok) router.push(intakeHref({ plate: r.plate, spot: r.loc }));
  }, [dialogs, router]);

  const release = useCallback(async (r: SetRef, o: { comment?: boolean; reintake?: boolean } = {}) => {
    const c = await dialogs.confirm({ title: 'Izsniegt riepas?', body: <Plate r={r} />, confirmText: 'Izsniegt', input: o.comment ? { placeholder: 'Komentārs (neobligāts)' } : undefined });
    if (!c.ok) return false;
    const done = await run(() => post(`/api/storage/${enc(r.id)}/release`, { comment: c.value }), 'Riepas izsniegtas');
    if (done && o.reintake) await offerReintake(r);
    return done;
  }, [dialogs, offerReintake, run]);

  const prepare = useCallback(async (r: SetRef, o: { comment?: boolean } = {}) => {
    const c = await dialogs.confirm({
      title: 'Sagatavot izsniegšanai?', confirmText: 'Sagatavot', input: o.comment ? { placeholder: 'Komentārs (neobligāts)' } : undefined,
      body: <><b className="mono">{r.plate || ''}</b>{r.loc ? <> · vieta {r.loc}</> : null} paliks <b>rezervēta</b> sezonas maiņai</>,
    });
    if (!c.ok) return false;
    return run(() => post(`/api/storage/${enc(r.id)}/prepare`, { comment: c.value }), 'Sagatavots · uzdevums nosūtīts noliktavai');
  }, [dialogs, run]);

  const terminate = useCallback(async (r: SetRef, o: { comment?: boolean } = {}) => {
    const c = await dialogs.confirm({
      icon: 'warning', title: 'Slēgt bez jaunām riepām?', confirmText: 'Slēgt', danger: true,
      body: <><Plate r={r} place={false} /> — klients neatstāj riepas, vieta atbrīvosies.</>,
      input: o.comment ? { placeholder: 'Komentārs (neobligāts)' } : undefined,
    });
    if (!c.ok) return false;
    return run(() => post(`/api/storage/${enc(r.id)}/release`, { comment: c.value || 'Slēgts bez jaunām riepām' }), 'Pasūtījums slēgts · vieta atbrīvota');
  }, [dialogs, run]);

  const unprepare = useCallback((id: string) => run(() => post(`/api/storage/${enc(id)}/unprepare`), 'Novietots atpakaļ vietā'), [run]);
  const unblock = useCallback((id: string) => run(() => post(`/api/storage/${enc(id)}/unblock`), 'Vieta atbloķēta'), [run]);
  const swap = useCallback((r: SetRef) => router.push(intakeHref({ plate: r.plate, spot: r.loc, swap: r.id })), [router]);

  return { release, prepare, terminate, unprepare, unblock, swap, offerReintake };
}
