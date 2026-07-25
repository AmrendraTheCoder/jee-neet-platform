/**
 * Inline status banner.
 *
 * Used for the constraint-relaxation notice (FR-PRC-05), the pending-sync
 * indicator (FR-SYN-05) and the offline notice. Deliberately not a toast: a
 * toast that disappears after three seconds cannot carry "we widened the year
 * range from 2019-2023 to 2015-2025", which the student must be able to read at
 * their own pace and act on.
 *
 * Copy passed here goes through the same discipline as the rest of the product:
 * no failure framing, no shaming (FR-A11Y-09).
 */

import type { ReactNode } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useColors } from '../../theme/ThemeProvider.js';
import { radius, space } from '../../theme/tokens.js';
import { useEnter } from '../../lib/motion/transitions.js';
import { useReduceMotion } from '../../lib/motion/useReduceMotion.js';
import { Button } from './Button.js';
import { Text } from './Text.js';

export type BannerTone = 'info' | 'success' | 'warning' | 'danger';

export interface BannerProps {
  readonly title: string;
  readonly body?: string;
  readonly tone?: BannerTone;
  readonly action?: { readonly label: string; readonly onPress: () => void };
}

export function Banner(props: BannerProps): ReactNode {
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  const enter = useEnter(0, reduceMotion);
  const tone = props.tone ?? 'info';

  const background =
    tone === 'success'
      ? colors.successMuted
      : tone === 'warning'
        ? colors.warningMuted
        : tone === 'danger'
          ? colors.dangerMuted
          : colors.accentMuted;

  const accent =
    tone === 'success'
      ? colors.success
      : tone === 'warning'
        ? colors.warning
        : tone === 'danger'
          ? colors.danger
          : colors.accent;

  return (
    <Animated.View
      style={[
        enter,
        {
          backgroundColor: background,
          borderRadius: radius.md,
          borderLeftWidth: 3,
          borderLeftColor: accent,
          padding: space.md,
          gap: space.sm,
        },
      ]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={props.body === undefined ? props.title : `${props.title}. ${props.body}`}
    >
      <Text variant="bodyStrong">{props.title}</Text>
      {props.body === undefined ? null : (
        <Text variant="caption" tone="muted">
          {props.body}
        </Text>
      )}
      {props.action === undefined ? null : (
        <View style={{ alignSelf: 'flex-start' }}>
          <Button variant="ghost" label={props.action.label} onPress={props.action.onPress} />
        </View>
      )}
    </Animated.View>
  );
}
