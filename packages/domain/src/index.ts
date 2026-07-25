/**
 * @platform/domain — the scoring and attempt engine.
 *
 * Pure TypeScript, zero runtime dependencies, no I/O and no clock reads. Every
 * function here is a pure function of its arguments, which is what makes the
 * scoring path testable, reproducible years later, and safe to retry.
 *
 * The database is authoritative in production (FR-SCR-01). This package is the
 * reference implementation, the test oracle for the SQL, and the engine behind
 * tutor-mode preview. The shared golden fixtures in `test/fixtures` are run
 * against both.
 */

export * from './types.js';

// Exam patterns and marking rules as data
export * from './exam/pattern.js';
export * from './exam/registry.js';
export {
  JEE_ADVANCED_2026_PROVENANCE,
  JEE_ADV_2026_MCQ_SINGLE,
  JEE_ADV_2026_MCQ_MULTI,
  JEE_ADV_2026_NUMERIC,
  JEE_ADV_2026_MATCHING,
} from './exam/patterns/jee-advanced-2026.js';

// Scoring
export * from './scoring/decimal.js';
export * from './scoring/numeric.js';
export * from './scoring/scoreQuestion.js';
export * from './scoring/scoreAttempt.js';
export * from './scoring/percentile.js';
export * from './scoring/tiebreak.js';
export * from './scoring/rescore.js';
export * from './scoring/fingerprint.js';

// Attempt lifecycle
export * from './attempt/palette.js';
export * from './attempt/shuffle.js';
export * from './attempt/timer.js';
