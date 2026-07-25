/**
 * The practice question navigator.
 *
 * The five states come from the shared domain engine (`paletteStateFor`), so
 * this client and the web attempt player derive them from exactly one
 * implementation. The states are derived from three orthogonal facts and are
 * never stored — which is what stops "marked for review" from becoming a variant
 * of the answer and silently clearing it.
 *
 * This is a practice navigator, not the examination palette. It is intentionally
 * smaller and simpler: the pixel-faithful five-colour palette with live counts
 * belongs to the ranked attempt player, which runs on the web client only (D2).
 */

import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import type { PaletteState, QuestionVersionId, Response } from '@platform/domain';
import { paletteStateFor } from '@platform/domain';

import { useColors } from '../../../theme/ThemeProvider.js';
import type { Palette } from '../../../theme/tokens.js';
import { MIN_TOUCH_TARGET, radius, space } from '../../../theme/tokens.js';
import { paletteEntryLabel } from '../../../lib/a11y/labels.js';
import { Card } from '../../../components/ui/Card.js';
import { Text } from '../../../components/ui/Text.js';

function colorFor(state: PaletteState, colors: Palette): string {
  switch (state) {
    case 'NOT_VISITED':
      return colors.stateNotVisited;
    case 'NOT_ANSWERED':
      return colors.stateNotAnswered;
    case 'ANSWERED':
      return colors.stateAnswered;
    case 'MARKED_FOR_REVIEW':
      return colors.stateMarked;
    case 'ANSWERED_AND_MARKED':
      return colors.stateAnsweredAndMarked;
  }
}

export interface SessionNavigatorProps {
  readonly order: readonly QuestionVersionId[];
  readonly responses: Readonly<Record<string, Response>>;
  readonly currentIndex: number;
  readonly onGoTo: (index: number) => void;
}

export function SessionNavigator(props: SessionNavigatorProps): ReactNode {
  const colors = useColors();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm }}
      accessibilityLabel="Question navigator"
    >
      {props.order.map((questionVersionId, index) => {
        const state = paletteStateFor(props.responses[String(questionVersionId)]);
        const isCurrent = index === props.currentIndex;
        return (
          <Card
            key={String(questionVersionId)}
            padded={false}
            onPress={() => {
              props.onGoTo(index);
            }}
            accessibilityLabel={paletteEntryLabel(index + 1, state)}
            accessibilityHint="Moves to this question"
            style={{
              minWidth: MIN_TOUCH_TARGET,
              minHeight: MIN_TOUCH_TARGET,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.md,
              borderWidth: isCurrent ? 2 : 1,
              borderColor: isCurrent ? colors.accent : colorFor(state, colors),
              backgroundColor: colors.surface,
            }}
          >
            <View style={{ alignItems: 'center', gap: 2, paddingHorizontal: space.sm }}>
              <Text variant="bodyStrong">{String(index + 1)}</Text>
              <View
                accessible={false}
                style={{
                  width: 16,
                  height: 3,
                  borderRadius: radius.pill,
                  backgroundColor: colorFor(state, colors),
                }}
              />
            </View>
          </Card>
        );
      })}
    </ScrollView>
  );
}
