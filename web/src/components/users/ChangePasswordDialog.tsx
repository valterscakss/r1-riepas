'use client';

import { useState } from 'react';
import { post } from '@/client/api';
import { useToast } from '@/client/toast';
import { MIN_PW } from '@/domain/users';
import { Field, PasswordField } from '../ui/Field';
import { FormDialog } from '../ui/FormDialog';

export function ChangePasswordDialog({ done }: { done: (v: undefined) => void }) {
  const toast = useToast();
  const [oldp, setOld] = useState('');
  const [newp, setNew] = useState('');
  return (
    <FormDialog title="Mainīt savu paroli" onCancel={() => done(undefined)} onSubmit={async () => {
      if (!oldp || !newp) return 'Aizpildi abus laukus';
      if (newp.length < MIN_PW) return `Jaunajai parolei jābūt vismaz ${MIN_PW} rakstzīmes`;
      await post('/api/change-password', { currentPassword: oldp, newPassword: newp });
      toast('Parole nomainīta');
      done(undefined);
    }}>
      <Field label="Pašreizējā parole"><input type="password" className="input" value={oldp} onChange={(e) => setOld(e.target.value)} autoComplete="current-password" /></Field>
      <Field label="Jaunā parole"><PasswordField value={newp} onChange={setNew} /></Field>
    </FormDialog>
  );
}
