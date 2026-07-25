import type { OptionId } from '@platform/domain';
import type { AttemptOption } from '../../lib/api/types.js';
import { PrerenderedMath } from '../../components/math/PrerenderedMath.js';
import './attempt.css';

/**
 * The option list.
 *
 * The letter beside each option is derived from its POSITION IN THE PERSISTED
 * ORDER and is a rendering artefact only (FR-ITM-03). It never travels: the
 * value handed to `onToggle` is the option's UUID, and the wire format is
 * `{question_version_id, option_id}` (FR-ATT-12). A letter or an index in that
 * payload is the silent, catastrophic bug class this product is built to avoid
 * — under option shuffling it records every answer against the wrong option
 * and presents as poor performance rather than as an error.
 */
export function OptionList(props: {
  readonly options: readonly AttemptOption[];
  readonly selected: readonly OptionId[];
  readonly multi: boolean;
  readonly onToggle: (optionId: OptionId) => void;
  readonly questionLabel: string;
}): JSX.Element {
  const selectedSet = new Set(props.selected.map(String));

  return (
    <fieldset className="options">
      <legend className="visually-hidden">
        {props.questionLabel}
        {props.multi ? ', select all that apply' : ', select one answer'}
      </legend>
      {props.options.map((option, index) => {
        const isSelected = selectedSet.has(String(option.optionId));
        const letter = String.fromCharCode(65 + index);
        return (
          <label
            key={String(option.optionId)}
            className={`option${isSelected ? ' option--selected' : ''}`}
          >
            <input
              className="option__control"
              type={props.multi ? 'checkbox' : 'radio'}
              name={props.multi ? String(option.optionId) : props.questionLabel}
              checked={isSelected}
              onChange={() => props.onToggle(option.optionId)}
            />
            <span className="option__letter" aria-hidden="true">
              {letter}
            </span>
            <span className="option__body">
              <PrerenderedMath html={option.bodyHtml} spokenText={option.spokenText} />
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
