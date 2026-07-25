/**
 * The routing decision between native rendering and the screen's math WebView.
 *
 * One component so the decision is made in one place and can be audited in one
 * place. Feature code renders `<QuestionBody />` and never reaches for
 * `MathSurface` directly.
 *
 * Routing rule:
 *   - `containsMath === false` (server-computed): fully native. No WebView is
 *     instantiated at all, which is the case for roughly two in five items.
 *   - otherwise: the stem and the options go into the single per-screen surface,
 *     because an option whose body is an integral cannot be typeset natively and
 *     a second WebView is not available at any price (FR-MTH-05).
 */

import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';
import { View } from 'react-native';

import type { OptionId } from '@platform/domain';
import { asOptionId } from '@platform/domain';
import { space } from '../../theme/tokens.js';
import type { PracticeQuestion } from '../../lib/api/types.js';
import { MathSurface } from './MathSurface.js';
import { NativeOptionList } from './NativeOptionList.js';
import { NativeProse } from './NativeProse.js';
import type { RenderableOption } from './protocol.js';

export interface QuestionBodyProps {
  readonly owner: string;
  readonly question: PracticeQuestion;
  readonly selectedOptionIds: readonly OptionId[];
  readonly multiSelect: boolean;
  readonly onToggleOption: (optionId: OptionId) => void;
  readonly onRenderError?: (detail: string) => void;
  readonly disabled?: boolean;
  /** Supplied only after the server has revealed the result (tutor mode). */
  readonly correctOptionIds?: readonly OptionId[];
}

export function QuestionBody(props: QuestionBodyProps): ReactNode {
  const { question, selectedOptionIds, onToggleOption } = props;

  const surfaceOptions = useMemo<readonly RenderableOption[]>(
    () =>
      question.options.map((option) => ({
        optionId: option.optionId,
        blocks: option.blocks,
        spokenText: option.spokenText,
        plainText: option.plainText,
        selected: selectedOptionIds.includes(option.optionId),
      })),
    [question.options, selectedOptionIds],
  );

  const handleSurfaceSelect = useCallback(
    (rawOptionId: string) => {
      // The surface hands back the id it was given. Re-branding it here rather
      // than trusting a bare string keeps the identity discipline visible at the
      // one boundary where it leaves the type system.
      onToggleOption(asOptionId(rawOptionId));
    },
    [onToggleOption],
  );

  if (!question.containsMath) {
    return (
      <View style={{ gap: space.lg }}>
        <NativeProse
          blocks={question.stem}
          plainTextFallback={question.stemPlainText}
          selectable
        />
        {question.options.length === 0 ? null : (
          <NativeOptionList
            options={question.options}
            selectedOptionIds={selectedOptionIds}
            multiSelect={props.multiSelect}
            onToggle={onToggleOption}
            {...(props.disabled === undefined ? {} : { disabled: props.disabled })}
            {...(props.correctOptionIds === undefined
              ? {}
              : { correctOptionIds: props.correctOptionIds })}
          />
        )}
      </View>
    );
  }

  return (
    <MathSurface
      owner={props.owner}
      docId={String(question.questionVersionId)}
      blocks={question.stem}
      options={surfaceOptions}
      multiSelect={props.multiSelect}
      onSelectOption={handleSurfaceSelect}
      {...(props.onRenderError === undefined ? {} : { onRenderError: props.onRenderError })}
    />
  );
}
