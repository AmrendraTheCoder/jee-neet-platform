import type { ReactNode } from 'react';
import './ui.css';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/**
 * Block-level message.
 *
 * `role="alert"` only for `danger`, deliberately. An alert interrupts a screen
 * reader mid-sentence; doing that for a passive "3 answers pending" notice
 * during a paper would talk over the question the candidate is reading.
 */
export function Callout(props: {
  readonly tone?: Tone;
  readonly title?: string;
  readonly children: ReactNode;
}): JSX.Element {
  const tone = props.tone ?? 'neutral';
  return (
    <div className={`callout callout--${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      {props.title === undefined ? null : <strong className="callout__title">{props.title}</strong>}
      <div className="callout__body">{props.children}</div>
    </div>
  );
}

export function Pill(props: {
  readonly tone?: Tone;
  readonly children: ReactNode;
  readonly title?: string;
}): JSX.Element {
  return (
    <span className={`pill pill--${props.tone ?? 'neutral'}`} title={props.title}>
      {props.children}
    </span>
  );
}

/**
 * Determinate progress. There is no indeterminate variant in this product:
 * FR-SCR-04 forbids a bare indefinite spinner, and FR-ATT-14 requires the
 * pre-attempt asset prefetch to show real progress.
 */
export function ProgressBar(props: {
  readonly value: number;
  readonly max: number;
  readonly label: string;
  readonly detail?: string;
}): JSX.Element {
  const pct = props.max <= 0 ? 0 : Math.min(100, Math.round((props.value / props.max) * 100));
  return (
    <div className="progress">
      <div className="progress__row">
        <span>{props.label}</span>
        <span className="mono">{pct}%</span>
      </div>
      <div
        className="progress__track"
        role="progressbar"
        aria-valuenow={props.value}
        aria-valuemin={0}
        aria-valuemax={props.max}
        aria-label={props.label}
      >
        <div className="progress__fill" style={{ inlineSize: `${pct}%` }} />
      </div>
      {props.detail === undefined ? null : <p className="subtle">{props.detail}</p>}
    </div>
  );
}

export function EmptyState(props: {
  readonly title: string;
  /**
   * A silent empty state is prohibited (FR-ADM-17). Every empty state in this
   * product says what is missing and what happens next.
   */
  readonly body: string;
  readonly action?: ReactNode;
}): JSX.Element {
  return (
    <div className="empty-state">
      <h3>{props.title}</h3>
      <p className="muted">{props.body}</p>
      {props.action}
    </div>
  );
}
