import type { ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useEffect } from 'react';

import { useColors } from '../../theme/ThemeProvider.js';
import { radius } from '../../theme/tokens.js';
import { timing } from '../../lib/motion/transitions.js';
import { useReduceMotion } from '../../lib/motion/useReduceMotion.js';

export interface ProgressBarProps {
  /** 0..1. Values outside the range are clamped rather than throwing. */
  readonly value: number;
  readonly label: string;
  readonly tone?: 'accent' | 'success' | 'warning';
  readonly height?: number;
}

/**
 * Determinate progress.
 *
 * Animates `scaleX` rather than `width` — a width animation forces a layout pass
 * per frame, and this component appears inside scrolling lists where that cost
 * compounds.
 */
export function ProgressBar(props: ProgressBarProps): ReactNode {
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  const clamped = Math.max(0, Math.min(1, props.value));
  const progress = useSharedValue(clamped);

  useEffect(() => {
    progress.value = withTiming(clamped, timing('view', 'standard', reduceMotion));
  }, [clamped, progress, reduceMotion]);

  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.value }] }));

  const tone =
    props.tone === 'success' ? colors.success : props.tone === 'warning' ? colors.warning : colors.accent;
  const height = props.height ?? 6;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={props.label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={{
        height,
        borderRadius: radius.pill,
        backgroundColor: colors.surfaceSunken,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={[
          fill,
          {
            height,
            backgroundColor: tone,
            borderRadius: radius.pill,
            width: '100%',
            transformOrigin: 'left',
          },
        ]}
      />
    </View>
  );
}
