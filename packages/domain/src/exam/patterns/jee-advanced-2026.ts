import type { MarkingRule, PatternProvenance } from '../pattern.js';

/**
 * JEE (Advanced) 2026 marking rules.
 *
 * SCOPE: D3 defers JEE Advanced to v2. This file therefore ships the *marking
 * rules* rather than a full pattern, for one specific reason — D3 requires that
 * the schema be general enough that JEE Advanced's scoring engines are data
 * entry in v2 rather than a rewrite. These constants are the proof of that, and
 * the test suite asserts the ladder produces the published awards.
 *
 * The full section structure (question counts per section per subject) is NOT
 * encoded here because nobody has verified it. Encode it in v2, from the primary
 * paper PDF, following docs/skill.md -> add-marking-rule.
 *
 * ------------------------------------------------------------------------
 * WHY THIS FILE MATTERS OUT OF PROPORTION TO ITS SIZE
 * ------------------------------------------------------------------------
 * Two errors about this scheme are near-universal on the Indian web, including
 * on major coaching sites:
 *
 *   1. The negative mark for multi-correct is widely published as -2. It moved
 *      to -1. The primary paper states "Negative Marks : -1 In all other cases".
 *
 *   2. Partial credit is widely published as a proportional formula,
 *      4 x (correct selected) / (total correct). That has never been the scheme.
 *      The real award is a LADDER: selecting only-correct-but-not-all awards
 *      exactly the number of correct options selected.
 *
 *      all correct selected  -> +4
 *      3 correct, none wrong -> +3
 *      2 correct, none wrong -> +2
 *      1 correct, none wrong -> +1
 *      nothing selected      ->  0
 *      any incorrect selected-> -1
 *
 * Implementing the proportional formula instead of the ladder systematically
 * under-scores every candidate on every partial-credit paper, silently, and it
 * presents as poor student performance rather than as a bug.
 */

const PROVENANCE: PatternProvenance = {
  sourceUrl: 'https://jeeadv.ac.in/documents/p1_english.pdf',
  sourceLabel: 'JEE (Advanced) 2026 Paper 1 — instructions page',
  retrievedOn: null,
  status: 'UNVERIFIED',
  notes:
    'The ladder and the -1 negative were quoted verbatim from this PDF during the research pass, but not retrieved first-hand by this team. Re-retrieve before v2 ranked use. Note that jeeadv commits only to being "consistent with previous examinations" and discloses the operative scheme on-screen on exam day, so this must be re-verified every cycle.',
};

export const JEE_ADVANCED_2026_PROVENANCE = PROVENANCE;

/** Single-correct MCQ. */
export const JEE_ADV_2026_MCQ_SINGLE: MarkingRule = {
  questionType: 'MCQ_SINGLE',
  correct: 3,
  incorrect: -1,
  unattempted: 0,
};

/**
 * Multi-correct with the published partial-credit ladder.
 *
 * Expressed as a lookup table rather than a formula so that a future change is
 * a data edit, per FR-PAT-02.
 */
export const JEE_ADV_2026_MCQ_MULTI: MarkingRule = {
  questionType: 'MCQ_MULTI',
  correct: 4,
  incorrect: -1,
  unattempted: 0,
  partial: {
    mode: 'LADDER_BY_CORRECT_SELECTED',
    awardIfAllCorrectSelected: 4,
    awardBySelectedCorrectCount: { 1: 1, 2: 2, 3: 3 },
    penaltyIfAnyIncorrect: -1,
  },
};

/**
 * Numeric response, truncated to two decimal places.
 *
 * TRUNCATE rather than HALF_UP is deliberate and is the published convention
 * for this paper. Rounding instead of truncating changes the verdict on any
 * answer whose third decimal is 5 or above.
 */
export const JEE_ADV_2026_NUMERIC: MarkingRule = {
  questionType: 'NUMERIC_DECIMAL',
  correct: 4,
  incorrect: 0,
  unattempted: 0,
  numeric: { kind: 'ROUNDED', decimals: 2, mode: 'TRUNCATE' },
  penaliseUnparseable: false,
};

/**
 * Matching-list questions (List-I with 4 entries, List-II with 5).
 *
 * Scored as a single-choice question over the offered permutations, which is
 * why the type exists separately from MCQ_SINGLE: it is never shufflable
 * (FR-ITM-11) and its options are permutation labels, not content.
 */
export const JEE_ADV_2026_MATCHING: MarkingRule = {
  questionType: 'MATCHING_LIST',
  correct: 3,
  incorrect: -1,
  unattempted: 0,
};
