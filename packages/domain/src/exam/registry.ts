import type { Exam } from '../types.js';
import { type ExamPattern, validatePattern } from './pattern.js';
import { JEE_MAIN_2026_P1 } from './patterns/jee-main-2026.js';
import { NEET_2026 } from './patterns/neet-2026.js';

/**
 * Built-in pattern registry.
 *
 * This is a *convenience seed*, not the system of record. In production the
 * authoritative patterns live in the database (FR-PAT-01) so that an admin can
 * add a 2027 pattern without an application release (FR-PAT-02). These
 * constants exist so the engine can be tested and seeded without a database.
 */
const BUILT_IN: readonly ExamPattern[] = [JEE_MAIN_2026_P1, NEET_2026];

const BY_ID = new Map(BUILT_IN.map((p) => [p.id, p]));

export function listPatterns(): readonly ExamPattern[] {
  return BUILT_IN;
}

export function getPattern(id: string): ExamPattern | undefined {
  return BY_ID.get(id);
}

export function patternsForExam(exam: Exam): readonly ExamPattern[] {
  return BUILT_IN.filter((p) => p.exam === exam);
}

/**
 * Every built-in pattern must be structurally valid even while its marking
 * scheme awaits primary-source verification. Structural validity and
 * provenance are independent concerns: the first is our bug, the second is our
 * homework.
 */
export function validateBuiltIns(): Map<string, ReturnType<typeof validatePattern>> {
  const out = new Map<string, ReturnType<typeof validatePattern>>();
  for (const p of BUILT_IN) {
    const problems = validatePattern(p);
    if (problems.length > 0) out.set(p.id, problems);
  }
  return out;
}

export { JEE_MAIN_2026_P1, NEET_2026 };
