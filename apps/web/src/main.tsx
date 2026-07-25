import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { RouterProvider } from './lib/router.js';
import { ApiProvider } from './lib/api/context.js';
import { SessionProvider, sessionFromAccessToken } from './lib/auth/session.js';
import { createHttpApiClient } from './lib/api/http.js';
import { getAccessToken, provideAccessToken, setAccessToken } from './lib/auth/tokenStore.js';
import './styles/base.css';

/**
 * Entry point.
 *
 * Three things are decided here and nowhere else: where the API is, where the
 * token comes from, and what happens when it is rejected.
 *
 * The base URL is read from the build-time environment rather than derived from
 * `window.location`. Deriving it would mean a preview deployment, an origin
 * with a stale DNS record, or a page opened from a cached HTML file could point
 * a live examination client at the wrong backend, and the failure would look
 * like a network problem rather than a misconfiguration.
 *
 * Only `VITE_`-prefixed variables reach this bundle, which is the mechanism
 * that keeps a service-role key from being inlined into client JavaScript
 * (NFR-SEC-04). Nothing privileged is read here, and `scripts/scan-secrets.mjs`
 * scans the built bundle to keep it that way.
 */

const baseUrl = import.meta.env['VITE_API_BASE_URL'] ?? '/api';

const api = createHttpApiClient({
  baseUrl,
  getToken: provideAccessToken,
  onUnauthorized: () => {
    // Drop the dead token so nothing retries with it, then hand off to the
    // portal. `replace` rather than `assign`: a candidate pressing Back after
    // being signed out should not land on a player that cannot load a paper.
    setAccessToken(null);
    window.location.replace('/signin');
  },
});

// Decoded for presentation only — which navigation to draw, which name to
// show. The signature is not verified here and is not meant to be; every
// request is authorised at the API boundary, and every destructive capability
// is re-checked server-side against the live role table (FR-IDN-10).
const token = getAccessToken();
const session = token === null ? null : sessionFromAccessToken(token);

const container = document.getElementById('root');
if (container === null) throw new Error('#root missing from index.html');

createRoot(container).render(
  <StrictMode>
    <ApiProvider client={api}>
      <SessionProvider session={session}>
        <RouterProvider>
          <App />
        </RouterProvider>
      </SessionProvider>
    </ApiProvider>
  </StrictMode>,
);
