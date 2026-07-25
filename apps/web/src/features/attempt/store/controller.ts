import type { OptionId, QuestionVersionId, SectionId } from '@platform/domain';
import type { ApiClient } from '../../../lib/api/client.js';
import type { ApiError } from '../../../lib/api/client.js';
import type { AttemptSnapshot, ResponseOp, SyncRequest, SyncResponse } from '../../../lib/api/types.js';
import { AttemptOutbox } from '../../../lib/offline/outbox.js';
import { createStore } from '../../../lib/store.js';
import type { Store } from '../../../lib/store.js';
import { createAnchor, monotonicNow, reconcileAnchor, serverNow } from '../../../lib/time/monotonic.js';
import { remainingSeconds } from '@platform/domain';
import { SyncEngine } from './sync.js';
import * as T from './transitions.js';
import { canEnterSection, currentQuestion, firstQuestionOfSection, isMultiSelect } from './selectors.js';
import type { AttemptState, PlayerScreen } from './types.js';

/**
 * Owns the attempt: state store, durable outbox, sync engine.
 *
 * Kept outside the React tree because the sync engine fires from a timer and
 * must be able to read and write state without a render, and because the
 * outbox must survive a component remount mid-paper.
 */
export class AttemptController {
  readonly store: Store<AttemptState>;

  private readonly sync: SyncEngine;
  private submitIdempotencyKey: string;

  private constructor(
    private readonly api: ApiClient,
    private readonly outbox: AttemptOutbox,
    snapshot: AttemptSnapshot,
    requestStartedMonotonicMs: number,
  ) {
    const anchor = createAnchor({
      serverEpochMs: snapshot.serverTimeMs,
      requestStartedMonotonicMs,
      responseReceivedMonotonicMs: monotonicNow(),
    });

    const first = snapshot.questions[0];
    if (first === undefined) throw new Error('attempt snapshot contains no questions');

    this.store = createStore<AttemptState>({
      snapshot,
      responses: new Map(snapshot.responses.map((r) => [String(r.questionVersionId), r])),
      currentQuestionVersionId: first.questionVersionId,
      draft: null,
      screen: 'INSTRUCTIONS',
      anchor,
      deadlineAtMs: snapshot.deadlineAtMs,
      status: snapshot.status,
      pendingCount: 0,
      syncHealth: 'CLEAR',
      submitting: false,
      closedSectionIds: new Set(),
      questionShownAtMonotonicMs: monotonicNow(),
      submitDialogOpen: false,
    });

    this.submitIdempotencyKey = `submit:${String(snapshot.attemptId)}`;

    this.sync = new SyncEngine({
      api,
      buildRequest: () => this.buildSyncRequest(),
      onResponse: (response, ops) => this.applySyncResponse(response, ops),
      onHealthChange: (health) => this.store.update((s) => ({ ...s, syncHealth: health })),
      remainingSeconds: () => {
        const state = this.store.getState();
        return remainingSeconds(state.deadlineAtMs, serverNow(state.anchor));
      },
      onFatal: (error: ApiError) => {
        // Deliberately not surfaced as a per-answer toast (FR-SYN-05). The
        // pending indicator already tells the candidate what is true, and the
        // detail belongs in the incident stream, not on a timed paper.
        console.error('[sync] non-retryable failure', error.code, error.message);
      },
    });
  }

  static async open(args: {
    readonly api: ApiClient;
    readonly snapshot: AttemptSnapshot;
    readonly requestStartedMonotonicMs: number;
  }): Promise<AttemptController> {
    const outbox = await AttemptOutbox.open(args.snapshot.attemptId, args.snapshot.lastAckClientSeq);
    const controller = new AttemptController(
      args.api,
      outbox,
      args.snapshot,
      args.requestStartedMonotonicMs,
    );
    await controller.refreshPendingCount();
    return controller;
  }

  /** Called when the candidate leaves the instructions screen (FR-ATT-14 gate). */
  beginPaper(): void {
    this.store.update((s) => ({
      ...s,
      screen: 'PLAYER',
      questionShownAtMonotonicMs: monotonicNow(),
    }));
    void this.recordVisit(this.store.getState().currentQuestionVersionId);
    this.sync.start();
  }

  dispose(): void {
    this.sync.stop();
    this.outbox.close();
  }

  forceSync(): void {
    this.sync.flushNow();
  }

  /* ---------------------------------------------------------------- *
   * Navigation
   * ---------------------------------------------------------------- */

  /**
   * Palette click, section tab, Back, Next, question-paper row.
   *
   * ALL of these navigate WITHOUT SAVING (FR-ATT-02). The unsaved draft is
   * discarded. See `transitions.navigateWithoutSaving` for why this matters
   * enough to be spelled out twice.
   */
  navigateTo(target: QuestionVersionId): void {
    const before = this.store.getState();
    if (before.currentQuestionVersionId === target && before.screen === 'PLAYER') return;

    void this.accumulateTimeOnLeaving(before);
    this.store.update((s) => T.navigateWithoutSaving(s, target, monotonicNow()));
    void this.recordVisit(target);
  }

  goNext(): void {
    const state = this.store.getState();
    const next = T.nextQuestionId(state, state.currentQuestionVersionId);
    if (next !== null) this.navigateTo(next);
  }

  goPrevious(): void {
    const state = this.store.getState();
    const previous = T.previousQuestionId(state, state.currentQuestionVersionId);
    if (previous !== null) this.navigateTo(previous);
  }

  enterSection(sectionId: SectionId): boolean {
    const state = this.store.getState();
    if (!canEnterSection(state, sectionId)) return false;
    const target = firstQuestionOfSection(state, sectionId);
    if (target === null) return false;
    this.navigateTo(target);
    return true;
  }

  /** Explicitly closes a time-locked section. Irreversible, hence confirmed in the UI. */
  closeSection(sectionId: SectionId): void {
    this.store.update((s) => {
      const closed = new Set(s.closedSectionIds);
      closed.add(String(sectionId));
      return { ...s, closedSectionIds: closed };
    });
    const state = this.store.getState();
    const next = T.nextQuestionId(state, state.currentQuestionVersionId);
    if (next !== null) this.navigateTo(next);
  }

  setScreen(screen: PlayerScreen): void {
    this.store.update((s) => ({ ...s, screen }));
  }

  setSubmitDialogOpen(open: boolean): void {
    this.store.update((s) => ({ ...s, submitDialogOpen: open }));
  }

  /* ---------------------------------------------------------------- *
   * Answering
   * ---------------------------------------------------------------- */

  /** Draft only. Nothing is persisted until an explicit save. */
  selectOption(optionId: OptionId): void {
    const state = this.store.getState();
    const question = currentQuestion(state);
    if (question === undefined) return;
    this.store.update((s) => T.toggleOption(s, optionId, isMultiSelect(question)));
  }

  setNumericInput(raw: string): void {
    this.store.update((s) => T.setNumeric(s, raw));
  }

  /** Saves the on-screen answer and advances. Review flag is left as it stands. */
  async saveAndNext(): Promise<void> {
    const state = this.store.getState();
    const existing = state.responses.get(String(state.currentQuestionVersionId));
    await this.commit({
      markedForReview: existing?.markedForReview ?? false,
      draft: T.effectiveDraft(state),
    });
    this.advanceAfterCommit();
  }

  /**
   * Sets the review flag AND saves the on-screen answer, then advances.
   *
   * Saving here is not incidental: the five-state palette has an
   * ANSWERED_AND_MARKED state, and that state can only be reached if marking
   * commits the answer. A "mark" that discarded the selection would make that
   * state unreachable and would silently drop an answer the candidate believed
   * they had flagged for a second look.
   */
  async markForReviewAndNext(): Promise<void> {
    const state = this.store.getState();
    await this.commit({ markedForReview: true, draft: T.effectiveDraft(state) });
    this.advanceAfterCommit();
  }

  /**
   * Clears the answer. Does NOT clear the review flag.
   *
   * The two are orthogonal columns (FR-ATT-03). A candidate who clears a
   * guessed answer while keeping the question flagged is doing something
   * deliberate, and folding the flag into the answer takes that away.
   */
  async clearResponse(): Promise<void> {
    const state = this.store.getState();
    const existing = state.responses.get(String(state.currentQuestionVersionId));
    await this.commit({
      markedForReview: existing?.markedForReview ?? false,
      draft: { selectedOptionIds: [], numericRaw: null },
    });
  }

  private advanceAfterCommit(): void {
    const state = this.store.getState();
    // Auto-advance carries across the section boundary from the last question
    // of a section (FR-ATT-01); on the final question of the paper the player
    // holds position rather than wrapping to question one.
    const next = T.nextQuestionId(state, state.currentQuestionVersionId);
    if (next !== null) this.navigateTo(next);
  }

  private async commit(args: {
    readonly markedForReview: boolean;
    readonly draft: { readonly selectedOptionIds: readonly OptionId[]; readonly numericRaw: string | null };
  }): Promise<void> {
    const state = this.store.getState();
    const questionVersionId = state.currentQuestionVersionId;
    const previous = state.responses.get(String(questionVersionId));
    const now = monotonicNow();

    const response = T.buildCommit({
      previous,
      questionVersionId,
      draft: args.draft,
      markedForReview: args.markedForReview,
      clientSeq: this.outbox.issueClientSeq(),
      elapsedMs: now - state.questionShownAtMonotonicMs,
    });

    // DURABLE FIRST, OPTIMISTIC SECOND (FR-SYN-01). `append` resolves only
    // once the IndexedDB transaction has committed, so the answer cannot be
    // lost by a tab closed in the window between the two.
    await this.outbox.append(this.toOp(response));
    this.store.update((s) => ({
      ...T.withResponse(s, response),
      questionShownAtMonotonicMs: now,
    }));
    await this.refreshPendingCount();
  }

  private async recordVisit(questionVersionId: QuestionVersionId): Promise<void> {
    const state = this.store.getState();
    const visit = T.markVisited(state, questionVersionId, this.outbox.issueClientSeq());
    // Already visited: nothing to write, and the sequence issued above is
    // simply skipped. Sequences must be monotonic, not gapless.
    if (visit === null) return;
    await this.outbox.append(this.toOp(visit));
    this.store.update((s) => {
      const responses = new Map(s.responses);
      responses.set(String(visit.questionVersionId), visit);
      return { ...s, responses };
    });
    await this.refreshPendingCount();
  }

  /**
   * Fold on-screen dwell time into the committed response when leaving.
   *
   * Threshold rather than every navigation, because a candidate who flicks
   * through the palette would otherwise generate an operation per click, and
   * the value carried is the EXISTING committed answer with a longer dwell —
   * never the draft. Navigation still saves nothing (FR-ATT-02).
   */
  private async accumulateTimeOnLeaving(state: AttemptState): Promise<void> {
    const existing = state.responses.get(String(state.currentQuestionVersionId));
    if (existing === undefined) return;
    const elapsed = monotonicNow() - state.questionShownAtMonotonicMs;
    if (elapsed < 2_000) return;

    const updated = {
      ...existing,
      timeSpentMs: existing.timeSpentMs + Math.round(elapsed),
      clientSeq: this.outbox.issueClientSeq(),
    };
    await this.outbox.append(this.toOp(updated));
    this.store.update((s) => {
      const responses = new Map(s.responses);
      responses.set(String(updated.questionVersionId), updated);
      return { ...s, responses };
    });
    await this.refreshPendingCount();
  }

  private toOp(response: {
    readonly questionVersionId: QuestionVersionId;
    readonly selectedOptionIds: readonly OptionId[];
    readonly numericRaw: string | null;
    readonly visited: boolean;
    readonly markedForReview: boolean;
    readonly timeSpentMs: number;
    readonly clientSeq: number;
  }): ResponseOp {
    return {
      ...response,
      attemptId: this.store.getState().snapshot.attemptId,
      recordedAtMonotonicMs: monotonicNow(),
    };
  }

  private async refreshPendingCount(): Promise<void> {
    const pendingCount = await this.outbox.pendingCount();
    this.store.update((s) => (s.pendingCount === pendingCount ? s : { ...s, pendingCount }));
  }

  /* ---------------------------------------------------------------- *
   * Sync plumbing
   * ---------------------------------------------------------------- */

  private async buildSyncRequest(): Promise<SyncRequest | null> {
    const state = this.store.getState();
    if (state.status !== 'IN_PROGRESS' && state.status !== 'PREFETCHING') return null;
    const ops = await this.outbox.pending();
    return {
      attemptId: state.snapshot.attemptId,
      lastAckClientSeq: this.outbox.acknowledgedThrough,
      ops,
      currentQuestionVersionId: state.currentQuestionVersionId,
    };
  }

  private async applySyncResponse(
    response: SyncResponse,
    _sentOps: readonly ResponseOp[],
  ): Promise<void> {
    await this.outbox.acknowledge(response.results.filter((r) => r.accepted));

    const candidate = createAnchor({
      serverEpochMs: response.serverTimeMs,
      // The heartbeat's own round trip is not measured here, so the anchor is
      // conservative by half a trip. Erring towards *less* displayed time than
      // the server holds is the correct direction: the deadline is the
      // server's and a candidate must never be shown more time than exists.
      requestStartedMonotonicMs: monotonicNow(),
      responseReceivedMonotonicMs: monotonicNow(),
    });

    this.store.update((s) => ({
      ...s,
      anchor: reconcileAnchor(s.anchor, candidate),
      // The deadline is read from the server on every heartbeat and never
      // computed here. No client action can move it (FR-ATT-06).
      deadlineAtMs: response.deadlineAtMs,
      status: response.status,
    }));
    await this.refreshPendingCount();
  }

  /* ---------------------------------------------------------------- *
   * Finalisation
   * ---------------------------------------------------------------- */

  /**
   * Submit. Idempotent by a stable key (FR-ATT-13 applies the same discipline
   * at start): a double-tap on a slow connection, or a retry whose response was
   * lost, must not produce a second finalisation.
   */
  async submit(): Promise<void> {
    if (this.store.getState().submitting) return;
    this.store.update((s) => ({ ...s, submitting: true }));

    try {
      // Drain the queue first so the last answers are acknowledged before the
      // status flips. The server-side sweeper would finalise correctly anyway
      // (FR-SYN-07), but a candidate should not have to rely on that.
      this.sync.flushNow();
      const pending = await this.outbox.pending();
      if (pending.length > 0) {
        const state = this.store.getState();
        const response = await this.api.sync({
          attemptId: state.snapshot.attemptId,
          lastAckClientSeq: this.outbox.acknowledgedThrough,
          ops: pending,
          currentQuestionVersionId: state.currentQuestionVersionId,
        });
        await this.applySyncResponse(response, pending);
      }

      const result = await this.api.submitAttempt({
        attemptId: this.store.getState().snapshot.attemptId,
        idempotencyKey: this.submitIdempotencyKey,
      });
      this.sync.stop();
      this.store.update((s) => ({
        ...s,
        status: result.status,
        submitting: false,
        submitDialogOpen: false,
      }));
    } catch (error) {
      this.store.update((s) => ({ ...s, submitting: false }));
      throw error;
    }
  }

  /** FR-ATT-19: available in the first five minutes, with a clear warning. */
  async abandon(): Promise<void> {
    const result = await this.api.abandonAttempt(this.store.getState().snapshot.attemptId);
    this.sync.stop();
    this.store.update((s) => ({ ...s, status: result.status }));
  }

  reportQuestion(questionVersionId: string, detail: string): void {
    void this.api
      .reportQuestion({
        attemptId: this.store.getState().snapshot.attemptId,
        questionVersionId,
        reason: detail,
        category: 'RENDER_FAILURE',
      })
      .catch(() => {
        // A failed report must never interrupt a live paper.
      });
  }
}
