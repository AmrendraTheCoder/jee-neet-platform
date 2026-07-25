import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '../../theme/ThemeProvider.js';
import { space } from '../../theme/tokens.js';
import { Text } from './Text.js';

export interface ScreenProps {
  readonly children: ReactNode;
  readonly title?: string;
  readonly subtitle?: string;
  /** Set false where the child is a list that must draw under the bottom inset. */
  readonly padBottom?: boolean;
}

/**
 * Screen shell: background, safe-area insets and an optional header.
 *
 * The header is a real `header` accessibility role so a screen-reader user can
 * jump between sections rather than swiping through every control.
 */
export function Screen(props: ScreenProps): ReactNode {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: insets.top,
        paddingBottom: props.padBottom === false ? 0 : insets.bottom,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      {props.title === undefined ? null : (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md }}>
          <Text variant="display" accessibilityRole="header">
            {props.title}
          </Text>
          {props.subtitle === undefined ? null : (
            <Text variant="caption" tone="muted" style={{ marginTop: space.xs }}>
              {props.subtitle}
            </Text>
          )}
        </View>
      )}
      {props.children}
    </View>
  );
}
