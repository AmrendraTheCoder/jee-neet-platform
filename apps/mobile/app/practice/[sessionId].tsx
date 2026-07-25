import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { Screen } from '~/components/ui/Screen.js';
import { Text } from '~/components/ui/Text.js';
import { Button } from '~/components/ui/Button.js';
import { Banner } from '~/components/ui/Banner.js';
import { QuestionBody } from '~/components/math/QuestionBody.js';
import { SessionNavigator } from '~/features/practice/components/SessionNavigator.js';
import { NumericKeypad } from '~/features/practice/components/NumericKeypad.js';
import { TutorReveal } from '~/features/practice/components/TutorReveal.js';
import { usePracticeSession } from '~/features/practice/usePracticeSession.js';
import { useSyncState } from '~/lib/offline/useSyncState.js';
import { space } from '~/theme/tokens.js';
import type { PracticeMode } from '~/lib/api/types.js';
import { asQuestionVersionId } from '@platform/domain';
import type { QuestionVersionId } from '@platform/domain';

/**
 * The practice player.
 *
 * Not a mock. There is no submit deadline, no auto-submit and no ranking here —
 * a ranked attempt is web-only, and every affordance on this screen assumes the
 * student can stop and come back. What it does share with the exam player is
 * the answer model: a response is {question_version_id, option_id}, never a
 * position, so the navigator, the reveal and the sync payload all key on the
 * option's identity and shuffling changes nothing about correctness.
 *
 * Every answer is written to SQLite before it reaches the interface, so the
 * palette can never show a state that is not already durable on the device.
 */

function parseOrder(raw: string | undefined): readonly QuestionVersionId[] {
  if (raw === undefined || raw === '') return [];
  return raw
    .split(',')
    .filter((id) => id !== '')
    .map(asQuestionVersionId);
}

export default function PracticeSessionScreen(): React.ReactNode {
  const params = useLocalSearchParams<{
    sessionId: string;
    mode?: string;
    order?: string;
  }>();

  const { online } = useSyncState();
  const [numeric, setNumeric] = useState('');
  // Self-reported, and asked only after the reveal. A student who got it right
  // by guessing has not learned it, and the scheduler is materially worse if it
  // cannot tell the two apart.
  const [guessed, setGuessed] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const mode: PracticeMode = params.mode === 'TIMED' ? 'TIMED' : 'TUTOR';
  const order = parseOrder(params.order);

  const session = usePracticeSession({
    sessionId: params.sessionId,
    mode,
    order,
    targetSeconds: null,
    online,
  });

  const current = session.current;
  const index = session.state.index;

  // The mark, the status and the key come from the server (FR-SCR-17); the
  // prose and rationales come with the solution payload. Both are keyed by
  // question version, and the reveal shows nothing until the result exists —
  // a client that derived correctness locally would be holding the key.
  const result = current === null ? undefined : session.state.results[String(current.questionVersionId)];

  if (order.length === 0) {
    return (
      <Screen title="Practice">
        <View style={{ padding: space.lg, gap: space.md }}>
          <Banner
            tone="warning"
            title="This session has no questions"
            body="Build a new set from the practice tab."
          />
          <Button label="Back to practice" onPress={() => router.back()} fullWidth />
        </View>
      </Screen>
    );
  }

  const isNumeric =
    current !== null &&
    (current.questionType === 'NUMERIC_INTEGER' || current.questionType === 'NUMERIC_DECIMAL');

  return (
    <Screen
      title={`Question ${String(index + 1)} of ${String(order.length)}`}
      subtitle={mode === 'TUTOR' ? 'Tutor mode' : 'Timed practice'}
      padBottom={false}
    >
      <SessionNavigator
        order={order}
        responses={session.state.responses}
        currentIndex={index}
        onGoTo={session.goTo}
      />

      <ScrollView contentContainerStyle={{ gap: space.lg, padding: space.lg, paddingBottom: space.xl }}>
        {current === null ? (
          <Text tone="muted">Loading this question…</Text>
        ) : (
          <>
            <QuestionBody
              owner={`practice:${params.sessionId}`}
              question={current}
              selectedOptionIds={session.state.responses[String(current.questionVersionId)]?.selectedOptionIds ?? []}
              multiSelect={current.questionType === 'MCQ_MULTI'}
              onToggleOption={(optionId) => void session.toggleOption(optionId)}
              disabled={result !== undefined}
              {...(result === undefined ? {} : { correctOptionIds: result.correctOptionIds })}
            />

            {isNumeric ? (
              <NumericKeypad
                value={numeric}
                onChange={(next) => {
                  setNumeric(next);
                  void session.setNumeric(next);
                }}
                disabled={result !== undefined}
              />
            ) : null}

            {result === undefined ? null : (
              <TutorReveal
                result={result}
                solution={session.solution}
                options={current.options}
                guessed={guessed}
                onToggleGuessed={() => setGuessed((value) => !value)}
                onReportError={() => setReportOpen(true)}
              />
            )}

            {session.revealBlockedReason === null ? null : (
              <Banner tone="info" title="Solution locked" body={session.revealBlockedReason} />
            )}

            {reportOpen ? (
              <Banner
                tone="info"
                title="Report sent"
                body="Thanks. Every report is read, and if the key is wrong every affected score is revised."
                action={{ label: 'Dismiss', onPress: () => setReportOpen(false) }}
              />
            ) : null}

            <View style={{ gap: space.sm }}>
              {mode === 'TUTOR' && result === undefined ? (
                <Button
                  label="Check answer"
                  onPress={() => void session.reveal()}
                  disabled={session.revealBlockedReason !== null}
                  fullWidth
                />
              ) : null}

              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button
                  label="Previous"
                  variant="secondary"
                  onPress={() => session.goTo(index - 1)}
                  disabled={index === 0}
                  style={{ flex: 1 }}
                />
                <Button
                  label={index === order.length - 1 ? 'Finish' : 'Next'}
                  onPress={() => {
                    setNumeric('');
                    if (index === order.length - 1) {
                      session.submit();
                      router.back();
                      return;
                    }
                    session.goTo(index + 1);
                  }}
                  style={{ flex: 1 }}
                />
              </View>

              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button
                  label="Clear"
                  variant="ghost"
                  onPress={() => {
                    setNumeric('');
                    void session.clearResponse();
                  }}
                  style={{ flex: 1 }}
                  accessibilityHint="Clears your answer but keeps the review flag"
                />
                <Button
                  label="Mark for review"
                  variant="ghost"
                  onPress={() => void session.toggleMark()}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
