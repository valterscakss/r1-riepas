import { requireScreen } from '@/server/session';
import { HomeScreen } from '@/components/screens/Home';

export const metadata = { title: 'Sākums — R1 Tires' };

export default async function Page() {
  await requireScreen('home');
  return <HomeScreen />;
}
