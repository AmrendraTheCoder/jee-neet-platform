import type { ReviewSnapshot } from '../../lib/api/types.js';
import { formatMarks, humanizeEnum } from '../../lib/format.js';
import { Callout, Pill } from '../../components/ui/Feedback.js';
import './review.css';

/**
 * The result header.
 *
 * Every number is server-computed (FR-SCR-17). Two presentation rules matter:
 *
 *   - The percentile arrives as an exact decimal STRING computed on the TOTAL
 *     raw score per cohort (FR-SCR-07). It is rendered as a string and never
 *     parsed to a float, because a float round-trip at seven decimal places
 *     silently changes the last digit and two candidates one place apart start
 *     seeing the same number.
 *   - Subject percentiles are shown separately and are explicitly NOT combined.
 *     Averaging them would produce a number that resembles the overall
 *     percentile and is wrong.
 *
 * There is no gamification on this screen (FR-RWD-11): no coins, no streak, no
 * league. A mock result is not a low-stakes surface.
 */
export function ScoreSummary(props: { readonly review: ReviewSnapshot }): JSX.Element {
  const { review } = props;

  return (
    <section className="score-summary">
      <div className="score-summary__headline">
        <div className="score-summary__figure">
          <span className="score-summary__label">Score</span>
          <span className="score-summary__value mono">
            {formatMarks(review.rawScore)}
            <span className="score-summary__max"> / {review.maxMarks}</span>
          </span>
          <span className="subtle">
            {review.positiveMarks} earned, {review.negativeMarks} lost to negative marking
          </span>
        </div>

        {review.percentile === null ? null : (
          <div className="score-summary__figure">
            <span className="score-summary__label">Percentile</span>
            <span className="score-summary__value mono">{review.percentile}</span>
            <span className="subtle">
              Computed on total score across {review.cohortSize ?? 0} candidates
            </span>
          </div>
        )}

        {review.rank === null ? null : (
          <div className="score-summary__figure">
            <span className="score-summary__label">Rank</span>
            <span className="score-summary__value mono">{review.rank}</span>
            <span className="subtle">Ties broken by the published chain</span>
          </div>
        )}
      </div>

      {review.attempt.shortened ? (
        <Callout tone="warning" title="Shortened attempt">
          You started this paper after the full duration was available, so it is not ranked
          against full-length attempts. Your marks and review are unaffected.
        </Callout>
      ) : null}

      {review.rescoreNote === null ? null : (
        <Callout tone="info" title="This result has been revised">
          {review.rescoreNote}
        </Callout>
      )}

      <div className="table-scroll">
        <table className="data-table">
          <caption className="visually-hidden">Marks by subject</caption>
          <thead>
            <tr>
              <th scope="col">Subject</th>
              <th scope="col">Score</th>
              <th scope="col">Percentile</th>
              <th scope="col">Correct</th>
              <th scope="col">Partial</th>
              <th scope="col">Incorrect</th>
              <th scope="col">Unanswered</th>
            </tr>
          </thead>
          <tbody>
            {review.bySubject.map((subject) => (
              <tr key={subject.subject}>
                <th scope="row">{humanizeEnum(subject.subject)}</th>
                <td className="mono">
                  {formatMarks(subject.score)} / {subject.maxMarks}
                </td>
                <td className="mono">{subject.percentile ?? 'Not published'}</td>
                <td className="mono">{subject.correct}</td>
                <td className="mono">{subject.partiallyCorrect}</td>
                <td className="mono">{subject.incorrect}</td>
                <td className="mono">{subject.unattempted}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="subtle">
        Subject percentiles describe your standing within each subject. They are not combined
        into the overall percentile above, which is computed on your total score.
      </p>

      <div className="row">
        <Pill title="Pins the marking configuration this result was computed under">
          Scoring configuration {review.scoringConfigFingerprint.slice(0, 12)}
        </Pill>
        <Pill title="Increments whenever a key revision produces a new result">
          Result version {review.resultVersion}
        </Pill>
      </div>
    </section>
  );
}
