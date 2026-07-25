import { useId } from 'react';
import type { ReactNode } from 'react';
import './ui.css';

export interface FieldProps {
  readonly label: string;
  readonly hint?: string;
  /** Present means invalid. Announced, not merely coloured. */
  readonly error?: string | undefined;
  readonly required?: boolean;
  readonly children: (ids: {
    readonly id: string;
    readonly describedBy: string | undefined;
    readonly invalid: boolean;
  }) => ReactNode;
}

/**
 * Labelled form control.
 *
 * The render-prop shape exists so the control keeps its own element type — a
 * textarea, a select, a radio group — while the label, hint and error wiring
 * stay identical everywhere. Colour alone never signals an error; the message
 * is text, and it is joined into `aria-describedby` so a screen reader hears
 * it when focus lands on the field rather than on submit.
 */
export function Field(props: FieldProps): JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [props.hint === undefined ? null : hintId, props.error === undefined ? null : errorId]
      .filter((v): v is string => v !== null)
      .join(' ') || undefined;

  return (
    <div className={`field${props.error === undefined ? '' : ' field--invalid'}`}>
      <label className="field__label" htmlFor={id}>
        {props.label}
        {props.required === true ? (
          <span className="field__required" aria-hidden="true">
            {' '}
            required
          </span>
        ) : null}
      </label>
      {props.hint === undefined ? null : (
        <p id={hintId} className="field__hint">
          {props.hint}
        </p>
      )}
      {props.children({ id, describedBy, invalid: props.error !== undefined })}
      {props.error === undefined ? null : (
        <p id={errorId} className="field__error" role="alert">
          {props.error}
        </p>
      )}
    </div>
  );
}

export function TextInput(props: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly describedBy?: string | undefined;
  readonly invalid?: boolean;
  readonly placeholder?: string;
  readonly type?: 'text' | 'url' | 'datetime-local' | 'number';
  readonly disabled?: boolean;
}): JSX.Element {
  return (
    <input
      id={props.id}
      className="input"
      type={props.type ?? 'text'}
      value={props.value}
      placeholder={props.placeholder}
      disabled={props.disabled}
      aria-describedby={props.describedBy}
      aria-invalid={props.invalid === true ? true : undefined}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    />
  );
}

export function TextArea(props: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly describedBy?: string | undefined;
  readonly invalid?: boolean;
  readonly rows?: number;
  readonly placeholder?: string;
  readonly monospace?: boolean;
}): JSX.Element {
  return (
    <textarea
      id={props.id}
      className={`input input--area${props.monospace === true ? ' mono' : ''}`}
      rows={props.rows ?? 4}
      value={props.value}
      placeholder={props.placeholder}
      aria-describedby={props.describedBy}
      aria-invalid={props.invalid === true ? true : undefined}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    />
  );
}

export function Select<T extends string>(props: {
  readonly id: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
  readonly describedBy?: string | undefined;
  readonly disabled?: boolean;
}): JSX.Element {
  return (
    <select
      id={props.id}
      className="input input--select"
      value={props.value}
      disabled={props.disabled}
      aria-describedby={props.describedBy}
      onChange={(event) => props.onChange(event.currentTarget.value as T)}
    >
      {props.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox(props: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: ReactNode;
  readonly disabled?: boolean;
}): JSX.Element {
  return (
    <label className={`checkbox${props.disabled === true ? ' checkbox--disabled' : ''}`}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}
