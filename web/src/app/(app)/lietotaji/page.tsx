import { requireScreen } from '@/server/session';
import { UsersScreen } from '@/components/screens/Users';

export const metadata = { title: 'Lietotāji — R1 Tires' };

export default async function Page() {
  await requireScreen('users');
  return <UsersScreen />;
}
