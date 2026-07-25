/**
 * The question-state and difficulty chip rows (FR-PRC-02, FR-PRC-04).
 *
 * Every chip shows its live matching count, including the ones at zero. A zero
 * that is visible tells the student which constraint emptied the set; a hidden
 * chip tells them nothing and makes the bank look thinner than it is.
 */

import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { space } from '../../../theme/tokens.js';
import { Chip } from '../../../components/ui/Chip.js';
import { Text } from '../../../components/ui/Text.js';
import type { ChipCounts, Difficulty, QuestionStateFilter } from '../filters.js';
import {
  DIFFICULTIES,
  QUESTION_STATES,
  QUESTION_STATE_HINTS,
  QUESTION_STATE_LABELS,
} from '../filters.js';

const DIFFICULTY_LABELS: Readonly<Record<Difficulty, string>> = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
};

export interface FilterChipRowProps {
  readonly counts: ChipCounts | null;
  readonly counting: boolean;
  readonly selectedStates: readonly QuestionStateFilter[];
  readonly selectedDifficulties: readonly Difficulty[];
  readonly onToggleState: (state: QuestionStateFilter) => void;
  readonly onToggleDifficulty: (difficulty: Difficulty) => void;
}

function Section(props: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="heading" accessibilityRole="header">
        {props.title}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }}
      >
        {props.children}
      </ScrollView>
    </View>
  );
}

export function FilterChipRow(props: FilterChipRowProps): ReactNode {
  return (
    <View style={{ gap: space.lg }}>
      <Section title="Question state">
        {QUESTION_STATES.map((state) => (
          <Chip
            key={state}
            label={QUESTION_STATE_LABELS[state]}
            hint={QUESTION_STATE_HINTS[state]}
            matchingCount={props.counts?.states[state] ?? 0}
            countPending={props.counting}
            selected={props.selectedStates.includes(state)}
            onToggle={() => {
              props.onToggleState(state);
            }}
          />
        ))}
      </Section>

      <Section title="Difficulty">
        {DIFFICULTIES.map((difficulty) => (
          <Chip
            key={difficulty}
            label={DIFFICULTY_LABELS[difficulty]}
            matchingCount={props.counts?.difficulties[difficulty] ?? 0}
            countPending={props.counting}
            selected={props.selectedDifficulties.includes(difficulty)}
            onToggle={() => {
              props.onToggleDifficulty(difficulty);
            }}
          />
        ))}
      </Section>
    </View>
  );
}
