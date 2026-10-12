import { requireScreen } from '@/server/session';
import { AnalyticsScreen } from '@/components/screens/Analytics';

export const metadata = { title: 'Analītika — R1 Tires' };

export default async function Page() {
  await requireScreen('analytics');
  return <AnalyticsScreen />;
}
