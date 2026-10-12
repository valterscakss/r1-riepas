import type { RecordStatus } from '@/domain/types';

export const STATUS: Record<RecordStatus, [string, string]> = {
  active: ['Glabājas', 'ok'], prepared: ['Rezervēts', 'warn'], blocked: ['Bloķēts', 'danger'],
  released: ['Izsniegts', 'plain'], free: ['Brīva vieta', 'ok'],
};

export function StatusBadge({ status, small }: { status: RecordStatus | string; small?: boolean }) {
  const [label, tone] = STATUS[status as RecordStatus] ?? STATUS.released;
  return <span className={`badge ${tone}${small ? ' sm' : ''}`}>{label}</span>;
}
