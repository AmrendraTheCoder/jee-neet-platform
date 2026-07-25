import { describe, expect, it } from 'vitest';
import { NonTotalTieBreakError, buildComparator, rank } from '../src/scoring/tiebreak.js';
import type { RankableAttempt } from '../src/scoring/tiebreak.js';
import type { TieBreakChain } from '../src/exam/pattern.js';
import { JEE_MAIN_2026_P1, NEET_2026 } from '../src/exam/registry.js';

function attempt(init: Partial<RankableAttempt> & { id: string }): RankableAttempt {
  return {
    id: init.id,
    rawScore: init.rawScore ?? 0,
    positiveMarks: init.positiveMarks ?? 0,
    incorrectCount: init.incorrectCount ?? 0,
    submittedAt: init.submittedAt ?? 0,
    bySubject: init.bySubject ?? [],
  };
}

describe('buildComparator', () => {
  it('refuses a chain that does not terminate in STABLE_ID', () => {
    const chain: TieBreakChain = [{ kind: 'TOTAL_SCORE_DESC' }];
    expect(() => buildComparator(chain)).toThrowError(NonTotalTieBreakError);
  });

  it('accepts a chain that does', () => {
    expect(() =>
      buildComparator([{ kind: 'TOTAL_SCORE_DESC' }, { kind: 'STABLE_ID' }]),
    ).not.toThrow();
  });
});

describe('rank — determinism', () => {
  const chain: TieBreakChain = [
    { kind: 'TOTAL_SCORE_DESC' },
    { kind: 'FEWER_INCORRECT' },
    { kind: 'STABLE_ID' },
  ];

  it('produces a total order, so repeated ranking never changes a position', () => {
    const attempts = [
      attempt({ id: 'c', rawScore: 100, incorrectCount: 2 }),
      attempt({ id: 'a', rawScore: 100, incorrectCount: 2 }),
      attempt({ id: 'b', rawScore: 100, incorrectCount: 2 }),
    ];

    const first = rank(attempts, chain);
    // Re-rank a differently-ordered input; the result must be identical.
    const second = rank([...attempts].reverse(), chain);
    expect(second).toEqual(first);

    // Fully tied candidates fall through to the stable id.
    expect(first.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('separates candidates on the earlier steps before reaching the stable id', () => {
    const ranked = rank(
      [
        attempt({ id: 'z', rawScore: 100, incorrectCount: 0 }),
        attempt({ id: 'a', rawScore: 100, incorrectCount: 5 }),
      ],
      chain,
    );
    // 'z' wins on fewer incorrect despite losing alphabetically.
    expect(ranked[0]?.id).toBe('z');
  });

  it('reports score-level rank alongside strict rank', () => {
    const ranked = rank(
      [
        attempt({ id: 'a', rawScore: 100, incorrectCount: 1 }),
        attempt({ id: 'b', rawScore: 100, incorrectCount: 2 }),
        attempt({ id: 'c', rawScore: 90 }),
      ],
      chain,
    );

    expect(ranked[0]).toMatchObject({ id: 'a', rank: 1, scoreRank: 1, tiedOnScore: 2 });
    expect(ranked[1]).toMatchObject({ id: 'b', rank: 2, scoreRank: 1, tiedOnScore: 2 });
    expect(ranked[2]).toMatchObject({ id: 'c', rank: 3, scoreRank: 3, tiedOnScore: 1 });
  });
});

describe('rank — published chains', () => {
  it('JEE Main leads with Mathematics', () => {
    const ranked = rank(
      [
        attempt({
          id: 'chemistry-strong',
          rawScore: 200,
          bySubject: [
            { subject: 'MATHEMATICS', score: 50, incorrect: 0 },
            { subject: 'PHYSICS', score: 60, incorrect: 0 },
            { subject: 'CHEMISTRY', score: 90, incorrect: 0 },
          ],
        }),
        attempt({
          id: 'maths-strong',
          rawScore: 200,
          bySubject: [
            { subject: 'MATHEMATICS', score: 90, incorrect: 0 },
            { subject: 'PHYSICS', score: 60, incorrect: 0 },
            { subject: 'CHEMISTRY', score: 50, incorrect: 0 },
          ],
        }),
      ],
      JEE_MAIN_2026_P1.tieBreak,
    );
    expect(ranked[0]?.id).toBe('maths-strong');
  });

  it('NEET leads with Biology as a combined group', () => {
    const ranked = rank(
      [
        attempt({
          id: 'physics-strong',
          rawScore: 400,
          bySubject: [
            { subject: 'BOTANY', score: 80, incorrect: 0 },
            { subject: 'ZOOLOGY', score: 80, incorrect: 0 },
            { subject: 'CHEMISTRY', score: 100, incorrect: 0 },
            { subject: 'PHYSICS', score: 140, incorrect: 0 },
          ],
        }),
        attempt({
          id: 'biology-strong',
          rawScore: 400,
          bySubject: [
            { subject: 'BOTANY', score: 120, incorrect: 0 },
            { subject: 'ZOOLOGY', score: 120, incorrect: 0 },
            { subject: 'CHEMISTRY', score: 100, incorrect: 0 },
            { subject: 'PHYSICS', score: 60, incorrect: 0 },
          ],
        }),
      ],
      NEET_2026.tieBreak,
    );
    // Botany + Zoology combined: 240 beats 160.
    expect(ranked[0]?.id).toBe('biology-strong');
  });

  it('every built-in chain is total', () => {
    for (const pattern of [JEE_MAIN_2026_P1, NEET_2026]) {
      expect(() => buildComparator(pattern.tieBreak)).not.toThrow();
    }
  });
});

describe('rank — scale', () => {
  it('ranks 10,000 attempts deterministically', () => {
    const attempts = Array.from({ length: 10_000 }, (_, i) =>
      attempt({ id: `s${String(i).padStart(5, '0')}`, rawScore: i % 301, incorrectCount: i % 7 }),
    );
    const chain: TieBreakChain = [
      { kind: 'TOTAL_SCORE_DESC' },
      { kind: 'FEWER_INCORRECT' },
      { kind: 'STABLE_ID' },
    ];
    const a = rank(attempts, chain);
    const b = rank([...attempts].reverse(), chain);
    expect(b).toEqual(a);
    expect(new Set(a.map((r) => r.rank)).size).toBe(10_000);
  });
});
