import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseWorkbook } from '../excel/import';
import { storageRows, toXlsx } from '../excel/export';
import { rec } from '../../../tests/fixtures';

const HEADER = ['VIETA', 'AUTO NR.', 'NOSAUKUMS', 'VĀRDS', 'TELEFONA NR.', 'IZMĒRS', 'NOSAUKUMS', 'SKAITS', 'DISKI', 'PIEZĪMES', 'SAŅEMŠANAS DATUMS', 'IZSNIEGŠANAS DATUMS'];

function workbook(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['2025 RUDENS'], HEADER, ...rows]), '2025 RUDENS');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['random notes']]), 'Piezīmes');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parseWorkbook', () => {
  const buf = workbook([
    ['a 1', 'ab-1234', 'BMW X5', 'Anna Ozola', 29123456, '245/40R19', 'Pirelli', '2+2', '275/35/19', null, '05.10.2025', null],
    ['A2', 'BRĪVS', null, null, null, null, null, null, null, null, null, null],
    ['A3', 'aizņemts', null, null, null, null, null, null, null, null, null, null],
    ['A4', 'CD5678', 'Audi', 'SERVISS SIA', 'SIA Serviss', '205/55/16', 'Nokian', '4', '4 Lietie', '205/55/16', '01.10.2024', '15.04.2025'],
    [null, null, null, null, null, null, null, null, null, null, null, null],
  ]);

  it('reads the seasonal sheet and skips sheets without the header', () => {
    const r = parseWorkbook(buf);
    expect(r.summary).toEqual({ sheets: 1, rows: 4, parsed: 4, skipped: 0 });
  });

  it('normalises plates, phones, sizes, dates and the staggered 2nd size', () => {
    const [a] = parseWorkbook(buf).records;
    expect(a).toMatchObject({
      location: 'A1', plate: 'AB1234', phone: '+37129123456', size1: '245/40/19', size2: '275/35/19',
      rimNote: null, intakeDate: '2025-10-05', status: 'active', isCompany: false, season: '2025 RUDENS',
    });
  });

  it('turns BRĪVS / AIZŅEMTS rows into free / blocked places', () => {
    const [, free, held] = parseWorkbook(buf).records;
    expect(free).toMatchObject({ plate: null, status: 'free' });
    expect(held).toMatchObject({ plate: null, status: 'blocked' });
  });

  it('spots companies, rim notes, released sets and a 2nd size that is the whole note', () => {
    const d = parseWorkbook(buf).records[3];
    expect(d).toMatchObject({ isCompany: true, phone: null, rimNote: '4 Lietie', size2: '205/55/16', notes: null, releaseDate: '2025-04-15', status: 'released' });
  });

  it('can replace every phone with a dummy for testing', () => {
    expect(parseWorkbook(buf, { dummyPhone: '01010101010' }).records[0].phone).toBe('01010101010');
  });
});

it('exports rows that read back', () => {
  const buf = toXlsx(storageRows([rec({ plate: 'AB1', brand: 'GY', status: 'prepared' })]), 'Tabula');
  const back = XLSX.utils.sheet_to_json<Record<string, string>>(XLSX.read(buf).Sheets.Tabula);
  expect(back[0]).toMatchObject({ 'Auto nr.': 'AB1', Ražotājs: 'Goodyear', Statuss: 'Rezervēts' });
});
