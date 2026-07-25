import { describe, expect, it } from 'vitest';
import { computePercentiles, subjectPercentiles } from '../src/scoring/percentile.js';

describe('computePercentiles', () => {
  it('gives the top scorer exactly 100', () => {
    const p = computePercentiles([
      { id: 'a', rawScore: 300 },
      { id: 'b', rawScore: 200 },
      { id: 'c', rawScore: 100 },
    ]);
    expect(p.get('a')).toBe('100.0000000');
  });

  it('uses the at-or-below rule, so the bottom scorer is not zero', () => {
    const p = computePercentiles([
      { id: 'a', rawScore: 300 },
      { id: 'b', rawScore: 200 },
      { id: 'c', rawScore: 100 },
    ]);
    // 1 of 3 candidates scored at or below 100.
    expect(p.get('c')).toBe('33.3333333');
    expect(p.get('b')).toBe('66.6666667');
  });

  it('gives tied candidates the same percentile', () => {
    const p = computePercentiles([
      { id: 'a', rawScore: 100 },
      { id: 'b', rawScore: 100 },
      { id: 'c', rawScore: 50 },
      { id: 'd', rawScore: 10 },
    ]);
    expect(p.get('a')).toBe(p.get('b'));
    // Both tied candidates sit at or above 4 of 4.
    expect(p.get('a')).toBe('100.0000000');
  });

  it('emits exactly seven decimal places, always', () => {
    const p = computePercentiles(
      Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, rawScore: i })),
    );
    for (const value of p.values()) {
      expect(value).toMatch(/^\d+\.\d{7}$/);
    }
  });

  it('is exact where floating point is not', () => {
    // 1/3 at seven decimals. A float pipeline can emit 33.3333330 or 33.3333340
    // depending on cohort size, and two genuinely different percentiles can
    // then print identically.
    const p = computePercentiles([
      { id: 'a', rawScore: 1 },
      { id: 'b', rawScore: 2 },
      { id: 'c', rawScore: 3 },
    ]);
    expect(p.get('a')).toBe('33.3333333');
  });

  it('handles a single-candidate cohort', () => {
    const p = computePercentiles([{ id: 'only', rawScore: 42 }]);
    expect(p.get('only')).toBe('100.0000000');
  });

  it('handles an empty cohort without throwing', () => {
    expect(computePercentiles([]).size).toBe(0);
  });

  it('handles negative raw scores, which are reachable under negative marking', () => {
    const p = computePercentiles([
      { id: 'a', rawScore: -12 },
      { id: 'b', rawScore: 0 },
      { id: 'c', rawScore: 40 },
    ]);
    expect(p.get('a')).toBe('33.3333333');
    expect(p.get('c')).toBe('100.0000000');
  });

  it('scales to a realistic cohort', () => {
    const cohort = Array.from({ length: 10_000 }, (_, i) => ({
      id: `s${i}`,
      rawScore: i % 301,
    }));
    const p = computePercentiles(cohort);
    expect(p.size).toBe(10_000);
    for (const value of p.values()) {
      const numeric = Number(value);
      expect(numeric).toBeGreaterThan(0);
      expect(numeric).toBeLessThanOrEqual(100);
    }
  });
});

describe('subjectPercentiles', () => {
  const cohort = [
    {
      id: 'a',
      bySubject: [
        { subject: 'PHYSICS' as const, score: 100 },
        { subject: 'CHEMISTRY' as const, score: 20 },
      ],
    },
    {
      id: 'b',
      bySubject: [
        { subject: 'PHYSICS' as const, score: 20 },
        { subject: 'CHEMISTRY' as const, score: 100 },
      ],
    },
  ];

  it('computes each subject independently', () => {
    const result = subjectPercentiles(cohort);
    expect(result.get('PHYSICS')?.get('a')).toBe('100.0000000');
    expect(result.get('PHYSICS')?.get('b')).toBe('50.0000000');
    expect(result.get('CHEMISTRY')?.get('a')).toBe('50.0000000');
    expect(result.get('CHEMISTRY')?.get('b')).toBe('100.0000000');
  });

  it('does not agree with an average of subject percentiles', () => {
    // Both candidates average 75 across subjects, yet their overall percentile
    // on total score is identical at 100 because their totals are equal. The
    // published method is explicit that the overall figure is not an average,
    // and this asserts the two methods genuinely differ so nobody "simplifies"
    // one into the other.
    const bySubject = subjectPercentiles(cohort);
    const averageA =
      (Number(bySubject.get('PHYSICS')?.get('a')) + Number(bySubject.get('CHEMISTRY')?.get('a'))) /
      2;
    const overall = computePercentiles([
      { id: 'a', rawScore: 120 },
      { id: 'b', rawScore: 120 },
    ]);
    expect(averageA).toBe(75);
    expect(Number(overall.get('a'))).toBe(100);
    expect(averageA).not.toBe(Number(overall.get('a')));
  });
});
