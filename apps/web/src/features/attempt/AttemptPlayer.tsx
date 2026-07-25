import { useCallback, useEffect, useState } from 'react';
import { humanizeEnum } from '../../lib/format.js';
import { useIsNarrow, useOnForeground } from '../../lib/usePreferences.js';
import { Button } from '../../components/ui/Button.js';
import { AnswerControls } from './AnswerControls.js';
import { AttemptHeader } from './AttemptHeader.js';
import { InstructionsScreen } from './InstructionsScreen.js';
import { Palette } from './Palette.js';
import { PaletteLegend } from './PaletteLegend.js';
import { QuestionPane } from './QuestionPane.js';
import { QuestionPaperView } from './QuestionPaperView.js';
import { SectionTabs } from './SectionTabs.js';
import { SubmitDialog } from './SubmitDialog.js';
import { useAttemptController, useAttemptState } from './context.js';
import { countsForSection, currentSectionId } from './store/selectors.js';
import './attempt.css';

/**
 * The player shell: header, section tabs, question, controls, palette rail.
 *
 * The layout collapses to a single column below 60rem with the palette in a
 * drawer, which is also what the 200% text-scale case produces on a desktop
 * (FR-A11Y-01, FR-A11Y-02) — one breakpoint serves both, and there is no
 * separate "zoomed" mode to keep in step.
 */
export function AttemptPlayer(): JSX.Element {
  const controller = useAttemptController();
  const screen = useAttemptState((s) => s.screen);
  const sectionId = useAttemptState((s) => currentSectionId(s));
  const isNarrow = useIsNarrow();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Returning from a backgrounded tab: some platforms suspend the monotonic
  // clock while hidden, so the countdown must be re-anchored against the
  // server before it is trusted again (FR-ATT-07). The same request carries
  // any answers that accumulated while offline (FR-ATT-08).
  const onForeground = useCallback(() => controller.forceSync(), [controller]);
  useOnForeground(onForeground);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      // The browser's own confirmation, not ours. It cannot stop the deadline,
      // but a candidate who closes the tab by accident should be asked once.
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  if (screen === 'INSTRUCTIONS') {
    return (
      <InstructionsScreen onBegin={null} onClose={() => controller.setScreen('PLAYER')} />
    );
  }

  return (
    <div className="player">
      <AttemptHeader />
      <SectionTabs />

      <div className="player__body">
        <main className="player__main" id="question-main" tabIndex={-1}>
          {screen === 'QUESTION_PAPER' ? (
            <QuestionPaperView />
          ) : (
            <>
              <QuestionPane />
              <AnswerControls />
            </>
          )}
        </main>

        {isNarrow ? (
          <>
            <div className="player__drawer-bar">
              <Button variant="secondary" fullWidth onClick={() => setPaletteOpen((v) => !v)}>
                {paletteOpen ? 'Hide question palette' : 'Show question palette'}
              </Button>
            </div>
            {paletteOpen ? <PaletteRail sectionId={sectionId} /> : null}
          </>
        ) : (
          <PaletteRail sectionId={sectionId} />
        )}
      </div>

      <SubmitDialog />
    </div>
  );
}

function PaletteRail(props: {
  readonly sectionId: ReturnType<typeof currentSectionId>;
}): JSX.Element {
  const controller = useAttemptController();
  const screen = useAttemptState((s) => s.screen);
  const sectionName = useAttemptState((s) => {
    const section = s.snapshot.sections.find((sec) => sec.sectionId === props.sectionId);
    return section === undefined ? '' : `${section.name} · ${humanizeEnum(section.subject)}`;
  });
  const counts = useAttemptState((s) =>
    props.sectionId === null
      ? { notVisited: 0, notAnswered: 0, answered: 0, markedForReview: 0, answeredAndMarked: 0 }
      : countsForSection(s, props.sectionId),
  );

  return (
    <aside className="player__rail" aria-label="Question palette and paper actions">
      <h2 className="player__rail-heading">{sectionName}</h2>
      <PaletteLegend counts={counts} dense />
      {props.sectionId === null ? null : <Palette sectionId={props.sectionId} />}

      <div className="player__rail-actions">
        <Button
          variant="secondary"
          fullWidth
          onClick={() =>
            controller.setScreen(screen === 'QUESTION_PAPER' ? 'PLAYER' : 'QUESTION_PAPER')
          }
        >
          {screen === 'QUESTION_PAPER' ? 'Back to the paper' : 'Question Paper'}
        </Button>
        <Button variant="quiet" fullWidth onClick={() => controller.setScreen('INSTRUCTIONS')}>
          Instructions
        </Button>
        <Button
          variant="primary"
          fullWidth
          size="lg"
          onClick={() => controller.setSubmitDialogOpen(true)}
        >
          Submit
        </Button>
      </div>
    </aside>
  );
}
