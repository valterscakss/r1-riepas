import { requireScreen } from '@/server/session';
import { SettingsScreen } from '@/components/screens/Settings';

export const metadata = { title: 'Iestatījumi — R1 Tires' };

export default async function Page() {
  await requireScreen('settings');
  return <SettingsScreen />;
}
