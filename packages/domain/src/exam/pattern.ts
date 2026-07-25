/**
 * Exam patterns and marking rules, expressed as data.
 *
 * Requirements: FR-PAT-01 through FR-PAT-08.
 *
 * The central commitment of this platform is that a pattern change for a new
 * exam year is an INSERT, never a release. If you find yourself adding a year
 * constant or a per-exam branch to the scoring path, the shape below is wrong
 * and that is the defect to fix.
 */

import type { Exam, QuestionType, Subject } from '../types.js';
import type { NumericSpec } from '../scoring/numeric.js';

/* ------------------------------------------------------------------ *
 * Provenance
 * ------------------------------------------------------------------ */

/**
 * Where a marking scheme came from, and whether anyone has actually checked it.
 *
 * This exists because the research corpus found that major coaching sites
 * publish a stale JEE Advanced negative mark (-2, superseded by -1) and a
 * partial-credit formula (4 x correct/total) that has never been the real
 * scheme. A platform whose central claim is scoring correctness cannot source
 * marking rules from search results.
 */
export interface PatternProvenance {
  readonly sourceUrl: string;
  readonly sourceLabel: string;
  /** ISO date the primary document was actually retrieved and read. */
  readonly retrievedOn: string | null;
  readonly status: 'VERIFIED_PRIMARY' | 'UNVERIFIED';
  readonly notes?: string;
}

/* ------------------------------------------------------------------ *
 * Marking rules
 * ------------------------------------------------------------------ */

/**
 * How a multi-correct question awards partial credit.
 *
 * `LADDER_BY_CORRECT_SELECTED` encodes the real published scheme: when the
 * candidate selects only correct options but not all of them, the award equals
 * the number of correct options selected. It is a lookup table, not a formula,
 * precisely so that a change is data.
 */
export type PartialPolicy =
  | { readonly mode: 'ALL_OR_NOTHING' }
  | {
      readonly mode: 'LADDER_BY_CORRECT_SELECTED';
      /** Award when every correct option (and nothing else) is selected. */
      readonly awardIfAllCorrectSelected: number;
      /** selectedCorrectCount -> award, applied when no incorrect option is selected. */
      readonly awardBySelectedCorrectCount: Readonly<Record<number, number>>;
      /** Applied when any incorrect option is selected, regardless of the rest. */
      readonly penaltyIfAnyIncorrect: number;
    };

interface MarkingBase {
  readonly correct: number;
  readonly incorrect: number;
  readonly unattempted: number;
}

export type MarkingRule =
  | (MarkingBase & { readonly questionType: 'MCQ_SINGLE' })
  | (MarkingBase & { readonly questionType: 'ASSERTION_REASON' })
  | (MarkingBase & { readonly questionType: 'MATCHING_LIST' })
  | (MarkingBase & { readonly questionType: 'MCQ_MULTI'; readonly partial: PartialPolicy })
  | (MarkingBase & {
      readonly questionType: 'NUMERIC_INTEGER' | 'NUMERIC_DECIMAL';
      readonly numeric: NumericSpec;
      /**
       * Whether an unparseable response is penalised as an incorrect answer.
       * Distinct from `incorrect` so a body that does not penalise malformed
       * numeric entry can be represented without abusing the incorrect value.
       */
      readonly penaliseUnparseable: boolean;
    });

/* ------------------------------------------------------------------ *
 * Tie-breaking
 * ------------------------------------------------------------------ */

/**
 * Deterministic tie-break chain (FR-SCR-09).
 *
 * Every chain MUST terminate in `STABLE_ID`, otherwise tied candidates order
 * arbitrarily and a student's displayed rank flickers between page loads —
 * a direct credibility hit with no error message attached.
 */
export type TieBreakStep =
  | { readonly kind: 'TOTAL_SCORE_DESC' }
  | { readonly kind: 'SUBJECT_SCORE_DESC'; readonly subject: Subject }
  | { readonly kind: 'SUBJECT_GROUP_SCORE_DESC'; readonly subjects: readonly Subject[] }
  | { readonly kind: 'FEWER_INCORRECT' }
  | { readonly kind: 'FEWER_INCORRECT_IN_SUBJECT'; readonly subject: Subject }
  | { readonly kind: 'HIGHER_POSITIVE_MARKS' }
  | { readonly kind: 'EARLIER_SUBMISSION' }
  | { readonly kind: 'STABLE_ID' };

export type TieBreakChain = readonly TieBreakStep[];

/* ------------------------------------------------------------------ *
 * Pattern
 * ------------------------------------------------------------------ */

export interface PatternSection {
  readonly ordinal: number;
  readonly name: string;
  readonly subject: Subject;
  readonly questionType: QuestionType;
  readonly questionCount: number;
  /**
   * How many of `questionCount` the candidate must answer. Equal to
   * `questionCount` unless the pattern offers internal choice.
   */
  readonly requiredCount: number;
  readonly maxMarks: number;
  readonly marking: MarkingRule;
  /** Optional per-section time lock; null means the section shares paper time. */
  readonly durationSeconds: number | null;
}

export interface ExamPattern {
  readonly id: string;
  readonly exam: Exam;
  readonly year: number;
  readonly paper: string;
  readonly durationMinutes: number;
  readonly totalMarks: number;
  readonly sections: readonly PatternSection[];
  readonly tieBreak: TieBreakChain;
  readonly provenance: PatternProvenance;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export interface PatternProblem {
  readonly code: string;
  readonly message: string;
  readonly sectionOrdinal?: number;
}

/**
 * Publish-time validator (FR-PAT-08).
 *
 * A malformed pattern must be impossible to ship, because every defect here
 * surfaces as a wrong score for a real student weeks later.
 */
export function validatePattern(pattern: ExamPattern): PatternProblem[] {
  const problems: PatternProblem[] = [];

  if (pattern.sections.length === 0) {
    problems.push({ code: 'NO_SECTIONS', message: 'pattern has no sections' });
  }

  const declared = pattern.totalMarks;
  const summed = pattern.sections.reduce((acc, s) => acc + s.maxMarks, 0);
  if (summed !== declared) {
    problems.push({
      code: 'MARKS_MISMATCH',
      message: `section max marks sum to ${summed}, declared total is ${declared}`,
    });
  }

  const ordinals = new Set<number>();
  for (const s of pattern.sections) {
    if (ordinals.has(s.ordinal)) {
      problems.push({
        code: 'DUPLICATE_ORDINAL',
        message: `duplicate section ordinal ${s.ordinal}`,
        sectionOrdinal: s.ordinal,
      });
    }
    ordinals.add(s.ordinal);

    if (s.marking.questionType !== s.questionType) {
      problems.push({
        code: 'MARKING_TYPE_MISMATCH',
        message: `section declares ${s.questionType} but its marking rule is for ${s.marking.questionType}`,
        sectionOrdinal: s.ordinal,
      });
    }

    if (s.requiredCount > s.questionCount) {
      problems.push({
        code: 'REQUIRED_EXCEEDS_COUNT',
        message: `requiredCount ${s.requiredCount} exceeds questionCount ${s.questionCount}`,
        sectionOrdinal: s.ordinal,
      });
    }

    const perQuestionMax = s.marking.correct * s.requiredCount;
    if (perQuestionMax !== s.maxMarks) {
      problems.push({
        code: 'SECTION_MARKS_UNREACHABLE',
        message: `section max marks ${s.maxMarks} is not reachable: ${s.requiredCount} questions at ${s.marking.correct} marks is ${perQuestionMax}`,
        sectionOrdinal: s.ordinal,
      });
    }

    if (s.questionType === 'MCQ_MULTI' && s.marking.questionType === 'MCQ_MULTI') {
      // FR-PAT-08: a multi-correct section must declare its partial policy
      // explicitly. Defaulting to all-or-nothing silently under-scores every
      // candidate on a partial-credit paper.
      if (s.marking.partial === undefined) {
        problems.push({
          code: 'MISSING_PARTIAL_POLICY',
          message: 'multi-correct section has no explicit partial policy',
          sectionOrdinal: s.ordinal,
        });
      }
    }
  }

  const last = pattern.tieBreak.at(-1);
  if (last?.kind !== 'STABLE_ID') {
    problems.push({
      code: 'TIEBREAK_NOT_TOTAL',
      message: 'tie-break chain must terminate in STABLE_ID or ordering is non-deterministic',
    });
  }

  return problems;
}

export class UnverifiedPatternError extends Error {
  constructor(readonly pattern: ExamPattern) {
    super(
      `pattern ${pattern.id} has provenance status ${pattern.provenance.status} and cannot be used for a ranked assessment. ` +
        `Verify the marking scheme against the primary source (${pattern.provenance.sourceUrl}) and record the retrieval date. ` +
        `See docs/skill.md -> add-marking-rule.`,
    );
    this.name = 'UnverifiedPatternError';
  }
}

export class InvalidPatternError extends Error {
  constructor(
    readonly pattern: ExamPattern,
    readonly problems: readonly PatternProblem[],
  ) {
    super(
      `pattern ${pattern.id} is invalid:\n` +
        problems.map((p) => `  [${p.code}] ${p.message}`).join('\n'),
    );
    this.name = 'InvalidPatternError';
  }
}

/**
 * Gate applied before a pattern may back a ranked test.
 *
 * This is the `scoring-verifier` discipline expressed in code: an unverified
 * marking scheme cannot silently reach production ranking. Practice use is
 * permitted; ranking is not.
 */
export function assertRankable(pattern: ExamPattern): void {
  const problems = validatePattern(pattern);
  if (problems.length > 0) throw new InvalidPatternError(pattern, problems);
  if (pattern.provenance.status !== 'VERIFIED_PRIMARY') {
    throw new UnverifiedPatternError(pattern);
  }
}
