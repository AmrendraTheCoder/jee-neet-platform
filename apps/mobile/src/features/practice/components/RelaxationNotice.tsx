/**
 * The banner that makes FR-PRC-05 true.
 *
 * "A bare empty state on the headline feature is prohibited." This component is
 * the enforcement: the session start screen renders it whenever the resolver
 * widened anything or fell short, and it names the constraint and the new value
 * in the student's own terms.
 *
 * It is not dismissible in the sense of disappearing on a timer. The student may
 * act on it — reopening the builder — but it does not vanish while they are
 * reading it.
 */

import type { ReactNode } from 'react';
import { View } from 'react-native';

import { space } from '../../../theme/tokens.js';
import { Banner } from '../../../components/ui/Banner.js';
import type { RelaxationResult } from '../relaxation.js';
import { shortfallExplanation } from '../relaxation.js';

export interface RelaxationNoticeProps {
  readonly result: RelaxationResult;
  readonly targetCount: number;
  readonly onEditFilters: () => void;
}

export function RelaxationNotice(props: RelaxationNoticeProps): ReactNode {
  const { result } = props;
  if (result.relaxations.length === 0 && !result.exhausted) return null;

  return (
    <View style={{ gap: space.sm }}>
      {result.relaxations.length === 0 ? null : (
        <Banner
          tone="info"
          title={
            result.relaxations.length === 1
              ? 'We widened one filter to fill this session'
              : `We widened ${String(result.relaxations.length)} filters to fill this session`
          }
          body={result.relaxations.map((relaxation) => relaxation.sentence).join(' ')}
          action={{ label: 'Change the filters', onPress: props.onEditFilters }}
        />
      )}

      {result.exhausted ? (
        <Banner
          tone="warning"
          title={`${String(result.questionVersionIds.length)} of ${String(props.targetCount)} questions found`}
          body={shortfallExplanation(result, props.targetCount)}
          action={{ label: 'Change the filters', onPress: props.onEditFilters }}
        />
      ) : null}
    </View>
  );
}
