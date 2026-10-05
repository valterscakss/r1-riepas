import { redirect } from 'next/navigation';
import { pageSession } from '@/server/session';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Pieteikšanās — R1 Tires' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Only same-site paths: never bounce a user to another origin after login.
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  if (await pageSession()) redirect(target);
  return <LoginForm next={target} />;
}
