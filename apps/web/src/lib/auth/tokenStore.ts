/**
 * Where the access token lives in the browser.
 *
 * `sessionStorage`, not `localStorage`, and the choice is not incidental. A
 * meaningful share of candidates sit mocks on a shared machine — a school lab,
 * a coaching centre, a cybercafe. `localStorage` survives the tab closing, so
 * the next person to open the browser inherits the previous candidate's
 * session, their attempts and their results. `sessionStorage` is scoped to the
 * tab and dies with it.
 *
 * The token is never read from a cookie and never sent as one: every request
 * from this client goes out with `credentials: 'omit'` and an explicit bearer
 * header, so there is no ambient authority for a cross-site request to borrow.
 *
 * What this module deliberately does NOT do is refresh. Refresh is
 * single-flighted server-side (FR-ATT-17) because two concurrent refreshes with
 * the same rotating token look like a stolen token and revoke the whole
 * session — which, mid-paper, logs a candidate out of a live examination. The
 * sign-in surface owns that flow and calls `setAccessToken` when it completes;
 * this module only holds the result.
 */

const STORAGE_KEY = 'platform.accessToken';

let cached: string | null = null;
let loaded = false;

function read(): string | null {
  if (loaded) return cached;
  loaded = true;
  try {
    cached = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Private-mode Safari and locked-down enterprise profiles throw on access
    // rather than returning null. An in-memory token still works for the life
    // of the tab, which is the only lifetime that matters here.
    cached = null;
  }
  return cached;
}

export function getAccessToken(): string | null {
  return read();
}

export function setAccessToken(token: string | null): void {
  cached = token;
  loaded = true;
  try {
    if (token === null) window.sessionStorage.removeItem(STORAGE_KEY);
    else window.sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Held in memory only. See above.
  }
}

/** The shape `createHttpApiClient` expects. Async because refresh may land here later. */
export async function provideAccessToken(): Promise<string | null> {
  return read();
}
