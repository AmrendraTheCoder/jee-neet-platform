import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { useColors } from '../../theme/ThemeProvider.js';
import { MIN_TOUCH_TARGET, radius, space } from '../../theme/tokens.js';
import { Text } from './Text.js';

export interface Segment<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
}

export interface SegmentedControlProps<T extends string> {
  readonly segments: readonly Segment<T>[];
  readonly value: T;
  readonly onChange: (next: T) => void;
  readonly accessibilityLabel: string;
}

/**
 * Mutually exclusive choice, used for Tutor Mode versus Timed Mode.
 *
 * Exposed as radio buttons rather than tabs, because these are not two views of
 * the same content — they are two different session behaviours, and a student
 * choosing one is making a decision, not navigating.
 */
export function SegmentedControl<T extends string>(props: SegmentedControlProps<T>): ReactNode {
  const colors = useColors();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={props.accessibilityLabel}
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surfaceSunken,
        borderRadius: radius.md,
        padding: space.xxs,
        gap: space.xxs,
      }}
    >
      {props.segments.map((segment) => {
        const selected = segment.value === props.value;
        return (
          <Pressable
            key={segment.value}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            accessibilityLabel={segment.label}
            {...(segment.hint === undefined ? {} : { accessibilityHint: segment.hint })}
            onPress={() => {
              props.onChange(segment.value);
            }}
            style={{
              flex: 1,
              minHeight: MIN_TOUCH_TARGET,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
              borderRadius: radius.sm,
              backgroundColor: selected ? colors.surface : 'transparent',
              borderWidth: 1,
              borderColor: selected ? colors.border : 'transparent',
            }}
          >
            <Text variant="bodyStrong" tone={selected ? 'accent' : 'muted'} align="center">
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
