/** A failed API call with the server's user-facing message. */
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let redirecting = false;
function toLogin() {
  if (redirecting || typeof window === 'undefined') return;
  redirecting = true;
  const next = window.location.pathname + window.location.search;
  // Outside React (called from any fetch), so no router here; a full load also clears the cache.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

/**
 * fetch for our own API: the session travels in the httpOnly cookie, a 401 sends
 * the user back to the login screen, and a non-2xx becomes an ApiError carrying
 * the server's message.
 */
export async function api<T = unknown>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set('content-type', 'application/json');
  const res = await fetch(url, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body, credentials: 'same-origin', cache: 'no-store' });
  if (res.status === 401 && !url.startsWith('/api/login')) { toLogin(); throw new ApiError(401, 'Sesija beigusies'); }
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError(res.status, (data as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`);
  return data as T;
}

export const post = <T = unknown>(url: string, json: unknown = {}) => api<T>(url, { method: 'POST', json });
export const patch = <T = unknown>(url: string, json: unknown) => api<T>(url, { method: 'PATCH', json });
export const put = <T = unknown>(url: string, json: unknown) => api<T>(url, { method: 'PUT', json });
export const del = <T = unknown>(url: string) => api<T>(url, { method: 'DELETE' });
export const enc = encodeURIComponent;

/** Download a server-built file (Excel export) and hand it to the browser. */
export async function download(url: string, fallbackName: string): Promise<void> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 401) { toLogin(); throw new ApiError(401, 'Sesija beigusies'); }
  if (!res.ok) {
    const d = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new ApiError(res.status, d?.error?.message ?? 'Neizdevās izveidot failu');
  }
  const blob = await res.blob();
  const name = (res.headers.get('content-disposition') ?? '').match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

export const errMsg = (e: unknown, fallback = 'Kaut kas nogāja greizi') =>
  e instanceof Error && e.message ? e.message : fallback;
