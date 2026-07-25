/**
 * Native option list, used for questions with no mathematics.
 *
 * This is the preferred path: real pressables, real accessibility roles, real
 * text scaling, no WebView. Questions that do contain mathematics render their
 * options inside the single math surface instead — see `MathSurface` for why.
 *
 * Selection is by `optionId` throughout. There is no code path in this component
 * that produces or consumes a positional index; the letter shown to the student
 * is a rendering artefact computed from the display position and is never sent
 * anywhere (FR-ITM-03, FR-ATT-12, EC-DATA-09).
 */

import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import type { OptionId } from '@platform/domain';
import { useColors } from '../../theme/ThemeProvider.js';
import { MIN_TOUCH_TARGET, radius, space } from '../../theme/tokens.js';
import { optionLabel } from '../../lib/a11y/labels.js';
import type { RenderableOptionPayload } from '../../lib/api/types.js';
import { Text } from '../ui/Text.js';
import { NativeProse } from './NativeProse.js';

export interface NativeOptionListProps {
  readonly options: readonly RenderableOptionPayload[];
  readonly selectedOptionIds: readonly OptionId[];
  readonly multiSelect: boolean;
  readonly onToggle: (optionId: OptionId) => void;
  readonly disabled?: boolean;
  /** Post-answer tutor-mode annotation, keyed by option identity. */
  readonly correctOptionIds?: readonly OptionId[];
}

export function NativeOptionList(props: NativeOptionListProps): ReactNode {
  const colors = useColors();
  const reveal = props.correctOptionIds !== undefined;

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Answer options"
      style={{ gap: space.sm }}
    >
      {props.options.map((option, index) => {
        const selected = props.selectedOptionIds.includes(option.optionId);
        const isCorrect = reveal && props.correctOptionIds?.includes(option.optionId) === true;
        const isWrongSelection = reveal && selected && !isCorrect;

        const borderColor = isCorrect
          ? colors.success
          : isWrongSelection
            ? colors.danger
            : selected
              ? colors.accent
              : colors.border;

        const background = isCorrect
          ? colors.successMuted
          : isWrongSelection
            ? colors.dangerMuted
            : selected
              ? colors.accentMuted
              : colors.surface;

        return (
          <Pressable
            key={String(option.optionId)}
            accessibilityRole={props.multiSelect ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: selected, disabled: props.disabled ?? false }}
            accessibilityLabel={optionLabel({
              position: index + 1,
              total: props.options.length,
              spokenText: option.spokenText,
              plainText: option.plainText,
              selected,
            })}
            disabled={props.disabled ?? false}
            onPress={() => {
              props.onToggle(option.optionId);
            }}
            style={{
              minHeight: MIN_TOUCH_TARGET,
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: space.md,
              padding: space.md,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor,
              backgroundColor: background,
            }}
          >
            <View
              accessible={false}
              style={{
                minWidth: 26,
                height: 26,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text variant="caption" tone={selected ? 'accent' : 'muted'}>
                {String.fromCharCode(65 + index)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <NativeProse blocks={option.blocks} plainTextFallback={option.plainText} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
