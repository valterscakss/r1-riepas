'use client';

import { useQuery } from '@tanstack/react-query';
import { api, del, enc, errMsg } from '@/client/api';
import { useDialogs } from '@/client/dialogs';
import { useSession } from '@/client/session';
import { useToast } from '@/client/toast';
import { initialsOf } from '@/domain/format';
import { ROLE_LABEL } from '@/domain/perms';
import type { Role, UserSummary } from '@/domain/types';
import { Credentials, EditUserDialog, loadPerms, NewUserDialog, PermsDialog, ResetPasswordDialog } from '../users/UserDialogs';

const ROLE_TONE: Record<Role, string> = { admin: 'accent', warehouse: 'violet', leja: 'teal', staff: 'plain' };

/** The in-app login and password generator. */
export function UsersScreen() {
  const { user: me, setUser } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api<{ users: UserSummary[] }>('/api/users') });
  const users = q.data?.users ?? [];
  const reload = () => void q.refetch();
  const showCreds = (title: string, username: string, password: string) =>
    dialogs.open<void>((done) => <Credentials title={title} username={username} password={password} done={() => done(undefined)} />);

  const create = async () => {
    const r = await dialogs.open<{ username: string; password: string }>((done) => <NewUserDialog done={done} />);
    if (!r) return;
    reload();
    await showCreds('Lietotājs izveidots', r.username, r.password);
  };
  const edit = async (u: UserSummary) => {
    const r = await dialogs.open<{ changed: boolean; reauth: boolean; self?: typeof me }>((done) => <EditUserDialog u={u} me={me} done={done} />);
    if (!r) return;
    if (r.self) setUser(r.self);
    reload();
    toast(!r.changed ? 'Nekas nebija jāmaina' : r.reauth ? 'Saglabāts · lietotājam jāpiesakās no jauna' : 'Saglabāts');
  };
  const reset = async (u: UserSummary) => {
    const pw = await dialogs.open<string>((done) => <ResetPasswordDialog u={u} done={done} />);
    if (pw) await showCreds('Parole atiestatīta', u.username, pw);
  };
  const perms = async (u: UserSummary) => {
    let initial;
    try { initial = await loadPerms(u.username); } catch (e) { await dialogs.alert(errMsg(e, 'Neizdevās ielādēt tiesības')); return; }
    const r = await dialogs.open<'saved' | 'reset'>((done) => <PermsDialog u={u} initial={initial} done={done} />);
    if (r === 'saved') toast('Tiesības saglabātas · stājas spēkā uzreiz');
    if (r === 'reset') toast('Atjaunoti lomas noklusējumi');
  };
  const remove = async (u: UserSummary) => {
    const c = await dialogs.confirm({ icon: 'warning', title: 'Dzēst lietotāju?', confirmText: 'Dzēst', danger: true, body: <><b className="mono">@{u.username}</b> · {u.name} vairs nevarēs pieteikties.</> });
    if (!c.ok) return;
    try { await del(`/api/users/${enc(u.username)}`); reload(); toast('Lietotājs dzēsts'); } catch (e) { await dialogs.alert(errMsg(e, 'Neizdevās dzēst')); }
  };

  const COLS = '1fr 150px auto auto';
  return (
    <div className="page w-900">
      <div className="page-head">
        <div><h1>Lietotāji</h1><div className="sub">{users.length} {users.length === 1 ? 'lietotājs' : 'lietotāji'} · pieejas un paroles</div></div>
        <button className="btn lg primary" onClick={create}>＋ Jauns lietotājs</button>
      </div>
      <div className="card clip">
        <div className="grid-table-head" style={{ gridTemplateColumns: COLS }}><span>Lietotājs</span><span>Loma</span><span /><span /></div>
        {!users.length && <div className="empty left">{q.isLoading ? 'Ielādē…' : 'Nav lietotāju'}</div>}
        {users.map((u) => (
          <div key={u.username} className="grid-table-row" style={{ gridTemplateColumns: COLS }}>
            <div className="row" style={{ gap: 11, minWidth: 0, flexWrap: 'nowrap' }}>
              <span className="initials">{initialsOf(u.name)}</span>
              <span style={{ minWidth: 0 }}><span className="ellipsis" style={{ display: 'block', fontWeight: 600 }}>{u.name}</span><span className="mono muted" style={{ display: 'block', fontSize: 11 }}>@{u.username}</span></span>
            </div>
            <span><span className={`badge ${ROLE_TONE[u.role]}`}>{ROLE_LABEL[u.role]}</span></span>
            <span className="row" style={{ gap: 6 }}>
              <button className="btn sm" title="Mainīt vārdu, lietotājvārdu vai lomu" onClick={() => edit(u)}>Rediģēt</button>
              {u.role !== 'admin' && <button className="btn sm" onClick={() => perms(u)}>Tiesības</button>}
              <button className="btn sm" onClick={() => reset(u)}>Atiestatīt paroli</button>
            </span>
            <button className="btn sm danger-text" title="Dzēst lietotāju" aria-label={`Dzēst ${u.username}`} onClick={() => remove(u)}>✕</button>
          </div>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 14, lineHeight: 1.6 }}>Paroles tiek glabātas šifrētā veidā (bcrypt). Ģenerētā parole tiek parādīta tikai vienu reizi — nokopē to un nodod lietotājam.</div>
    </div>
  );
}
