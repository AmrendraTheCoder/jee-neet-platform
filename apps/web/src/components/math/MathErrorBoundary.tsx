import { useState } from 'react';
import type { ReactNode } from 'react';
import { ErrorBoundary } from '../../lib/ErrorBoundary.js';
import { Button } from '../ui/Button.js';
import './math.css';

export interface MathErrorBoundaryProps {
  readonly children: ReactNode;
  /** The raw LaTeX or HTML source, shown verbatim on failure (FR-MTH-03). */
  readonly source: string;
  readonly questionVersionId: string;
  /** Auto-creates an incident. Never blocks the render path. */
  readonly onReport: (questionVersionId: string, detail: string) => void;
}

/**
 * Per-question render boundary (FR-MTH-03).
 *
 * The requirement is precise about what happens on failure, and each clause is
 * there because of a specific bad outcome:
 *
 *   - the boundary is PER QUESTION, so one malformed item cannot crash an
 *     attempt that has two hours left on an immovable deadline;
 *   - the RAW SOURCE is shown in monospace, because a candidate who can read
 *     `\frac{3}{4}` can still answer the question, and a blank box guarantees
 *     they cannot;
 *   - a REPORT action is offered and an incident is created automatically, so
 *     the failure reaches the moderation queue (FR-ADM-14) without depending
 *     on the candidate to act during a timed paper.
 */
export function MathErrorBoundary(props: MathErrorBoundaryProps): JSX.Element {
  return (
    <ErrorBoundary
      resetKey={props.questionVersionId}
      onError={(error) => props.onReport(props.questionVersionId, error.message)}
      fallback={(error) => (
        <MathFallback
          error={error}
          source={props.source}
          questionVersionId={props.questionVersionId}
          onReport={props.onReport}
        />
      )}
    >
      {props.children}
    </ErrorBoundary>
  );
}

function MathFallback(props: {
  readonly error: Error;
  readonly source: string;
  readonly questionVersionId: string;
  readonly onReport: (questionVersionId: string, detail: string) => void;
}): JSX.Element {
  const [reported, setReported] = useState(false);

  return (
    <div className="math-fallback" role="group" aria-label="Question could not be formatted">
      <p className="math-fallback__notice">
        This question could not be formatted for display. Its original text is shown below
        exactly as it was written. You can still answer it.
      </p>
      <pre className="math-fallback__source">{props.source}</pre>
      <div className="row">
        <Button
          variant="secondary"
          disabled={reported}
          onClick={() => {
            props.onReport(props.questionVersionId, props.error.message);
            setReported(true);
          }}
        >
          {reported ? 'Reported' : 'Report this question'}
        </Button>
        <span className="subtle">
          {reported
            ? 'Thank you. This has been sent to the content team and does not affect your marks.'
            : 'A report has already been logged automatically. You can add to it.'}
        </span>
      </div>
    </div>
  );
}
