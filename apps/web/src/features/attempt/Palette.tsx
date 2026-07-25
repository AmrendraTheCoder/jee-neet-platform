import { useCallback, useRef } from 'react';
import type { PaletteState } from '@platform/domain';
import type { QuestionVersionId, SectionId } from '@platform/domain';
import { useAttemptController, useAttemptState } from './context.js';
import { paletteStateOf, questionsInSection } from './store/selectors.js';
import './attempt.css';

const STATE_CLASS: Readonly<Record<PaletteState, string>> = {
  NOT_VISITED: 'pal--not-visited',
  NOT_ANSWERED: 'pal--not-answered',
  ANSWERED: 'pal--answered',
  MARKED_FOR_REVIEW: 'pal--marked',
  ANSWERED_AND_MARKED: 'pal--answered-marked',
};

export const STATE_LABEL: Readonly<Record<PaletteState, string>> = {
  NOT_VISITED: 'Not Visited',
  NOT_ANSWERED: 'Not Answered',
  ANSWERED: 'Answered',
  MARKED_FOR_REVIEW: 'Marked for Review',
  ANSWERED_AND_MARKED: 'Answered and Marked for Review',
};

/**
 * The five-state question palette (FR-ATT-01).
 *
 * Two behaviours here are non-negotiable.
 *
 * 1. State is DERIVED on every render via `paletteStateOf`, which calls into
 *    @platform/domain. It is never stored. See `store/selectors.ts`.
 *
 * 2. CLICKING A CELL NAVIGATES WITHOUT SAVING (FR-ATT-02). `navigateTo`
 *    discards the unsaved draft and touches nothing in `responses` except the
 *    destination's visited flag. Candidates rely on this: they try an option,
 *    jump elsewhere via the palette, and come back expecting their selection
 *    to be gone. A player that saves here converts a deliberate non-attempt
 *    into a wrong answer, which on a negatively-marked paper costs real marks.
 */
export function Palette(props: { readonly sectionId: SectionId }): JSX.Element {
  const controller = useAttemptController();
  const gridRef = useRef<HTMLDivElement | null>(null);

  const questions = useAttemptState(
    (state) => questionsInSection(state, props.sectionId),
    (a, b) => a.length === b.length && a.every((q, i) => q === b[i]),
  );

  // Roving tab index: 180 cells in the tab order would take a keyboard
  // candidate two hundred presses to get past the palette. One stop, then
  // arrow keys inside it.
  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const grid = gridRef.current;
    if (grid === null) return;
    const cells = [...grid.querySelectorAll<HTMLButtonElement>('button[data-palette-cell]')];
    const index = cells.findIndex((cell) => cell === document.activeElement);
    if (index < 0) return;

    const columns = Number.parseInt(
      getComputedStyle(grid).getPropertyValue('--palette-columns') || '5',
      10,
    );

    const moves: Readonly<Record<string, number>> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    };
    const delta = moves[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const target = cells[Math.min(cells.length - 1, Math.max(0, index + delta))];
    target?.focus();
  }, []);

  return (
    <div
      ref={gridRef}
      className="palette-grid"
      role="group"
      aria-label="Question palette"
      onKeyDown={onKeyDown}
    >
      {questions.map((question, index) => (
        <PaletteCell
          key={String(question.questionVersionId)}
          questionVersionId={question.questionVersionId}
          number={index + 1}
          onSelect={() => controller.navigateTo(question.questionVersionId)}
        />
      ))}
    </div>
  );
}

function PaletteCell(props: {
  readonly questionVersionId: QuestionVersionId;
  readonly number: number;
  readonly onSelect: () => void;
}): JSX.Element {
  const state = useAttemptState((s) => paletteStateOf(s, props.questionVersionId));
  const isCurrent = useAttemptState(
    (s) => s.currentQuestionVersionId === props.questionVersionId,
  );

  return (
    <button
      type="button"
      data-palette-cell
      data-state={state}
      className={`pal ${STATE_CLASS[state]}${isCurrent ? ' pal--current' : ''}`}
      tabIndex={isCurrent ? 0 : -1}
      aria-current={isCurrent ? 'true' : undefined}
      aria-label={`Question ${props.number}, ${STATE_LABEL[state]}`}
      onClick={props.onSelect}
    >
      <span aria-hidden="true">{props.number}</span>
      {state === 'ANSWERED_AND_MARKED' ? <span className="pal__dot" aria-hidden="true" /> : null}
    </button>
  );
}
