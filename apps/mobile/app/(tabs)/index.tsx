import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';

import { Screen } from '~/components/ui/Screen.js';
import { Text } from '~/components/ui/Text.js';
import { Button } from '~/components/ui/Button.js';
import { Banner } from '~/components/ui/Banner.js';
import { SegmentedControl } from '~/components/ui/SegmentedControl.js';
import type { Segment } from '~/components/ui/SegmentedControl.js';
import { FilterChipRow } from '~/features/practice/components/FilterChipRow.js';
import { TaxonomyBrowser } from '~/features/practice/components/TaxonomyBrowser.js';
import { RelaxationNotice } from '~/features/practice/components/RelaxationNotice.js';
import { useBuilder } from '~/features/practice/useBuilder.js';
import { createLocalSession, loadTaxonomyChildren } from '~/features/practice/repository.js';
import { shortfallExplanation } from '~/features/practice/relaxation.js';
import type { RelaxationResult } from '~/features/practice/relaxation.js';
import type { PracticeMode, TaxonomyNode } from '~/lib/api/types.js';
import { useSyncState } from '~/lib/offline/useSyncState.js';
import { space } from '~/theme/tokens.js';
import type { QuestionVersionId } from '@platform/domain';

/**
 * The session builder.
 *
 * The whole screen is built around one claim: a student should never press
 * Start and find out afterwards that their filters matched eleven questions.
 * Every chip carries its live matching count, and when the criteria cannot fill
 * the target the builder widens them itself and says which constraint it moved
 * and what it became. Silently returning a short session is the behaviour this
 * screen exists to avoid — it reads as an empty question bank rather than as a
 * narrow filter, and the student has no way to tell which.
 */

const MODES: readonly Segment<PracticeMode>[] = [
  { value: 'TUTOR', label: 'Tutor', hint: 'Solution after each answer' },
  { value: 'TIMED', label: 'Timed', hint: 'A pace target, nothing auto-submits' },
];

const MODE_HINTS: Readonly<Record<PracticeMode, string>> = {
  TUTOR: 'The solution unlocks once you have answered each question.',
  // Practice is never ranked and never server-deadlined: the clock here is a
  // pace target the student set for themselves, and running past it submits
  // nothing.
  TIMED: 'Shows a target pace as you work. Running over does not end the session.',
};

export default function PracticeBuilderScreen(): React.ReactNode {
  const builder = useBuilder();
  const { online } = useSyncState();

  const [mode, setMode] = useState<PracticeMode>('TUTOR');
  const [nodes, setNodes] = useState<readonly TaxonomyNode[]>([]);
  const [parentId, setParentId] = useState<string | null>(null);
  const [resolution, setResolution] = useState<RelaxationResult | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTaxonomyChildren(parentId)
      .then((next) => {
        if (!cancelled) setNodes(next);
      })
      .catch(() => {
        if (!cancelled) setNodes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [parentId]);

  const start = useCallback(async (): Promise<void> => {
    setStarting(true);
    setError(null);
    try {
      const result = await builder.resolve();
      setResolution(result);

      if (result.questionVersionIds.length === 0) {
        // Nothing to start. The notice above explains why in words rather than
        // leaving the student with a disabled button and no reason.
        return;
      }

      // Local, not server-allocated: a practice session must start on a train
      // with no signal. The id is stable so a resumed session reattaches to the
      // same row rather than forking a second one.
      const sessionId = `local-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
      await createLocalSession({
        sessionId,
        mode,
        questionVersionIds: result.questionVersionIds as readonly QuestionVersionId[],
        durationSeconds: null,
      });

      router.push({
        pathname: '/practice/[sessionId]',
        params: { sessionId, mode, order: result.questionVersionIds.join(',') },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not build that session.');
    } finally {
      setStarting(false);
    }
  }, [builder, mode]);

  const selectedCount = builder.criteria.subTopicIds.length + builder.criteria.chapterIds.length;

  return (
    <Screen title="Practice" subtitle="Build a set, then work through it at your own pace.">
      <ScrollView contentContainerStyle={{ gap: space.lg, paddingBottom: space.xl }}>
        {online ? null : (
          <View style={{ paddingHorizontal: space.lg }}>
            <Banner
              tone="info"
              title="Offline"
              body="You can still practise. Answers are saved on this device and sent when you reconnect."
            />
          </View>
        )}

        <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
          <Text variant="heading" accessibilityRole="header">
            Mode
          </Text>
          <SegmentedControl
            segments={MODES}
            value={mode}
            onChange={setMode}
            accessibilityLabel="Practice mode"
          />
          <Text variant="caption" tone="muted">
            {MODE_HINTS[mode]}
          </Text>
        </View>

        <FilterChipRow
          counts={builder.counts}
          counting={builder.counting}
          selectedStates={builder.criteria.states}
          selectedDifficulties={builder.criteria.difficulties}
          onToggleState={builder.toggleState}
          onToggleDifficulty={builder.toggleDifficulty}
        />

        <View style={{ gap: space.sm }}>
          <View style={{ paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Text variant="heading" accessibilityRole="header">
              Syllabus
            </Text>
            {parentId === null ? null : (
              <Button label="Back" variant="ghost" onPress={() => setParentId(null)} />
            )}
          </View>
          <TaxonomyBrowser
            nodes={nodes}
            selectedIds={[...builder.criteria.chapterIds, ...builder.criteria.subTopicIds]}
            onOpen={(node) => setParentId(node.id)}
            onToggleSelect={(node) => {
              if (node.level === 'SUB_TOPIC') builder.toggleSubTopic(node.id);
              else builder.toggleChapter(node.id);
            }}
            emptyMessage="Nothing here yet. Sync once on a connection to fill the syllabus."
          />
        </View>

        {resolution === null ? null : (
          <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
            <RelaxationNotice
              result={resolution}
              targetCount={builder.criteria.targetCount}
              onEditFilters={() => setResolution(null)}
            />
            {resolution.questionVersionIds.length === 0 ? (
              <Banner
                tone="warning"
                title="No questions matched"
                body={shortfallExplanation(resolution, builder.criteria.targetCount)}
              />
            ) : null}
          </View>
        )}

        {error === null ? null : (
          <View style={{ paddingHorizontal: space.lg }}>
            <Banner tone="danger" title="Could not start" body={error} />
          </View>
        )}

        <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
          <Button
            label={starting ? 'Building…' : `Start ${String(builder.criteria.targetCount)} questions`}
            onPress={() => void start()}
            disabled={starting}
            fullWidth
            accessibilityHint={
              selectedCount === 0
                ? 'No chapters selected, so questions are drawn from your whole syllabus'
                : `Drawing from ${String(selectedCount)} selected areas`
            }
          />
          <Button label="Reset filters" variant="ghost" onPress={builder.reset} fullWidth />
        </View>
      </ScrollView>
    </Screen>
  );
}
