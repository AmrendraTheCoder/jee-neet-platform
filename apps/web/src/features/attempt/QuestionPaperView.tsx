import { humanizeEnum } from '../../lib/format.js';
import { PrerenderedMath } from '../../components/math/PrerenderedMath.js';
import { Button } from '../../components/ui/Button.js';
import { useAttemptController, useAttemptState } from './context.js';
import { STATE_LABEL } from './Palette.js';
import { paletteStateOf } from './store/selectors.js';
import './attempt.css';

/**
 * The Question Paper view (FR-ATT-01).
 *
 * Every question in the paper, in the attempt's materialised order, on one
 * scrollable page — the same affordance the real interface offers so a
 * candidate can scan for the questions they can do quickly.
 *
 * All 180 bodies render through the SAME `MathScope` as the player, because
 * this screen is the one place a renderer-per-row would be tempting and the
 * one place it would be most expensive (FR-MTH-05). The scope memoises on
 * source, so scrolling this list costs no re-render of prepared HTML.
 *
 * Selecting a row navigates WITHOUT SAVING, exactly like the palette.
 */
export function QuestionPaperView(): JSX.Element {
  const controller = useAttemptController();
  const sections = useAttemptState((s) => s.snapshot.sections);
  const questions = useAttemptState((s) => s.snapshot.questions);

  return (
    <div className="paper-view">
      <div className="paper-view__bar row">
        <h2>Question Paper</h2>
        <div className="spacer" />
        <Button variant="secondary" onClick={() => controller.setScreen('PLAYER')}>
          Back to the paper
        </Button>
      </div>

      {[...sections]
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((section) => {
          const sectionQuestions = questions.filter((q) => q.sectionId === section.sectionId);
          return (
            <section key={String(section.sectionId)} className="paper-view__section">
              <h3 className="paper-view__section-heading">
                {section.name}
                <span className="subtle"> {humanizeEnum(section.subject)}</span>
              </h3>
              <ol className="paper-view__list">
                {sectionQuestions.map((question, index) => (
                  <PaperRow
                    key={String(question.questionVersionId)}
                    number={index + 1}
                    bodyHtml={question.bodyHtml}
                    spokenText={question.spokenText}
                    questionVersionId={String(question.questionVersionId)}
                    onOpen={() => controller.navigateTo(question.questionVersionId)}
                  />
                ))}
              </ol>
            </section>
          );
        })}
    </div>
  );
}

function PaperRow(props: {
  readonly number: number;
  readonly bodyHtml: string;
  readonly spokenText: string;
  readonly questionVersionId: string;
  readonly onOpen: () => void;
}): JSX.Element {
  const state = useAttemptState((s) => {
    const question = s.snapshot.questions.find(
      (q) => String(q.questionVersionId) === props.questionVersionId,
    );
    return question === undefined ? 'NOT_VISITED' : paletteStateOf(s, question.questionVersionId);
  });

  return (
    <li className="paper-row">
      <div className="paper-row__head">
        <span className="paper-row__number mono">{props.number}</span>
        <span className="subtle">{STATE_LABEL[state]}</span>
        <div className="spacer" />
        <Button variant="quiet" onClick={props.onOpen}>
          Go to question {props.number}
        </Button>
      </div>
      <PrerenderedMath html={props.bodyHtml} spokenText={props.spokenText} />
    </li>
  );
}
