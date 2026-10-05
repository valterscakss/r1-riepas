import { api } from '@/server/http';
import { listBranches } from '@/server/repo/misc';

/** Every branch, active or not (admin screen). */
export const GET = api('admin', async () => ({ branches: await listBranches() }));
