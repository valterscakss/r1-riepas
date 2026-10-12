// The shop this browser works in. The server checks the id against what the user
// may open and falls back to the first allowed branch, so a stale or tampered value
// can never widen access — it only picks among the user's own branches.
const KEY = 'r1_branch';

export function getBranch(): string {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
}

export function setBranch(id: string): void {
  try { localStorage.setItem(KEY, id); } catch { /* storage blocked: the server falls back to the first branch */ }
}
