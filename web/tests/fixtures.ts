import type { Container, RecordEvent, StorageRecord } from '@/domain/types';

let seq = 0;
export function rec(p: Partial<StorageRecord> = {}): StorageRecord {
  seq++;
  return {
    id: String(seq), season: '2025 RUDENS', location: null, plate: null, makeModel: null,
    customerName: null, isCompany: false, phone: null, size1: null, brand: null, quantity: null,
    size2: null, rimNote: null, notes: null, intakeDate: null, releaseDate: null, status: 'active',
    preparedDate: null, threadDepth: null, smsCode: null, feeEur: null, ...p,
  };
}

export function container(p: Partial<Container> & { prefix: string }): Container {
  seq++;
  return { id: String(seq), label: null, rows: 1, cols: 4, cells: null, names: null, zones: null, createdAt: null, ...p };
}

export function ev(p: Partial<RecordEvent> & { recordId: string; action: string }): RecordEvent {
  seq++;
  return { id: String(seq), comment: null, actor: null, createdAt: null, ...p };
}
