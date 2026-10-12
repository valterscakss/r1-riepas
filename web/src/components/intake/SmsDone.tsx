'use client';

import { Modal } from '@/client/dialogs';
import { eur } from '@/domain/format';
import type { StorageRecord } from '@/domain/types';

/** After an intake: the place, the price, and the SMS the customer gets, as it will look on a phone. */
export function SmsDone({ r, done }: { r: StorageRecord; done: (v: 'finish' | undefined) => void }) {
  const time = new Date().toTimeString().slice(0, 5);
  return (
    <Modal onClose={() => done(undefined)} className="wide">
      <div className="modal-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 300px' }}>
        <div style={{ padding: 32 }}>
          <div className="dialog-icon" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}>✓</div>
          <h2 style={{ fontSize: 22, fontWeight: 600 }}>Glabāšana apstiprināta</h2>
          <p className="muted-2" style={{ fontSize: 14, lineHeight: 1.6, margin: '8px 0 22px' }}>Riepas noglabātas vietā <strong className="mono">{r.location || '—'}</strong>. Klientam paredzētais SMS kods ir ģenerēts.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="tile kv" style={{ padding: '11px 14px' }}><span>SMS kods</span><span className="mono" style={{ fontWeight: 600 }}>{r.smsCode || '—'}</span></div>
            <div className="tile kv" style={{ padding: '11px 14px' }}><span>Cena</span><span className="mono" style={{ fontWeight: 600 }}>{r.feeEur ? eur(r.feeEur) : '—'}</span></div>
          </div>
          <div className="row" style={{ marginTop: 24 }}>
            <button className="btn lg primary" style={{ flex: 1 }} autoFocus onClick={() => done('finish')}>Pabeigt</button>
            <button className="btn lg" onClick={() => done(undefined)}>Aizvērt</button>
          </div>
        </div>
        <div style={{ background: 'var(--surface-2)', borderLeft: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 26 }}>
          <div style={{ width: 230, background: 'oklch(0.16 0.01 262)', borderRadius: 30, padding: 10 }}>
            <div style={{ background: 'var(--bg)', borderRadius: 22, overflow: 'hidden' }}>
              <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 16px 5px', fontSize: 11 }}><span>{time}</span><span>R1 Tires</span></div>
              <div style={{ padding: '8px 12px 18px' }}>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px 16px 16px 5px', padding: '12px 13px', fontSize: 12, lineHeight: 1.55 }}>
                  <div style={{ marginBottom: 6 }}>Jūsu riepas ir noglabātas! 🛞</div>
                  <div>Kods: <strong className="mono">{r.smsCode || '—'}</strong></div>
                  <div>Vieta: <strong className="mono">{r.location || '—'}</strong></div>
                  <div>Izmērs: <strong className="mono">{r.size1 || '—'}{r.size2 ? ` + ${r.size2}` : ''}</strong></div>
                  <div>Protektors: <strong className="mono">{r.threadDepth ? `${r.threadDepth} mm` : '—'}</strong></div>
                  <div className="muted-2" style={{ marginTop: 6 }}>Izņem jebkurā laikā ar kodu vai numura zīmi.</div>
                </div>
                <div className="muted" style={{ fontSize: 9, marginTop: 5, textAlign: 'right' }}>Sagatavots · tagad</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
