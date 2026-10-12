'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { Modal } from '@/client/dialogs';
import { errMsg } from '@/client/api';

/**
 * A titled form in a modal. `onSubmit` returns an error message to show (and
 * keep the dialog open) or nothing to close it.
 */
export function FormDialog({ title, children, onCancel, onSubmit, submitText = 'Saglabāt', size = 'narrow', extra }: {
  title: string; children: ReactNode; onCancel: () => void; onSubmit: () => Promise<string | void> | string | void;
  submitText?: string; size?: 'narrow' | '' | 'wide'; extra?: ReactNode;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const msg = await onSubmit();
      if (msg) setError(msg);
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onCancel} className={size}>
      <form onSubmit={submit}>
        <div className="modal-head"><h2>{title}</h2><button type="button" className="btn icon" aria-label="Aizvērt" onClick={onCancel}>✕</button></div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {children}
          <div className="dialog-error" role="alert">{error}</div>
        </div>
        <div className="modal-foot">
          {extra}
          <button type="button" className="btn lg" onClick={onCancel}>Atcelt</button>
          <button type="submit" className="btn lg primary" disabled={busy}>{busy ? 'Saglabā…' : submitText}</button>
        </div>
      </form>
    </Modal>
  );
}
