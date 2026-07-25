import { describe, expect, it } from 'vitest';
import {
  InvalidPatternError,
  UnverifiedPatternError,
  assertRankable,
  validatePattern,
} from '../src/exam/pattern.js';
import type { ExamPattern } from '../src/exam/pattern.js';
import {
  JEE_MAIN_2026_P1,
  NEET_2026,
  getPattern,
  listPatterns,
  patternsForExam,
  validateBuiltIns,
} from '../src/exam/registry.js';
import { canonicalize, fingerprint } from '../src/scoring/fingerprint.js';

describe('built-in patterns', () => {
  it('are all structurally valid', () => {
    const problems = validateBuiltIns();
    expect([...problems.entries()]).toEqual([]);
  });

  it('JEE Main sums to 300 marks across 75 questions', () => {
    const total = JEE_MAIN_2026_P1.sections.reduce((a, s) => a + s.maxMarks, 0);
    const questions = JEE_MAIN_2026_P1.sections.reduce((a, s) => a + s.questionCount, 0);
    expect(total).toBe(300);
    expect(questions).toBe(75);
  });

  it('NEET sums to 720 marks across 180 questions', () => {
    const total = NEET_2026.sections.reduce((a, s) => a + s.maxMarks, 0);
    const questions = NEET_2026.sections.reduce((a, s) => a + s.questionCount, 0);
    expect(total).toBe(720);
    expect(questions).toBe(180);
  });

  it('are discoverable through the registry', () => {
    expect(listPatterns()).toHaveLength(2);
    expect(getPattern('NEET-2026-UG')).toBe(NEET_2026);
    expect(getPattern('does-not-exist')).toBeUndefined();
    expect(patternsForExam('JEE_MAIN')).toEqual([JEE_MAIN_2026_P1]);
    expect(patternsForExam('JEE_ADVANCED')).toEqual([]);
  });
});

/**
 * The provenance gate.
 *
 * A marking scheme sourced from anywhere but the examining body's own document
 * cannot silently reach production ranking. The research corpus found major
 * coaching sites publishing a stale negative mark and a partial-credit formula
 * that has never been the real scheme; a platform whose central claim is
 * scoring correctness cannot inherit that.
 */
describe('assertRankable — the provenance gate', () => {
  it('refuses an unverified pattern for ranked use', () => {
    expect(() => assertRankable(JEE_MAIN_2026_P1)).toThrowError(UnverifiedPatternError);
    expect(() => assertRankable(NEET_2026)).toThrowError(UnverifiedPatternError);
  });

  it('points the reader at the primary source and the procedure', () => {
    try {
      assertRankable(NEET_2026);
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('neet.nta.nic.in');
      expect(message).toContain('add-marking-rule');
    }
  });

  it('accepts a pattern once its provenance is recorded as verified', () => {
    const verified: ExamPattern = {
      ...NEET_2026,
      provenance: {
        ...NEET_2026.provenance,
        status: 'VERIFIED_PRIMARY',
        retrievedOn: '2026-07-25',
      },
    };
    expect(() => assertRankable(verified)).not.toThrow();
  });

  it('still refuses a structurally broken pattern even when verified', () => {
    const broken: ExamPattern = {
      ...NEET_2026,
      totalMarks: 999,
      provenance: {
        ...NEET_2026.provenance,
        status: 'VERIFIED_PRIMARY',
        retrievedOn: '2026-07-25',
      },
    };
    expect(() => assertRankable(broken)).toThrowError(InvalidPatternError);
  });
});

describe('validatePattern', () => {
  it('catches a marks mismatch', () => {
    const problems = validatePattern({ ...NEET_2026, totalMarks: 700 });
    expect(problems.map((p) => p.code)).toContain('MARKS_MISMATCH');
  });

  it('catches a section whose max marks are unreachable', () => {
    const first = NEET_2026.sections[0]!;
    const problems = validatePattern({
      ...NEET_2026,
      sections: [{ ...first, maxMarks: 999 }, ...NEET_2026.sections.slice(1)],
    });
    expect(problems.map((p) => p.code)).toContain('SECTION_MARKS_UNREACHABLE');
  });

  it('catches a marking rule that does not match its section type', () => {
    const first = NEET_2026.sections[0]!;
    const problems = validatePattern({
      ...NEET_2026,
      sections: [
        {
          ...first,
          questionType: 'NUMERIC_INTEGER',
        },
        ...NEET_2026.sections.slice(1),
      ],
    });
    expect(problems.map((p) => p.code)).toContain('MARKING_TYPE_MISMATCH');
  });

  it('catches a duplicate section ordinal', () => {
    const first = NEET_2026.sections[0]!;
    const problems = validatePattern({ ...NEET_2026, sections: [first, { ...first }] });
    expect(problems.map((p) => p.code)).toContain('DUPLICATE_ORDINAL');
  });

  it('catches requiredCount exceeding questionCount', () => {
    const first = NEET_2026.sections[0]!;
    const problems = validatePattern({
      ...NEET_2026,
      sections: [{ ...first, requiredCount: 99 }, ...NEET_2026.sections.slice(1)],
    });
    expect(problems.map((p) => p.code)).toContain('REQUIRED_EXCEEDS_COUNT');
  });

  it('catches a tie-break chain that is not total', () => {
    const problems = validatePattern({
      ...NEET_2026,
      tieBreak: [{ kind: 'TOTAL_SCORE_DESC' }],
    });
    expect(problems.map((p) => p.code)).toContain('TIEBREAK_NOT_TOTAL');
  });

  it('catches an empty pattern', () => {
    const problems = validatePattern({ ...NEET_2026, sections: [], totalMarks: 0 });
    expect(problems.map((p) => p.code)).toContain('NO_SECTIONS');
  });
});

describe('fingerprint', () => {
  it('is stable across property order', () => {
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
  });

  it('changes when a value changes', () => {
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });

  it('distinguishes nested structures', () => {
    expect(fingerprint({ a: [1, 2] })).not.toBe(fingerprint({ a: [2, 1] }));
  });

  it('ignores undefined properties so optional fields do not shift the value', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
  });

  it('emits 32 hex characters', () => {
    expect(fingerprint({ any: 'thing' })).toMatch(/^[0-9a-f]{32}$/);
  });

  it('refuses non-finite numbers rather than silently emitting null', () => {
    expect(() => canonicalize({ x: Number.NaN })).toThrowError(TypeError);
    expect(() => canonicalize({ x: Number.POSITIVE_INFINITY })).toThrowError(TypeError);
  });

  it('normalises negative zero', () => {
    expect(canonicalize(-0)).toBe(canonicalize(0));
  });
});
