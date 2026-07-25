import { memo } from 'react';
import { useMathScope } from './MathScope.js';
import './math.css';

export interface PrerenderedMathProps {
  /** `body_html`, rendered server-side at write time (FR-MTH-01). */
  readonly html: string;
  /** Read by assistive technology instead of the visual markup (FR-ITM-12). */
  readonly spokenText?: string;
  readonly className?: string;
}

/**
 * Renders server-pre-rendered question content.
 *
 * Memoised on `html` alone. The attempt player re-renders on every countdown
 * tick — four times a second for three hours — and without this the question
 * body is re-sanitised and re-inserted forty thousand times per paper, which
 * also destroys any text selection the candidate had made.
 */
export const PrerenderedMath = memo(function PrerenderedMath(
  props: PrerenderedMathProps,
): JSX.Element {
  const scope = useMathScope();
  const safe = scope.prepare(props.html);

  return (
    <div className={props.className === undefined ? 'math-body' : `math-body ${props.className}`}>
      {props.spokenText !== undefined && props.spokenText !== '' ? (
        <span className="visually-hidden">{props.spokenText}</span>
      ) : null}
      <div
        // The visual markup is hidden from assistive technology when a spoken
        // form exists: a screen reader announcing "backslash int" is a failure
        // the requirement calls out by name.
        aria-hidden={props.spokenText !== undefined && props.spokenText !== '' ? true : undefined}
        dangerouslySetInnerHTML={{ __html: safe }}
      />
    </div>
  );
});

/**
 * Runtime LaTeX rendering. Authoring preview only (FR-AUT-01).
 *
 * The student client never reaches this path — a candidate's device rendering
 * LaTeX at view time is the thing FR-MTH-01 exists to prevent.
 */
export const LatexPreview = memo(function LatexPreview(props: {
  readonly source: string;
  readonly className?: string;
}): JSX.Element {
  const scope = useMathScope();
  return (
    <div
      className={props.className === undefined ? 'math-body' : `math-body ${props.className}`}
      dangerouslySetInnerHTML={{ __html: scope.renderSource(props.source) }}
    />
  );
});
