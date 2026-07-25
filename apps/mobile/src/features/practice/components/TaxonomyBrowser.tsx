/**
 * Subject > Chapter > Topic > Sub-topic browse with mastery (FR-TAX-01).
 *
 * Uses a recycling list because a subject can carry several hundred sub-topics.
 * Three settings here are not defaults and each exists for a documented reason:
 *
 *  - `maintainVisibleContentPosition` is disabled. It is on by default and moves
 *    rows when the underlying data reorders, which happens here every time a
 *    mastery figure or a due count syncs in. A row that slides away under the
 *    finger is worse than a scroll position that stays put.
 *  - `getItemType` keys on the node level, so a chapter row and a sub-topic row
 *    never share a recycling pool and never inherit each other's height.
 *  - the list is never nested inside a scroll view; the header is a list header.
 *
 * No row mounts a WebView. Node names are plain text by construction.
 */

import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { View } from 'react-native';
import { FlashList } from '@shopify/flash-list';

import { useColors } from '../../../theme/ThemeProvider.js';
import { MIN_TOUCH_TARGET, radius, space } from '../../../theme/tokens.js';
import { masteryLabel } from '../../../lib/a11y/labels.js';
import { Card } from '../../../components/ui/Card.js';
import { ProgressBar } from '../../../components/ui/ProgressBar.js';
import { Text } from '../../../components/ui/Text.js';
import type { TaxonomyNode } from '../../../lib/api/types.js';

export interface TaxonomyBrowserProps {
  readonly nodes: readonly TaxonomyNode[];
  readonly selectedIds: readonly string[];
  readonly onOpen: (node: TaxonomyNode) => void;
  readonly onToggleSelect: (node: TaxonomyNode) => void;
  readonly header?: ReactNode;
  readonly emptyMessage: string;
}

function MasteryRow({ node }: { readonly node: TaxonomyNode }): ReactNode {
  const colors = useColors();

  if (node.mastery === null) {
    return (
      <View style={{ gap: space.xs }}>
        <Text variant="caption" tone="muted">
          Not enough attempts yet to show mastery
        </Text>
        <View style={{ height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken }} />
      </View>
    );
  }

  const percent = Math.round(node.mastery * 100);
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="caption" tone="muted">
        {`Mastery ${String(percent)}%`}
      </Text>
      <ProgressBar
        value={node.mastery}
        label={`Mastery ${String(percent)} percent`}
        tone={node.mastery >= 0.75 ? 'success' : node.mastery >= 0.4 ? 'accent' : 'warning'}
      />
    </View>
  );
}

export function TaxonomyBrowser(props: TaxonomyBrowserProps): ReactNode {
  const colors = useColors();

  const renderItem = useCallback(
    ({ item }: { readonly item: TaxonomyNode }) => {
      const selected = props.selectedIds.includes(item.id);
      const isLeaf = item.level === 'SUB_TOPIC';

      return (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
          <Card
            onPress={() => {
              if (isLeaf) props.onToggleSelect(item);
              else props.onOpen(item);
            }}
            accessibilityLabel={masteryLabel(
              item.name,
              item.mastery === null ? null : item.mastery * 100,
              item.dueCardCount,
            )}
            accessibilityHint={
              isLeaf ? 'Adds or removes this sub-topic from your session' : 'Opens the next level'
            }
            style={{
              borderColor: selected ? colors.accent : colors.border,
              backgroundColor: selected ? colors.accentMuted : colors.surface,
              minHeight: MIN_TOUCH_TARGET,
            }}
          >
            <View style={{ gap: space.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{item.name}</Text>
                  <Text variant="caption" tone="muted">
                    {`${String(item.questionCount)} questions`}
                    {item.dueCardCount > 0 ? ` · ${String(item.dueCardCount)} due for review` : ''}
                  </Text>
                </View>
                {isLeaf ? null : (
                  <Text variant="caption" tone="accent">
                    Open
                  </Text>
                )}
              </View>
              <MasteryRow node={item} />
            </View>
          </Card>
        </View>
      );
    },
    [colors, props],
  );

  return (
    <FlashList
      data={props.nodes}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      getItemType={(item) => item.level}
      maintainVisibleContentPosition={{ disabled: true }}
      ListHeaderComponent={props.header === undefined ? null : <>{props.header}</>}
      ListEmptyComponent={
        <View style={{ padding: space.xl }}>
          <Text tone="muted">{props.emptyMessage}</Text>
        </View>
      }
      contentContainerStyle={{ paddingVertical: space.md }}
    />
  );
}
