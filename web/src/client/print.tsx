'use client';

import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let root: Root | null = null;

/**
 * Print a document (handover act, manual): render it into #print-area, which
 * the print stylesheet swaps in for the whole page — no popup to be blocked,
 * works from a phone too.
 */
export function printNode(node: ReactNode, settleMs = 120): void {
  const el = document.getElementById('print-area');
  if (!el) return;
  root ??= createRoot(el);
  root.render(node);
  setTimeout(() => window.print(), settleMs);
}
