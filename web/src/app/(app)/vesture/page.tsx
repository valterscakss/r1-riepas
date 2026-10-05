import { requireScreen } from '@/server/session';
import { HistoryScreen } from '@/components/screens/History';

export const metadata = { title: 'Vēsture — R1 Tires' };

export default async function Page() {
  await requireScreen('history');
  return <HistoryScreen />;
}
