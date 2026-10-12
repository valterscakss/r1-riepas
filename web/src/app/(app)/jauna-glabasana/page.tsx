import { requireScreen } from '@/server/session';
import { IntakeScreen } from '@/components/screens/Intake';

export const metadata = { title: 'Jauna glabāšana — R1 Tires' };

export default async function Page({ searchParams }: { searchParams: Promise<{ plate?: string; spot?: string; swap?: string }> }) {
  await requireScreen('intake');
  const { plate, spot, swap } = await searchParams;
  // A new key per prefill: arriving from a release or a swap always starts a clean form.
  return <IntakeScreen key={`${plate ?? ''}|${spot ?? ''}|${swap ?? ''}`} initial={{ plate, spot, swap }} />;
}
