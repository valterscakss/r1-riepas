import { requireScreen } from '@/server/session';
import { WarehouseScreen } from '@/components/screens/Warehouse';

export const metadata = { title: 'Noliktava — R1 Tires' };

export default async function Page() {
  await requireScreen('warehouse');
  return <WarehouseScreen />;
}
