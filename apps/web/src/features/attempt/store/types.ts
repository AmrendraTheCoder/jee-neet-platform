import type { OptionId, QuestionVersionId, SectionId } from '@platform/domain';
import type { AttemptSnapshot, AttemptStatus, PersistedResponse } from '../../../lib/api/types.js';
import type { ClockAnchor } from '../../../lib/time/monotonic.js';

/**
 * The on-screen, UNSAVED selection for the current question.
 *
 * This being separate from `responses` is the whole architecture of the
 * player. In the real examination interface, choosing an option changes what
 * is on screen and changes nothing else. Only Save & Next and Mark for Review
 * & Next commit it. Everything that navigates — palette, section tab, question
 * paper — discards it (FR-ATT-02).
 *
 * A player that writes the selection straight into `responses` cannot express
 * that, and every clone that does gets FR-ATT-02 wrong.
 */
export interface DraftAnswer {
  readonly selectedOptionIds: readonly OptionId[];
  readonly numericRaw: string | null;
}

export type PlayerScreen = 'INSTRUCTIONS' | 'PLAYER' | 'QUESTION_PAPER';

export type SyncHealth =
  /** Everything acknowledged. */
  | 'CLEAR'
  /** A batch is in flight. */
  | 'SYNCING'
  /**
   * Retrying under backoff. Surfaced as a passive count, never as a per-answer
   * error toast (FR-SYN-05) — a toast per answer during a network dip is an
   * interruption storm on a timed paper, and the answers are safe locally.
   */
  | 'RETRYING';

export interface AttemptState {
  /** Immutable for the life of the attempt. Resolved once at start (FR-TST-10). */
  readonly snapshot: AttemptSnapshot;
  /** Committed answers, keyed by question version id. Never by position. */
  readonly responses: ReadonlyMap<string, PersistedResponse>;
  readonly currentQuestionVersionId: QuestionVersionId;
  readonly draft: DraftAnswer | null;
  readonly screen: PlayerScreen;
  readonly anchor: ClockAnchor;
  /** Mirrors the server value; re-read on every heartbeat, never extended. */
  readonly deadlineAtMs: number;
  readonly status: AttemptStatus;
  readonly pendingCount: number;
  readonly syncHealth: SyncHealth;
  readonly submitting: boolean;
  /**
   * Sections a candidate may no longer enter. Empty where the pattern permits
   * free switching, which is the JEE Main and NEET case.
   */
  readonly closedSectionIds: ReadonlySet<string>;
  /** Monotonic timestamp at which the current question came on screen. */
  readonly questionShownAtMonotonicMs: number;
  readonly submitDialogOpen: boolean;
}

export interface SectionNavigability {
  readonly sectionId: SectionId;
  readonly enterable: boolean;
  readonly reason: string | null;
}
