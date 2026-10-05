'use client';

import { download, errMsg } from '@/client/api';
import { useSession } from '@/client/session';
import { useToast } from '@/client/toast';
import { useDialogs } from '@/client/dialogs';

/** "⭳ Excel" — downloads what is on screen, with the same filters. Hidden without act.export. */
export function ExportButton({ what, params, small }: { what: string; params?: Record<string, string>; small?: boolean }) {
  const { can } = useSession();
  const toast = useToast();
  const { alert } = useDialogs();
  if (!can('act.export')) return null;
  const qs = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v)).toString();
  const go = async () => {
    try {
      await download(`/api/export/${what}${qs ? `?${qs}` : ''}`, `${what}.xlsx`);
      toast('Fails lejupielādēts');
    } catch (e) { await alert(errMsg(e, 'Neizdevās lejupielādēt')); }
  };
  return <button className={`btn${small ? ' sm' : ''}`} title="Lejupielādēt Excel failu" onClick={go}>⭳ Excel</button>;
}
