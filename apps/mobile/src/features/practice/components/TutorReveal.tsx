/**
 * Tutor Mode reveal (FR-PRC-03, FR-SCR-17, FR-SCR-18).
 *
 * Everything numeric here is server-computed and rendered verbatim. The client
 * does not calculate marks; where it shows an explanation, that explanation
 * arrived with the result. This is the surface that turns scoring correctness
 * from invisible engineering into something a student can screenshot, so the
 * one thing it must never do is invent a number.
 *
 * The guessed-right self-report lives here because this is the only moment the
 * student actually knows the answer. It is self-reported and never inferred:
 * a four-minute response on this hardware usually means the student was working
 * on paper, not that they were confident (FR-SRS-06).
 */

import type { ReactNode } from 'react';
import { Linking, View } from 'react-native';

import type { OptionId } from '@platform/domain';

import { useColors } from '../../../theme/ThemeProvider.js';
import { radius, space } from '../../../theme/tokens.js';
import { Banner } from '../../../components/ui/Banner.js';
import { Button } from '../../../components/ui/Button.js';
import { Card } from '../../../components/ui/Card.js';
import { Text } from '../../../components/ui/Text.js';
import { NativeProse } from '../../../components/math/NativeProse.js';
import type { QuestionResult, RenderableOptionPayload, SolutionPayload } from '../../../lib/api/types.js';

export interface TutorRevealProps {
  readonly result: QuestionResult;
  readonly solution: SolutionPayload | null;
  readonly options: readonly RenderableOptionPayload[];
  readonly guessed: boolean;
  readonly onToggleGuessed: () => void;
  readonly onReportError: () => void;
}

function marksLabel(marks: number): string {
  return marks > 0 ? `+${String(marks)}` : String(marks);
}

export function TutorReveal(props: TutorRevealProps): ReactNode {
  const colors = useColors();
  const { result } = props;

  const tone =
    result.status === 'CORRECT'
      ? 'success'
      : result.status === 'PARTIALLY_CORRECT'
        ? 'warning'
        : result.status === 'UNATTEMPTED'
          ? 'info'
          : 'danger';

  return (
    <View style={{ gap: space.lg }}>
      <Banner
        tone={tone}
        title={`${marksLabel(result.marks)} marks`}
        // The server's own words. Partial credit in particular has to be
        // explained in the scheme's terms rather than as a fraction, because the
        // widely republished proportional formula is not the real scheme.
        body={result.explanation}
      />

      <View style={{ gap: space.sm }}>
        <Text variant="heading" accessibilityRole="header">
          Why each option is right or wrong
        </Text>
        {props.options.map((option, index) => {
          const rationale = props.solution?.rationales.find(
            (entry) => entry.optionId === option.optionId,
          );
          const isCorrect = result.correctOptionIds.includes(option.optionId as OptionId);
          return (
            <Card
              key={String(option.optionId)}
              style={{
                borderColor: isCorrect ? colors.success : colors.border,
                backgroundColor: isCorrect ? colors.successMuted : colors.surface,
              }}
            >
              <View style={{ gap: space.sm }}>
                <Text variant="bodyStrong" tone={isCorrect ? 'success' : 'default'}>
                  {`${String.fromCharCode(65 + index)}. ${isCorrect ? 'Correct' : 'Incorrect'}`}
                </Text>
                <NativeProse
                  blocks={rationale?.blocks ?? []}
                  plainTextFallback={
                    rationale === undefined
                      ? 'The rationale for this option has not loaded yet.'
                      : option.plainText
                  }
                  variant="caption"
                />
              </View>
            </Card>
          );
        })}
      </View>

      {props.solution === null ? null : (
        <View style={{ gap: space.sm }}>
          <Text variant="heading" accessibilityRole="header">
            Full solution
          </Text>
          <Card>
            <NativeProse blocks={props.solution.blocks} plainTextFallback="" selectable />
          </Card>
          {props.solution.videoUrl === null ? null : (
            <Button
              variant="secondary"
              label="Open the video solution"
              // Deep-linked out, never embedded (FR-SOL-04). The standard
              // embedded player hands platform identifiers to a third party, and
              // most of these users are legally children.
              accessibilityHint="Opens outside this app in your browser or video app"
              onPress={() => {
                const url = props.solution?.videoUrl;
                if (url !== null && url !== undefined) void Linking.openURL(url);
              }}
            />
          )}
        </View>
      )}

      <Card
        onPress={props.onToggleGuessed}
        accessibilityLabel={
          props.guessed
            ? 'Marked as a guess. Tap to unmark.'
            : 'Mark this as a guess so it comes back in revision.'
        }
        style={{
          borderColor: props.guessed ? colors.accent : colors.border,
          backgroundColor: props.guessed ? colors.accentMuted : colors.surface,
          borderRadius: radius.md,
        }}
      >
        <Text variant="bodyStrong">
          {props.guessed ? 'Recorded as a guess' : 'I guessed this one'}
        </Text>
        <Text variant="caption" tone="muted">
          Guessed-right questions come back in revision. Nothing else can tell us this — we do not
          infer it from how long you took, because you may have been working on paper.
        </Text>
      </Card>

      <Button variant="ghost" label="Report an error in this question" onPress={props.onReportError} />
    </View>
  );
}
