/**
 * Wires the pure session reducer to storage, the network and the clock.
 *
 * Order of operations for every student mutation is fixed: persist locally,
 * receive the allocated `client_seq`, then dispatch. That is FR-SYN-01 read
 * literally, and it is what makes an app kill between tap and render a
 * non-event.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { OptionId, QuestionVersionId } from '@platform/domain';

import { revealPracticeAnswer } from '../../lib/api/endpoints.js';
import type { PracticeMode, PracticeQuestion, SolutionPayload } from '../../lib/api/types.js';
import { loadCachedQuestions, markSeen, persistResponse } from './repository.js';
import type { PracticeClock } from './practiceTimer.js';
import { monotonicNow, pause, resume, startClock, tick } from './practiceTimer.js';
import type { SessionState } from './session.js';
import { createSession, currentQuestionId, sessionReducer } from './session.js';

const TICK_INTERVAL_MS = 1000;

export interface PracticeSessionApi {
  readonly state: SessionState;
  readonly questions: readonly PracticeQuestion[];
  readonly current: PracticeQuestion | null;
  readonly clock: PracticeClock;
  readonly solution: SolutionPayload | null;
  readonly revealBlockedReason: string | null;
  readonly toggleOption: (optionId: OptionId) => Promise<void>;
  readonly setNumeric: (raw: string) => Promise<void>;
  readonly toggleMark: () => Promise<void>;
  readonly clearResponse: () => Promise<void>;
  readonly goTo: (index: number) => void;
  readonly reveal: () => Promise<void>;
  readonly submit: () => void;
  readonly setPaused: (paused: boolean) => void;
}

export function usePracticeSession(args: {
  readonly sessionId: string;
  readonly mode: PracticeMode;
  readonly order: readonly QuestionVersionId[];
  readonly targetSeconds: number | null;
  readonly online: boolean;
}): PracticeSessionApi {
  const [state, dispatch] = useReducer(
    sessionReducer,
    { sessionId: args.sessionId, mode: args.mode, order: args.order },
    createSession,
  );
  const [questions, setQuestions] = useState<readonly PracticeQuestion[]>([]);
  const [solution, setSolution] = useState<SolutionPayload | null>(null);
  const [clock, setClock] = useState<PracticeClock>(() =>
    startClock(args.mode === 'TIMED' ? args.targetSeconds : null),
  );
  const revealKey = useRef<string>('');

  useEffect(() => {
    let cancelled = false;
    void loadCachedQuestions(args.order).then((loaded) => {
      if (!cancelled) setQuestions(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [args.order]);

  const current = useMemo(() => {
    const id = currentQuestionId(state);
    if (id === null) return null;
    return questions.find((question) => question.questionVersionId === id) ?? null;
  }, [questions, state]);

  // Record delivery against the seen ledger the moment a question is shown, not
  // when it is answered. A question the student saw and skipped has still been
  // spent, and serving it again as a "fresh unseen item" would be a lie
  // (FR-SRS-03).
  useEffect(() => {
    if (current === null) return;
    void markSeen(current.questionVersionId, current.subTopicId, 'PRACTICE');
  }, [current]);

  // Moving to a new question clears the previous solution immediately. Leaving
  // it mounted for a frame is how a solution from question 4 appears above the
  // stem of question 5.
  useEffect(() => {
    setSolution(null);
  }, [state.index]);

  useEffect(() => {
    const timer = setInterval(() => {
      setClock((previous) => tick(previous));
    }, TICK_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  // Backgrounding pauses the practice clock. This is legitimate here precisely
  // because practice is unranked: the student who put the phone down to work a
  // problem on paper is doing the right thing and must not be penalised for it,
  // and there is no fairness property to protect (FR-SRS-06 rough-work note).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      setClock((previous) =>
        status === 'active' ? resume(previous, monotonicNow()) : pause(previous, monotonicNow()),
      );
    });
    return () => {
      subscription.remove();
    };
  }, []);

  const persistCurrent = useCallback(
    async (mutate: (seq: number) => void) => {
      const id = currentQuestionId(state);
      if (id === null) return;
      const existing = state.responses[String(id)];
      const seq = await persistResponse(args.sessionId, {
        questionVersionId: id,
        selectedOptionIds: existing?.selectedOptionIds ?? [],
        numericRaw: existing?.numericRaw ?? null,
        visited: true,
        markedForReview: existing?.markedForReview ?? false,
        timeSpentMs: existing?.timeSpentMs ?? 0,
        clientSeq: 0,
      });
      mutate(seq);
    },
    [args.sessionId, state],
  );

  const toggleOption = useCallback(
    async (optionId: OptionId) => {
      const multiSelect = current?.questionType === 'MCQ_MULTI';
      await persistCurrent((clientSeq) => {
        dispatch({ type: 'TOGGLE_OPTION', optionId, multiSelect, clientSeq });
      });
    },
    [current, persistCurrent],
  );

  const setNumeric = useCallback(
    async (raw: string) => {
      await persistCurrent((clientSeq) => {
        dispatch({ type: 'SET_NUMERIC', raw, clientSeq });
      });
    },
    [persistCurrent],
  );

  const toggleMark = useCallback(async () => {
    await persistCurrent((clientSeq) => {
      dispatch({ type: 'TOGGLE_MARK', clientSeq });
    });
  }, [persistCurrent]);

  const clearResponse = useCallback(async () => {
    await persistCurrent((clientSeq) => {
      dispatch({ type: 'CLEAR_RESPONSE', clientSeq });
    });
  }, [persistCurrent]);

  const goTo = useCallback((index: number) => {
    dispatch({ type: 'GO_TO', index });
  }, []);

  /**
   * Tutor-mode reveal.
   *
   * Requires connectivity, and says so plainly rather than degrading into
   * silence. The alternative — caching keys so reveal works offline — is
   * prohibited (FR-SYN-10), and the honest failure is far better than a feature
   * that quietly stops working in a hostel dead zone.
   */
  const reveal = useCallback(async () => {
    const id = currentQuestionId(state);
    if (id === null || !args.online) return;
    const response = state.responses[String(id)];
    if (response === undefined) return;

    dispatch({ type: 'REVEAL_REQUESTED' });
    revealKey.current = revealKey.current === '' ? `${args.sessionId}:${String(id)}` : revealKey.current;

    try {
      const payload = await revealPracticeAnswer({
        sessionId: args.sessionId,
        questionVersionId: id,
        selectedOptionIds: response.selectedOptionIds.map(String),
        numericRaw: response.numericRaw,
        idempotencyKey: `${args.sessionId}:${String(id)}`,
      });
      dispatch({ type: 'REVEAL', result: payload.result });
      setSolution(payload.solution);
    } catch {
      dispatch({ type: 'REVEAL_FAILED' });
    }
  }, [args.online, args.sessionId, state]);

  const submit = useCallback(() => {
    dispatch({ type: 'SUBMIT' });
  }, []);

  const setPaused = useCallback((paused: boolean) => {
    setClock((previous) => (paused ? pause(previous) : resume(previous)));
  }, []);

  const revealBlockedReason =
    args.mode === 'TUTOR' && !args.online
      ? 'You are offline, so we cannot show the solution yet. Your answer is saved on this device and the explanation will appear the next time you connect.'
      : null;

  return {
    state,
    questions,
    current,
    clock,
    solution,
    revealBlockedReason,
    toggleOption,
    setNumeric,
    toggleMark,
    clearResponse,
    goTo,
    reveal,
    submit,
    setPaused,
  };
}
