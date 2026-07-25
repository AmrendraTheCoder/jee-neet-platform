import { Button } from '../../components/ui/Button.js';
import { useAttemptController, useAttemptState } from './context.js';
import { effectiveDraft } from './store/transitions.js';
import './attempt.css';

/**
 * The action bar, in the order and with the semantics of the real interface
 * (FR-ATT-01, FR-ATT-02, FR-ATT-03).
 *
 *   Back / Next          navigate WITHOUT saving
 *   Clear Response       clears the answer, LEAVES the review flag
 *   Mark for Review & Next   saves the answer AND flags it, then advances
 *   Save & Next          saves the answer, then advances
 *
 * Back and Next are navigation, not commits. A candidate who selects an option
 * and presses Next has not saved it — identical to clicking a palette cell.
 * Making Next save is the same mistake as making the palette save, and it is
 * just as costly on a negatively-marked paper.
 */
export function AnswerControls(): JSX.Element {
  const controller = useAttemptController();
  const hasDraftAnswer = useAttemptState((s) => {
    const draft = effectiveDraft(s);
    return draft.selectedOptionIds.length > 0 || (draft.numericRaw ?? '').trim() !== '';
  });
  const isMarked = useAttemptState(
    (s) => s.responses.get(String(s.currentQuestionVersionId))?.markedForReview ?? false,
  );

  return (
    <div className="answer-controls">
      <div className="answer-controls__nav">
        <Button variant="secondary" onClick={() => controller.goPrevious()}>
          Back
        </Button>
        <Button variant="secondary" onClick={() => controller.goNext()}>
          Next
        </Button>
      </div>

      <div className="answer-controls__actions">
        <Button
          variant="quiet"
          disabled={!hasDraftAnswer}
          onClick={() => void controller.clearResponse()}
        >
          Clear Response
        </Button>
        <Button variant="secondary" onClick={() => void controller.markForReviewAndNext()}>
          {isMarked ? 'Keep Marked and Next' : 'Mark for Review & Next'}
        </Button>
        <Button variant="primary" onClick={() => void controller.saveAndNext()}>
          Save &amp; Next
        </Button>
      </div>
    </div>
  );
}
