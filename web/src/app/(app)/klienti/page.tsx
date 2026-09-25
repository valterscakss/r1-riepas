import { requireScreen } from '@/server/session';
import { CustomersScreen } from '@/components/screens/Customers';

export const metadata = { title: 'Klienti — R1 Tires' };

export default async function Page() {
  await requireScreen('customers');
  return <CustomersScreen />;
}
