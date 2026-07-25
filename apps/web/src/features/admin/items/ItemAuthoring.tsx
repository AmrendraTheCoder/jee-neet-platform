import { useEffect, useMemo, useState } from 'react';
import type { QuestionType, Subject } from '@platform/domain';
import { QUESTION_TYPES, SUBJECTS } from '@platform/domain';
import type { AuthoredItem, Provenance } from '../../../lib/api/types.js';
import { useApi } from '../../../lib/api/context.js';
import { humanizeEnum } from '../../../lib/format.js';
import { LatexPreview } from '../../../components/math/PrerenderedMath.js';
import { Button } from '../../../components/ui/Button.js';
import { Callout, Pill } from '../../../components/ui/Feedback.js';
import { Checkbox, Field, Select, TextArea, TextInput } from '../../../components/ui/Field.js';
import { OptionEditor } from './OptionEditor.js';
import { PublishGate } from './PublishGate.js';
import { evaluateGate, lintItem, mustDisableShuffle } from './itemLint.js';
import '../admin.css';

const PROVENANCES: readonly { value: Provenance; label: string }[] = [
  { value: 'ORIGINAL', label: 'Original, commissioned' },
  { value: 'PYQ_NTA', label: 'Previous-year question' },
  { value: 'LICENSED', label: 'Licensed' },
  { value: 'THIRD_PARTY_UNCLEARED', label: 'Third party, uncleared (cannot publish)' },
];

/**
 * Item authoring with live preview and the publication gate (FR-AUT-01..05).
 *
 * The preview uses the SAME renderer, at the same version, as the student
 * client — both go through `MathScope`, and the admin shell mounts exactly one
 * (FR-AUT-01). Editor and reader cannot disagree, which is the point: an
 * author who approves an item that renders differently for the candidate has
 * approved something they never saw.
 */
export function ItemAuthoring(props: {
  readonly items: readonly AuthoredItem[];
  readonly currentUserId: string;
}): JSX.Element {
  const api = useApi();
  const [selectedId, setSelectedId] = useState<string | null>(
    props.items[0]?.questionVersionId ?? null,
  );
  const [draft, setDraft] = useState<AuthoredItem | null>(null);
  const [saveState, setSaveState] = useState<string | null>(null);

  useEffect(() => {
    const found = props.items.find((item) => item.questionVersionId === selectedId);
    setDraft(found === undefined ? null : { ...found });
  }, [props.items, selectedId]);

  const gate = useMemo(
    () => (draft === null ? null : evaluateGate(draft, props.currentUserId)),
    [draft, props.currentUserId],
  );

  const rationaleErrors = useMemo(() => {
    const map = new Map<number, string>();
    if (draft === null) return map;
    for (const finding of lintItem(draft)) {
      const match = /^options\.(\d+)\.rationale$/.exec(finding.field);
      if (match?.[1] !== undefined) map.set(Number(match[1]), finding.message);
    }
    return map;
  }, [draft]);

  if (draft === null || gate === null) {
    return (
      <div className="admin-page">
        <h1>Item authoring</h1>
        <Callout tone="info" title="No item selected">
          Select an item from the list, or create a new draft.
        </Callout>
      </div>
    );
  }

  const isNumeric =
    draft.questionType === 'NUMERIC_INTEGER' || draft.questionType === 'NUMERIC_DECIMAL';
  const shuffleForcedOff = mustDisableShuffle(draft);

  const patch = (changes: Partial<AuthoredItem>): void => {
    setDraft((previous) => {
      if (previous === null) return previous;
      const next = { ...previous, ...changes };
      // FR-ITM-11: the linter FORCES shuffling off rather than warning about
      // it. A warning an author can dismiss is not a control.
      return mustDisableShuffle(next) ? { ...next, shuffleOptions: false } : next;
    });
  };

  return (
    <div className="admin-page admin-page--split">
      <div className="admin-page__list">
        <h2 className="admin-page__list-heading">Items</h2>
        <ul className="admin-list">
          {props.items.map((item) => (
            <li key={item.questionVersionId}>
              <button
                type="button"
                className={`admin-list__item${item.questionVersionId === selectedId ? ' admin-list__item--active' : ''}`}
                onClick={() => setSelectedId(item.questionVersionId)}
              >
                <span className="admin-list__title">
                  {item.stemLatex.slice(0, 60) || 'Untitled draft'}
                </span>
                <span className="row">
                  <Pill>{item.lifecycle}</Pill>
                  <Pill tone={item.latexValid ? 'neutral' : 'danger'}>v{item.versionNo}</Pill>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="admin-page__main stack">
        <header className="row">
          <h1>Item authoring</h1>
          <Pill>{draft.lifecycle}</Pill>
          <div className="spacer" />
          <Button
            variant="secondary"
            onClick={() => {
              setSaveState('Saving');
              void api
                .saveItem(draft)
                .then((saved) => {
                  setDraft(saved);
                  setSaveState(
                    saved.attemptCount > 0
                      ? `Saved as version ${saved.versionNo}. Attempts existed, so this forked a new version.`
                      : `Saved as version ${saved.versionNo}.`,
                  );
                })
                .catch((error: unknown) => {
                  setSaveState(error instanceof Error ? error.message : 'Save failed.');
                });
            }}
          >
            Save draft
          </Button>
          <Button
            disabled={!gate.ready}
            onClick={() => {
              void api
                .transitionItem({
                  questionVersionId: draft.questionVersionId,
                  to: 'PUBLISHED',
                  note: 'Published from the authoring console',
                })
                .then((saved) => setDraft(saved))
                .catch((error: unknown) =>
                  setSaveState(error instanceof Error ? error.message : 'Publish rejected.'),
                );
            }}
          >
            Publish
          </Button>
        </header>

        {saveState === null ? null : <Callout tone="info">{saveState}</Callout>}

        {draft.attemptCount > 0 ? (
          <Callout tone="warning" title={`${draft.attemptCount} attempts exist against this item`}>
            A content change forks a new version and resets item statistics. Students who sat
            this item before and after answered materially different questions. If the change
            must apply retroactively, that is a rescore, not an edit.
          </Callout>
        ) : null}

        <div className="admin-grid">
          <Field label="Provenance" hint="Capture this first, not last." required>
            {({ id }) => (
              <Select
                id={id}
                value={draft.provenance}
                options={PROVENANCES}
                onChange={(provenance) => patch({ provenance })}
              />
            )}
          </Field>

          <Field label="Source reference" required>
            {({ id }) => (
              <TextInput
                id={id}
                value={draft.sourceRef}
                placeholder="JEE Main 2023, Session 1, Shift 2, Q34"
                onChange={(sourceRef) => patch({ sourceRef })}
              />
            )}
          </Field>

          <Field label="Subject" required>
            {({ id }) => (
              <Select
                id={id}
                value={draft.subject}
                options={SUBJECTS.map((s: Subject) => ({ value: s, label: humanizeEnum(s) }))}
                onChange={(subject) => patch({ subject })}
              />
            )}
          </Field>

          <Field label="Question type" required>
            {({ id }) => (
              <Select
                id={id}
                value={draft.questionType}
                options={QUESTION_TYPES.map((t: QuestionType) => ({
                  value: t,
                  label: humanizeEnum(t),
                }))}
                onChange={(questionType) => patch({ questionType })}
              />
            )}
          </Field>

          <Field label="Sub-topic" hint="The review-card key." required>
            {({ id }) => (
              <TextInput
                id={id}
                value={draft.subTopicLabel ?? ''}
                placeholder="Rotational motion / Moment of inertia"
                onChange={(label) =>
                  patch({
                    subTopicLabel: label === '' ? null : label,
                    subTopicId: label === '' ? null : `subtopic:${label.toLowerCase()}`,
                  })
                }
              />
            )}
          </Field>

          <Field label="Authored difficulty" hint="Your estimate; measured against the empirical value later." required>
            {({ id }) => (
              <Select
                id={id}
                value={draft.authoredDifficulty ?? 'MEDIUM'}
                options={[
                  { value: 'EASY' as const, label: 'Easy' },
                  { value: 'MEDIUM' as const, label: 'Medium' },
                  { value: 'HARD' as const, label: 'Hard' },
                ]}
                onChange={(authoredDifficulty) => patch({ authoredDifficulty })}
              />
            )}
          </Field>
        </div>

        <Field label="Question stem (LaTeX)" required>
          {({ id }) => (
            <TextArea
              id={id}
              rows={6}
              monospace
              value={draft.stemLatex}
              onChange={(stemLatex) => patch({ stemLatex })}
            />
          )}
        </Field>

        <section className="preview card">
          <h3>Live preview</h3>
          <p className="subtle">
            Rendered with the same engine and version the student client uses. If this differs
            from production, stop and report it rather than working around it.
          </p>
          <LatexPreview source={draft.stemLatex} />
        </section>

        {isNumeric ? (
          <Field label="Accepted numeric answer" required>
            {({ id }) => (
              <TextInput
                id={id}
                value={draft.numericAnswer ?? ''}
                onChange={(numericAnswer) => patch({ numericAnswer })}
              />
            )}
          </Field>
        ) : (
          <>
            <h3>Options</h3>
            <OptionEditor
              options={draft.options}
              multi={draft.questionType === 'MCQ_MULTI'}
              rationaleErrors={rationaleErrors}
              onChange={(options) => patch({ options })}
            />
            <Checkbox
              checked={draft.shuffleOptions}
              disabled={shuffleForcedOff}
              onChange={(shuffleOptions) => patch({ shuffleOptions })}
              label={
                shuffleForcedOff
                  ? 'Shuffling is off and cannot be enabled: this question type or its option text depends on option position.'
                  : 'Shuffle options for each candidate (default off)'
              }
            />
          </>
        )}

        <Field label="Solution (LaTeX)" required>
          {({ id }) => (
            <TextArea
              id={id}
              rows={5}
              monospace
              value={draft.solutionLatex}
              onChange={(solutionLatex) => patch({ solutionLatex })}
            />
          )}
        </Field>

        <div className="admin-grid">
          <Field label="Alt text" hint="Describes any figure for a candidate who cannot see it." required>
            {({ id }) => (
              <TextArea id={id} rows={2} value={draft.altText} onChange={(altText) => patch({ altText })} />
            )}
          </Field>
          <Field label="Spoken text" hint="How a screen reader should read this question." required>
            {({ id }) => (
              <TextArea
                id={id}
                rows={2}
                value={draft.spokenText}
                onChange={(spokenText) => patch({ spokenText })}
              />
            )}
          </Field>
        </div>

        {draft.duplicateWarnings.length === 0 ? null : (
          <Callout tone="info" title="Near-duplicate signals">
            <ul>
              {draft.duplicateWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
            <Checkbox
              checked={draft.duplicatesAcknowledged}
              onChange={(duplicatesAcknowledged) => patch({ duplicatesAcknowledged })}
              label="I have reviewed these. A variant family is an asset; two members must never land in the same paper."
            />
          </Callout>
        )}

        <PublishGate item={draft} gate={gate} currentUserId={props.currentUserId} />
      </div>
    </div>
  );
}
