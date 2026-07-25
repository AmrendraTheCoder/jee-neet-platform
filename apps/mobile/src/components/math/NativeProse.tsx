/**
 * Native rendering for non-mathematical content (FR-MTH-05).
 *
 * Roughly two in five items in this bank are pure prose. Rendering those through
 * a WebView would pay the whole WebView cost for text a `Text` node draws for
 * nothing — and it is the path that makes list rows affordable at all, since a
 * list may never mount a WebView.
 *
 * Where a math block reaches this component (which happens only in a list row,
 * where no WebView is permitted) it degrades to the server-supplied plain-text
 * projection with a visible marker, rather than to raw LaTeX. A row reading
 * "\\frac{d}{dx}" is worse than a row reading "contains an equation".
 */

import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useColors } from '../../theme/ThemeProvider.js';
import { radius, space } from '../../theme/tokens.js';
import { Text } from '../ui/Text.js';
import type { ContentBlock } from './protocol.js';

export interface NativeProseProps {
  readonly blocks: readonly ContentBlock[];
  /** Server-computed LaTeX-stripped projection, used where a block is not text. */
  readonly plainTextFallback: string;
  readonly numberOfLines?: number;
  readonly variant?: 'body' | 'caption' | 'bodyStrong';
  readonly selectable?: boolean;
}

export function NativeProse(props: NativeProseProps): ReactNode {
  const colors = useColors();
  const variant = props.variant ?? 'body';
  const hasNonText = props.blocks.some((block) => block.kind !== 'text');

  if (hasNonText) {
    return (
      <View style={{ gap: space.xs }}>
        <Text
          variant={variant}
          {...(props.numberOfLines === undefined ? {} : { numberOfLines: props.numberOfLines })}
        >
          {props.plainTextFallback}
        </Text>
        <View
          style={{
            alignSelf: 'flex-start',
            paddingHorizontal: space.sm,
            paddingVertical: space.xxs,
            borderRadius: radius.sm,
            backgroundColor: colors.surfaceSunken,
          }}
        >
          <Text variant="caption" tone="muted">
            Contains typeset notation. Open to read it.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <Text
      variant={variant}
      {...(props.numberOfLines === undefined ? {} : { numberOfLines: props.numberOfLines })}
      {...(props.selectable === undefined ? {} : { selectable: props.selectable })}
    >
      {props.blocks.map((block) => (block.kind === 'text' ? block.value : '')).join('')}
    </Text>
  );
}
