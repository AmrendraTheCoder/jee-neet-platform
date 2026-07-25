import { useState } from 'react';
import { humanizeEnum } from '../../lib/format.js';
import { Button } from '../../components/ui/Button.js';
import { Dialog } from '../../components/ui/Dialog.js';
import { Callout } from '../../components/ui/Feedback.js';
import { useAttemptController, useAttemptState } from './context.js';
import { attemptedTotal, countsForAttempt, countsForSection } from './store/selectors.js';
import { LEGEND_ROWS } from './PaletteLegend.js';
import './attempt.css';

/**
 * Submit confirmation (FR-ATT-04).
 *
 * Shows counts per state — the same five the palette shows, derived from the
 * same `paletteCounts` in @platform/domain so they cannot disagree — and
 * requires an EXPLICIT confirm. There is no single-tap submit anywhere in the
 * player: this is an irreversible action at the end of a three-hour paper.
 *
 * The per-section breakdown is here because the aggregate hides the case that
 * actually costs marks: a candidate who has answered everything except one
 * section they never opened.
 */
export function SubmitDialog(): JSX.Element {
  const controller = useAttemptController();
  const open = useAttemptState((s) => s.submitDialogOpen);
  const submitting = useAttemptState((s) => s.submitting);
  const pendingCount = useAttemptState((s) => s.pendingCount);
  const counts = useAttemptState((s) => countsForAttempt(s));
  const sections = useAttemptState((s) => s.snapshot.sections);
  const totalQuestions = useAttemptState((s) => s.snapshot.questions.length);
  const [error, setError] = useState<string | null>(null);

  const unanswered = counts.notVisited + counts.notAnswered + counts.markedForReview;

  return (
    <Dialog
      open={open}
      width="lg"
      title="Submit your paper"
      description="Once submitted, you cannot return to this paper."
      dismissible={!submitting}
      onClose={() => controller.setSubmitDialogOpen(false)}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={submitting}
            onClick={() => controller.setSubmitDialogOpen(false)}
          >
            Go back to the paper
          </Button>
          <Button
            variant="primary"
            disabled={submitting}
            onClick={() => {
              setError(null);
              void controller.submit().catch((cause: unknown) => {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : 'Your submission could not be confirmed. Your answers are saved.',
                );
              });
            }}
          >
            {submitting ? 'Submitting' : 'Yes, submit my paper'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <dl className="submit-summary">
          {LEGEND_ROWS.map((row) => (
            <div key={row.key} className="submit-summary__row">
              <dt>
                <span className={`pal pal--chip ${row.className}`} aria-hidden="true" />
                {row.label}
              </dt>
              <dd className="mono">{counts[row.key]}</dd>
            </div>
          ))}
          <div className="submit-summary__row submit-summary__row--total">
            <dt>Attempted</dt>
            <dd className="mono">
              {attemptedTotal(counts)} of {totalQuestions}
            </dd>
          </div>
        </dl>

        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">Counts by section</caption>
            <thead>
              <tr>
                <th scope="col">Section</th>
                <th scope="col">Answered</th>
                <th scope="col">Marked</th>
                <th scope="col">Not answered</th>
                <th scope="col">Not visited</th>
              </tr>
            </thead>
            <tbody>
              {[...sections]
                .sort((a, b) => a.ordinal - b.ordinal)
                .map((section) => (
                  <SectionRow key={String(section.sectionId)} sectionId={section.sectionId} name={`${section.name} (${humanizeEnum(section.subject)})`} />
                ))}
            </tbody>
          </table>
        </div>

        {unanswered > 0 ? (
          <Callout tone="warning" title={`${unanswered} question${unanswered === 1 ? '' : 's'} without a saved answer`}>
            Questions you marked for review are only counted as answered if you also saved an
            answer on them. You can go back and check before submitting.
          </Callout>
        ) : null}

        {pendingCount > 0 ? (
          <Callout tone="info" title={`${pendingCount} answer${pendingCount === 1 ? '' : 's'} still syncing`}>
            These are saved on this device and will be sent before your paper is finalised.
            Submitting now is safe.
          </Callout>
        ) : null}

        {error === null ? null : (
          <Callout tone="danger" title="Submission not confirmed">
            {error} Your answers remain saved. Try again, or wait — your paper is finalised
            automatically when the deadline passes.
          </Callout>
        )}
      </div>
    </Dialog>
  );
}

function SectionRow(props: {
  readonly sectionId: Parameters<typeof countsForSection>[1];
  readonly name: string;
}): JSX.Element {
  const counts = useAttemptState((s) => countsForSection(s, props.sectionId));
  return (
    <tr>
      <th scope="row">{props.name}</th>
      <td className="mono">{counts.answered + counts.answeredAndMarked}</td>
      <td className="mono">{counts.markedForReview + counts.answeredAndMarked}</td>
      <td className="mono">{counts.notAnswered}</td>
      <td className="mono">{counts.notVisited}</td>
    </tr>
  );
}
