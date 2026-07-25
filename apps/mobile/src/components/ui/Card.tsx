import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useColors } from '../../theme/ThemeProvider.js';
import { radius, space } from '../../theme/tokens.js';
import { usePressScale } from '../../lib/motion/transitions.js';
import { useReduceMotion } from '../../lib/motion/useReduceMotion.js';

export interface CardProps {
  readonly children: ReactNode;
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  readonly padded?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * Surface container.
 *
 * Elevation is expressed with a border and a background step rather than a
 * shadow. Shadows on Android are rendered by the platform elevation API, which
 * forces an extra draw pass per card; a 40-row practice list pays for that on
 * every frame of a fling.
 */
export function Card(props: CardProps): ReactNode {
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  const press = usePressScale(reduceMotion);

  const style: StyleProp<ViewStyle> = [
    {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: props.padded === false ? 0 : space.lg,
    },
    props.style,
  ];

  if (props.onPress === undefined) {
    return <View style={style}>{props.children}</View>;
  }

  return (
    <Animated.View style={press.style}>
      <Pressable
        accessibilityRole="button"
        {...(props.accessibilityLabel === undefined
          ? {}
          : { accessibilityLabel: props.accessibilityLabel })}
        {...(props.accessibilityHint === undefined
          ? {}
          : { accessibilityHint: props.accessibilityHint })}
        onPress={props.onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={style}
      >
        {props.children}
      </Pressable>
    </Animated.View>
  );
}
