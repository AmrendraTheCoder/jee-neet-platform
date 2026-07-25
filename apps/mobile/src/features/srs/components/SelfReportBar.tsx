/**
 * How the student grades a review.
 *
 * They do not pick a scheduler grade. They report what happened — guessed,
 * unsure, knew it — and the grade is derived from that together with the actual
 * outcome (`deriveRating`). Two reasons:
 *
 *  - asking a sixteen-year-old to choose between "Hard" and "Good" for a
 *    question they got right is asking them to do the scheduler's job;
 *  - it keeps the grade a function of correctness and self-report only, which is
 *    what FR-SRS-06 requires. There is no control here that could be influenced
 *    by how long they took.
 *
 * The interval each choice produces is shown under it, so the consequence is
 * visible before the tap rather than surprising afterwards.
 */

import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import type { ResponseStatus } from '@platform/domain';

import { useColors } from '../../../theme/ThemeProvider.js';
import { MIN_TOUCH_TARGET, radius, space } from '../../../theme/tokens.js';
import { Text } from '../../../components/ui/Text.js';
import type { SelfReport } from '../grading.js';
import { SELF_REPORTS, SELF_REPORT_LABELS, deriveRating } from '../grading.js';
import type { ReviewRating } from '../grading.js';
import { describeInterval } from '../scheduler.js';

export interface SelfReportBarProps {
  readonly outcome: ResponseStatus;
  readonly intervalDays: Readonly<Record<ReviewRating, number>>;
  readonly onSelect: (report: SelfReport) => void;
  readonly disabled?: boolean;
}

export function SelfReportBar(props: SelfReportBarProps): ReactNode {
  const colors = useColors();
  const disabled = props.disabled ?? false;

  return (
    <View style={{ gap: space.sm }} accessibilityRole="radiogroup">
      <Text variant="heading" accessibilityRole="header">
        How did that go?
      </Text>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {SELF_REPORTS.map((report) => {
          const rating = deriveRating(props.outcome, report);
          const days = props.intervalDays[rating];
          return (
            <Pressable
              key={report}
              accessibilityRole="radio"
              accessibilityState={{ checked: false, disabled }}
              accessibilityLabel={`${SELF_REPORT_LABELS[report]}. We would show this concept again ${describeInterval(days)}.`}
              disabled={disabled}
              onPress={() => {
                props.onSelect(report);
              }}
              style={{
                flex: 1,
                minHeight: MIN_TOUCH_TARGET,
                paddingVertical: space.md,
                paddingHorizontal: space.sm,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                alignItems: 'center',
                gap: space.xxs,
                opacity: disabled ? 0.45 : 1,
              }}
            >
              <Text variant="bodyStrong" align="center">
                {SELF_REPORT_LABELS[report]}
              </Text>
              <Text variant="caption" tone="muted" align="center">
                {describeInterval(days)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text variant="caption" tone="muted">
        We never guess this from how long you took. If you spent four minutes working it out on
        paper, that is exactly what we want you to do.
      </Text>
    </View>
  );
}
