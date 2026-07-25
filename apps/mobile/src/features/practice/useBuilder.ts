/**
 * Custom-test-builder state.
 *
 * Counts are recomputed on every criteria change, from local SQLite, debounced
 * by one frame's worth of time so a rapid double-toggle issues one pass rather
 * than two. They are never fetched: a chip count that arrives over the network
 * is a chip count that is wrong while the student is looking at it, and it would
 * put a request behind every tap (NFR-SCL-11).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Subject } from '@platform/domain';

import type {
  BuilderCriteria,
  ChipCounts,
  Difficulty,
  QuestionStateFilter,
  YearRange,
} from './filters.js';
import { EMPTY_CRITERIA, chipCounts } from './filters.js';
import type { RelaxationResult } from './relaxation.js';
import { resolveWithRelaxation } from './relaxation.js';

const RECOUNT_DEBOUNCE_MS = 60;

export interface BuilderApi {
  readonly criteria: BuilderCriteria;
  readonly counts: ChipCounts | null;
  readonly counting: boolean;
  readonly toggleState: (state: QuestionStateFilter) => void;
  readonly toggleDifficulty: (difficulty: Difficulty) => void;
  readonly toggleChapter: (chapterId: string) => void;
  readonly toggleSubTopic: (subTopicId: string) => void;
  readonly setSubject: (subject: Subject | null) => void;
  readonly setYears: (years: YearRange | null) => void;
  readonly setTargetCount: (count: number) => void;
  readonly reset: () => void;
  readonly resolve: () => Promise<RelaxationResult>;
}

function toggle<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function useBuilder(initial: Partial<BuilderCriteria> = {}): BuilderApi {
  const [criteria, setCriteria] = useState<BuilderCriteria>({ ...EMPTY_CRITERIA, ...initial });
  const [counts, setCounts] = useState<ChipCounts | null>(null);
  const [counting, setCounting] = useState(true);
  const generation = useRef(0);

  useEffect(() => {
    const mine = generation.current + 1;
    generation.current = mine;
    setCounting(true);

    const timer = setTimeout(() => {
      void chipCounts(criteria)
        .then((next) => {
          // A slower earlier pass must not overwrite a newer result. Without this
          // guard, toggling two chips quickly can leave the counts describing the
          // first selection while the chips show the second.
          if (generation.current !== mine) return;
          setCounts(next);
          setCounting(false);
        })
        .catch(() => {
          if (generation.current !== mine) return;
          setCounting(false);
        });
    }, RECOUNT_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [criteria]);

  const toggleState = useCallback((state: QuestionStateFilter) => {
    setCriteria((previous) => ({ ...previous, states: toggle(previous.states, state) }));
  }, []);

  const toggleDifficulty = useCallback((difficulty: Difficulty) => {
    setCriteria((previous) => ({
      ...previous,
      difficulties: toggle(previous.difficulties, difficulty),
    }));
  }, []);

  const toggleChapter = useCallback((chapterId: string) => {
    setCriteria((previous) => ({ ...previous, chapterIds: toggle(previous.chapterIds, chapterId) }));
  }, []);

  const toggleSubTopic = useCallback((subTopicId: string) => {
    setCriteria((previous) => ({
      ...previous,
      subTopicIds: toggle(previous.subTopicIds, subTopicId),
    }));
  }, []);

  const setSubject = useCallback((subject: Subject | null) => {
    setCriteria((previous) => ({ ...previous, subject }));
  }, []);

  const setYears = useCallback((years: YearRange | null) => {
    setCriteria((previous) => ({ ...previous, years }));
  }, []);

  const setTargetCount = useCallback((count: number) => {
    // Floor of one, ceiling of sixty. Sixty is roughly the largest set a student
    // completes in one sitting on a phone; beyond that the session becomes a
    // full-length mock, and this client does not run those.
    setCriteria((previous) => ({ ...previous, targetCount: Math.max(1, Math.min(60, count)) }));
  }, []);

  const reset = useCallback(() => {
    setCriteria(EMPTY_CRITERIA);
  }, []);

  const resolve = useCallback(() => resolveWithRelaxation(criteria), [criteria]);

  return useMemo(
    () => ({
      criteria,
      counts,
      counting,
      toggleState,
      toggleDifficulty,
      toggleChapter,
      toggleSubTopic,
      setSubject,
      setYears,
      setTargetCount,
      reset,
      resolve,
    }),
    [
      criteria,
      counts,
      counting,
      toggleState,
      toggleDifficulty,
      toggleChapter,
      toggleSubTopic,
      setSubject,
      setYears,
      setTargetCount,
      reset,
      resolve,
    ],
  );
}
