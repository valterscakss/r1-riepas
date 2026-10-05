'use client';

import { useState, type FormEvent } from 'react';
import { post, errMsg } from '@/client/api';

export function LoginForm({ next }: { next: string }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) { setError('Ievadi lietotājvārdu un paroli'); return; }
    setBusy(true); setError('');
    try {
      await post('/api/login', { username: username.trim(), password });
      // A full load: the server layout reads the new cookie from scratch.
      window.location.assign(next);
    } catch (err) {
      setError(errMsg(err, 'Savienojuma kļūda'));
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 26 }}>
          <div className="logo" style={{ width: 56, height: 56, borderRadius: 15, fontSize: 22, marginBottom: 14 }}>R1</div>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>R1 Tires</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>Piesakies, lai turpinātu</div>
        </div>
        <form className="card" style={{ padding: 24 }} onSubmit={submit}>
          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="lg-user">Lietotājvārds</label>
            <input id="lg-user" autoFocus autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="lietotajvards" style={{ height: 46 }} value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 18 }}>
            <label htmlFor="lg-pass">Parole</label>
            <input id="lg-pass" type="password" autoComplete="current-password" placeholder="••••••••" style={{ height: 46 }} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button type="submit" className="btn lg primary block" disabled={busy}>{busy ? 'Piesakās…' : 'Pieteikties'}</button>
          <div role="alert" style={{ color: 'var(--danger)', fontSize: 13, textAlign: 'center', marginTop: 12, minHeight: 16 }}>{error}</div>
          <button type="button" className="btn ghost block" onClick={() => setForgot((v) => !v)}>Aizmirsi paroli?</button>
          {forgot && <div className="muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 6 }}>Sazinies ar administratoru — sadaļā <b>Lietotāji → Atiestatīt paroli</b>.</div>}
        </form>
      </div>
    </div>
  );
}
