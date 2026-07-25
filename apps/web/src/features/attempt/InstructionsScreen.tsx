import { useState } from 'react';
import { formatDuration } from '@platform/domain';
import { formatIst, formatLocal, humanizeEnum } from '../../lib/format.js';
import { PrerenderedMath } from '../../components/math/PrerenderedMath.js';
import { Button } from '../../components/ui/Button.js';
import { Callout } from '../../components/ui/Feedback.js';
import { Checkbox } from '../../components/ui/Field.js';
import { LEGEND_ROWS } from './PaletteLegend.js';
import { useAttemptState } from './context.js';
import './attempt.css';

/**
 * The instructions screen (FR-ATT-01).
 *
 * Reachable before the paper and again from inside it. Three things on it are
 * requirements rather than courtesy:
 *
 *   - the five palette states and their colours, so the interface is legible
 *     before the clock matters;
 *   - an explicit statement that a ranked attempt CANNOT BE PAUSED
 *     (FR-ATT-09), because discovering that from a running timer is the worst
 *     possible moment to learn it;
 *   - the window in canonical IST alongside the viewer's local time
 *     (FR-TST-03, FR-TST-04), so a candidate outside IST cannot misread it.
 */
export function InstructionsScreen(props: {
  readonly onBegin: (() => void) | null;
  readonly onClose: (() => void) | null;
}): JSX.Element {
  const snapshot = useAttemptState((s) => s.snapshot);
  const [acknowledged, setAcknowledged] = useState(false);

  const durationSeconds = Math.max(
    0,
    Math.round((snapshot.deadlineAtMs - snapshot.startedAtMs) / 1000),
  );

  return (
    <div className="centered-page stack instructions">
      <header className="stack">
        <h1>{snapshot.testTitle}</h1>
        <p className="muted">
          {humanizeEnum(snapshot.exam)} pattern {snapshot.patternId} ·{' '}
          {snapshot.questions.length} questions · {formatDuration(durationSeconds)}
        </p>
      </header>

      <section className="card stack">
        <h2>Your window</h2>
        <dl className="kv">
          <div>
            <dt>Paper ends</dt>
            <dd>
              {formatIst(snapshot.deadlineAtMs)}
              <br />
              <span className="subtle">{formatLocal(snapshot.deadlineAtMs)}</span>
            </dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{formatDuration(durationSeconds)}</dd>
          </div>
          <div>
            <dt>Ranking</dt>
            <dd>
              {snapshot.rankingMode === 'strict'
                ? 'Every candidate sits the same questions. Only the order varies.'
                : 'Each candidate draws from a larger pool. Your standing is a percentile within that pool.'}
            </dd>
          </div>
        </dl>
      </section>

      <Callout tone="warning" title="This paper cannot be paused">
        Once you begin, the clock runs until the deadline whatever you do. Closing the tab,
        losing your connection or changing device does not stop it. If you return, you resume
        with the time that is left.
      </Callout>

      <section className="card stack">
        <h2>How the question palette works</h2>
        <ul className="legend legend--instructions">
          {LEGEND_ROWS.map((row) => (
            <li key={row.key} className="legend__row">
              <span className={`pal pal--chip ${row.className}`} aria-hidden="true">
                {row.key === 'answeredAndMarked' ? <span className="pal__dot" /> : null}
              </span>
              <span className="legend__label">{row.label}</span>
            </li>
          ))}
        </ul>
        <ul className="instructions__rules">
          <li>
            Selecting an option does not save it. Use <strong>Save &amp; Next</strong> to save
            your answer.
          </li>
          <li>
            Clicking a question in the palette moves you there <strong>without saving</strong>{' '}
            what you had selected. This matches the real examination.
          </li>
          <li>
            <strong>Mark for Review &amp; Next</strong> saves your answer and flags the question
            so you can come back to it. Marking on its own does not count as an answer.
          </li>
          <li>
            <strong>Clear Response</strong> removes your answer. It does not remove the review
            flag — the two are independent.
          </li>
          <li>
            Numeric questions have an on-screen keypad. <strong>There is no calculator</strong>,
            because calculators are not permitted in the examination.
          </li>
        </ul>
      </section>

      {snapshot.instructionsHtml === '' ? null : (
        <section className="card">
          <PrerenderedMath html={snapshot.instructionsHtml} />
        </section>
      )}

      {snapshot.tieBreakLabels.length === 0 ? null : (
        <section className="card stack">
          <h2>How ties are broken</h2>
          <ol className="instructions__rules">
            {snapshot.tieBreakLabels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ol>
        </section>
      )}

      {props.onBegin === null ? (
        <div className="row">
          <Button size="lg" onClick={() => props.onClose?.()}>
            Back to the paper
          </Button>
        </div>
      ) : (
        <div className="stack">
          <Checkbox
            checked={acknowledged}
            onChange={setAcknowledged}
            label="I have read the instructions and I understand that the paper cannot be paused once it begins."
          />
          <div className="row">
            <Button size="lg" disabled={!acknowledged} onClick={props.onBegin}>
              Begin the paper
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
