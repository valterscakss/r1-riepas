'use client';

import { useState } from 'react';
import { api, enc, patch, post, put } from '@/client/api';
import { Modal } from '@/client/dialogs';
import { useToast } from '@/client/toast';
import { PERM_GROUPS, ROLE_LABEL, ROLE_OPTIONS, type PermKey } from '@/domain/perms';
import { MIN_PW, USERNAME_RE, USERNAME_RULE } from '@/domain/users';
import type { Role, UserSummary } from '@/domain/types';
import type { SessionUser } from '@/server/auth';
import { Field, PasswordField } from '../ui/Field';
import { FormDialog } from '../ui/FormDialog';
import { genPassword, slugUser } from '../ui/password';

/** Shown once after a create/reset: copy it and hand it over. */
export function Credentials({ title, username, password, done }: { title: string; username: string; password: string; done: () => void }) {
  const toast = useToast();
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${username} / ${password}`); toast('Pieejas dati nokopēti'); } catch { toast('Neizdevās nokopēt', 'error'); }
    done();
  };
  return (
    <Modal onClose={done} className="narrow">
      <div className="modal-body">
        <div className="dialog-icon" style={{ background: 'var(--ok-soft)', color: 'var(--ok)', margin: '8px auto 14px' }}>✓</div>
        <h2 style={{ fontSize: 20, textAlign: 'center' }}>{title}</h2>
        <div className="muted" style={{ fontSize: 13, margin: '12px 0' }}>Nokopē un nodod lietotājam. Parole vairs netiks rādīta.</div>
        <div className="tile kv" style={{ marginBottom: 8, padding: '11px 13px' }}><span>Lietotājs</span><span className="mono" style={{ fontWeight: 600 }}>{username}</span></div>
        <div className="tile kv" style={{ padding: '11px 13px' }}><span>Parole</span><span className="mono" style={{ fontWeight: 600 }}>{password}</span></div>
      </div>
      <div className="modal-foot" style={{ justifyContent: 'center' }}>
        <button className="btn lg" onClick={done}>Aizvērt</button>
        <button className="btn lg primary" onClick={copy}>📋 Kopēt</button>
      </div>
    </Modal>
  );
}

export function NewUserDialog({ done }: { done: (v: { username: string; password: string } | undefined) => void }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [touched, setTouched] = useState(false);
  const [role, setRole] = useState<Role>('staff');
  const [password, setPassword] = useState(() => genPassword(12));
  return (
    <FormDialog title="Jauns lietotājs" submitText="Izveidot" onCancel={() => done(undefined)} onSubmit={async () => {
      const u = username.trim().toLowerCase();
      if (!name.trim()) return 'Ievadi vārdu';
      if (!USERNAME_RE.test(u)) return USERNAME_RULE;
      if (password.length < MIN_PW) return `Parolei jābūt vismaz ${MIN_PW} rakstzīmes`;
      await post('/api/users', { name: name.trim(), username: u, role, password });
      done({ username: u, password });
    }}>
      <Field label="Vārds"><input className="input" placeholder="Jānis Bērziņš" value={name} onChange={(e) => { setName(e.target.value); if (!touched) setUsername(slugUser(e.target.value)); }} /></Field>
      <Field label="Lietotājvārds"><input className="input mono" placeholder="janis" autoCapitalize="none" autoCorrect="off" value={username} onChange={(e) => { setTouched(true); setUsername(e.target.value); }} /></Field>
      <Field label="Loma"><select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLE_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Parole"><PasswordField value={password} onChange={setPassword} /></Field>
    </FormDialog>
  );
}

/** Name, login name and role. Password, permissions and history stay as they are. */
export function EditUserDialog({ u, me, done }: { u: UserSummary; me: SessionUser; done: (v: { changed: boolean; reauth: boolean; self?: SessionUser } | undefined) => void }) {
  const isSelf = me.username.toLowerCase() === u.username.toLowerCase();
  const [name, setName] = useState(u.name);
  const [username, setUsername] = useState(u.username);
  const [role, setRole] = useState<Role>(u.role);
  return (
    <FormDialog title="Rediģēt lietotāju" onCancel={() => done(undefined)} onSubmit={async () => {
      const us = username.trim().toLowerCase();
      if (!name.trim()) return 'Ievadi vārdu';
      if (!USERNAME_RE.test(us)) return USERNAME_RULE;
      const r = await patch<{ changed: boolean; reauth: boolean; user: { username: string; name: string; role: Role } }>(`/api/users/${enc(u.username)}`,
        { name: name.trim(), username: us, ...(isSelf ? {} : { role }) });
      done({ changed: r.changed, reauth: r.reauth, self: isSelf ? { ...me, ...r.user } : undefined });
    }}>
      <Field label="Vārds"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Lietotājvārds (pieteikšanās vārds)"><input className="input mono" autoCapitalize="none" autoCorrect="off" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
      <Field label="Loma">
        <select className="input" disabled={isSelf} style={isSelf ? { opacity: 0.6 } : undefined} value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLE_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {isSelf && <div className="muted" style={{ fontSize: 11, marginTop: 5 }}>Savu lomu nevar mainīt — to var izdarīt cits administrators.</div>}
      </Field>
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>Parole, tiesības un vēsture paliek nemainīgas.{isSelf ? '' : ' Ja maini lietotājvārdu vai lomu, lietotājam būs jāpiesakās no jauna.'}</div>
    </FormDialog>
  );
}

export function ResetPasswordDialog({ u, done }: { u: UserSummary; done: (v: string | undefined) => void }) {
  const [password, setPassword] = useState(() => genPassword(12));
  return (
    <FormDialog title="Atiestatīt paroli" submitText="Atiestatīt" onCancel={() => done(undefined)} onSubmit={async () => {
      if (password.length < MIN_PW) return `Parolei jābūt vismaz ${MIN_PW} rakstzīmes`;
      await post(`/api/users/${enc(u.username)}/reset`, { password });
      done(password);
    }}>
      <div className="muted" style={{ fontSize: 13 }}>Lietotājs <b className="mono">@{u.username}</b> · {u.name}</div>
      <Field label="Jaunā parole"><PasswordField value={password} onChange={setPassword} /></Field>
    </FormDialog>
  );
}

type PermsData = { role: Role; defaults: Record<PermKey, boolean>; effective: Record<PermKey, boolean> };

/**
 * Tick exactly what this user sees and does; unticked = hidden AND blocked by
 * the server, including the data fields (phones, names, prices, SMS codes).
 */
export function PermsDialog({ u, initial, done }: { u: UserSummary; initial: PermsData; done: (v: 'saved' | 'reset' | undefined) => void }) {
  const [on, setOn] = useState<Record<string, boolean>>({ ...initial.effective });
  const save = (body: Record<string, boolean>) => put(`/api/users/${enc(u.username)}/perms`, body);
  return (
    <FormDialog title={`Tiesības · ${u.name || u.username}`} size="" onCancel={() => done(undefined)}
      onSubmit={async () => { await save(on); done('saved'); }}
      extra={<button type="button" className="btn lg" style={{ marginRight: 'auto' }} onClick={async () => { await save(initial.defaults); done('reset'); }}>Lomas noklusējumi</button>}>
      <div className="muted" style={{ fontSize: 12 }}>Loma: <b>{ROLE_LABEL[initial.role]}</b> — atzīmētais nosaka, ko <b>@{u.username}</b> redz un drīkst. Neatzīmētie dati (telefoni, vārdi, cenas) tiek slēpti arī no servera atbildēm.</div>
      <div style={{ maxHeight: '56vh', overflow: 'auto' }}>
        {PERM_GROUPS.map(([group, items]) => (
          <div key={group} style={{ marginBottom: 12 }}>
            <div className="label" style={{ marginBottom: 4 }}>{group}</div>
            <div className="modal-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
              {items.map(([k, label]) => {
                const changed = initial.defaults[k] !== on[k];
                return (
                  <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 4px', cursor: 'pointer', fontSize: 13, fontWeight: changed ? 600 : 400 }}>
                    <input type="checkbox" checked={!!on[k]} onChange={(e) => setOn((s) => ({ ...s, [k]: e.target.checked }))} style={{ width: 17, height: 17, accentColor: 'var(--accent)' }} />
                    <span>{label}{changed && <span style={{ fontSize: 10, color: 'var(--accent-2)' }}> (mainīts)</span>}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </FormDialog>
  );
}

export const loadPerms = (username: string) => api<PermsData>(`/api/users/${enc(username)}/perms`);
