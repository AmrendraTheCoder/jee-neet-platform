import { useCallback, useEffect, useState } from 'react';
import type { AttemptId, TestId } from '@platform/domain';
import { useApi } from '../../lib/api/context.js';
import type { AttemptSnapshot } from '../../lib/api/types.js';
import { useNavigationGuard, useRouter } from '../../lib/router.js';
import { monotonicNow } from '../../lib/time/monotonic.js';
import { MathScope } from '../../components/math/MathScope.js';
import { Button } from '../../components/ui/Button.js';
import { Callout } from '../../components/ui/Feedback.js';
import { AttemptPlayer } from './AttemptPlayer.js';
import { AttemptProvider, useAttemptState } from './context.js';
import { InstructionsScreen } from './InstructionsScreen.js';
import { PrefetchGate } from './PrefetchGate.js';
import { AttemptController } from './store/controller.js';
import './attempt.css';

type Phase =
  | { readonly kind: 'LOADING' }
  | { readonly kind: 'ERROR'; readonly message: string }
  | { readonly kind: 'PREFETCH'; readonly controller: AttemptController }
  | { readonly kind: 'INSTRUCTIONS'; readonly controller: AttemptController }
  | { readonly kind: 'RUNNING'; readonly controller: AttemptController };

/**
 * Owns the attempt lifecycle on the client.
 *
 * The order is deliberate and is the requirement's order: start or resume,
 * THEN prefetch every asset with determinate progress (FR-ATT-14), THEN the
 * instructions screen, THEN the paper. A candidate never meets a loading state
 * once the clock is theirs to spend.
 *
 * There is exactly ONE `MathScope` for the whole attempt — the player, the
 * question paper view and the instructions all render through it (FR-MTH-05).
 */
export function AttemptRoute(props: {
  readonly testId: TestId | null;
  readonly attemptId: AttemptId | null;
}): JSX.Element {
  const api = useApi();
  const [phase, setPhase] = useState<Phase>({ kind: 'LOADING' });

  useEffect(() => {
    let disposed = false;
    let created: AttemptController | null = null;

    const open = async (): Promise<void> => {
      const requestStartedMonotonicMs = monotonicNow();
      let snapshot: AttemptSnapshot;
      try {
        snapshot =
          props.attemptId !== null
            ? await api.getAttempt(props.attemptId)
            : props.testId !== null
              ? await api.startAttempt({
                  testId: props.testId,
                  // Stable per test per browser: a double-tap or a retry whose
                  // response was lost must return the SAME attempt, never a
                  // second one (FR-ATT-13).
                  idempotencyKey: idempotencyKeyFor(props.testId),
                })
              : (() => {
                  throw new Error('no test or attempt identified');
                })();
      } catch (error) {
        if (!disposed) {
          setPhase({
            kind: 'ERROR',
            message: error instanceof Error ? error.message : 'This paper could not be opened.',
          });
        }
        return;
      }

      const controller = await AttemptController.open({
        api,
        snapshot,
        requestStartedMonotonicMs,
      });
      created = controller;

      if (disposed) {
        controller.dispose();
        return;
      }
      setPhase({ kind: 'PREFETCH', controller });
    };

    void open();
    return () => {
      disposed = true;
      created?.dispose();
    };
  }, [api, props.attemptId, props.testId]);

  if (phase.kind === 'LOADING') {
    return <p className="load-state">Opening your paper.</p>;
  }

  if (phase.kind === 'ERROR') {
    return (
      <div className="centered-page">
        <Callout tone="danger" title="This paper could not be opened">
          {phase.message} If a live test is running, contact your invigilator now rather than
          reloading repeatedly.
        </Callout>
      </div>
    );
  }

  return (
    <MathScope>
      <AttemptProvider controller={phase.controller}>
        {phase.kind === 'PREFETCH' ? (
          <PrefetchGate
            assets={phase.controller.store.getState().snapshot.assets}
            onReady={() => setPhase({ kind: 'INSTRUCTIONS', controller: phase.controller })}
          />
        ) : phase.kind === 'INSTRUCTIONS' ? (
          <InstructionsScreen
            onClose={null}
            onBegin={() => {
              phase.controller.beginPaper();
              setPhase({ kind: 'RUNNING', controller: phase.controller });
            }}
          />
        ) : (
          <RunningAttempt />
        )}
      </AttemptProvider>
    </MathScope>
  );
}

/**
 * The running paper, plus the two terminal states.
 *
 * A submitted attempt does not render the player at all. Leaving the player
 * mounted after submission is how a stale draft becomes a post-deadline write
 * attempt, which the server rejects (FR-SYN-06) but which should never be sent.
 */
function RunningAttempt(): JSX.Element {
  const status = useAttemptState((s) => s.status);
  const attemptId = useAttemptState((s) => s.snapshot.attemptId);
  const { navigate } = useRouter();

  // Guard in-app navigation while the paper is live. The deadline does not
  // stop for a misclick (FR-ATT-09).
  const guard = useCallback(
    (to: string) => {
      if (status !== 'IN_PROGRESS') return true;
      return window.confirm(
        'Your paper is still running and the clock does not stop. Leave this page?',
      );
    },
    [status],
  );
  useNavigationGuard(guard);

  if (status === 'SUBMITTED' || status === 'EXPIRED') {
    return (
      <div className="centered-page stack">
        <h1>Your paper has been submitted</h1>
        <Callout tone="success" title="Answers received">
          Your result is being computed. You will be able to review every question, in the
          order you saw it, once scoring completes.
        </Callout>
        <div className="row">
          <Button
            size="lg"
            onClick={() => navigate(`/attempt/${encodeURIComponent(String(attemptId))}/review`)}
          >
            Go to my result
          </Button>
        </div>
      </div>
    );
  }

  if (status === 'SUPERSEDED') {
    return (
      <div className="centered-page">
        <Callout tone="warning" title="This paper is open on another device">
          You resumed this attempt elsewhere, so this session is now read-only. Continue on the
          device where you resumed.
        </Callout>
      </div>
    );
  }

  if (status === 'ABANDONED') {
    return (
      <div className="centered-page">
        <Callout tone="neutral" title="Attempt abandoned">
          This attempt was abandoned and will not be scored or ranked. It has not used your
          ranked attempt for this test.
        </Callout>
      </div>
    );
  }

  return <AttemptPlayer />;
}

/**
 * Idempotency key for attempt start.
 *
 * Persisted in `localStorage` rather than generated per render, because the
 * failure it defends against is precisely the one where the client retries: a
 * fresh key on retry creates a second attempt, and the partial unique index on
 * `(user_id, test_id) WHERE status = 'in_progress'` then rejects it as an
 * error the candidate sees (FR-ATT-13).
 */
function idempotencyKeyFor(testId: TestId): string {
  const storageKey = `attempt-start:${String(testId)}`;
  const existing = window.localStorage.getItem(storageKey);
  if (existing !== null) return existing;
  const key = crypto.randomUUID();
  window.localStorage.setItem(storageKey, key);
  return key;
}
