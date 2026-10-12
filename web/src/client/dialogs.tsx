'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type Icon = 'question' | 'warning' | 'success' | 'info' | 'error';
const ICON: Record<Icon, [string, string, string]> = {
  question: ['?', 'var(--accent-soft)', 'var(--accent-2)'],
  warning: ['!', 'var(--warn-soft)', 'var(--warn)'],
  success: ['✓', 'var(--ok-soft)', 'var(--ok)'],
  info: ['i', 'var(--accent-soft)', 'var(--accent-2)'],
  error: ['✕', 'var(--danger-soft)', 'var(--danger)'],
};

export interface ConfirmOpts {
  title: string;
  body?: ReactNode;
  icon?: Icon;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  hideCancel?: boolean;
  /** Ask for an optional line of text (a comment) alongside the confirmation. */
  input?: { placeholder?: string; initial?: string; multiline?: boolean };
  wide?: boolean;
}
export interface ConfirmResult { ok: boolean; value: string }

type Render<T> = (done: (v: T | undefined) => void) => ReactNode;
interface Entry { id: number; node: ReactNode }

interface DialogApi {
  confirm: (o: ConfirmOpts) => Promise<ConfirmResult>;
  alert: (text: string, title?: string) => Promise<void>;
  /** Any custom dialog; resolves with what it passes to `done`, or undefined when dismissed. */
  open: <T>(render: Render<T>) => Promise<T | undefined>;
}

const Ctx = createContext<DialogApi | null>(null);
let seq = 0;

/** A modal frame with Escape / backdrop-click to dismiss. */
export function Modal({ onClose, children, className = '', labelledBy }: { onClose: () => void; children: ReactNode; className?: string; labelledBy?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay dialog" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>{children}</div>
    </div>
  );
}

function ConfirmDialog({ o, done }: { o: ConfirmOpts; done: (r: ConfirmResult) => void }) {
  const [value, setValue] = useState(o.input?.initial ?? '');
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const [glyph, bg, fg] = ICON[o.icon ?? 'question'];
  const id = `dlg-${o.title.length}-${seq}`;
  return (
    <Modal onClose={() => done({ ok: false, value })} className={o.wide ? 'wide' : 'narrow'} labelledBy={id}>
      <div className="modal-body" style={{ textAlign: 'center', paddingTop: 28 }}>
        <div className="dialog-icon" style={{ background: bg, color: fg, margin: '0 auto 14px' }}>{glyph}</div>
        <h2 id={id} style={{ fontSize: 20, fontWeight: 600 }}>{o.title}</h2>
        {o.body && <div className="muted-2" style={{ fontSize: 14, marginTop: 10, textAlign: o.wide ? 'left' : 'center' }}>{o.body}</div>}
        {o.input && (o.input.multiline
          ? <textarea ref={ref} className="input" rows={4} style={{ marginTop: 16 }} value={value} placeholder={o.input.placeholder} onChange={(e) => setValue(e.target.value)} />
          : <input ref={ref} className="input" style={{ marginTop: 16 }} value={value} placeholder={o.input.placeholder} onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') done({ ok: true, value }); }} />)}
      </div>
      <div className="modal-foot" style={{ justifyContent: 'center' }}>
        {!o.hideCancel && <button className="btn lg" onClick={() => done({ ok: false, value })}>{o.cancelText ?? 'Atcelt'}</button>}
        <button className={`btn lg ${o.danger ? 'danger' : 'primary'}`} autoFocus={!o.input} onClick={() => done({ ok: true, value })}>{o.confirmText ?? 'Labi'}</button>
      </div>
    </Modal>
  );
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Entry[]>([]);

  const open = useCallback(<T,>(render: Render<T>) => new Promise<T | undefined>((resolve) => {
    const id = ++seq;
    const done = (v: T | undefined) => { setStack((s) => s.filter((e) => e.id !== id)); resolve(v); };
    setStack((s) => [...s, { id, node: render(done) }]);
  }), []);

  const confirm = useCallback((o: ConfirmOpts) =>
    open<ConfirmResult>((done) => <ConfirmDialog o={o} done={done} />).then((r) => r ?? { ok: false, value: '' }), [open]);

  const alert = useCallback((text: string, title = 'Kļūda') =>
    confirm({ title, body: text, icon: title === 'Kļūda' ? 'error' : 'info', hideCancel: true }).then(() => undefined), [confirm]);

  return (
    <Ctx.Provider value={{ confirm, alert, open }}>
      {children}
      {stack.map((e) => <div key={e.id}>{e.node}</div>)}
    </Ctx.Provider>
  );
}

export function useDialogs(): DialogApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDialogs outside DialogProvider');
  return v;
}
