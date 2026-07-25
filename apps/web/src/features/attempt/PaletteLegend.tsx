import type { PaletteCounts } from '@platform/domain';
import './attempt.css';

export interface LegendRow {
  readonly key: keyof PaletteCounts;
  readonly className: string;
  readonly label: string;
}

/**
 * Legend rows in the order the examination interface presents them.
 *
 * Exported because the submit confirmation reports the same five counts
 * (FR-ATT-04) and the two must never disagree — a candidate reconciling the
 * palette against the confirmation is the last check before an irreversible
 * action.
 */
export const LEGEND_ROWS: readonly LegendRow[] = [
  { key: 'notVisited', className: 'pal--not-visited', label: 'Not Visited' },
  { key: 'notAnswered', className: 'pal--not-answered', label: 'Not Answered' },
  { key: 'answered', className: 'pal--answered', label: 'Answered' },
  { key: 'markedForReview', className: 'pal--marked', label: 'Marked for Review' },
  {
    key: 'answeredAndMarked',
    className: 'pal--answered-marked',
    label: 'Answered and Marked for Review',
  },
];

/**
 * Live counts per state.
 *
 * Counts are derived from `paletteCounts` in @platform/domain on every render,
 * so they cannot drift from the cells above them. `aria-live="polite"` is
 * deliberately absent: announcing five numbers after every save would talk
 * over the question a screen-reader candidate is reading.
 */
export function PaletteLegend(props: {
  readonly counts: PaletteCounts;
  readonly dense?: boolean;
}): JSX.Element {
  return (
    <ul className={`legend${props.dense === true ? ' legend--dense' : ''}`}>
      {LEGEND_ROWS.map((row) => (
        <li key={row.key} className="legend__row">
          <span className={`pal pal--chip ${row.className}`} aria-hidden="true">
            {props.counts[row.key]}
            {row.key === 'answeredAndMarked' ? <span className="pal__dot" /> : null}
          </span>
          <span className="legend__label">
            {props.counts[row.key]} {row.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
