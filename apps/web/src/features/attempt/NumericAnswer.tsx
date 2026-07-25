import { useCallback, useRef } from 'react';
import { normalizeNumericInput } from '@platform/domain';
import './attempt.css';

/**
 * ASCII digits, written as literals.
 *
 * FR-ATT-05: the keypad emits ASCII digits REGARDLESS OF DEVICE LOCALE. These
 * are `U+0030`..`U+0039` in the source and nothing localises them — no
 * `toLocaleString`, no Intl formatter, no number input whose rendering the
 * platform may choose. A candidate on a Hindi or Tamil device locale who typed
 * a correct answer that arrived as Devanagari or Tamil numerals would score
 * zero with no way to discover why.
 *
 * The domain normaliser folds non-ASCII digits anyway (that is the belt), but
 * a keypad that emits them in the first place would be the braces failing.
 */
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const;

/**
 * THERE IS NO CALCULATOR. FR-ATT-05 is explicit: calculators are banned across
 * all three examinations, so providing one here would train a habit that is
 * unavailable on the day. Nothing in this file evaluates an expression.
 */
export function NumericAnswer(props: {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly allowDecimal: boolean;
  readonly allowNegative: boolean;
  readonly label: string;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const append = useCallback(
    (character: string) => {
      props.onChange(props.value + character);
      inputRef.current?.focus();
    },
    [props],
  );

  const backspace = useCallback(() => {
    props.onChange(props.value.slice(0, -1));
    inputRef.current?.focus();
  }, [props]);

  const canonical = normalizeNumericInput(props.value).canonical;

  return (
    <div className="numeric">
      <label className="numeric__label" htmlFor="numeric-answer">
        {props.label}
      </label>

      <input
        ref={inputRef}
        id="numeric-answer"
        className="numeric__input mono"
        // `type="text"` with an explicit inputmode, not `type="number"`:
        // number inputs silently drop characters the browser dislikes, expose
        // spinners that change an answer on a stray scroll, and localise their
        // own decimal separator.
        type="text"
        inputMode="decimal"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={props.value}
        aria-describedby="numeric-canonical"
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />

      {/* The candidate sees exactly how their entry will be read. `2,50,000`
          and Devanagari numerals both resolve here, before submission, rather
          than becoming an unexplained zero after it (FR-SCR-05). */}
      <p id="numeric-canonical" className="numeric__canonical subtle">
        {props.value.trim() === ''
          ? 'No answer entered.'
          : canonical === null
            ? 'This entry is not a number and will be marked as a wrong answer.'
            : `Will be read as ${canonical}`}
      </p>

      <div className="keypad" role="group" aria-label="Numeric keypad">
        {DIGITS.map((digit) => (
          <button
            key={digit}
            type="button"
            className="keypad__key"
            onClick={() => append(digit)}
            aria-label={`Digit ${digit}`}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          className="keypad__key"
          disabled={!props.allowDecimal}
          onClick={() => append('.')}
          aria-label="Decimal point"
        >
          .
        </button>
        <button
          type="button"
          className="keypad__key"
          disabled={!props.allowNegative}
          onClick={() => append('-')}
          aria-label="Minus sign"
        >
          -
        </button>
        <button
          type="button"
          className="keypad__key keypad__key--wide"
          onClick={backspace}
          aria-label="Backspace"
        >
          Backspace
        </button>
      </div>
    </div>
  );
}
