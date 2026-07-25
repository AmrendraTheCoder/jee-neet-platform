/**
 * Button.
 *
 * Enforces the 44pt minimum through `minHeight`/`minWidth` rather than a fixed
 * height, so the target still meets the floor when the label wraps to three
 * lines at 200% text scale (FR-A11Y-01, FR-A11Y-02).
 */

import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useColors } from '../../theme/ThemeProvider.js';
import { MIN_TOUCH_TARGET, radius, space } from '../../theme/tokens.js';
import { usePressScale } from '../../lib/motion/transitions.js';
import { useReduceMotion } from '../../lib/motion/useReduceMotion.js';
import { Text } from './Text.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: ButtonVariant;
  readonly disabled?: boolean;
  readonly accessibilityHint?: string;
  readonly fullWidth?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly leading?: ReactNode;
}

export function Button(props: ButtonProps): ReactNode {
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  const press = usePressScale(reduceMotion);
  const variant = props.variant ?? 'primary';
  const disabled = props.disabled ?? false;

  const background =
    variant === 'primary'
      ? colors.accent
      : variant === 'danger'
        ? colors.danger
        : variant === 'secondary'
          ? colors.surfaceRaised
          : 'transparent';

  const borderColor =
    variant === 'secondary' ? colors.border : variant === 'ghost' ? 'transparent' : background;

  const tone = variant === 'primary' || variant === 'danger' ? 'inverse' : 'default';

  return (
    <Animated.View style={[press.style, props.fullWidth === true ? { alignSelf: 'stretch' } : null]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.label}
        accessibilityState={{ disabled }}
        {...(props.accessibilityHint === undefined ? {} : { accessibilityHint: props.accessibilityHint })}
        disabled={disabled}
        onPress={props.onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[
          {
            minHeight: MIN_TOUCH_TARGET,
            minWidth: MIN_TOUCH_TARGET,
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor,
            backgroundColor: background,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: space.sm,
            opacity: disabled ? 0.45 : 1,
          },
          props.style,
        ]}
      >
        {props.leading === undefined ? null : <View>{props.leading}</View>}
        <Text variant="bodyStrong" tone={variant === 'ghost' ? 'accent' : tone} align="center">
          {props.label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}
