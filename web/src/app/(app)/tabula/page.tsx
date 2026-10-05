import { requireScreen } from '@/server/session';
import { TableScreen } from '@/components/screens/Table';

export const metadata = { title: 'Tabula — R1 Tires' };

export default async function Page() {
  await requireScreen('table');
  return <TableScreen />;
}
