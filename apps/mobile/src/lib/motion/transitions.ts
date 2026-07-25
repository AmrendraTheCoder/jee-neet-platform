/**
 * The only sanctioned way to animate in this client.
 *
 * Everything routes through these helpers so the reduce-motion collapse and the
 * duration ceiling are enforced in one place rather than remembered at ~80 call
 * sites. Ad-hoc `withSpring` in a feature file is a review finding.
 *
 * Only `opacity` and `transform` are animated. Animating width, height, top or
 * left forces a layout pass every frame, which is the difference between smooth
 * and visibly janky on a Snapdragon 4-series device.
 */

import { useEffect } from 'react';
import type { WithTimingConfig } from 'react-native-reanimated';
import { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import type { DurationToken, EasingToken } from './tokens.js';
import { duration, easing, REDUCED_MOTION_DURATION, STAGGER_MAX_CHILDREN, STAGGER_STEP_MS } from './tokens.js';

export function timing(
  token: DurationToken,
  curve: EasingToken,
  reduceMotion: boolean,
): WithTimingConfig {
  if (reduceMotion) {
    return { duration: REDUCED_MOTION_DURATION, easing: Easing.linear };
  }
  const [x1, y1, x2, y2] = easing[curve];
  return { duration: duration[token], easing: Easing.bezier(x1, y1, x2, y2) };
}

/**
 * Stagger delay for the nth child of an entering list.
 *
 * Returns zero past the cap so a 90-item list does not schedule 90 concurrent
 * animations, and so the tail of a long list is never held back waiting for a
 * delay the student will not perceive anyway.
 */
export function staggerDelay(index: number, reduceMotion: boolean): number {
  if (reduceMotion) return 0;
  if (index >= STAGGER_MAX_CHILDREN) return 0;
  return index * STAGGER_STEP_MS;
}

/**
 * Entrance: fade with a 6pt rise. Emphasized-decelerate, per the token file.
 *
 * The rise is deliberately small. A large translation on entry reads as a
 * transition between contexts, and a list row appearing is not that.
 */
export function useEnter(index: number, reduceMotion: boolean): ReturnType<typeof useAnimatedStyle> {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      staggerDelay(index, reduceMotion),
      withTiming(1, timing('element', 'decelerate', reduceMotion)),
    );
  }, [index, progress, reduceMotion]);

  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * (reduceMotion ? 0 : 6) }],
  }));
}

/**
 * Press feedback: a 2% scale-down held only while the finger is down.
 *
 * No release overshoot. The control returns to rest on the standard curve, which
 * is what a physical button does.
 */
export function usePressScale(reduceMotion: boolean): {
  readonly style: ReturnType<typeof useAnimatedStyle>;
  readonly onPressIn: () => void;
  readonly onPressOut: () => void;
} {
  const pressed = useSharedValue(0);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.02 }],
  }));

  return {
    style,
    onPressIn: () => {
      pressed.value = withTiming(1, timing('state', 'accelerate', reduceMotion));
    },
    onPressOut: () => {
      pressed.value = withTiming(0, timing('state', 'standard', reduceMotion));
    },
  };
}

/** Cross-fade a value that changes in place, e.g. a live filter count. */
export function useValueChangeFlash(
  dependency: number | string,
  reduceMotion: boolean,
): ReturnType<typeof useAnimatedStyle> {
  const progress = useSharedValue(1);

  useEffect(() => {
    progress.value = 0.35;
    progress.value = withTiming(1, timing('state', 'standard', reduceMotion));
  }, [dependency, progress, reduceMotion]);

  return useAnimatedStyle(() => ({ opacity: progress.value }));
}
