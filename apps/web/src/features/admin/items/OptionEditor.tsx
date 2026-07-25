import type { OptionId } from '@platform/domain';
import type { AuthoredOption } from '../../../lib/api/types.js';
import { Button } from '../../../components/ui/Button.js';
import { Checkbox, Field, TextArea } from '../../../components/ui/Field.js';
import { LatexPreview } from '../../../components/math/PrerenderedMath.js';
import '../admin.css';

/**
 * Option authoring.
 *
 * Options carry stable UUID identity from the moment they are created
 * (FR-ITM-03). The letter beside each row is derived from its index for the
 * author's convenience and is never persisted — reusing an option UUID for
 * different text, or reasoning about options as A/B/C/D, is how a key ends up
 * pointing at the wrong thing after an edit.
 */
export function OptionEditor(props: {
  readonly options: readonly AuthoredOption[];
  readonly multi: boolean;
  readonly onChange: (options: readonly AuthoredOption[]) => void;
  readonly rationaleErrors: ReadonlyMap<number, string>;
}): JSX.Element {
  const update = (index: number, patch: Partial<AuthoredOption>): void => {
    props.onChange(
      props.options.map((option, i) => (i === index ? { ...option, ...patch } : option)),
    );
  };

  const setCorrect = (index: number, isCorrect: boolean): void => {
    if (props.multi) {
      update(index, { isCorrect });
      return;
    }
    // Single-answer: marking one correct clears the others, so the state can
    // never hold two keys for a type that admits one.
    props.onChange(props.options.map((option, i) => ({ ...option, isCorrect: i === index && isCorrect })));
  };

  return (
    <div className="option-editor">
      {props.options.map((option, index) => (
        <div key={String(option.optionId)} className="option-editor__row">
          <div className="option-editor__head">
            <span className="option__letter">{String.fromCharCode(65 + index)}</span>
            <Checkbox
              checked={option.isCorrect}
              onChange={(checked) => setCorrect(index, checked)}
              label={props.multi ? 'Correct option' : 'This is the answer'}
            />
            <div className="spacer" />
            <span className="subtle mono">{String(option.optionId).slice(0, 8)}</span>
            <Button
              variant="quiet"
              onClick={() => props.onChange(props.options.filter((_, i) => i !== index))}
              disabled={props.options.length <= 2}
            >
              Remove
            </Button>
          </div>

          <Field label="Option text (LaTeX)">
            {({ id }) => (
              <TextArea
                id={id}
                rows={2}
                monospace
                value={option.latex}
                onChange={(latex) => update(index, { latex })}
              />
            )}
          </Field>

          {option.latex.trim() === '' ? null : (
            <div className="option-editor__preview">
              <LatexPreview source={option.latex} />
            </div>
          )}

          <Field
            label="Why this option is wrong"
            hint="Mandatory for every option. Explain the misconception, not the verdict."
            error={props.rationaleErrors.get(index)}
            required
          >
            {({ id, describedBy, invalid }) => (
              <TextArea
                id={id}
                rows={2}
                value={option.rationale}
                invalid={invalid}
                describedBy={describedBy}
                onChange={(rationale) => update(index, { rationale })}
              />
            )}
          </Field>
        </div>
      ))}

      <Button
        variant="secondary"
        onClick={() =>
          props.onChange([
            ...props.options,
            {
              optionId: crypto.randomUUID() as OptionId,
              latex: '',
              rationale: '',
              isCorrect: false,
              pinnedPosition: null,
            },
          ])
        }
      >
        Add option
      </Button>
    </div>
  );
}
