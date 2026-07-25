/**
 * Filter chip carrying a live matching count (FR-PRC-04).
 *
 * The count is not decoration. It is what turns the builder from a form into a
 * conversation: the student can see that "incorrect + hard + 2019-2023" leaves
 * eleven questions *before* committing, which is the whole reason FR-PRC-05
 * exists as a fallback rather than as the primary path.
 *
 * A count of zero renders the chip as still selectable but visibly inert, and
 * never as absent. Hiding a zero-count filter makes the bank look smaller than
 * it is and hides the fact that a previously chosen constraint caused it.
 */

import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useColors } from '../../theme/ThemeProvider.js';
import { MIN_TOUCH_TARGET, radius, space } from '../../theme/tokens.js';
import { useValueChangeFlash } from '../../lib/motion/transitions.js';
import { useReduceMotion } from '../../lib/motion/useReduceMotion.js';
import { filterChipLabel } from '../../lib/a11y/labels.js';
import { Text } from './Text.js';

export interface ChipProps {
  readonly label: string;
  readonly matchingCount: number;
  readonly selected: boolean;
  readonly onToggle: () => void;
  /** Shown as a hint, e.g. why a state filter means what it means. */
  readonly hint?: string;
  readonly countPending?: boolean;
}

export function Chip(props: ChipProps): ReactNode {
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  const countFlash = useValueChangeFlash(props.matchingCount, reduceMotion);
  const empty = props.matchingCount === 0;

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: props.selected }}
      accessibilityLabel={filterChipLabel({
        name: props.label,
        matchingCount: props.matchingCount,
        selected: props.selected,
      })}
      {...(props.hint === undefined ? {} : { accessibilityHint: props.hint })}
      onPress={props.onToggle}
      style={{
        minHeight: MIN_TOUCH_TARGET,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: props.selected ? colors.accent : colors.border,
        backgroundColor: props.selected ? colors.accentMuted : colors.surface,
        opacity: empty && !props.selected ? 0.6 : 1,
      }}
    >
      <Text variant="bodyStrong" tone={props.selected ? 'accent' : 'default'}>
        {props.label}
      </Text>
      <Animated.View style={countFlash}>
        <View
          style={{
            minWidth: 28,
            paddingHorizontal: space.sm,
            paddingVertical: space.xxs,
            borderRadius: radius.pill,
            backgroundColor: props.selected ? colors.accent : colors.surfaceSunken,
            alignItems: 'center',
          }}
        >
          <Text variant="caption" tone={props.selected ? 'inverse' : 'muted'}>
            {props.countPending === true ? '…' : String(props.matchingCount)}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}
