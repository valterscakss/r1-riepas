'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tone = 'success' | 'info' | 'error';
interface Toast { id: number; text: string; tone: Tone }
const Ctx = createContext<(text: string, tone?: Tone) => void>(() => undefined);

let seq = 0;

/** Small confirmations in the corner: "Riepas izsniegtas". */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const show = useCallback((text: string, tone: Tone = 'success') => {
    const id = ++seq;
    setList((l) => [...l, { id, text, tone }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), tone === 'error' ? 5000 : 2600);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {list.map((t) => <div key={t.id} className={`toast ${t.tone === 'success' ? '' : t.tone}`}>{t.text}</div>)}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
