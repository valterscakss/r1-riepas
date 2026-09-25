import { requireScreen } from '@/server/session';
import { SpotsScreen } from '@/components/screens/Spots';

export const metadata = { title: 'Novietnes — R1 Tires' };

export default async function Page() {
  await requireScreen('spots');
  return <SpotsScreen />;
}
