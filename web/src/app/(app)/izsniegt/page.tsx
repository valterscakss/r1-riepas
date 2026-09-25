import { requireScreen } from '@/server/session';
import { ReleaseScreen } from '@/components/screens/Release';

export const metadata = { title: 'Izsniegt glabāšanu — R1 Tires' };

export default async function Page() {
  await requireScreen('release');
  return <ReleaseScreen />;
}
