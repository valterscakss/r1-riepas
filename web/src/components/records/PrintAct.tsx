import type { ReactNode } from 'react';
import type { StorageRecord } from '@/domain/types';
import { eur, lvDate } from '@/domain/format';
import { notesOf, size2Of } from '@/domain/sizes';

const Row = ({ label, value }: { label: string; value: ReactNode }) => (
  <tr><th style={{ textAlign: 'left', padding: '5px 12px 5px 0', fontWeight: 500, color: '#555', width: '38%', verticalAlign: 'top', fontSize: 12 }}>{label}</th>
    <td style={{ padding: '5px 0', fontWeight: 600, fontSize: 13, verticalAlign: 'top' }}>{value || '—'}</td></tr>
);
const Head = ({ children }: { children: ReactNode }) => <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#555', marginBottom: 6 }}>{children}</div>;
const Cell = ({ children, head }: { children: ReactNode; head?: boolean }) => head
  ? <th style={{ textAlign: 'left', padding: '7px 9px', fontSize: 11, fontWeight: 700, border: '1px solid #ccc' }}>{children}</th>
  : <td style={{ padding: '8px 9px', border: '1px solid #ccc' }}>{children}</td>;
const Sign = ({ who, name }: { who: string; name: string }) => (
  <div style={{ flex: 1 }}>
    <div style={{ height: 46, borderBottom: '1px solid #000' }} />
    <div style={{ fontSize: 11, color: '#555', marginTop: 5 }}>{who}</div>
    <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2, minHeight: 15 }}>{name}</div>
  </div>
);

/**
 * The handover act the customer signs when collecting their tires: what was
 * stored, where, what it costs, and two signature lines. Fields this user may
 * not see never arrived from the server, so they are simply absent here too.
 */
export function PrintAct({ r, staff }: { r: StorageRecord; staff: string }) {
  const now = new Date();
  const size2 = size2Of(r);
  const rims = r.rimNote || (size2 ? '—' : 'Bez diskiem');
  const notes = notesOf(r);
  return (
    <div style={{ maxWidth: '180mm', margin: '0 auto', fontSize: 13, lineHeight: 1.45, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #000', paddingBottom: 10, marginBottom: 16 }}>
        <div><div style={{ fontSize: 19, fontWeight: 700 }}>R1 Tires</div><div style={{ fontSize: 11, color: '#555' }}>Riepu glabāšana</div></div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>RIEPU IZSNIEGŠANAS AKTS</div>
          <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>Nr. {r.id} · {lvDate(now)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 26, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <Head>Klients</Head>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
            <Row label="Vārds / uzņēmums" value={r.customerName} />
            {r.phone && <Row label="Telefons" value={r.phone} />}
            <Row label="Auto numurs" value={r.plate} />
            {r.makeModel && <Row label="Auto" value={r.makeModel} />}
          </tbody></table>
        </div>
        <div style={{ flex: 1 }}>
          <Head>Glabāšana</Head>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
            <Row label="Sezona" value={r.season} />
            <Row label="Vieta" value={r.location} />
            <Row label="Pieņemts" value={lvDate(r.intakeDate)} />
            <Row label="Izsniegts" value={lvDate(r.releaseDate) || lvDate(now)} />
            {r.smsCode && <Row label="SMS kods" value={r.smsCode} />}
          </tbody></table>
        </div>
      </div>
      <Head>Izsniegtās riepas</Head>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead><tr style={{ background: '#f1f1f1' }}><Cell head>Izmērs</Cell><Cell head>Ražotājs</Cell><Cell head>Skaits</Cell><Cell head>Diski</Cell><Cell head>Protektors</Cell></tr></thead>
        <tbody><tr>
          <Cell><b>{r.size1 || '—'}{size2 ? ` + ${size2}` : ''}</b></Cell><Cell>{r.brand || '—'}</Cell><Cell>{r.quantity || '—'}</Cell>
          <Cell>{rims}</Cell><Cell>{r.threadDepth ? `${r.threadDepth} mm` : '—'}</Cell>
        </tr></tbody>
      </table>
      {notes && <div style={{ marginBottom: 14 }}><Head>Piezīmes</Head><div style={{ fontSize: 12 }}>{notes}</div></div>}
      {r.feeEur && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}><div style={{ border: '1px solid #000', padding: '8px 16px' }}><span style={{ fontSize: 11, color: '#555' }}>Glabāšanas maksa</span> <span style={{ fontSize: 16, fontWeight: 700, marginLeft: 10 }}>{eur(r.feeEur)}</span></div></div>}
      <div style={{ borderTop: '1px solid #ccc', paddingTop: 12, marginTop: 4 }}>
        <p style={{ margin: '0 0 20px', fontSize: 12, lineHeight: 1.55 }}>Klients apstiprina, ka ir saņēmis augstāk norādītās riepas pilnā apjomā un bez redzamiem bojājumiem, un ka pretenziju pret glabātāju nav.</p>
        <div style={{ display: 'flex', gap: 40 }}><Sign who="Klienta paraksts" name={r.customerName ?? ''} /><Sign who="Izsniedza (darbinieks)" name={staff} /></div>
        <div style={{ fontSize: 11, color: '#555', marginTop: 14 }}>Datums: {lvDate(now)}</div>
      </div>
    </div>
  );
}
