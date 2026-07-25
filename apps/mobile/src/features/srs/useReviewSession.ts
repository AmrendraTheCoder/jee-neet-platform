/**
 * Drives one pass through the due queue.
 *
 * The loop is: take the next due card, draw a fresh unseen item for its
 * sub-topic, let the student answer, reveal, take the self-report, advance the
 * card, move on. The item is incidental — the card is what is being scheduled,
 * and the item is only how the concept gets probed this time (FR-SRS-01).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { QuestionVersionId, ResponseStatus } from '@platform/domain';

import type { PracticeQuestion } from '../../lib/api/types.js';
import { markSeen } from '../practice/repository.js';
import type { SelfReport } from './grading.js';
import { deriveRating } from './grading.js';
import type { DueCard } from './queue.js';
import { drawUnseenItem, dueCards, recordReview } from './queue.js';
import { previewIntervals } from './scheduler.js';
import type { ReviewRating } from './grading.js';

export type ReviewPhase = 'LOADING' | 'ANSWERING' | 'REVEALED' | 'EXHAUSTED' | 'COMPLETE';

export interface ReviewSessionApi {
  readonly phase: ReviewPhase;
  readonly card: DueCard | null;
  readonly question: PracticeQuestion | null;
  readonly completed: number;
  readonly remaining: number;
  readonly intervalDays: Readonly<Record<ReviewRating, number>>;
  readonly reveal: (outcome: ResponseStatus) => void;
  readonly grade: (report: SelfReport) => Promise<void>;
  readonly skip: () => void;
}

const DAILY_TARGET = 20;

export function useReviewSession(online: boolean): ReviewSessionApi {
  const [queue, setQueue] = useState<readonly DueCard[]>([]);
  const [index, setIndex] = useState(0);
  const [question, setQuestion] = useState<PracticeQuestion | null>(null);
  const [phase, setPhase] = useState<ReviewPhase>('LOADING');
  const [outcome, setOutcome] = useState<ResponseStatus>('UNATTEMPTED');

  useEffect(() => {
    let cancelled = false;
    void dueCards(Date.now(), DAILY_TARGET).then((cards) => {
      if (cancelled) return;
      setQueue(cards);
      setPhase(cards.length === 0 ? 'COMPLETE' : 'LOADING');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const card = queue[index] ?? null;

  useEffect(() => {
    if (card === null) {
      if (queue.length > 0) setPhase('COMPLETE');
      return;
    }
    let cancelled = false;
    setPhase('LOADING');
    setQuestion(null);

    void drawUnseenItem(card.card, online).then((drawn) => {
      if (cancelled) return;
      if (drawn === null) {
        // No unseen item for this sub-topic. Never repeat one — a scheduler that
        // re-serves a question the student has met is testing recall of that
        // question, which is the failure mode keying on sub-topics exists to
        // avoid (AC-SRS-02).
        setPhase('EXHAUSTED');
        return;
      }
      setQuestion(drawn);
      void markSeen(drawn.questionVersionId, drawn.subTopicId, 'SRS');
      setPhase('ANSWERING');
    });

    return () => {
      cancelled = true;
    };
  }, [card, online, queue.length]);

  const intervalDays = useMemo(
    () =>
      card === null
        ? { AGAIN: 0, HARD: 0, GOOD: 0, EASY: 0 }
        : previewIntervals(card.card, Date.now()),
    [card],
  );

  const reveal = useCallback((next: ResponseStatus) => {
    setOutcome(next);
    setPhase('REVEALED');
  }, []);

  const advance = useCallback(() => {
    setIndex((previous) => previous + 1);
  }, []);

  const grade = useCallback(
    async (report: SelfReport) => {
      if (card === null) return;
      const rating = deriveRating(outcome, report);
      await recordReview({
        card: card.card,
        subject: card.subject,
        rating,
        questionVersionId: (question?.questionVersionId ?? null) as QuestionVersionId | null,
        // The instant the review happened, not the instant it syncs. A review
        // taken offline at night and uploaded in the morning must schedule from
        // when it was taken.
        reviewedAtMs: Date.now(),
      });
      advance();
    },
    [advance, card, outcome, question],
  );

  const skip = useCallback(() => {
    advance();
  }, [advance]);

  return {
    phase,
    card,
    question,
    completed: index,
    remaining: Math.max(0, queue.length - index),
    intervalDays,
    reveal,
    grade,
    skip,
  };
}
