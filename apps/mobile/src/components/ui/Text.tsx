/**
 * Typed text primitive.
 *
 * Wrapping the platform component is what makes "no capped font scaling"
 * enforceable: nothing here sets `maxFontSizeMultiplier`, so the OS text size
 * carries straight through at up to 200% (FR-A11Y-01) and every layout in the
 * app is forced to cope rather than being quietly protected.
 */

import type { ReactNode } from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import { Text as RNText } from 'react-native';

import { useColors } from '../../theme/ThemeProvider.js';
import type { TypeToken } from '../../theme/tokens.js';
import { type as typeScale } from '../../theme/tokens.js';

export type TextTone = 'default' | 'muted' | 'accent' | 'success' | 'warning' | 'danger' | 'inverse';

export interface AppTextProps {
  readonly children: ReactNode;
  readonly variant?: TypeToken;
  readonly tone?: TextTone;
  readonly align?: TextStyle['textAlign'];
  readonly numberOfLines?: number;
  readonly style?: StyleProp<TextStyle>;
  readonly accessibilityRole?: 'header' | 'text' | 'summary';
  readonly selectable?: boolean;
}

export function Text(props: AppTextProps): ReactNode {
  const colors = useColors();
  const variant = props.variant ?? 'body';
  const tone = props.tone ?? 'default';

  const color =
    tone === 'muted'
      ? colors.textMuted
      : tone === 'accent'
        ? colors.accent
        : tone === 'success'
          ? colors.success
          : tone === 'warning'
            ? colors.warning
            : tone === 'danger'
              ? colors.danger
              : tone === 'inverse'
                ? colors.textInverse
                : colors.text;

  const base = typeScale[variant];

  return (
    <RNText
      style={[
        {
          fontSize: base.fontSize,
          lineHeight: base.lineHeight,
          fontWeight: base.fontWeight,
          color,
          ...(variant === 'mono' ? { fontFamily: 'monospace' } : {}),
          ...(props.align === undefined ? {} : { textAlign: props.align }),
        },
        props.style,
      ]}
      {...(props.numberOfLines === undefined ? {} : { numberOfLines: props.numberOfLines })}
      {...(props.accessibilityRole === undefined ? {} : { accessibilityRole: props.accessibilityRole })}
      {...(props.selectable === undefined ? {} : { selectable: props.selectable })}
    >
      {props.children}
    </RNText>
  );
}
