import { paletteStateFor } from '@platform/domain';
import type { AttemptQuestion, PersistedResponse, ReviewOutcome } from '../../lib/api/types.js';
import { MathErrorBoundary } from '../../components/math/MathErrorBoundary.js';
import { PrerenderedMath } from '../../components/math/PrerenderedMath.js';
import { Button } from '../../components/ui/Button.js';
import { Pill } from '../../components/ui/Feedback.js';
import { STATE_LABEL } from '../attempt/Palette.js';
import { MarksBreakdown } from './MarksBreakdown.js';
import './review.css';

/**
 * One reviewed question.
 *
 * Rendered from the PINNED ATTEMPT SNAPSHOT — the same question bodies and the
 * same persisted option order the candidate saw (FR-SCR-17, AC-ATT-05, and the
 * edge case about review rendering from live item rows). Reading from live
 * items would show a candidate a question they did not sit whenever an item
 * has been corrected since, and would renumber the options under a shuffle,
 * making their own answer look like a different one.
 *
 * The option letters are derived from the persisted order for display only.
 * Correctness is matched on option UUID (FR-ITM-03).
 */
export function ReviewQuestion(props: {
  readonly index: number;
  readonly question: AttemptQuestion;
  readonly outcome: ReviewOutcome;
  readonly response: PersistedResponse | undefined;
  readonly onReport: (questionVersionId: string, detail: string) => void;
  readonly onChallenge: (questionVersionId: string) => void;
}): JSX.Element {
  const { question, outcome, response } = props;
  const selected = new Set((response?.selectedOptionIds ?? []).map(String));
  const correct = new Set(outcome.correctOptionIds.map(String));
  const paletteState = paletteStateFor(response);

  return (
    <article className="review-question" id={`q-${props.index}`}>
      <header className="review-question__head">
        <h3>Question {props.index}</h3>
        <Pill>{STATE_LABEL[paletteState]}</Pill>
        {response !== undefined && response.timeSpentMs > 0 ? (
          <Pill
            tone={
              outcome.cohortMedianTimeMs !== null &&
              response.timeSpentMs > outcome.cohortMedianTimeMs * 1.5
                ? 'warning'
                : 'neutral'
            }
            title="Time with this question on screen. Rough work done on paper is not counted."
          >
            {Math.round(response.timeSpentMs / 1000)}s on screen
            {outcome.cohortMedianTimeMs === null
              ? ''
              : ` · median ${Math.round(outcome.cohortMedianTimeMs / 1000)}s`}
          </Pill>
        ) : null}
      </header>

      <MarksBreakdown outcome={outcome} marking={question.marking} />

      <MathErrorBoundary
        questionVersionId={String(question.questionVersionId)}
        source={question.spokenText}
        onReport={props.onReport}
      >
        {question.stimulusHtml === null ? null : (
          <PrerenderedMath html={question.stimulusHtml} />
        )}
        <PrerenderedMath html={question.bodyHtml} spokenText={question.spokenText} />
      </MathErrorBoundary>

      {question.options.length > 0 ? (
        <ol className="review-options">
          {question.options.map((option, index) => {
            const id = String(option.optionId);
            const isCorrect = correct.has(id);
            const wasSelected = selected.has(id);
            const classes = ['review-option'];
            if (isCorrect) classes.push('review-option--correct');
            if (wasSelected && !isCorrect) classes.push('review-option--wrong');
            if (wasSelected) classes.push('review-option--chosen');

            return (
              <li key={id} className={classes.join(' ')}>
                <div className="review-option__head">
                  <span className="option__letter" aria-hidden="true">
                    {String.fromCharCode(65 + index)}
                  </span>
                  {isCorrect ? <Pill tone="success">Correct option</Pill> : null}
                  {wasSelected ? <Pill tone="info">You chose this</Pill> : null}
                </div>
                <PrerenderedMath html={option.bodyHtml} spokenText={option.spokenText} />
                {/* Per-option rationale: why this distractor is wrong, not a
                    restatement that it is (FR-SOL-02, FR-AUT-04). */}
                {props.outcome.optionRationales[id] === undefined ? null : (
                  <p className="review-option__rationale">{props.outcome.optionRationales[id]}</p>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <dl className="review-numeric">
          <div>
            <dt>Your answer</dt>
            <dd className="mono">{response?.numericRaw ?? 'Not answered'}</dd>
          </div>
          <div>
            <dt>Accepted answer</dt>
            <dd className="mono">{outcome.correctNumericValue ?? 'Not published'}</dd>
          </div>
        </dl>
      )}

      <details className="review-solution">
        <summary>Solution</summary>
        <PrerenderedMath html={outcome.solutionHtml} />
        {outcome.videoUrl === null ? null : (
          // Deep-link out, never an embedded player: the standard embed
          // transmits platform identifiers and may serve interest-based
          // advertising to a child (FR-SOL-04).
          <p>
            <a href={outcome.videoUrl} target="_blank" rel="noreferrer noopener">
              Watch the video solution (opens the video site)
            </a>
          </p>
        )}
      </details>

      <div className="row">
        <Button variant="quiet" onClick={() => props.onChallenge(String(question.questionVersionId))}>
          Challenge this answer
        </Button>
        <Button
          variant="quiet"
          onClick={() => props.onReport(String(question.questionVersionId), 'Reported from review')}
        >
          Report an error
        </Button>
      </div>
    </article>
  );
}
