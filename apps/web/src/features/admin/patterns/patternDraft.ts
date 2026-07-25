import type {
  Exam,
  ExamPattern,
  MarkingRule,
  PatternSection,
  QuestionType,
  RoundingMode,
  Subject,
  TieBreakChain,
  TieBreakStep,
} from '@platform/domain';

/**
 * A mutable editing shape for an exam pattern, and the projection back to the
 * immutable domain type.
 *
 * THIS EDITOR IS THE PROOF THAT EXAM MECHANICS ARE DATA (invariant 1,
 * FR-PAT-01, FR-PAT-02). A 2027 pattern is composed here and shipped as an
 * INSERT — no year constant, no per-exam branch, no release. If a pattern ever
 * needs a code change to express, the schema is wrong and that is the defect
 * to fix rather than adding a branch.
 *
 * The partial-credit ladder is edited as an explicit lookup table for the same
 * reason. A formula field would invite `4 x correct/total`, which circulates
 * widely and has never been any examining body's real scheme.
 */

export interface SectionDraft {
  readonly key: string;
  readonly ordinal: number;
  readonly name: string;
  readonly subject: Subject;
  readonly questionType: QuestionType;
  readonly questionCount: number;
  readonly requiredCount: number;
  readonly maxMarks: number;
  readonly durationSeconds: number | null;

  readonly correct: number;
  readonly incorrect: number;
  readonly unattempted: number;

  readonly partialMode: 'ALL_OR_NOTHING' | 'LADDER_BY_CORRECT_SELECTED';
  readonly awardIfAllCorrectSelected: number;
  readonly ladder: readonly { readonly selectedCorrect: number; readonly award: number }[];
  readonly penaltyIfAnyIncorrect: number;

  readonly numericKind: 'EXACT_INTEGER' | 'TOLERANCE' | 'ROUNDED';
  readonly toleranceAbs: string;
  readonly decimals: number;
  readonly roundingMode: RoundingMode;
  readonly penaliseUnparseable: boolean;
}

export interface PatternDraft {
  readonly id: string;
  readonly exam: Exam;
  readonly year: number;
  readonly paper: string;
  readonly durationMinutes: number;
  readonly totalMarks: number;
  readonly sections: readonly SectionDraft[];
  readonly tieBreak: readonly TieBreakStep[];
  readonly sourceUrl: string;
  readonly sourceLabel: string;
  readonly retrievedOn: string;
  readonly verifiedPrimary: boolean;
  readonly notes: string;
}

export function newSectionDraft(ordinal: number): SectionDraft {
  return {
    key: crypto.randomUUID(),
    ordinal,
    name: `Section ${ordinal}`,
    subject: 'PHYSICS',
    questionType: 'MCQ_SINGLE',
    questionCount: 20,
    requiredCount: 20,
    maxMarks: 80,
    durationSeconds: null,
    correct: 4,
    incorrect: -1,
    unattempted: 0,
    partialMode: 'LADDER_BY_CORRECT_SELECTED',
    awardIfAllCorrectSelected: 4,
    ladder: [
      { selectedCorrect: 3, award: 3 },
      { selectedCorrect: 2, award: 2 },
      { selectedCorrect: 1, award: 1 },
    ],
    penaltyIfAnyIncorrect: -1,
    numericKind: 'EXACT_INTEGER',
    toleranceAbs: '0',
    decimals: 2,
    roundingMode: 'HALF_UP',
    penaliseUnparseable: false,
  };
}

export function newPatternDraft(): PatternDraft {
  return {
    id: '',
    exam: 'JEE_MAIN',
    year: new Date().getUTCFullYear() + 1,
    paper: 'Paper 1',
    durationMinutes: 180,
    totalMarks: 300,
    sections: [newSectionDraft(1)],
    tieBreak: [{ kind: 'TOTAL_SCORE_DESC' }, { kind: 'STABLE_ID' }],
    sourceUrl: '',
    sourceLabel: '',
    retrievedOn: '',
    verifiedPrimary: false,
    notes: '',
  };
}

function toMarkingRule(section: SectionDraft): MarkingRule {
  const base = {
    correct: section.correct,
    incorrect: section.incorrect,
    unattempted: section.unattempted,
  };

  switch (section.questionType) {
    case 'MCQ_MULTI': {
      const awardBySelectedCorrectCount: Record<number, number> = {};
      for (const rung of section.ladder) {
        awardBySelectedCorrectCount[rung.selectedCorrect] = rung.award;
      }
      return {
        ...base,
        questionType: 'MCQ_MULTI',
        partial:
          section.partialMode === 'ALL_OR_NOTHING'
            ? { mode: 'ALL_OR_NOTHING' }
            : {
                mode: 'LADDER_BY_CORRECT_SELECTED',
                awardIfAllCorrectSelected: section.awardIfAllCorrectSelected,
                awardBySelectedCorrectCount,
                penaltyIfAnyIncorrect: section.penaltyIfAnyIncorrect,
              },
      };
    }
    case 'NUMERIC_INTEGER':
    case 'NUMERIC_DECIMAL':
      return {
        ...base,
        questionType: section.questionType,
        numeric:
          section.numericKind === 'EXACT_INTEGER'
            ? { kind: 'EXACT_INTEGER' }
            : section.numericKind === 'TOLERANCE'
              ? { kind: 'TOLERANCE', toleranceAbs: section.toleranceAbs }
              : { kind: 'ROUNDED', decimals: section.decimals, mode: section.roundingMode },
        penaliseUnparseable: section.penaliseUnparseable,
      };
    case 'MATCHING_LIST':
      return { ...base, questionType: 'MATCHING_LIST' };
    case 'ASSERTION_REASON':
      return { ...base, questionType: 'ASSERTION_REASON' };
    case 'MCQ_SINGLE':
    default:
      return { ...base, questionType: 'MCQ_SINGLE' };
  }
}

function toSection(section: SectionDraft): PatternSection {
  return {
    ordinal: section.ordinal,
    name: section.name,
    subject: section.subject,
    questionType: section.questionType,
    questionCount: section.questionCount,
    requiredCount: section.requiredCount,
    maxMarks: section.maxMarks,
    marking: toMarkingRule(section),
    durationSeconds: section.durationSeconds,
  };
}

export function toExamPattern(draft: PatternDraft): ExamPattern {
  return {
    id: draft.id,
    exam: draft.exam,
    year: draft.year,
    paper: draft.paper,
    durationMinutes: draft.durationMinutes,
    totalMarks: draft.totalMarks,
    sections: draft.sections.map(toSection),
    tieBreak: draft.tieBreak as TieBreakChain,
    provenance: {
      sourceUrl: draft.sourceUrl,
      sourceLabel: draft.sourceLabel,
      retrievedOn: draft.retrievedOn === '' ? null : draft.retrievedOn,
      // The gate that keeps an unverified scheme out of ranked assessment.
      // Verification means the examining body's own PDF on its own domain —
      // never a coaching site, a summary, or a search result.
      status: draft.verifiedPrimary ? 'VERIFIED_PRIMARY' : 'UNVERIFIED',
      ...(draft.notes === '' ? {} : { notes: draft.notes }),
    },
  };
}

export const TIE_BREAK_LABELS: Readonly<Record<TieBreakStep['kind'], string>> = {
  TOTAL_SCORE_DESC: 'Higher total score',
  SUBJECT_SCORE_DESC: 'Higher score in a named subject',
  SUBJECT_GROUP_SCORE_DESC: 'Higher score across a group of subjects',
  FEWER_INCORRECT: 'Fewer incorrect answers overall',
  FEWER_INCORRECT_IN_SUBJECT: 'Fewer incorrect answers in a named subject',
  HIGHER_POSITIVE_MARKS: 'Higher positive marks earned',
  EARLIER_SUBMISSION: 'Earlier submission',
  STABLE_ID: 'Stable candidate identifier (required last step)',
};
