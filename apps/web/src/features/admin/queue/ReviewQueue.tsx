import { useMemo, useState } from 'react';
import type { AuthoredItem } from '../../../lib/api/types.js';
import { useApi } from '../../../lib/api/context.js';
import { humanizeEnum } from '../../../lib/format.js';
import { Button } from '../../../components/ui/Button.js';
import { Callout, EmptyState, Pill } from '../../../components/ui/Feedback.js';
import { Field, TextArea } from '../../../components/ui/Field.js';
import { LatexPreview } from '../../../components/math/PrerenderedMath.js';
import { evaluateGate } from '../items/itemLint.js';
import '../admin.css';

/**
 * The editorial review queue (FR-ADM-01, FR-AUT-03).
 *
 * The approve control is disabled for the item's own author. That is a
 * courtesy: `approved_by <> created_by` is a database CHECK constraint, so a
 * self-approval fails at the database even with super-admin rights. Showing it
 * as disabled with the reason is better than letting an operator discover the
 * rule from a constraint-violation message.
 *
 * "Request changes" requires a written note, because a review that returns an
 * item with no reason costs the author a round trip to find out why.
 */
export function ReviewQueue(props: {
  readonly items: readonly AuthoredItem[];
  readonly currentUserId: string;
}): JSX.Element {
  const api = useApi();
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const queue = useMemo(
    () => props.items.filter((item) => item.lifecycle === 'IN_REVIEW' || item.lifecycle === 'CHANGES_REQUESTED'),
    [props.items],
  );

  if (queue.length === 0) {
    return (
      <div className="admin-page">
        <h1>Review queue</h1>
        <EmptyState
          title="Nothing waiting for review"
          body="Items submitted for review appear here. Authors cannot approve their own work, so this queue never empties itself."
        />
      </div>
    );
  }

  const transition = (item: AuthoredItem, to: AuthoredItem['lifecycle']): void => {
    if (to === 'CHANGES_REQUESTED' && note.trim().length < 10) {
      setMessage('Requesting changes needs a written reason of at least ten characters.');
      return;
    }
    void api
      .transitionItem({ questionVersionId: item.questionVersionId, to, note: note.trim() })
      .then(() => {
        setNote('');
        setMessage(`Item moved to ${to}.`);
      })
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : 'The transition was rejected.'),
      );
  };

  return (
    <div className="admin-page stack">
      <h1>Review queue</h1>
      <p className="muted">
        {queue.length} item{queue.length === 1 ? '' : 's'} awaiting a second reader.
      </p>

      {message === null ? null : <Callout tone="info">{message}</Callout>}

      <Field
        label="Review note"
        hint="Required when requesting changes. Recorded against the version."
      >
        {({ id }) => <TextArea id={id} rows={2} value={note} onChange={setNote} />}
      </Field>

      {queue.map((item) => {
        const gate = evaluateGate(item, props.currentUserId);
        const isOwnWork = item.createdBy === props.currentUserId;

        return (
          <article key={item.questionVersionId} className="card stack">
            <header className="row">
              <h2>{humanizeEnum(item.subject)} · {humanizeEnum(item.questionType)}</h2>
              <Pill>{item.lifecycle}</Pill>
              <Pill tone={item.provenance === 'THIRD_PARTY_UNCLEARED' ? 'danger' : 'neutral'}>
                {item.provenance}
              </Pill>
              <div className="spacer" />
              <span className="subtle">Authored by {item.createdBy}</span>
            </header>

            <LatexPreview source={item.stemLatex} />

            <ol className="review-queue__options">
              {item.options.map((option, index) => (
                <li key={String(option.optionId)}>
                  <span className="option__letter">{String.fromCharCode(65 + index)}</span>
                  <LatexPreview source={option.latex} />
                  {option.isCorrect ? <Pill tone="success">Keyed</Pill> : null}
                  <p className="subtle">{option.rationale || 'No rationale supplied.'}</p>
                </li>
              ))}
            </ol>

            {gate.blocking.length === 0 ? null : (
              <Callout tone="danger" title="Blocking findings">
                <ul>
                  {gate.blocking.map((finding) => (
                    <li key={`${finding.code}:${finding.field}`}>{finding.message}</li>
                  ))}
                </ul>
              </Callout>
            )}

            {isOwnWork ? (
              <Callout tone="warning" title="You wrote this item">
                You cannot approve your own work. This is a database constraint, not a console
                rule, and super-admin rights do not change it.
              </Callout>
            ) : null}

            <div className="row">
              <Button
                variant="secondary"
                onClick={() => transition(item, 'CHANGES_REQUESTED')}
              >
                Request changes
              </Button>
              <Button
                disabled={isOwnWork || gate.blocking.length > 0}
                onClick={() => transition(item, 'APPROVED')}
              >
                Approve
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
