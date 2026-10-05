import * as XLSX from 'xlsx';
import { canonBrand } from '../brands';
import type { Analytics } from '../analytics';
import type { HistoryEntry } from '../history';
import type { SpotUniverse } from '../spots';
import type { Perms } from '../perms';
import { redactRecord } from '../perms';
import { tiresLine } from '../records';
import type { StorageRecord, Task } from '../types';

/**
 * Every list in the app can leave as .xlsx. Each sheet mirrors what is on screen
 * — same filters, same column order — so the download matches what was shown.
 */
type Row = Record<string, string | number>;

const yn = (b: boolean) => (b ? 'Jā' : 'Nē');
export const STATUS_LV: Record<string, string> = {
  active: 'Glabājas', prepared: 'Rezervēts', blocked: 'Bloķēts', released: 'Izsniegts', free: 'Brīva vieta',
};
const ACTION_LV: Record<string, string> = {
  in: 'Pieņemšana', created: 'Pieņemšana', out: 'Izsniegšana', released: 'Izsniegšana',
  swapped: 'Maiņa', prepared: 'Sagatavots', unprepared: 'Atpakaļ vietā',
  blocked: 'Bloķēts', unblocked: 'Atbloķēts', edited: 'Rediģēts', comment: 'Komentārs', photo: 'Bilde',
};

export const storageRows = (rows: StorageRecord[]): Row[] => rows.map((r) => ({
  Vieta: r.location ?? '', 'Auto nr.': r.plate ?? '', Nosaukums: r.makeModel ?? '',
  Vārds: r.customerName ?? '', Uzņēmums: yn(r.isCompany), Telefons: r.phone ?? '',
  Izmērs: r.size1 ?? '', '2. izmērs': r.size2 ?? '', Ražotājs: canonBrand(r.brand) ?? '',
  Skaits: r.quantity ?? '', Diski: r.rimNote ?? '', Protektors: r.threadDepth ?? '',
  'SMS kods': r.smsCode ?? '', Cena: r.feeEur ?? '', Piezīmes: r.notes ?? '',
  Saņemts: r.intakeDate ?? '', Izsniegts: r.releaseDate ?? '',
  Sezona: r.season ?? '', Statuss: STATUS_LV[r.status] ?? r.status,
}));

export const historyRows = (list: HistoryEntry[]): Row[] => list.map((e) => ({
  Datums: e.d, Darbība: ACTION_LV[e.type] ?? e.type, 'Auto nr.': e.plate ?? '',
  Klients: e.cust ?? '', Vieta: e.loc ?? '', Riepas: e.tires ?? '',
  Komentārs: e.comment ?? '', Veica: e.actor ?? '',
}));

/** Every chart's rows stacked, with a column naming the chart they came from. */
export function analyticsRows(a: Analytics): Row[] {
  const out: Row[] = [];
  const push = (group: string, items: Array<{ label: string; count: number }>) =>
    items.forEach((x) => out.push({ Grupa: group, Vērtība: x.label, Skaits: x.count }));
  push('Auto markas', a.makes); push('Modeļi', a.models); push('Izmēri', a.sizes);
  push('Ražotāji', a.brands); push('Daudzuma veidi', a.quantities); push('Sezonas', a.seasons);
  return out;
}

/** One row per storage entry under its client, so Excel can pivot per customer. */
export const customerRows = (all: StorageRecord[]): Row[] => all
  .filter((r) => r.plate || r.customerName)
  .map((r) => ({
    Klients: r.customerName ?? '', Uzņēmums: yn(r.isCompany), Telefons: r.phone ?? '',
    'Auto nr.': r.plate ?? '', Auto: r.makeModel ?? '',
    Sezona: r.season ?? '', Vieta: r.location ?? '',
    Riepas: tiresLine(r),
    '2. izmērs': r.size2 ?? '', Diski: r.rimNote ?? '', Protektors: r.threadDepth ?? '',
    Cena: r.feeEur ?? '', 'SMS kods': r.smsCode ?? '',
    Saņemts: r.intakeDate ?? '', Izsniegts: r.releaseDate ?? '',
    Statuss: STATUS_LV[r.status] ?? r.status,
  }))
  .sort((a, b) => String(a.Klients).localeCompare(String(b.Klients), 'lv') || String(b.Saņemts || '').localeCompare(String(a.Saņemts || '')));

export const taskRows = (tasks: Task[]): Row[] => tasks.map((t) => ({
  Veids: t.kind === 'prepare' ? 'Sagatavot riepas' : t.kind === 'store' ? 'Novietot glabāšanā' : 'Pasūtījums',
  Nosaukums: t.title, Apraksts: t.details ?? '', Vieta: t.location ?? '', 'Auto nr.': t.plate ?? '',
  Statuss: t.status === 'done' ? 'Pabeigts' : 'Darāms',
  Pieprasīja: t.createdBy ?? '', Izveidots: t.createdAt ?? '',
  Pabeidza: t.doneBy ?? '', Pabeigts: t.doneAt ?? '',
}));

export const pendingRows = (recs: StorageRecord[]): Row[] => recs.map((r) => ({
  Vieta: r.location ?? '', 'Auto nr.': r.plate ?? '', Klients: r.customerName ?? '', Telefons: r.phone ?? '',
  Riepas: tiresLine(r), '2. izmērs': r.size2 ?? '', Sezona: r.season ?? '',
  Sagatavots: r.preparedDate ?? '', Saņemts: r.intakeDate ?? '',
}));

export function spotRows(u: SpotUniverse, perms: Perms): Row[] {
  return u.spots.map((s) => {
    const held = u.occupied.get(s.code);
    const r = held ? redactRecord(held, perms) : undefined;
    return {
      Vieta: s.code, Konteiners: s.c,
      Statuss: r ? (STATUS_LV[r.status] ?? r.status) : 'Brīvs',
      'Auto nr.': r?.plate ?? '', Klients: r?.customerName ?? '',
      Izmērs: r?.size1 ?? '', Ražotājs: canonBrand(r?.brand) ?? '',
      Diski: r?.rimNote ?? '', 'SMS kods': r?.smsCode ?? '', Saņemts: r?.intakeDate ?? '',
    };
  });
}

/** One sheet, columns roughly sized to their content so the file opens readable. */
export function toXlsx(rows: Row[], sheet: string): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0] ?? {});
  ws['!cols'] = headers.map((h) => ({
    wch: Math.min(42, Math.max(h.length + 2, ...rows.slice(0, 400).map((r) => String(r[h] ?? '').length + 2))),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
