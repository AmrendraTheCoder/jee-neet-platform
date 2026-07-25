import type { MarkingRule } from '@platform/domain';
import type { ReviewOutcome } from '../../lib/api/types.js';
import { formatMarks } from '../../lib/format.js';
import { Pill } from '../../components/ui/Feedback.js';
import { explainMarking } from './explainMarking.js';
import './review.css';

const STATUS_TONE = {
  CORRECT: 'success',
  PARTIALLY_CORRECT: 'warning',
  INCORRECT: 'danger',
  UNATTEMPTED: 'neutral',
  DROPPED: 'info',
  UNPARSEABLE: 'danger',
} as const;

/**
 * The marks breakdown (FR-SCR-18).
 *
 * This is the headline differentiator of the product, so it is deliberately
 * the most prominent element on a reviewed question rather than a footnote.
 * A candidate who lost a mark should never have to work out why.
 *
 * Every number here comes from the server (FR-SCR-17). The scheme beneath it
 * is rendered from the marking rule as data, so a partial-credit ladder is
 * explained as the ladder it actually is.
 */
export function MarksBreakdown(props: {
  readonly outcome: ReviewOutcome;
  readonly marking: MarkingRule;
}): JSX.Element {
  const explanation = explainMarking({
    rule: props.marking,
    status: props.outcome.status,
    marks: props.outcome.marks,
  });

  return (
    <section className={`marks marks--${STATUS_TONE[props.outcome.status]}`}>
      <div className="marks__head">
        <span className="marks__value mono">{formatMarks(props.outcome.marks)}</span>
        <div className="marks__headline">
          <Pill tone={STATUS_TONE[props.outcome.status]}>{explanation.headline}</Pill>
          {/* The server's own justification for this mark, produced by the
              same engine that computed it. Shown verbatim so the explanation
              and the number can never disagree. */}
          <p className="marks__server-note">{props.outcome.explanation}</p>
        </div>
      </div>

      <details className="marks__scheme">
        <summary>How this question was marked</summary>
        <ul>
          {explanation.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        <p className="subtle">
          Answer key version {props.outcome.answerKeyVersion}. If this key is ever revised, your
          result is recomputed and you are told exactly what changed.
        </p>
      </details>
    </section>
  );
}
