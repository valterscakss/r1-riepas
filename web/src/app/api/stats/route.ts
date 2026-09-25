import { api } from '@/server/http';
import { statsView } from '@/domain/spots';
import { todayIso } from '@/domain/format';
import { loadUniverse } from '@/server/services';

/** Dashboard numbers and the spot map. */
export const GET = api({ any: ['screen.home', 'screen.spots', 'screen.intake'] }, async ({ perms }) =>
  statsView(await loadUniverse(), perms, todayIso()));
