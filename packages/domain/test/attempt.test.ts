import { describe, expect, it } from 'vitest';
import {
  attemptedCount,
  hasAnswer,
  paletteCounts,
  paletteState,
  paletteStateFor,
} from '../src/attempt/palette.js';
import {
  assertInQuestionOrder,
  mulberry32,
  seededShuffle,
  shuffleOptions,
} from '../src/attempt/shuffle.js';
import {
  SUBMISSION_GRACE_SECONDS,
  acceptsResponseAt,
  accommodationSeconds,
  computeDeadline,
  evaluateLateJoin,
  formatDuration,
  remainingSeconds,
} from '../src/attempt/timer.js';
import { opt, response } from './helpers.js';

describe('palette — five states derived from three orthogonal facts', () => {
  it('maps every combination correctly', () => {
    expect(paletteState({ visited: false, hasAnswer: false, markedForReview: false })).toBe(
      'NOT_VISITED',
    );
    expect(paletteState({ visited: true, hasAnswer: false, markedForReview: false })).toBe(
      'NOT_ANSWERED',
    );
    expect(paletteState({ visited: true, hasAnswer: true, markedForReview: false })).toBe(
      'ANSWERED',
    );
    expect(paletteState({ visited: true, hasAnswer: false, markedForReview: true })).toBe(
      'MARKED_FOR_REVIEW',
    );
    expect(paletteState({ visited: true, hasAnswer: true, markedForReview: true })).toBe(
      'ANSWERED_AND_MARKED',
    );
  });

  it('an unvisited question is NOT_VISITED regardless of other flags', () => {
    expect(paletteState({ visited: false, hasAnswer: true, markedForReview: true })).toBe(
      'NOT_VISITED',
    );
  });

  it('marking a question never removes its answer', () => {
    // EC-NOTES-03: if "marked for review" were stored as a variant of the
    // answer rather than as an orthogonal flag, marking would clear the answer
    // and the candidate would silently lose marks on the questions they were
    // most careful about.
    const answered = response(1, { selectedOptionIds: [opt(1, 'B')], markedForReview: false });
    const marked = { ...answered, markedForReview: true };
    expect(hasAnswer(marked)).toBe(true);
    expect(paletteStateFor(marked)).toBe('ANSWERED_AND_MARKED');
  });

  it('recognises a numeric answer as an answer', () => {
    expect(hasAnswer(response(1, { numericRaw: '42' }))).toBe(true);
    expect(hasAnswer(response(1, { numericRaw: '   ' }))).toBe(false);
    expect(hasAnswer(response(1, { numericRaw: null }))).toBe(false);
  });

  it('counts states for the submit confirmation', () => {
    const order = ['q1', 'q2', 'q3', 'q4', 'q5'];
    const responses = new Map([
      ['q1', response(1, { selectedOptionIds: [opt(1, 'A')] })],
      ['q2', response(2, { selectedOptionIds: [opt(2, 'A')], markedForReview: true })],
      ['q3', response(3, { visited: true })],
      ['q4', response(4, { visited: true, markedForReview: true })],
      // q5 never visited
    ]);

    const counts = paletteCounts(order, responses);
    expect(counts).toEqual({
      notVisited: 1,
      notAnswered: 1,
      answered: 1,
      markedForReview: 1,
      answeredAndMarked: 1,
    });
    // An answered-and-marked question still counts as attempted. Reporting it
    // otherwise on the confirmation screen is how a candidate submits believing
    // they answered fewer than they did.
    expect(attemptedCount(counts)).toBe(2);
  });
});

describe('shuffle — deterministic and reproducible', () => {
  it('produces the same order for the same seed, every time', () => {
    const items = Array.from({ length: 90 }, (_, i) => `q${i}`);
    const a = seededShuffle(items, 'attempt-abc');
    const b = seededShuffle(items, 'attempt-abc');
    expect(b).toEqual(a);
  });

  it('produces a different order for a different seed', () => {
    const items = Array.from({ length: 90 }, (_, i) => `q${i}`);
    expect(seededShuffle(items, 'attempt-abc')).not.toEqual(seededShuffle(items, 'attempt-xyz'));
  });

  it('never mutates the input', () => {
    const items = ['a', 'b', 'c', 'd'];
    const copy = [...items];
    seededShuffle(items, 'seed');
    expect(items).toEqual(copy);
  });

  it('is a permutation — no item lost, none duplicated', () => {
    const items = Array.from({ length: 200 }, (_, i) => i);
    const shuffled = seededShuffle(items, 'seed');
    expect(shuffled).toHaveLength(items.length);
    expect(new Set(shuffled).size).toBe(items.length);
  });

  it('survives a hypothetical reinstall: order is a function of seed alone', () => {
    // EC-RAND-01. The order is re-derivable from the stored seed years later,
    // which is what makes an attempt auditable.
    const items = ['q1', 'q2', 'q3', 'q4', 'q5'];
    const atStart = seededShuffle(items, 'attempt-42');
    const afterReinstall = seededShuffle(items, 'attempt-42');
    const inAuditYearsLater = seededShuffle(items, 'attempt-42');
    expect(afterReinstall).toEqual(atStart);
    expect(inAuditYearsLater).toEqual(atStart);
  });

  it('mulberry32 emits values in [0, 1)', () => {
    const next = mulberry32(12345);
    for (let i = 0; i < 1000; i += 1) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('shuffleOptions', () => {
  const base = {
    questionVersionId: 'q1',
    optionIds: ['o1', 'o2', 'o3', 'o4'],
  };

  it('leaves options untouched when shuffling is off, which is the default', () => {
    expect(shuffleOptions({ ...base, shuffleOptions: false }, 'seed')).toEqual(base.optionIds);
  });

  it('honours a pinned position so "None of the above" stays last', () => {
    // FR-ITM-10. Scoring can never break from a shuffle because the key is an
    // option id, but "None of the above" in position B is semantically broken.
    const result = shuffleOptions(
      { ...base, shuffleOptions: true, pinnedPositions: { o4: 3 } },
      'seed',
    );
    expect(result[3]).toBe('o4');
    expect(new Set(result).size).toBe(4);
  });

  it('gives different questions uncorrelated permutations under one attempt seed', () => {
    const a = shuffleOptions({ ...base, questionVersionId: 'q1', shuffleOptions: true }, 'seed');
    const b = shuffleOptions({ ...base, questionVersionId: 'q2', shuffleOptions: true }, 'seed');
    expect(b).not.toEqual(a);
  });

  it('rejects two options pinned to the same position', () => {
    expect(() =>
      shuffleOptions(
        { ...base, shuffleOptions: true, pinnedPositions: { o3: 3, o4: 3 } },
        'seed',
      ),
    ).toThrowError(/two options pinned/);
  });

  it('rejects a pinned position outside the option list', () => {
    expect(() =>
      shuffleOptions({ ...base, shuffleOptions: true, pinnedPositions: { o1: 9 } }, 'seed'),
    ).toThrowError(RangeError);
  });
});

describe('assertInQuestionOrder', () => {
  it('accepts a question that belongs to the attempt', () => {
    expect(() => assertInQuestionOrder('q2', ['q1', 'q2', 'q3'])).not.toThrow();
  });

  it('rejects one that does not — the EC-DATA-09 guard', () => {
    expect(() => assertInQuestionOrder('q9', ['q1', 'q2', 'q3'])).toThrowError(
      /not part of this attempt/,
    );
  });
});

describe('timer — server-authoritative deadline', () => {
  const start = Date.UTC(2026, 4, 3, 8, 30, 0);
  const threeHours = 180 * 60;

  it('computes the natural end when the window is generous', () => {
    const result = computeDeadline({
      startedAtMs: start,
      baseDurationSeconds: threeHours,
      windowEndsAtMs: start + 6 * 3600 * 1000,
    });
    expect(result.deadlineAtMs).toBe(start + threeHours * 1000);
    expect(result.shortened).toBe(false);
  });

  it('truncates at window close and flags the attempt as shortened', () => {
    const result = computeDeadline({
      startedAtMs: start,
      baseDurationSeconds: threeHours,
      windowEndsAtMs: start + 80 * 60 * 1000,
    });
    expect(result.deadlineAtMs).toBe(start + 80 * 60 * 1000);
    expect(result.shortened).toBe(true);
  });

  it('grants an accommodation entitlement attached to the person', () => {
    // FR-A11Y-05. Without this, a candidate lawfully entitled to a longer
    // sitting simply cannot use the product.
    const result = computeDeadline({
      startedAtMs: start,
      baseDurationSeconds: threeHours,
      windowEndsAtMs: start + 3 * 3600 * 1000,
      accommodation: { extraSeconds: 3600, reason: 'compensatory hour' },
    });
    expect(result.accommodationSeconds).toBe(3600);
    expect(result.effectiveDurationSeconds).toBe(threeHours + 3600);
    // The window is extended too. Extending only the duration would grant the
    // time and then take it back at the window boundary.
    expect(result.deadlineAtMs).toBe(start + (threeHours + 3600) * 1000);
    expect(result.shortened).toBe(false);
  });

  it('supports pro-rata additional time', () => {
    expect(accommodationSeconds(threeHours, { extraTimeRatio: 1 / 3, reason: 'pro rata' })).toBe(
      3600,
    );
  });

  it('rejects a negative entitlement', () => {
    expect(() =>
      accommodationSeconds(threeHours, { extraSeconds: -60, reason: 'invalid' }),
    ).toThrowError(RangeError);
  });

  it('rejects a non-positive duration', () => {
    expect(() =>
      computeDeadline({ startedAtMs: start, baseDurationSeconds: 0, windowEndsAtMs: null }),
    ).toThrowError(RangeError);
  });

  it('never returns a negative remaining time', () => {
    expect(remainingSeconds(start, start + 10_000)).toBe(0);
    expect(remainingSeconds(start + 10_000, start)).toBe(10);
  });

  it('grants no time when the device clock moves backwards', () => {
    // EC-TIMER-01. The deadline is an absolute server instant; the only way a
    // client could gain time is by influencing it, and it cannot.
    const result = computeDeadline({
      startedAtMs: start,
      baseDurationSeconds: threeHours,
      windowEndsAtMs: null,
    });
    const honestNow = start + 60 * 60 * 1000;
    const tamperedNow = honestNow - 45 * 60 * 1000;

    const honest = remainingSeconds(result.deadlineAtMs, honestNow);
    // A client that lies about "now" changes only its own display. The server
    // computes remaining time from its own clock against the same deadline.
    const serverView = remainingSeconds(result.deadlineAtMs, honestNow);
    expect(serverView).toBe(honest);
    expect(remainingSeconds(result.deadlineAtMs, tamperedNow)).toBeGreaterThan(honest);
    // ...which is precisely why the server, not the client, decides.
    expect(result.deadlineAtMs).toBe(start + threeHours * 1000);
  });
});

describe('timer — late join', () => {
  const startsAt = Date.UTC(2026, 4, 3, 8, 30, 0);
  const windowEndsAt = startsAt + 3 * 3600 * 1000;
  const duration = 180 * 60;

  it('refuses a start before the window opens', () => {
    const d = evaluateLateJoin({
      nowMs: startsAt - 1000,
      startsAtMs: startsAt,
      windowEndsAtMs: windowEndsAt,
      baseDurationSeconds: duration,
      lateJoinCutoffSeconds: null,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/has not started/);
  });

  it('refuses a start after the window closes', () => {
    const d = evaluateLateJoin({
      nowMs: windowEndsAt + 1,
      startsAtMs: startsAt,
      windowEndsAtMs: windowEndsAt,
      baseDurationSeconds: duration,
      lateJoinCutoffSeconds: null,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/window has closed/);
  });

  it('enforces the late-join cutoff', () => {
    const d = evaluateLateJoin({
      nowMs: startsAt + 31 * 60 * 1000,
      startsAtMs: startsAt,
      windowEndsAtMs: windowEndsAt,
      baseDurationSeconds: duration,
      lateJoinCutoffSeconds: 30 * 60,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/joining window/);
  });

  it('warns a late joiner of their real available time before any question is shown', () => {
    // FR-TST-06. Discovering it from the timer is the failure this prevents.
    const d = evaluateLateJoin({
      nowMs: startsAt + 100 * 60 * 1000,
      startsAtMs: startsAt,
      windowEndsAtMs: windowEndsAt,
      baseDurationSeconds: duration,
      lateJoinCutoffSeconds: null,
    });
    expect(d.allowed).toBe(true);
    expect(d.shortened).toBe(true);
    expect(d.availableSeconds).toBe(80 * 60);
    expect(d.reason).toContain('1h 20m');
    expect(d.reason).toContain('not 3h');
    expect(d.reason).toMatch(/will not be ranked/);
  });

  it('does not warn a punctual candidate', () => {
    const d = evaluateLateJoin({
      nowMs: startsAt,
      startsAtMs: startsAt,
      windowEndsAtMs: windowEndsAt,
      baseDurationSeconds: duration,
      lateJoinCutoffSeconds: null,
    });
    expect(d.shortened).toBe(false);
    expect(d.reason).toBeNull();
  });
});

describe('timer — submission grace', () => {
  const deadline = Date.UTC(2026, 4, 3, 11, 30, 0);

  it('accepts a response inside the grace window', () => {
    expect(acceptsResponseAt(deadline, deadline + 5_000)).toBe(true);
    expect(acceptsResponseAt(deadline, deadline + SUBMISSION_GRACE_SECONDS * 1000)).toBe(true);
  });

  it('rejects one beyond it', () => {
    expect(acceptsResponseAt(deadline, deadline + (SUBMISSION_GRACE_SECONDS + 1) * 1000)).toBe(
      false,
    );
  });
});

describe('formatDuration', () => {
  it('renders durations the way a candidate reads them', () => {
    expect(formatDuration(80 * 60)).toBe('1h 20m');
    expect(formatDuration(180 * 60)).toBe('3h');
    expect(formatDuration(45 * 60)).toBe('45m');
  });
});
