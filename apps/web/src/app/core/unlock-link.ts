/**
 * Links that open a team with a password without typing it: `…#unlock=<teamId>.<key>`. The key is in the fragment,
 * so it never reaches a server log or a Referer. It's read once at start-up, kept for this tab only, and taken out
 * of the address bar right away, so bookmarking or reloading the page doesn't keep it; a page opened by hand asks
 * for the password as usual. The key itself is signed by the server for the current password, not the password.
 */

const STORE = 'rb-unlock-links';

function read(): Record<string, string> {
  try { return JSON.parse(sessionStorage.getItem(STORE) ?? '{}') as Record<string, string>; } catch { return {}; }
}
function write(keys: Record<string, string>) {
  try { sessionStorage.setItem(STORE, JSON.stringify(keys)); } catch { /* storage off: the prompt asks instead */ }
}

/** Run before the app starts (and its sign-in redirects), so the key survives a trip through the login page. */
export function captureUnlockLink() {
  const m = /(?:^#|&)unlock=([\w-]+)\.(\d+\.[\w-]+)/.exec(location.hash);
  if (!m) return;
  write({ ...read(), [m[1]]: m[2] });
  const rest = location.hash.replace(/(?:^#|&)unlock=[^&]*/, '').replace(/^&/, '');
  history.replaceState(history.state, '', location.pathname + location.search + (rest ? '#' + rest : ''));
}

/** The key a link brought for this team, used once. */
export function takeUnlockKey(teamId: string): string | null {
  const keys = read();
  const key = keys[teamId] ?? null;
  if (key) { delete keys[teamId]; write(keys); }
  return key;
}

/** The link to send: `path` on this site, opening the team without its password. */
export function unlockLink(base: string, path: string, teamId: string, key: string): string {
  return `${base}${path}#unlock=${teamId}.${key}`;
}
