import { requireScreen } from '@/server/session';
import { HelpScreen } from '@/components/screens/Help';

export const metadata = { title: 'Instrukcija — R1 Tires' };

export default async function Page() {
  await requireScreen('help');
  return <HelpScreen />;
}
