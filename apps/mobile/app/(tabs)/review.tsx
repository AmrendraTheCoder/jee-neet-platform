import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Screen } from '~/components/ui/Screen.js';
import { Text } from '~/components/ui/Text.js';
import { Button } from '~/components/ui/Button.js';
import { Banner } from '~/components/ui/Banner.js';
import { ProgressBar } from '~/components/ui/ProgressBar.js';
import { QuestionBody } from '~/components/math/QuestionBody.js';
import { Scratchpad } from '~/features/srs/components/Scratchpad.js';
import { SelfReportBar } from '~/features/srs/components/SelfReportBar.js';
import { useReviewSession } from '~/features/srs/useReviewSession.js';
import { useSyncState } from '~/lib/offline/useSyncState.js';
import { space } from '~/theme/tokens.js';
import type { OptionId } from '@platform/domain';

/**
 * Spaced-repetition review.
 *
 * One card at a time, answer then reveal then self-report. The self-report is
 * asked once, immediately after the reveal, and never again — a grading prompt
 * that reappears later gets answered from memory of the prompt rather than
 * memory of the recall, which is the thing the scheduler is trying to measure.
 *
 * The queue is finite by design. When it is exhausted the screen says so and
 * stops, rather than topping up with unseen material: reviewing ahead of
 * schedule is how a student spends an evening on cards that were not due and
 * arrives at the ones that were with nothing left.
 */
export default function ReviewScreen(): React.ReactNode {
  const { online, pendingAnswers } = useSyncState();
  const session = useReviewSession(online);
  const [selected, setSelected] = useState<readonly OptionId[]>([]);

  const total = session.completed + session.remaining;

  if (session.phase === 'LOADING') {
    return (
      <Screen title="Review">
        <View style={{ padding: space.lg }}>
          <Text tone="muted">Finding what is due…</Text>
        </View>
      </Screen>
    );
  }

  if (session.phase === 'COMPLETE' || session.phase === 'EXHAUSTED') {
    return (
      <Screen title="Review">
        <View style={{ padding: space.lg, gap: space.md }}>
          <Banner
            tone="success"
            title={session.completed === 0 ? 'Nothing due today' : 'Review complete'}
            body={
              session.completed === 0
                ? 'Cards appear here when they are due. Practising creates them.'
                : `You reviewed ${String(session.completed)} card${session.completed === 1 ? '' : 's'}. Come back tomorrow — spacing them out is what makes them stick.`
            }
          />
          {pendingAnswers === 0 ? null : (
            <Text variant="caption" tone="muted">
              {pendingAnswers} answer{pendingAnswers === 1 ? '' : 's'} waiting to sync.
            </Text>
          )}
        </View>
      </Screen>
    );
  }

  const question = session.question;
  const revealed = session.phase === 'REVEALED';

  return (
    <Screen title="Review" subtitle={`${String(session.completed)} of ${String(total)}`}>
      <ScrollView contentContainerStyle={{ gap: space.lg, padding: space.lg, paddingBottom: space.xl }}>
        <ProgressBar
          value={total === 0 ? 0 : session.completed / total}
          label={`${String(session.completed)} of ${String(total)} reviewed`}
        />

        {question === null ? (
          <Banner
            tone="warning"
            title="This card's question is not on the device"
            body="Sync once on a connection to download it, or skip to the next card."
            action={{ label: 'Skip', onPress: session.skip }}
          />
        ) : (
          <>
            <QuestionBody
              owner={`review:${String(question.questionVersionId)}`}
              question={question}
              selectedOptionIds={selected}
              multiSelect={question.questionType === 'MCQ_MULTI'}
              onToggleOption={(optionId) => {
                if (revealed) return;
                setSelected((current) =>
                  current.includes(optionId)
                    ? current.filter((id) => id !== optionId)
                    : question.questionType === 'MCQ_MULTI'
                      ? [...current, optionId]
                      : [optionId],
                );
              }}
              disabled={revealed}
            />

            {/* Working space, not a stored answer. Cleared with the card. */}
            <Scratchpad questionVersionId={question.questionVersionId} />

            {revealed ? (
              <SelfReportBar
                outcome={selected.length === 0 ? 'UNATTEMPTED' : 'CORRECT'}
                intervalDays={session.intervalDays}
                onSelect={(report) => {
                  void session.grade(report).then(() => setSelected([]));
                }}
              />
            ) : (
              <View style={{ gap: space.sm }}>
                <Button
                  label="Show answer"
                  onPress={() => session.reveal(selected.length === 0 ? 'UNATTEMPTED' : 'CORRECT')}
                  fullWidth
                />
                <Button
                  label="Skip this card"
                  variant="ghost"
                  onPress={() => {
                    setSelected([]);
                    session.skip();
                  }}
                  fullWidth
                  accessibilityHint="Leaves the card due and moves to the next one"
                />
              </View>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
