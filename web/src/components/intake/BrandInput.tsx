'use client';

import { useLayoutEffect, useRef, type InputHTMLAttributes } from 'react';
import { completeBrand } from '@/domain/brands';

/**
 * Completes a known brand IN the field while typing ("Mi" → "Mi|chelin" with
 * the rest selected), not a dropdown; deleting never re-completes.
 */
export function BrandInput({ value, onChange, ...rest }: { value: string; onChange: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const ref = useRef<HTMLInputElement>(null);
  const sel = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    if (sel.current && ref.current) { ref.current.setSelectionRange(...sel.current); sel.current = null; }
  });
  return (
    <input ref={ref} autoComplete="off" value={value} {...rest} onChange={(e) => {
      const v = e.target.value;
      const deleting = (e.nativeEvent as InputEvent).inputType?.startsWith('delete');
      const hit = !deleting ? completeBrand(v) : null;
      if (hit && hit !== v) { sel.current = [v.length, hit.length]; onChange(hit); } else onChange(v);
    }} />
  );
}
