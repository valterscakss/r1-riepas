import { requireScreen } from '@/server/session';
import { PendingScreen } from '@/components/screens/Pending';

export const metadata = { title: 'Sagatavotie — R1 Tires' };

export default async function Page() {
  await requireScreen('pending');
  return <PendingScreen />;
}
