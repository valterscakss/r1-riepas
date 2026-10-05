import { api } from '@/server/http';

export const GET = api('user', async ({ user, perms }) => ({ user, perms }));
