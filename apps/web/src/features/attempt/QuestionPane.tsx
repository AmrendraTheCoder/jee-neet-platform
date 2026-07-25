import { humanizeEnum } from '../../lib/format.js';
import { MathErrorBoundary } from '../../components/math/MathErrorBoundary.js';
import { PrerenderedMath } from '../../components/math/PrerenderedMath.js';
import { Pill } from '../../components/ui/Feedback.js';
import { useAttemptController, useAttemptState } from './context.js';
import { NumericAnswer } from './NumericAnswer.js';
import { OptionList } from './OptionList.js';
import { currentQuestion, isMultiSelect, isNumeric, positionInSection } from './store/selectors.js';
import { effectiveDraft } from './store/transitions.js';
import './attempt.css';

/**
 * The question itself: stem, any shared stimulus, and the answer control.
 *
 * The answer control reads from `effectiveDraft` — the unsaved on-screen
 * selection if there is one, otherwise the committed response. That is what
 * makes navigation-without-saving observable: leaving and returning shows the
 * committed answer again because the draft was dropped (FR-ATT-02).
 */
export function QuestionPane(): JSX.Element {
  const controller = useAttemptController();
  const question = useAttemptState((s) => currentQuestion(s));
  const draft = useAttemptState((s) => effectiveDraft(s));
  const positionLabel = useAttemptState((s) =>
    question === undefined ? '' : `Question ${positionInSection(s, question.questionVersionId)}`,
  );
  const marksLabel = useAttemptState((s) => {
    const q = currentQuestion(s);
    if (q === undefined) return '';
    const negative = q.marking.incorrect;
    return `+${q.marking.correct} correct, ${negative === 0 ? 'no negative marking' : `${negative} incorrect`}`;
  });

  if (question === undefined) {
    return <p className="load-state">This question is not part of your paper.</p>;
  }

  return (
    <article className="question" aria-labelledby="question-heading">
      <div className="question__meta row">
        <h2 id="question-heading" className="question__number">
          {positionLabel}
        </h2>
        <Pill>{humanizeEnum(question.questionType)}</Pill>
        {/* The marking scheme for THIS paper, which travels on the
            (test_section, question) join — the same item in another paper may
            score differently (FR-PAT-04). */}
        <Pill tone="info" title="Marking scheme for this paper">
          {marksLabel}
        </Pill>
      </div>

      <MathErrorBoundary
        questionVersionId={String(question.questionVersionId)}
        source={question.spokenText}
        onReport={(id, detail) => controller.reportQuestion(id, detail)}
      >
        {question.stimulusHtml === null ? null : (
          <div className="question__stimulus">
            <PrerenderedMath html={question.stimulusHtml} />
          </div>
        )}
        <PrerenderedMath
          html={question.bodyHtml}
          spokenText={question.spokenText}
          className="question__stem"
        />
      </MathErrorBoundary>

      {isNumeric(question) ? (
        <NumericAnswer
          label="Your answer"
          value={draft.numericRaw ?? ''}
          allowDecimal={question.questionType === 'NUMERIC_DECIMAL'}
          allowNegative
          onChange={(next) => controller.setNumericInput(next)}
        />
      ) : (
        <OptionList
          options={question.options}
          selected={draft.selectedOptionIds}
          multi={isMultiSelect(question)}
          questionLabel={positionLabel}
          onToggle={(optionId) => controller.selectOption(optionId)}
        />
      )}
    </article>
  );
}
