import { useCallback, useEffect, useState } from 'react';
import type { AttemptId } from '@platform/domain';
import { useApi } from '../../lib/api/context.js';
import type { PersistedResponse, ReviewResult, ReviewSnapshot } from '../../lib/api/types.js';
import { MathScope } from '../../components/math/MathScope.js';
import { Callout, EmptyState, ProgressBar } from '../../components/ui/Feedback.js';
import { ReviewQuestion } from './ReviewQuestion.js';
import { ScoreSummary } from './ScoreSummary.js';
import './review.css';

/**
 * The result and review screen.
 *
 * ONE `MathScope` for the whole screen, shared by every question on it
 * (FR-MTH-05) — a 180-question review is the other place a renderer per row
 * would be tempting.
 *
 * While scoring runs the screen shows a determinate wait with a real estimate
 * (FR-SCR-04). A bare indefinite spinner on the number a candidate cares most
 * about is the specific thing that requirement forbids.
 */
export function ReviewRoute(props: { readonly attemptId: AttemptId }): JSX.Element {
  const api = useApi();
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const poll = async (): Promise<void> => {
      try {
        const next = await api.getReview(props.attemptId);
        if (cancelled) return;
        setResult(next);
        if (next.state === 'PENDING') {
          // Polled, not subscribed. Realtime is never load-bearing here
          // (invariant 8): the result must arrive with realtime disabled.
          timer = window.setTimeout(() => void poll(), 5_000);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'This result could not be loaded.');
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [api, props.attemptId]);

  const onReport = useCallback(
    (questionVersionId: string, detail: string) => {
      void api
        .reportQuestion({
          attemptId: props.attemptId,
          questionVersionId,
          reason: detail,
          category: 'OTHER',
        })
        .catch(() => undefined);
    },
    [api, props.attemptId],
  );

  const onChallenge = useCallback(
    (questionVersionId: string) => {
      const reason = window.prompt(
        'Tell us why you believe the published answer is wrong. A written reason is required.',
      );
      if (reason === null || reason.trim().length < 10) return;
      void api
        .reportQuestion({
          attemptId: props.attemptId,
          questionVersionId,
          reason: reason.trim(),
          category: 'WRONG_KEY',
        })
        .catch(() => undefined);
    },
    [api, props.attemptId],
  );

  if (error !== null) {
    return (
      <div className="centered-page">
        <Callout tone="danger" title="Result unavailable">
          {error}
        </Callout>
      </div>
    );
  }

  if (result === null) return <p className="load-state">Loading your result.</p>;

  if (result.state === 'PENDING') {
    return (
      <div className="centered-page stack">
        <h1>Your score is being computed</h1>
        <ProgressBar
          label="Scoring"
          value={result.etaSeconds === null ? 0 : Math.max(0, 60 - result.etaSeconds)}
          max={60}
          detail={
            result.etaSeconds === null
              ? 'This normally takes under a minute. This page updates itself.'
              : `About ${result.etaSeconds} seconds remaining. This page updates itself.`
          }
        />
        <p className="muted">
          Your answers are safely recorded. Nothing further is needed from you.
        </p>
      </div>
    );
  }

  return (
    <MathScope>
      <ReviewBody review={result} onReport={onReport} onChallenge={onChallenge} />
    </MathScope>
  );
}

function ReviewBody(props: {
  readonly review: ReviewSnapshot;
  readonly onReport: (questionVersionId: string, detail: string) => void;
  readonly onChallenge: (questionVersionId: string) => void;
}): JSX.Element {
  const { review } = props;
  const responses = new Map<string, PersistedResponse>(
    review.attempt.responses.map((r) => [String(r.questionVersionId), r]),
  );
  const outcomes = new Map(review.outcomes.map((o) => [String(o.questionVersionId), o]));

  return (
    <div className="centered-page stack review">
      <header className="stack">
        <h1>{review.attempt.testTitle}</h1>
        <p className="muted">
          Every question below is shown exactly as it appeared in your paper, in the same order,
          with the options in the same positions.
        </p>
      </header>

      <ScoreSummary review={review} />

      <h2>Question by question</h2>

      {review.attempt.questions.length === 0 ? (
        <EmptyState
          title="No questions to review"
          body="This attempt recorded no questions. If that is unexpected, contact support and quote your attempt reference."
        />
      ) : (
        review.attempt.questions.map((question, index) => {
          const outcome = outcomes.get(String(question.questionVersionId));
          if (outcome === undefined) return null;
          return (
            <ReviewQuestion
              key={String(question.questionVersionId)}
              index={index + 1}
              question={question}
              outcome={outcome}
              response={responses.get(String(question.questionVersionId))}
              onReport={props.onReport}
              onChallenge={props.onChallenge}
            />
          );
        })
      )}
    </div>
  );
}
