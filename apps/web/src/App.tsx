import { useEffect, useState } from 'react';
import { asAttemptId, asTestId } from '@platform/domain';
import { ErrorBoundary } from './lib/ErrorBoundary.js';
import { Link, useRouteMatch, useRouter } from './lib/router.js';
import { useSession } from './lib/auth/session.js';
import { useApi } from './lib/api/context.js';
import type { AdminBootstrap } from './lib/api/types.js';
import { AttemptRoute } from './features/attempt/AttemptRoute.js';
import { ReviewRoute } from './features/review/ReviewRoute.js';
import { ItemAuthoring } from './features/admin/items/ItemAuthoring.js';
import { ReviewQueue } from './features/admin/queue/ReviewQueue.js';
import { Button } from './components/ui/Button.js';
import { Callout, EmptyState } from './components/ui/Feedback.js';
import './features/admin/admin.css';

/**
 * The route tree.
 *
 * Two surfaces share this bundle: the examination player and the admin console.
 * They are kept in one app because they share the maths renderer, the design
 * tokens and the API client, and splitting them would duplicate all three.
 *
 * The attempt player renders WITHOUT the surrounding chrome. That is not a
 * layout preference — FR-ATT-09 says a ranked attempt cannot be paused, and a
 * navigation bar offering "Admin" and "Sign out" next to a running clock is an
 * invitation to lose a paper by misclick. The player owns the whole viewport
 * and the only way out is the submit dialog or the browser's own controls,
 * which the in-app navigation guard cannot and should not intercept.
 */

function Chrome(props: { readonly children: React.ReactNode }): JSX.Element {
  const session = useSession();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <Link to="/" className="app-header__brand">
          Assessment Platform
        </Link>
        <div className="spacer" />
        {session?.capabilities.has('questions.write') === true ? (
          <Link to="/admin">Admin</Link>
        ) : null}
        {session === null ? null : <span className="subtle">{session.displayName}</span>}
      </header>
      <main id="main" className="centered-page">
        {props.children}
      </main>
    </div>
  );
}

function Home(): JSX.Element {
  const session = useSession();

  if (session === null) {
    return (
      <Chrome>
        <Callout tone="info" title="Not signed in">
          This client requires an authenticated session. Sign in from the
          organisation portal; the examination player will open from the test
          link you were given.
        </Callout>
      </Chrome>
    );
  }

  return (
    <Chrome>
      <div className="stack">
        <h1>Welcome back</h1>
        <p className="muted">
          Open a test from your organisation portal to begin. A ranked mock runs
          full screen and cannot be paused once started.
        </p>
        <EmptyState
          title="No test open"
          body="Scheduled tests appear here once your organisation publishes them."
        />
      </div>
    </Chrome>
  );
}

function AdminRoute(): JSX.Element {
  const api = useApi();
  const session = useSession();
  const [bootstrap, setBootstrap] = useState<AdminBootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'authoring' | 'queue'>('authoring');

  useEffect(() => {
    let cancelled = false;
    api
      .getAdminBootstrap()
      .then((next) => {
        if (!cancelled) setBootstrap(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Presentation only. The server re-verifies every capability inside the RPC
  // against the live role table (FR-IDN-10), so this gate hides a console it
  // does not protect.
  if (session !== null && !session.capabilities.has('questions.write')) {
    return (
      <Chrome>
        <Callout tone="warning" title="Not available">
          This account does not hold the authoring capability.
        </Callout>
      </Chrome>
    );
  }

  if (error !== null) {
    return (
      <Chrome>
        <Callout tone="danger" title="Could not load the console">
          {error}
        </Callout>
      </Chrome>
    );
  }

  if (bootstrap === null) {
    return (
      <Chrome>
        <div className="load-state">Loading the console…</div>
      </Chrome>
    );
  }

  return (
    <Chrome>
      <div className="stack">
        <div className="row" role="tablist" aria-label="Console sections">
          <Button
            variant={tab === 'authoring' ? 'primary' : 'quiet'}
            role="tab"
            aria-selected={tab === 'authoring'}
            onClick={() => setTab('authoring')}
          >
            Authoring
          </Button>
          <Button
            variant={tab === 'queue' ? 'primary' : 'quiet'}
            role="tab"
            aria-selected={tab === 'queue'}
            onClick={() => setTab('queue')}
          >
            Review queue
          </Button>
        </div>
        {tab === 'authoring' ? (
          <ItemAuthoring items={bootstrap.items} currentUserId={bootstrap.currentUserId} />
        ) : (
          <ReviewQueue items={bootstrap.items} currentUserId={bootstrap.currentUserId} />
        )}
      </div>
    </Chrome>
  );
}

function NotFound(): JSX.Element {
  return (
    <Chrome>
      <EmptyState title="Not found" body="That address does not match anything here." />
    </Chrome>
  );
}

export function App(): JSX.Element {
  const { location } = useRouter();

  const review = useRouteMatch('/attempt/:attemptId/review');
  const attempt = useRouteMatch('/attempt/:attemptId');
  const start = useRouteMatch('/test/:testId/start');
  const admin = useRouteMatch('/admin');
  const home = useRouteMatch('/');

  // Resetting on `location` means a route that threw does not keep the next
  // route from rendering. The player installs its own, tighter boundaries per
  // question (FR-MTH-03), so a single bad item never reaches this one.
  return (
    <ErrorBoundary
      resetKey={location}
      fallback={(error, reset) => (
        <Chrome>
          <div className="stack">
            <Callout tone="danger" title="Something went wrong">
              {error.message}
            </Callout>
            <div className="row">
              <Button onClick={reset}>Try again</Button>
            </div>
          </div>
        </Chrome>
      )}
    >
      {review !== null && review.params['attemptId'] !== undefined ? (
        <ReviewRoute attemptId={asAttemptId(review.params['attemptId'])} />
      ) : attempt !== null && attempt.params['attemptId'] !== undefined ? (
        <AttemptRoute attemptId={asAttemptId(attempt.params['attemptId'])} testId={null} />
      ) : start !== null && start.params['testId'] !== undefined ? (
        <AttemptRoute attemptId={null} testId={asTestId(start.params['testId'])} />
      ) : admin !== null ? (
        <AdminRoute />
      ) : home !== null ? (
        <Home />
      ) : (
        <NotFound />
      )}
    </ErrorBoundary>
  );
}
