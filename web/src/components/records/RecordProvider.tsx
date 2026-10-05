'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { RecordModal } from './RecordModal';

const Ctx = createContext<(id: string) => void>(() => undefined);

/** Any screen can open the full record card — data, photos, history, actions. */
export function RecordProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const open = useCallback((rid: string) => setId(String(rid)), []);
  return (
    <Ctx.Provider value={open}>
      {children}
      {id && <RecordModal id={id} onClose={() => setId(null)} />}
    </Ctx.Provider>
  );
}

export const useOpenRecord = () => useContext(Ctx);
