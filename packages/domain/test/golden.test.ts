import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scoreQuestion } from '../src/scoring/scoreQuestion.js';
import type { MarkingRule } from '../src/exam/pattern.js';
import {
  type AnswerKey,
  type OptionId,
  type Response,
  asAnswerKeyVersion,
  asOptionId,
  asQuestionVersionId,
} from '../src/types.js';

/**
 * The shared scoring oracle.
 *
 * `fixtures/golden-scoring.json` is written from the published marking schemes,
 * not generated from either implementation. Both the TypeScript engine (here)
 * and the PL/pgSQL functions (packages/db/test/04_scoring_golden.sql) are
 * asserted against it. Neither implementation is allowed to define truth, and
 * the fixture is never edited to make a failing implementation pass.
 */

interface GoldenCase {
  readonly id: string;
  readonly description?: string;
  readonly rule: string;
  readonly selected: readonly string[];
  readonly numericRaw: string | null;
  readonly key: {
    readonly correct: readonly string[];
    readonly numericValue: string | null;
    readonly resolution: 'MULTI_KEY' | 'ALL_CORRECT' | 'DROPPED' | null;
  };
  readonly expect: { readonly marks: number; readonly status: string };
}

interface GoldenFile {
  readonly version: number;
  readonly markingRules: Readonly<Record<string, MarkingRule>>;
  readonly cases: readonly GoldenCase[];
}

const fixturePath = fileURLToPath(new URL('./fixtures/golden-scoring.json', import.meta.url));
const golden = JSON.parse(readFileSync(fixturePath, 'utf8')) as GoldenFile;

const optionId = (letter: string): OptionId => asOptionId(`opt-${letter.toLowerCase()}`);
const QUESTION = asQuestionVersionId('golden-q');

function buildResponse(c: GoldenCase): Response | undefined {
  // A case with no selection and no numeric input models a question the
  // candidate never interacted with at all.
  if (c.selected.length === 0 && c.numericRaw === null) return undefined;
  return {
    questionVersionId: QUESTION,
    selectedOptionIds: c.selected.map(optionId),
    numericRaw: c.numericRaw,
    visited: true,
    markedForReview: false,
    timeSpentMs: 0,
    clientSeq: 1,
  };
}

function buildKey(c: GoldenCase): AnswerKey {
  return {
    questionVersionId: QUESTION,
    version: asAnswerKeyVersion(1),
    correctOptionIds: c.key.correct.map(optionId),
    numericValue: c.key.numericValue,
    resolution: c.key.resolution,
  };
}

describe('golden scoring oracle', () => {
  it('the fixture file is well formed', () => {
    expect(golden.version).toBe(1);
    expect(golden.cases.length).toBeGreaterThanOrEqual(40);
    const ids = golden.cases.map((c) => c.id);
    expect(new Set(ids).size, 'duplicate case ids').toBe(ids.length);
    for (const c of golden.cases) {
      expect(golden.markingRules[c.rule], `unknown rule ${c.rule} in case ${c.id}`).toBeDefined();
    }
  });

  for (const c of golden.cases) {
    const label = c.description ? `${c.id} — ${c.description}` : c.id;
    it(label, () => {
      const rule = golden.markingRules[c.rule];
      /* c8 ignore next */
      if (rule === undefined) throw new Error(`unknown rule ${c.rule}`);

      const outcome = scoreQuestion(rule, buildResponse(c), buildKey(c));

      expect(outcome.marks, `marks for ${c.id}`).toBe(c.expect.marks);
      expect(outcome.status, `status for ${c.id}`).toBe(c.expect.status);
      // Every outcome must be explainable to the candidate (FR-SCR-18).
      expect(outcome.explanation.length, `explanation for ${c.id}`).toBeGreaterThan(0);
    });
  }
});

describe('golden oracle — the case that must never regress', () => {
  it('two of three correct awards the ladder value, not the proportional value', () => {
    const c = golden.cases.find((x) => x.id === 'adv-multi-two-of-three');
    expect(c, 'the two-of-three fixture must exist').toBeDefined();
    expect(c!.expect.marks).toBe(2);
    // 4 * 2 / 3 = 2.666..., the formula published across the Indian web.
    expect(c!.expect.marks).not.toBe((4 * 2) / 3);
  });
});
