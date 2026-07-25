import type {
  AttemptId,
  Exam,
  ExamPattern,
  MarkingRule,
  OptionId,
  QuestionType,
  QuestionVersionId,
  ResponseStatus,
  SectionId,
  Subject,
  TestId,
} from '@platform/domain';

/**
 * The wire contract between this client and the API.
 *
 * Two rules govern the shape of everything here.
 *
 * - An answer is `{question_version_id, option_id}` and never a positional
 *   index or a letter (FR-ATT-12, FR-ITM-03). There is no field anywhere below
 *   that carries a position, and the branded id types make substituting one a
 *   compile error rather than a silent scoring corruption.
 * - Nothing on an in-progress attempt payload can carry a key, a solution, a
 *   rationale or a video URL (FR-SOL-05, FR-SOL-06, AC-NTS-01). Those types
 *   exist only under `ReviewSnapshot`, which the server refuses to produce
 *   before `solutions_visible_from`.
 */

export interface AttemptOption {
  readonly optionId: OptionId;
  /** Pre-rendered server-side on write (FR-MTH-01). Never LaTeX at runtime. */
  readonly bodyHtml: string;
  /** Screen-reader and plain-text fallback (FR-ITM-12). */
  readonly spokenText: string;
}

export interface AttemptQuestion {
  readonly questionVersionId: QuestionVersionId;
  readonly sectionId: SectionId;
  readonly subject: Subject;
  readonly questionType: QuestionType;
  /** 1-based position within the attempt's materialised order (FR-ATT-10). */
  readonly displayOrder: number;
  readonly bodyHtml: string;
  readonly spokenText: string;
  /** Shared comprehension or matching stem, referenced not duplicated (FR-ITM-08). */
  readonly stimulusHtml: string | null;
  /** Persisted option order for this attempt. Identical on every resume (FR-ATT-11). */
  readonly options: readonly AttemptOption[];
  /** Lives on the (test_section, question) join, never on the item (FR-PAT-04). */
  readonly marking: MarkingRule;
  readonly assetIds: readonly string[];
}

export interface AttemptSection {
  readonly sectionId: SectionId;
  readonly ordinal: number;
  readonly name: string;
  readonly subject: Subject;
  /**
   * A time-locked section may not be re-entered once left, and may not be
   * entered early. Where the pattern does not lock, switching is free.
   */
  readonly timeLocked: boolean;
  readonly durationSeconds: number | null;
  readonly instructionsHtml: string;
}

export interface AssetManifestEntry {
  readonly assetId: string;
  /**
   * One URL per object, identical for every candidate. Per-user signed URLs
   * would eliminate CDN caching entirely and make origin egress scale with
   * student count instead of asset count.
   */
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
}

export type RankingMode = 'strict' | 'pooled';

export interface AttemptSnapshot {
  readonly attemptId: AttemptId;
  readonly testId: TestId;
  readonly testTitle: string;
  readonly exam: Exam;
  readonly patternId: string;
  readonly rankingMode: RankingMode;
  /** Rendered in the UI so the ordering rule is never a mystery (FR-SCR-09). */
  readonly tieBreakLabels: readonly string[];
  readonly sections: readonly AttemptSection[];
  /** In the attempt's materialised order. The client never re-sorts this. */
  readonly questions: readonly AttemptQuestion[];
  readonly instructionsHtml: string;
  readonly assets: readonly AssetManifestEntry[];
  /** Server-authoritative and immovable by any client action (FR-ATT-06). */
  readonly deadlineAtMs: number;
  readonly startedAtMs: number;
  readonly serverTimeMs: number;
  readonly graceSeconds: number;
  /** True for a late joiner; excluded from the ranked leaderboard (FR-TST-06). */
  readonly shortened: boolean;
  /** Highest client sequence the server has durably accepted. */
  readonly lastAckClientSeq: number;
  /** Responses already persisted, for resume on any device (FR-ATT-15). */
  readonly responses: readonly PersistedResponse[];
  readonly status: AttemptStatus;
}

export type AttemptStatus =
  | 'PREFETCHING'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'SUPERSEDED'
  | 'ABANDONED'
  | 'EXPIRED';

export interface PersistedResponse {
  readonly questionVersionId: QuestionVersionId;
  readonly selectedOptionIds: readonly OptionId[];
  readonly numericRaw: string | null;
  readonly visited: boolean;
  readonly markedForReview: boolean;
  readonly timeSpentMs: number;
  readonly clientSeq: number;
}

/** One durable local operation. Ordered by `clientSeq` and never by arrival (FR-SYN-02). */
export interface ResponseOp extends PersistedResponse {
  readonly attemptId: AttemptId;
  /** Monotonic client time of the edit, for audit only. Never authoritative. */
  readonly recordedAtMonotonicMs: number;
}

/**
 * Heartbeat and answer-sync are ONE request (FR-ATT-08). Splitting them doubles
 * the request count for ten thousand concurrent candidates and creates a state
 * where the server believes a client is alive but has not seen its answers.
 */
export interface SyncRequest {
  readonly attemptId: AttemptId;
  readonly lastAckClientSeq: number;
  readonly ops: readonly ResponseOp[];
  /** Which question is on screen. Operational telemetry, never scoring input. */
  readonly currentQuestionVersionId: QuestionVersionId | null;
}

export interface SyncOpResult {
  readonly clientSeq: number;
  readonly accepted: boolean;
  /** `STALE_SEQUENCE`, `AFTER_DEADLINE`, `NOT_IN_ATTEMPT_ORDER`. */
  readonly reason: string | null;
}

export interface SyncResponse {
  readonly serverTimeMs: number;
  readonly deadlineAtMs: number;
  readonly status: AttemptStatus;
  readonly results: readonly SyncOpResult[];
  readonly lastAckClientSeq: number;
}

export interface SubmitResponse {
  readonly attemptId: AttemptId;
  readonly status: AttemptStatus;
  /** FR-SCR-04: a real estimate, never a bare indefinite spinner. */
  readonly resultsEtaSeconds: number | null;
}

/* ------------------------------------------------------------------ *
 * Review — only ever produced after `solutions_visible_from`
 * ------------------------------------------------------------------ */

export interface ReviewOutcome {
  readonly questionVersionId: QuestionVersionId;
  /** Server-computed. The client never computes a mark (FR-SCR-17). */
  readonly marks: number;
  readonly status: ResponseStatus;
  readonly explanation: string;
  readonly correctOptionIds: readonly OptionId[];
  readonly correctNumericValue: string | null;
  readonly solutionHtml: string;
  /** Per-option, explaining why each distractor is wrong (FR-SOL-02). */
  readonly optionRationales: Readonly<Record<string, string>>;
  /** Deep-linked out, never embedded, for under-18 sessions (FR-SOL-04). */
  readonly videoUrl: string | null;
  readonly answerKeyVersion: number;
  readonly cohortMedianTimeMs: number | null;
}

export interface ReviewSnapshot {
  /**
   * The pinned attempt snapshot, byte-identical in content and ordering to
   * what was on screen during the paper (FR-SCR-17, AC-ATT-05). Review renders
   * from this, never from live item rows: an item corrected after the paper
   * would otherwise show the candidate a question they did not sit.
   */
  readonly attempt: AttemptSnapshot;
  readonly outcomes: readonly ReviewOutcome[];
  readonly rawScore: number;
  readonly positiveMarks: number;
  readonly negativeMarks: number;
  readonly maxMarks: number;
  /** 7-decimal exact string from the domain engine. Never a float. */
  readonly percentile: string | null;
  readonly rank: number | null;
  readonly cohortSize: number | null;
  readonly bySubject: readonly ReviewSubjectScore[];
  readonly counts: ReviewCounts;
  readonly scoringConfigFingerprint: string;
  readonly resultVersion: number;
  readonly rescoreNote: string | null;
}

export interface ReviewSubjectScore {
  readonly subject: Subject;
  readonly score: number;
  readonly positiveMarks: number;
  readonly maxMarks: number;
  readonly percentile: string | null;
  readonly correct: number;
  readonly partiallyCorrect: number;
  readonly incorrect: number;
  readonly unattempted: number;
}

export interface ReviewCounts {
  readonly correct: number;
  readonly partiallyCorrect: number;
  readonly incorrect: number;
  readonly unattempted: number;
  readonly dropped: number;
  readonly unparseable: number;
}

export interface ScoringPendingState {
  readonly state: 'PENDING';
  readonly etaSeconds: number | null;
}

export type ReviewResult = ScoringPendingState | ({ readonly state: 'READY' } & ReviewSnapshot);

/* ------------------------------------------------------------------ *
 * Admin
 * ------------------------------------------------------------------ */

export type ItemLifecycle =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'FLAGGED'
  | 'RETIRED';

export type Provenance = 'ORIGINAL' | 'PYQ_NTA' | 'LICENSED' | 'THIRD_PARTY_UNCLEARED';

export interface AuthoredOption {
  readonly optionId: OptionId;
  readonly latex: string;
  /** Mandatory (FR-AUT-04). "This is incorrect" is not a rationale. */
  readonly rationale: string;
  readonly isCorrect: boolean;
  /** Options that must not move, e.g. "None of the above" (FR-ITM-10). */
  readonly pinnedPosition: number | null;
}

export interface AuthoredItem {
  readonly questionId: string;
  readonly questionVersionId: QuestionVersionId;
  readonly versionNo: number;
  readonly lifecycle: ItemLifecycle;
  readonly exam: readonly Exam[];
  readonly subject: Subject;
  readonly questionType: QuestionType;
  readonly stemLatex: string;
  readonly options: readonly AuthoredOption[];
  readonly solutionLatex: string;
  readonly numericAnswer: string | null;
  readonly provenance: Provenance;
  readonly sourceRef: string;
  readonly subTopicId: string | null;
  readonly subTopicLabel: string | null;
  readonly authoredDifficulty: 'EASY' | 'MEDIUM' | 'HARD' | null;
  readonly altText: string;
  readonly spokenText: string;
  readonly shuffleOptions: boolean;
  readonly createdBy: string;
  readonly approvedBy: string | null;
  /** Server-side strict LaTeX validation result (FR-MTH-02). */
  readonly latexValid: boolean;
  readonly latexError: string | null;
  readonly attemptCount: number;
  readonly duplicateWarnings: readonly string[];
  readonly duplicatesAcknowledged: boolean;
}

export interface ChallengeSummary {
  readonly challengeId: string;
  readonly questionVersionId: QuestionVersionId;
  readonly testTitle: string;
  readonly stemPlain: string;
  /** Distinct challengers, not report count: volume alone is manufacturable. */
  readonly distinctChallengers: number;
  readonly totalReports: number;
  /** Negative discrimination is the classic miskey signature (FR-ADM-07). */
  readonly discrimination: number;
  readonly keyedOptionSelectionRate: number;
  readonly topDistractorSelectionRate: number;
  readonly openedAtMs: number;
  readonly resolution: string | null;
  readonly publicNote: string | null;
}

export interface RescoreCandidate {
  readonly attemptId: AttemptId;
  readonly displayName: string;
  readonly previousRawScore: number;
  readonly previousPositiveMarks: number;
}

export interface TestSummary {
  readonly testId: TestId;
  readonly title: string;
  readonly exam: Exam;
  readonly patternId: string;
  readonly startsAtMs: number;
  readonly endsAtMs: number;
  readonly published: boolean;
  readonly liveNow: boolean;
}

export interface AdminBootstrap {
  readonly patterns: readonly ExamPattern[];
  readonly items: readonly AuthoredItem[];
  readonly challenges: readonly ChallengeSummary[];
  readonly tests: readonly TestSummary[];
  readonly currentUserId: string;
  readonly currentUserName: string;
}
