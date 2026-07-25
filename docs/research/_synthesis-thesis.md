# STRATEGIC IDEATION LAYER
## JEE/NEET Practice Engine — Positioning, Wedges, Requirements Spine

---

## 1. POSITIONING THESIS

This is not a test-prep app with a test engine bolted on; it is **an assessment-infrastructure product that goes to market as a student app** — the first Indian platform where the exam's own mechanics are versioned data rather than hardcoded assumptions, and where every mark a student receives is reproducible, explainable and auditable months later. Concretely: marking schemes (including JEE Advanced's real partial-credit ladder, which the entire Indian web publishes wrongly as `4 × selected_correct / total_correct`), question content, answer keys and paper composition are all immutable versioned rows; a student's attempt pins the exact version they saw, so the paper can be replayed byte-identically, a key revision produces a visible before/after delta rather than a silent score change, and a dropped question triggers an idempotent rescore that re-emits ranks and reward ledgers instead of corrupting them. That defensible-scoring spine is the substrate for the second half of the thesis: because items are immutably versioned, a student's own errors can be turned into a spaced-repetition schedule (FSRS at concept level, not question level) that content corrections never destroy — the AnkiHub guarantee, which no Indian product offers because none of them version anything. And because the whole content lifecycle is modelled, the admin console is a shippable product rather than internal tooling, which is how this reaches coaching centres. The market opening is stated by the incumbents themselves: Unacademy's CEO conceded in March 2026 that "the sector itself has not seen enough real product innovation"; Allen still delivers 8 of 19 NEET test-series papers on pen and paper; Embibe marks correct answers wrong on spelling; and from 2027 roughly 23 lakh NEET aspirants will sit a computer-based test whose interface they have never seen. The wrapper around all of it is a deliberate business-model refusal — no telesales, no auto-mandate, no purchasable coins, no global rank wall, one paid tier — which is not a feature but a moat, because copying it requires the funded incumbents to dismantle their own revenue engine.

**One-line category claim:** *The NTA-grade CBT engine with a memory of everything you got wrong.*

---

## 2. THE THREE WEDGES

### Wedge 1 — Scoring as Versioned Data (the "defensible mark")

**What it is.** Marking rules, exam patterns, paper composition, question content and answer keys are all first-class versioned entities. `exam_pattern → pattern_section → marking_rule(jsonb)`; a test pins `pattern_id`; an attempt pins `question_version_id` and `answer_key_version`; scoring is a pure Postgres function of `(attempt, key_version, scoring_config_hash)`. Ships with: pixel-faithful NTA console (five-state palette with palette-click-does-not-save, section auto-advance, virtual numeric keypad, no calculator), per-question marks-awarded breakdown in the review screen, a post-submit Response Sheet, a time-boxed answer-challenge flow, and an idempotent rescore pipeline supporting `MULTI_KEY / ALL_CORRECT / DROPPED` with different eligible populations per flag.

**Why incumbents cannot copy quickly.** Their scoring lives in application code with year constants, and their attempt tables are mutable and reference mutable question rows. Retrofitting item immutability is not a feature — it is a data migration across every historical attempt plus a rewrite of the grading path, undertaken by teams whose engineering signal (Allen 1,667 iOS ratings and a "login system is broken" 1★; PW paid features simply absent on iPad) suggests they cannot execute it during exam season. They also have no incentive: their differentiation is faculty brand and video, so scoring correctness is a cost centre, not a product.

**Dossier evidence.** JEE Advanced multi-correct penalty moved −2 (2025) → −1 (2026) and Paper 1 Section 2 went 3 questions → 4; jeeadv commits only to being "consistent with previous examinations" and discloses the actual scheme on-screen on exam day. Secondary sources including pw.live and aakash.ac.in still publish the stale −2 rule and the wrong proportional formula. NEET keys are revised under public paid challenge windows (₹200/question) and, in 2024, under Supreme Court direction for 23,33,297 candidates. NTA percentile is computed on the *total* raw score per shift to 7 decimal places and explicitly is **not** an average of subject percentiles. Three exams have three different tie-break chains, and JEE Advanced's leads with *positive marks earned* — a column that cannot be backfilled.

---

### Wedge 2 — Error Memory (FSRS on concepts, non-destructive by construction)

**What it is.** Every wrong answer, every marked-for-review question and every formula generates a review card keyed on `(student_id, sub_topic_id)` — not `(student_id, question_id)` — scheduled by FSRS-6 via `ts-fsrs` (MIT), with per-cohort parameter re-fitting nightly. When a concept comes due, the engine serves a *fresh unseen* item of matched difficulty from that sub-topic, drawn against a per-student seen-ledger. The FSRS grade is derived from outcome × response time (correct+fast = Easy, correct+slow = Good, near-miss/flagged = Hard, wrong/timeout = Again). An "exam countdown mode" ramps desired retention from 0.90 toward 0.95 as the JEE/NEET date approaches. Crucially, editing or correcting a question preserves every student's scheduling state, because scheduling attaches to the concept and to the stable `question_id`, never to mutable content.

**Why incumbents cannot copy quickly.** Three structural blocks. (a) It *requires* Wedge 1 — without immutable versioning, a typo fix silently invalidates every card, and without a per-question seen-ledger the scheduler degenerates into re-showing memorised MCQs. (b) It requires content operations discipline they demonstrably lack: a bank with a 1% error rate and a live SRS loop surfaces every error repeatedly to the same student. (c) It is anti-correlated with their P&L — a scheduler that says "do 22 cards and stop" competes directly with a business monetising lecture-hours and batch upsells. Allen's "Improvement Book" and "Flash Card" are the closest existing artefacts and are static.

**Dossier evidence.** FSRS has been Anki's default since v23.10, trained on ~700M reviews, benchmarked at log-loss 0.291 / RMSE 5.3% vs SM-2's 0.354 / 16.2% over ~349.9M filtered reviews, needing 20–30% fewer reviews for equal retention. Implementations are permissively licensed (`ts-fsrs` MIT, `fsrs-rs` BSD-3, `py-fsrs` MIT). No significant Indian JEE/NEET app ships an FSRS-grade scheduler. AnkiHub's entire commercial value proposition (~$6/mo) is that content updates do not wipe review history.

---

### Wedge 3 — The Admin Console as a Shipped Product (the B2B2C control plane)

**What it is.** A real authoring and operations product, not internal tooling: LaTeX-first authoring (TipTap 3.29 + MathLive, server-side KaTeX validation as a publish gate), OCR ingestion with a side-by-side original-crop vs rendered-LaTeX diff, duplicate detection triad (SHA-256 normalised / MinHash-LSH / pgvector), mandatory provenance and licence status, five-role capability RBAC with `approved_by <> created_by` enforced as a CHECK constraint, blueprint-driven MILP paper assembly with an explanation panel, per-cohort item statistics using the QTI 3.0 Usage Data vocabulary verbatim, an auto-flag engine feeding a human review queue, a rescore/void console, and per-institute tenancy with batch rosters and an off-by-default rank-publication toggle.

**Why incumbents cannot copy quickly.** The teacher side of this market is not merely weak, it is abandoned: Unacademy's Educator app sits at 3.33★/391 ratings with its last update on 11 Jan 2024 — 2.5 years stale against a learner app with 54,284 ratings; Embibe Classroom, the most feature-complete teacher tool found anywhere in the India catalogue, has 9 total iOS ratings; Allen exposes no public teacher app at all. Building it requires exposing content operations that incumbents treat as trade secret and cost centre, and it requires the immutable versioning of Wedge 1 as a precondition. Meanwhile ExamBro — a standalone teacher paper-generation utility with no platform behind it — sits at 4.85★/196 ratings, which is the cleanest available demand signal in the entire dossier.

**Dossier evidence.** Above, plus: the Rajasthan Coaching Centres Act 2025 s.12(viii)/(ix) bars centres from publishing internal assessment results or segregating batches by performance — meaning an off-by-default, institute-controlled publication toggle is not a nicety but a compliance feature that converts Kota-belt customers.

**Fourth, non-capability moat (positioning, not a wedge):** self-serve commerce, published refund window, zero sales calls, an in-app promise that the OTP number will never be dialled. Costs nothing to build; unavailable to any funded incumbent whose revenue engine is telesales + auto-mandate + non-refundable subscription — the single most reliably hated pattern in the category's review record.

---

## 3. FEATURE INVENTORY

Tiers: **MVP** = v1 launch gate · **1.5** = within 90 days of launch · **v2** = post-PMF · **NOT** = explicitly rejected (see §3.4).

### 3.1 STUDENT

| # | Feature | Tier | Justification |
|---|---|---|---|
| S1 | Phone OTP + Google/Apple sign-in; no phone required for email path | MVP | OTP via DLT-registered Indian provider (~₹0.15 vs Twilio ₹0.45); explicit in-app "we will never call you". |
| S2 | Neutral age screen + DOB capture, no leading copy | MVP | DPDP s.2(f): under-18 = child. Age must be captured before any processing; a "18+?" prompt teaches users to lie. |
| S3 | Verifiable parental consent flow (parent OTP + DigiLocker/authorised age token), consent ledger | MVP | DPDP Rules 2025 r.10. Majority of cohort is 16–18; this is the default path, not an edge case. ₹200 cr exposure. |
| S4 | Onboarding profile: exam target, category, gender, home state, target year, language | MVP | Required inputs for percentile/rank prediction and category-scoped analytics; retrofitting across 10k+ users is materially harder. |
| S5 | Subject > Chapter > Topic > Sub-topic browse with mastery state | MVP | Core navigation; also the FSRS card key. |
| S6 | Free complete PYQ bank, tagged by exam / year / chapter / topic / difficulty / question type | MVP | MARKS sets the free floor at 1 lakh+ PYQs. This is cost of entry, not product. |
| S7 | Custom test builder with question-state filters (unused / incorrect / correct / marked / guessed-right) | MVP | UWorld's most-imitated global feature; entirely absent in India. Engine-level, compounds with S8/S9. |
| S8 | Tutor Mode vs Timed Mode toggle | MVP | UWorld core distinction; nobody in India ships it. Trivial given the attempt-behaviour model. |
| S9 | NTA-faithful CBT player: 5-state palette, Save&Next, Mark-for-Review&Next, Clear Response, palette-click-does-NOT-save, section tabs with free switching, auto-advance on section-last Save&Next, Question Paper view, instructions screen, submit-confirmation summary | MVP | The flagship. NEET moves to CBT from 2027; palette-click-saves is the single most common fidelity failure. |
| S10 | Server-authoritative timer: immutable `deadline_at`, 30s heartbeat, monotonic-clock display, auto-submit at zero | MVP | Device clocks are hostile; NTA's clock is server-set and the exam ends without user action. |
| S11 | On-screen virtual numeric keypad (tap-only); **no calculator** | MVP | NTA Public Notice 02 Nov 2025: the Appendix-VIII calculator line was a typographic error; calculators banned in all three exams. |
| S12 | Question types: MCQ-single, multi-correct with partial ladder, numeric-integer (JEE Main), numeric-2dp (JEE Adv), matching-list (4×5 + 4 permutations), shared question stem with N children, assertion-reason | MVP | Required for JEE Advanced fidelity; neither matching-list nor stems is expressible as a generic MCQ. |
| S13 | Per-question marks-awarded breakdown in review ("+2 because you selected 2 of 3 correct; the ladder awards +2, not 2.67") | MVP | Turns scoring correctness from invisible engineering into a visible, screenshot-able differentiator. |
| S14 | Post-submit Response Sheet: recorded response vs key vs marks, replayed from pinned versions and pinned option order | MVP | Mirrors NTA. Must render from the immutable snapshot or review shows a question the student never saw. |
| S15 | "Challenge this answer" flow, time-boxed, routed to admin queue | MVP | NTA runs paid challenge windows; students expect the affordance. Also the recall layer statistics cannot provide. |
| S16 | "Report an error on this question" on every question | MVP | Embibe's top content complaint is "mistakes in questions". Cheapest possible trust signal. |
| S17 | Results: raw score (negative-capable), NTA-method percentile to 7dp on total, subject-wise percentiles, section breakdown | MVP | Percentile of total per cohort — never an average of subject percentiles (bulletin says so outright). |
| S18 | Time-per-question vs cohort median, overtime flag | MVP | Quizrr's headline analytic; highest-leverage differentiator at low cost since we own the engine. |
| S19 | Mistake taxonomy self-tagging at review (conceptual / calculation / misread / silly / guessed-right / unattempted) | MVP | Cheapest input to genuinely useful analytics; also the SRS grading signal. |
| S20 | Chapter weightage vs your accuracy scatter → "study these three chapters next" | MVP | Analytics must be prescriptive, not decorative. |
| S21 | Text solutions with **per-option rationales** (why each distractor is wrong) + YouTube link | MVP | Indian solutions are universally "the answer with working". Distractor analysis is UWorld's product. |
| S22 | Bookmarks / saved questions | MVP | Table stakes. |
| S23 | Persistent Notebook: rich text + LaTeX, full-text search, backlinks to source questions | MVP | Quizrr has a notebook; nobody has search + backlinks. |
| S24 | In-attempt private notes (RLS-isolated from solution tables) | MVP | Notes UI must never join to solutions — that is an answer-key leak, not a UX bug. |
| S25 | FSRS review queue: auto-cards from wrong answers, marked questions, formulas; concept-keyed; fresh item per due card | MVP | Wedge 2. Ships with the engine, not after it. |
| S26 | Exam countdown mode (desired retention ramps 0.90 → 0.95 as exam date nears) | 1.5 | Real product feature, not a gimmick; needs a stable review log first. |
| S27 | Daily practice target (small, guaranteed-completable: 10 questions or one card session) | MVP | Streak must be earnable by a small action, not a 3-hour mock. |
| S28 | Streak with auto-applied freeze (2 free, weekly replenish), free effort-based repair (2 sets in 48h), 4 schedulable rest days/month | MVP | Duolingo's freeze cut at-risk churn 21%; forgiveness must be bounded and never loss-framed. No paid repair. |
| S29 | Coins: earn-only, non-purchasable, non-transferable, non-convertible; sinks are in-app utility only | MVP | PROGA 2025: purchasable coins that can win anything = "other stakes", 3 years + ₹1 cr, criminal not civil. |
| S30 | Bucketed leaderboard: ~30 peers, promotion/relegation, pseudonymous, opt-in, one-tap permanent opt-out | MVP | Absolute leaderboards demoralise the bottom 80%; Rajasthan Act bars publishing assessment results; SC *Sukdeb Saha* guidelines. |
| S31 | Personal-improvement track always visible (percentile delta vs own last 5, chapter mastery) | MVP | The non-competitive primary metric. Competitive track is secondary and optional. |
| S32 | Weekly all-India live mock, fixed start instant (one absolute `starts_at`, IST label + local time shown) | MVP | Testbook's "Pro Live Tests" is the highest-engagement format in the category and is the retention spine. Fixed start is also the only integrity-preserving schedule. |
| S33 | Offline: chapter download with size estimate, untimed offline practice, offline card review, queued sync | MVP | Practice content is a few MB vs 500MB of video — structurally impossible for video-first incumbents. |
| S34 | Offline answer queue: local SQLite write before optimistic UI, `client_seq` monotonic, batched sync, "N answers pending" chip | MVP | Never a per-answer error toast; out-of-order writes must be dropped by seq guard, not applied. |
| S35 | Cross-device resume with explicit session takeover (`SESSION_SUPERSEDED` 409, loser goes read-only) | MVP | Fixes both the honest case (phone died) and the collusion case (parallel device) with one mechanism. |
| S36 | Shareable rank/insight card image | MVP | Screenshotting rank cards is the category's organic growth loop; also Duolingo milestone-share is the highest-ROI low-risk borrow. |
| S37 | Formula sheets / revision cards per chapter | 1.5 | Table stakes (MARKS Formula Cards, PW Utsav) but not launch-blocking. |
| S38 | Predicted percentile/rank, anchored to published national marks-vs-percentile points with a confidence interval and "based on N students" | 1.5 | Highest perceived value; naive `(100−p)/100 × N` on a self-selected cohort is confidently wrong and destroys trust. |
| S39 | Scored self-assessment papers with predicted score output | 1.5 | UWorld sells these at $50; the paid-tier anchor. |
| S40 | QBank reset (entitlement) | 1.5 | Paid-tier perk with zero marginal cost. |
| S41 | Hindi UI + Hindi content (bilingual stacked render, English authoritative) | 1.5 | SATHEE ships 12 languages; "60% English 40% Hindi" is a top-5 Testbook complaint. Bilingual stacked mirrors the real NEET booklet. |
| S42 | Confidence tagging pre-submit (sure / unsure / guessed) → accuracy×confidence matrix | 1.5 | Cheapest possible input to a genuinely novel analytic; absent in India. |
| S43 | AI doubt assistant, entered only *after* solution + per-option rationale + YouTube link have been shown | 1.5 | Commodity (nine competitors ship it) and the category's most-broken promise. Include, never lead with it. |
| S44 | Study planner auto-scheduling from declared availability + syllabus deadline | v2 | High perceived value, high complexity, needs a stable mastery model first. |
| S45 | College/counselling predictor (JoSAA / MCC AIQ + state quota) | v2 | Requires licensed opening-closing rank data by institute-branch-category-quota-gender-round. |
| S46 | Human doubt escalation with visible SLA countdown and coin auto-refund on breach | v2 | Only ship a promise you can staff. The state machine matters more than the answer speed. |
| S47 | Parent view (linked, consented, read-only progress) | 1.5 | Falls out of the VPC architecture; auto-revoked at the student's 18th birthday. |
| S48 | Wellbeing layer: session cap + break prompt, Tele-MANAS 14416 persistent link, no notifications 23:00–06:00, no failure-framed copy | MVP | NEET-linked suicides 4 (2021) → ≥32 (2025). This is a product requirement, not CSR. |
| S49 | Accessibility: MathML output path, spoken-text field per expression, 200% text scale, 44pt targets, reduce-motion, both orientations, tablet layout | MVP | Repeated iPad/landscape complaints at Allen and PW; RPwD Act direction of travel post *Rajive Raturi*. |
| S50 | Single paid tier: free PYQ+CBT engine / ₹1,799–1,999 per year (₹599/quarter), self-serve, published refund window, one-tap cancel | MVP | Testbook collapsed four tiers into Pass One; multi-tier creates entitlement bugs and "I paid and it isn't available" reviews. |
| S51 | Grievance/support ticket with 48h auto-acknowledgement and 30-day resolution timer | MVP | Consumer Protection (E-Commerce) Rules 2020 r.4 + DPDP r.14 + published Grievance Officer. |

### 3.2 ADMIN

| # | Feature | Tier | Justification |
|---|---|---|---|
| A1 | Capability RBAC: AUTHOR / REVIEWER / SUBJECT_LEAD / OPS / ANALYST / SUPER_ADMIN, roles in `user_roles` projected to JWT via `custom_access_token_hook` | MVP | Two roles is the brief's biggest architectural mistake; "who approved this item" is the audit trail you need in a rank dispute. Roles in `user_metadata` = one-line privilege escalation (splinter lint 0015, ERROR). |
| A2 | Separation of duties enforced as `CHECK (approved_by <> created_by)` | MVP | Free on day one, impossible to backfill once 20k items point at one shared admin account. |
| A3 | LaTeX-first authoring: TipTap 3.29 + `@tiptap/extension-mathematics` + MathLive 0.110, live KaTeX preview | MVP | katex pinned to 0.17.x in the editor (extension peer-deps `^0.16.4 \|\| ^0.17.0`); renderer and editor must never disagree. |
| A4 | Server-side KaTeX validation as a hard publish gate (`throwOnError:true, strict:true`), stores `latex_valid` + errors | MVP | A red-garbage integrand mid-exam is unanswerable. Validate at authoring, degrade at render. |
| A5 | Image-question upload with crop, mandatory alt-text/spoken-text, server-side pre-resize to 2–3 fixed widths | MVP | Transform-on-read is $5/1,000 distinct origin images per period (~$250/mo at 50k); pre-generate once. |
| A6 | OCR ingestion pipeline: Mathpix v3/pdf ($0.005/pg) or self-hosted Surya/Marker → vision-LLM segmentation → DRAFT items, with original-crop vs rendered diff review | 1.5 | Ingest cost is trivial; human verification is the cost. Track `edits_per_ingested_item` as the content-ops north star. |
| A7 | Duplicate detection triad: SHA-256 normalised stem / MinHash-LSH Jaccard ≥0.8 / pgvector cosine ≥0.92 / dHash for images; surfaced as warning, never a block | 1.5 | `VARIANT_OF` is an asset (never put two variants in one paper), not just a defect. |
| A8 | Mandatory non-nullable provenance: ORIGINAL / PYQ_NTA / LICENSED / THIRD_PARTY_UNCLEARED + `source_ref`; UNCLEARED cannot publish | MVP | NCERT press release 07 Apr 2024 threatens action for use "in whole or in part"; coaching-institute material has no s.52 defence. Serving query filters on licence status so a class can be dark-launched. |
| A9 | Taxonomy manager: subject/chapter/topic/sub-topic, exam cross-tags, PYQ year, authored-difficulty | MVP | `authored_difficulty` and `empirical_difficulty_p` are separate columns; the delta is an author-calibration signal. |
| A10 | Item versioning + full history; content edit forks a version and resets statistics, metadata edit updates in place | MVP | Moodle's model, improved: delivered tests pin `question_version_id`, making immutability a foreign-key invariant. |
| A11 | Review workflow: DRAFT → IN_REVIEW → CHANGES_REQUESTED → APPROVED → PUBLISHED → FLAGGED → RETIRED; RETIRED stays readable | MVP | Past attempts depend on retired versions. Never hard-delete. |
| A12 | Translation manager: translations are versioned *children* of the English version; keys/marks live only on the parent | 1.5 | NTA's own rule — English is final on ambiguity. Sibling rows silently diverge and can end up keyed differently. |
| A13 | Marking-rule editor: `exam_pattern → pattern_section → marking_rule(jsonb)`, versioned by exam+year | MVP | A 2027 pattern change must be an INSERT, not a release. PYQ replays score under their own year's rules. |
| A14 | Blueprint editor + MILP auto-assembly (OR-Tools/HiGHS) with "why this item" explanation and manual override | 1.5 | Constraints: chapter counts, difficulty histogram, no item seen in last 3 tests, PYQ-year spread, key balance, no two variant-family members. |
| A15 | Test builder: sections, per-section timing/lock, window, ranking mode (strict/pooled), attempt policy, solutions-visible-from, late-join cutoff | MVP | Blueprint validated at save (Σ section max_marks = declared total) so a malformed paper cannot ship. |
| A16 | Publish freeze: trigger blocks writes to `test_questions` once `published_at` is set on a strict-ranked test | MVP | Prevents a mid-window paper change splitting one leaderboard across two papers. |
| A17 | Exam calendar entity (admin-editable): sessions, shifts, cancellations, re-exams | MVP | NEET 2026 was cancelled on 12 May and re-run 21 June; test series keyed to fixed dates break mid-cycle. |
| A18 | Answer-key versioning + challenge triage queue ranked by distinct challengers and by negative discrimination | MVP | Upheld challenges revise the key for everyone. Discrimination < 0 is the classic miskey signature. |
| A19 | Rescore console: MULTI_KEY / ALL_CORRECT / DROPPED with per-flag eligible population; idempotent, audited, re-emits leaderboard snapshot and reward deltas | MVP | Without it, a key revision silently corrupts ranks and already-issued coins. Compensating top-ups only, never clawbacks. |
| A20 | Void-question console with explicit policy choice: full marks to all / to attempted only / drop and rescale | MVP | Policy must be chosen and recorded per void, then executed through the same key-version mechanism. |
| A21 | Item statistics per **cohort context**: P-value, PTbis, AIS, distractor NumberChoosing/PercentChoosing/AISResponse/PTbis-Response | 1.5 | QTI 3.0 Usage Data vocabulary adopted verbatim; a global p-value is worse than none because it is population-dependent. |
| A22 | Auto-flag engine (gated at caseCount ≥ 100) → human review queue, never auto-retire | 1.5 | p<0.25, p>0.90, r_pb<0, distractor r_pb > key r_pb (miskey), distractor <5% (dead), non-key distractor >30% (ambiguous). Thresholds catch ~85.7%; student reports are the recall layer. |
| A23 | Test reliability: KR-20/alpha per test and section + SEM in raw marks; suppressed below ~20 items | 1.5 | Alpha rises mechanically with item count; a 25-question drill will look "unreliable" and admins will draw the wrong conclusion. |
| A24 | Attempt inspector: replay the exact paper a student saw, focus events, device switches, incident log, integrity risk score | MVP | The dispute-resolution surface. Requires the pinned snapshot and stored shuffle seed. |
| A25 | Compensation console: grant deadline extension (audited, linked to an incident), offer equivalent re-attempt, exclude attempt from ranking | MVP | NTA re-examined 1,563 candidates for time loss. Without this, the only options are "do nothing" or "void everything". |
| A26 | Integrity review queue: velocity outliers, wrong-answer-vector Jaccard similarity between accounts, duplicate device fingerprints, background-episode counts | 1.5 | Human review before any leaderboard removal. Never auto-ban — false positives on genuine toppers are catastrophic. |
| A27 | User admin: search, role assign, ban, session revoke, entitlement grant | MVP | Destructive capabilities re-checked in a SECURITY DEFINER RPC against the live DB, not against a cached JWT claim. |
| A28 | Pricing/plan admin, coupons, institute codes, entitlement overrides | MVP | Store-vs-web SKU parity; commission + 18% GST modelled into list price. |
| A29 | Rewards config: earn-rule whitelist, sink whitelist, daily/lifetime caps, expiry, global daily mint cap | MVP | Coins tied to consistency, never to spending. Global mint cap bounds farm damage even when undetected. |
| A30 | Contest/giveaway builder producing an in-app Official Rules screen (sole sponsor, Apple/Google disclaimed, fixed winner count, deadline, award date, odds if random), free-entry path mandatory, FMV cap ₹10,000 | 1.5 | Lotteries Act consideration test; Apple 5.3.1/5.3.2; Play chance-based reward rules; s.194B per-transaction ₹10,000 TDS trigger from 01 Apr 2025. |
| A31 | Comms console: announcement broadcast, push composer with enforced quiet hours and frequency caps, in-app status banner ("solutions being uploaded, ETA X"), language variants | MVP | PW loses trust mostly through unexplained absence, not through errors. Never a silent empty state. |
| A32 | Feature flags + module kill switches (rewards, leaderboard, contests, AI doubt) | MVP | PROGA's constitutional challenge is pending before a larger SC bench; an adverse ruling must be a config change, not a re-architecture. |
| A33 | Immutable audit log viewer (append-only, trigger-enforced) across content, keys, rescores, extensions, role changes, reward grants | MVP | The artefact you produce in a dispute, an audit, or a Board inquiry. |
| A34 | DPDP console: consent ledger viewer, notice-version manager (per language), erasure/DSR queue with SLA, breach runbook with 72h timer, subprocessor register | MVP | Rule 7 requires intimating the *verified parent* — impossible without a maintained parent channel. Consent records retained 7 years as a separate retention class. |
| A35 | Licence register + takedown workflow keyed to `licence_status` | MVP | An App Store 5.2 / Play IP complaint can remove the app without a court ever being involved. |
| A36 | Institute tenancy: institute admin role, batches, roster import, batch-scoped leaderboard, rank-publication toggle **off by default**, institute-branded test series | v2 | The B2B2C revenue unlock; also the Rajasthan Act compliance surface. |
| A37 | Async bulk export (results CSV, paper PDF for print) streamed to Storage via a paginating job | 1.5 | PostgREST silently truncates at 1,000 rows; 1.8M response rows must never go through the Data API. |
| A38 | Bulk import: own JSON/CSV with explicit LaTeX + image URL fields → GIFT → Moodle XML | 1.5 (own format MVP) | Stop when demand stops. Skip Aiken, SCORM, Blackboard. |
| A39 | Ops calendar: deploy freeze windows auto-derived from scheduled tests; pre-scale checklist | MVP | A non-concurrent `CREATE INDEX` during a live test takes ACCESS EXCLUSIVE on the hottest table and loses 10,000 attempts. |

### 3.3 PLATFORM

| # | Capability | Tier | Justification |
|---|---|---|---|
| P1 | Supabase ap-south-1 (Mumbai); GCP asia-south1; Redis in-country | MVP | Region is immutable post-creation; DPDP cross-border restrictions could notify with immediate effect. |
| P2 | RLS style guide enforced in CI: `TO authenticated`, `(select auth.uid())` subselect-wrapped, indexed policy columns, no joins in policies, SECURITY DEFINER helpers with `SET search_path = ''` | MVP | Measured 171ms→<0.1ms, 11,000ms→10ms, 178,000ms→12ms. Not visible with 1k dev rows. |
| P3 | CI gates: splinter lint (fail on 0013/0010/0015), persona RLS test suite (anon / student A / student B / admin), bundle secret grep for `sb_secret_`/`service_role`, licence scan blocking GPL/AGPL, KaTeX render validation, 200%-text-scale a11y check | MVP | Each of these corresponds to a specific catastrophic failure documented in the dossier. |
| P4 | Column-level answer isolation: `question_solutions` / `answer_keys` in a non-exposed schema, no GRANTs to `authenticated`, served only via RPC gated on attempt state | MVP | RLS controls rows, never columns. `?select=id,correct_option` dumps the key otherwise. |
| P5 | Server-side shuffle: seed = `hmac_sha256(SERVER_SECRET, attempt_id)`, order materialised to `attempts.question_order[]`, seed never sent to client | MVP | Reproducible for audit, unpredictable to the client, stable across resume/reinstall/device. |
| P6 | Wire format is `{question_version_id, option_id}` — never positional indices; server asserts membership in `question_order` | MVP | Positional mapping under shuffle silently scores every answer against the wrong question and looks like poor performance. |
| P7 | Attempt store: append-only steps + `(visited, answer, marked_for_review, time_spent_ms, change_count)` tuple; `positive_marks_earned` persisted separately from net | MVP | Derives the 5 palette states correctly; JEE Advanced tie-break needs positive marks and it cannot be backfilled. |
| P8 | `responses` RANGE-partitioned monthly via pg_partman on pg_cron with ≥3 future partitions; BTREE `(attempt_id, question_id)`, BRIN on `answered_at` | MVP | A missing partition means every INSERT fails mid-exam, for everyone, simultaneously. |
| P9 | Idempotency: `idempotency_keys` table (24h TTL), state-machine guard `UPDATE ... WHERE status='in_progress'`, `UNIQUE(attempt_id)` on results, `UNIQUE(attempt_id, reason)` on coin ledger | MVP | Double-submit / lost-200 retry / two-device submit all collapse into one mechanism. |
| P10 | Submit ≠ score: `finalize_attempt` is an O(1) status flip enqueuing pgmq; scoring is set-based SQL in Cloud Run workers; pg_cron reconciler re-enqueues stuck attempts | MVP | Edge Functions cap at 2s CPU / 256MB; percentile is O(N) per cohort. 10k × O(N) is 10^8 row reads in 60s. |
| P11 | Sweeper: pg_cron every 30s, `WHERE status='in_progress' AND deadline_at < now() - 120s ... FOR UPDATE SKIP LOCKED LIMIT 500` | MVP | The only reliable finaliser; nobody's client can be trusted to call submit. |
| P12 | Redis: sharded leaderboard ZSETs + 1Hz merge, snapshot to Postgres, `ZREVRANK` for own rank, never client `ZRANGE`; seat counters via `DECR`; strictly a cache for anything with economic value | MVP | Score packed as integer (percentile × 10^7) to avoid float ties at 7dp. |
| P13 | Realtime **Broadcast only** for leaderboard/announcements; never `postgres_changes`; jittered joins; spend cap OFF | MVP | postgres_changes is single-threaded and tops out ~4,000 msg/s with RLS; Pro default caps at 500 peak connections. |
| P14 | HTTP heartbeats (not Realtime) carry timer + answer delta in one request; adaptive interval 30s/60s | MVP | Collapses ~1,333 rps into ~1,000 rps and survives a Realtime outage. |
| P15 | Admission tokens with ±90s jittered `start_allowed_at`; mandatory asset prefetch before the timer starts | MVP | Converts a 10-second herd into a 3-minute smear and makes offline completion possible. |
| P16 | Question images: public bucket, UUIDv4 unguessable paths, ONE signed/public URL per object per test window, long `cacheControl`, Cloudflare tiered cache, cache-warm job | MVP | Per-user signed URLs eliminate CDN caching entirely: ~135 GB origin egress per test instead of ~13.5 MB. |
| P17 | Math rendering: KaTeX 0.18.x pre-rendered server-side on write (0.103 ms/expr) storing `body_html` + `body_mathml` + `plain_text`; ONE WebView per screen with a ~590 KB local KaTeX+mhchem bundle; native text for non-math prose | MVP | WebViews cost 150–200 MB each; 4 GB Android is the 2026 India baseline. Never a WebView per list row. Never PDFs. |
| P18 | Numeric grading: NFKC normalise, Unicode-minus mapping, decimal (not float) parse, per-question scheme `{value, tolerance_abs \| decimals+rounding}`; ASCII keypad regardless of locale | MVP | JEE Main = round to nearest integer; JEE Advanced = truncate/round to 2dp. Never string equality. |
| P19 | Auth hardening: custom SMTP, DLT SMS provider, Turnstile on signup/signin/reset, raised OTP quota, ≤3600s OTP expiry, per-phone/per-device issuance caps, +91 country allowlist | MVP | Built-in email is 2/hour project-wide; SMS pumping is a five-figure overnight loss. |
| P20 | Long-lived exam JWT (≥4h) + attempt-scoped write token (`aud=attempt:write`, exp = deadline+15m) | MVP | Per-IP refresh limit (1,800/hr, non-configurable) throttles a 400-student coaching centre behind one NAT IP. |
| P21 | Statement timeouts per role (authenticated ~8s, service_role ~120s); cache-hit-ratio alert <99%; pooler saturation alert; k6 10k-VU rehearsal per release | MVP | Cache-hit collapse is the failure mode with no slow-query signature. |
| P22 | Supavisor transaction mode (6543) for all GCP workers with prepared statements disabled; students never touch Postgres directly | MVP | `prepared statement "s0" already exists` appears only under concurrency — i.e. during the exam. |
| P23 | Attestation: Play Integrity (raise quota above 10k/day before any event) + App Attest, verified server-side, tiered — unattested devices get practice mode, not ranked papers | 1.5 | Do not block honest students on custom ROMs; provide an appeals path. |
| P24 | `expo-screen-capture` prevention + screenshot listener logging + per-attempt visible watermark (roll no + timestamp) | 1.5 | Second-phone photography is undefeatable; watermarking deters and traces, which is the achievable goal. |
| P25 | iOS `AutomaticAssessmentConfiguration` hard lock; Android soft controls only (no Device Owner on consumer BYOD) | v2 | Never market "exam-proof lockdown on Android" — Safe Exam Browser has no Android build at all. |
| P26 | xAPI (IEEE 9274.1.1-2023) statement shape as the internal analytics event schema | MVP | Costs nothing now; de-risks institutional integration later. Ignore Caliper and SCORM. |
| P27 | EAS Update with code signing; deploy freeze during live windows; question content served from Storage/CDN, never in the JS bundle | MVP | A 12 MB bundle re-downloads fully per update by default; a mid-test bundle swap crashes active attempts. |
| P28 | Expo SDK 57 pins (`npx expo install`), with tested overrides for FlashList (2.0.2→2.3.2); `maintainVisibleContentPosition` disabled on question lists; never nested in ScrollView; Skia `opaque`; worklets bundle mode for the Hermes RAM regression | MVP | Each maps to a documented crash/jank failure on the exact devices Indian students own. |
| P29 | BigQuery export partitioned + clustered by exam date for admin analytics; read replica or materialized views for dashboards | 1.5 | A subject lead opening a chapter heatmap must never lock the Postgres instance serving a live exam. |
| P30 | PITR enabled (≥7-day) + independent nightly logical dump of question bank and keys to a separate GCS bucket under a different credential domain | MVP | Restoring a whole project to fix one table discards every in-flight attempt; rehearse the restore-to-new-project path and record the real RTO. |

### 3.4 EXPLICITLY NOT DOING

| Rejected | Reason |
|---|---|
| AI tutor as the headline product | Commoditised across nine competitors plus the free government platform; also the category's most-broken promise. Include, never lead. |
| Video lectures, live classes, faculty brand | Capital-intensive and structurally impaired: Vedantu ₹227 Cr revenue against ₹210 Cr loss; Unacademy sold sub-$500M from a $3.5B peak; Byju's insolvent. |
| Purchasable coins, loot boxes, spin-wheels, cash/voucher prizes, entry-fee contests | PROGA 2025: criminal, 3 years + ₹1 cr, personal officer liability. Apple 3.1.1 also forbids expiry of IAP-purchased currency, destroying inflation control. |
| Global all-India public rank wall | Demoralises the structural 80%; Rajasthan Act s.12(viii)/(ix); SC *Sukdeb Saha* guidelines; existential reputational risk. |
| Telesales, auto-mandate, non-refundable subscription | The most reliably hated pattern in the category. Refusing it is the moat. |
| Four subscription tiers | Testbook actively de-tiered to Pass One; tiers create entitlement bugs and "I paid and it isn't there" reviews. |
| Full QTI 3.0 compliance | XML-heavy, MathML-carried, lossy against JSONB+LaTeX, uneven support even in 2026. Align *names* now, build the adapter only when a buyer pays for it. |
| Real-time IRT / adaptive CAT at launch | Needs 200–500 responses per item and exposure control; nothing to calibrate at cold start. Elo online first, IRT offline monthly, CAT possibly never. |
| Webcam proctoring on free/practice tiers | DPDP children's-data liability + Storage cost + product-inappropriate. Reserve for explicitly consented paid proctored mocks only. |
| Apple Kids Category | One-way door: links out and purchase flows are barred, and the constraints persist even after deselecting. Target 13–17 via honest age rating instead. |
| In-app Razorpay/UPI on iOS | Guideline 3.1.1 — guaranteed rejection. Web checkout with no in-app mention or link; honour via account entitlement. |
| Questions delivered as PDFs | The single root cause of the category's worst UX complaints (Allen's laggy, non-zoomable, position-losing viewer). |
| Standard embedded YouTube player for under-18 sessions | Transmits Google identifiers and may serve interest-based ads to a child — DPDP s.9(3) + Play Families AAID ban. Use external open or `youtube-nocookie`. |
| Social feed, DMs, public note sharing, community answers at v1 | Pulls the app into UGC obligations (Apple 1.2, intermediary status, moderation SLA) with no offsetting v1 value. |
| WatermelonDB, Turso Offline Sync, Moti, `react-native-math-view` | Stale or beta: 11 months no commits, "no durability guarantees", Reanimated-3-only, archived since 2024. |
| Self-hosting Supabase | Forfeits PITR, zero-downtime upgrades, Supavisor HA, Smart CDN — and you own a Postgres failover runbook during a live exam. Revisit above ~$1,000/mo compute. |
| TrueSkill / any port | Patent-encumbered by Microsoft; a licence scanner will not catch it. Use openskill.py or Elo-MMR (MIT). |
| Surya/Marker model weights above $5M funding/revenue | Weights are Rail-M, not Apache-2.0. Pay Mathpix or buy the commercial licence. |
| Any AGPL/GPL code in the bundle or backend | Moodle, Canvas, TAO, TCExam, Anki, DOMjudge, quizaccess_* — study the design, clean-room it, paste nothing. Moodle App (Apache-2.0) is the one large codebase you may legally borrow from. |
| 13-language content at launch | 13× editorial and review cost. English + Hindi at launch; regional by state share, driven by NTA's own centre-restriction table. |

---

## 4. THE ADMIN CONTROL SURFACE

The organising principle: **an admin controls state machines and policies, never rows directly.** Every mutation is an event with an actor, a reason and a version; nothing that a student has seen is ever edited in place. Twelve control planes.

### 4.1 Content plane
Create, review, approve, publish, flag, retire — never delete. Controls: item authoring (LaTeX with live preview, validated server-side as a publish gate); image upload with crop, alt-text and pre-resized derivatives; question-type selection (MCQ-single, multi-correct, numeric-integer, numeric-2dp, matching-list, shared stem, assertion-reason); option identity as stable UUIDs with `shuffle_options` defaulting **off** and `pinned_position` for "None/All of the above"; per-option rationale authoring (mandatory field, not optional); solution text, solution video URL, spoken-text accessibility string; taxonomy assignment down to sub-topic; exam cross-tags, PYQ paper/year/shift/question-number, authored difficulty; provenance and licence status (blocking); duplicate-warning acknowledgement; version history with a diff view and an explicit fork-vs-update decision (content edit forks, metadata edit updates); translation as a child of the English parent; bulk import and OCR ingest queues; and a licence/takedown register that can dark-launch an entire provenance class with one flag.

### 4.2 Assessment-design plane
Exam patterns and marking rules as data: `exam_pattern(exam, year, paper) → pattern_section(ordinal, name, question_count, max_marks, question_type) → marking_rule(jsonb: full, negative, zero_on_unanswered, partial_ladder[], numeric_precision, negative_on_numeric)`. Admin can author a 2027 pattern without an app release. Blueprints (chapter weightage, difficulty histogram, PYQ-year spread, item-type quotas, key balance, variant-family exclusion, recency exclusion) saved, reused and executed by the MILP assembler with an override and an explanation panel. Save-time validation: Σ section max_marks must equal the declared total, every question must carry a scheme, every multi-correct must declare a partial policy.

### 4.3 Test-lifecycle plane
Create → schedule → publish (freeze) → run → close → score → publish results → rescore. Controls: sections and ordering; overall duration and per-section deadlines; `carry_forward_unused_section_time` (default false); section lock policy; absolute `starts_at`/`ends_at` in one canonical timezone; late-join cutoff and shortened-attempt tagging; ranking mode (strict vs pooled) with the leaderboard badge that follows from it; attempt policy (max attempts, which attempt is ranked, cooldown); solutions-visible-from; shuffle scope (within-section vs whole-paper); test versioning for mid-window changes; and a publish freeze enforced by trigger, not by convention.

### 4.4 Live-operations plane
The console an admin uses at 14:00 on a Sunday. Live attempt count and completion curve; error-rate and incident stream; per-attempt inspector with exact paper replay, focus events, device switches and incident log; grant a deadline extension (audited, must link to an incident); offer an equivalent re-attempt; exclude an attempt from ranking; extend the whole test window; broadcast an in-test announcement; and the platform-time-loss compensation ladder executed as policy (<60s none / 60s–10min automatic extension / >10min or >15% of duration re-attempt + exclusion) rather than negotiated during the incident.

### 4.5 Key-and-rescore plane
Answer keys as immutable versions with author, reason and effective-from. Challenge queue ranked by distinct challengers and by statistical signal (negative point-biserial, bimodal distractor distribution). Per-question resolution flags with distinct eligible populations: `MULTI_KEY` (+4 to anyone marking any correct option), `ALL_CORRECT` (+4 to all who attempted), `DROPPED` (+4 to all who appeared, shift-scoped for JEE Main). Void policy choice per void: full-marks-to-all / full-marks-to-attempted / drop-and-rescale. Execution is a single idempotent transaction writing new result rows, a new leaderboard snapshot, an atomic pointer swap, a per-student `score_revision` record, a compensating (never clawback) reward ledger entry, and a notification carrying the before/after delta. Every resolution writes a public note visible to every challenger.

### 4.6 Psychometrics plane
Per-cohort item statistics (`context_id` scoping is mandatory — the same item has different p-values for JEE and NEET cohorts): P-value, point-biserial, AIS, and per-distractor NumberChoosing/PercentChoosing/AISResponse/PTbis-Response. Auto-flag rules with editable thresholds, gated at caseCount ≥ 100, routed to a review queue with a recorded disposition (RETAIN / REVISE / RETIRE / RESCORE). Test-level KR-20/alpha and SEM, suppressed below the minimum item count. Authored-vs-empirical difficulty delta as an author-calibration report.

### 4.7 People plane
Capability RBAC with a fixed capability vocabulary (`questions.write`, `questions.approve`, `tests.publish`, `keys.revise`, `attempts.extend`, `rewards.configure`, `users.ban`, `analytics.read`, `audit.read`). Roles live in a server-owned table projected into the JWT; destructive capabilities are re-verified in a SECURITY DEFINER RPC against the live database because JWT claims are cached until refresh. Student admin: search, entitlement grant/revoke, session revoke, device-switch history, ban with reason, appeals queue. Institute tenancy: institute admin role, batches, roster import, batch-scoped leaderboards, rank publication toggle off by default.

### 4.8 Commerce plane
Plans and prices per storefront (iOS IAP, Play Billing, web) with commission and 18% GST modelled into list price; coupons and institute codes; entitlement overrides and manual grants; refund policy text as a versioned artefact; refund processing including automatic entitlement revocation on Apple `REFUND`/`REVOKE` and Play RTDN (never trust a client receipt); dunning configuration; RBI e-mandate pre-debit notification scheduling with a dead-letter queue; per-debit ceiling enforcement (≤₹15,000 to avoid per-transaction AFA); GST invoice generation with SAC 9992 and place-of-supply from the declared state.

### 4.9 Rewards plane
Earn-rule whitelist (enum-constrained, behaviour-keyed, database-enforced so a purchase-origin credit is structurally impossible), sink whitelist, per-action coin values, daily and lifetime caps, inactivity decay, global daily mint cap and anomaly alerting; streak configuration (freeze grant rate, repair cost in effort not money, schedulable rest days); leaderboard bucket size, promotion/relegation rules, opt-in default, pseudonymity enforcement; contest/giveaway builder that will not save without an Official Rules screen (sole sponsor, Apple/Google disclaimed, fixed winner count, entry deadline, award date, odds if random, free-entry path) and refuses an FMV above ₹10,000; nightly ledger reconciliation with drift alarm.

### 4.10 Moderation and integrity plane
Student error-report triage with SLA and disposition; challenge triage; image-failure incident aggregation with automatic void-review flagging above a threshold; integrity queue (velocity outliers, wrong-answer-vector similarity, device fingerprint reuse, sustained background episodes) with mandatory human review before any leaderboard action; provenance/IP audit sweeps (image hashing, text similarity) over the corpus.

### 4.11 Communications plane
Announcement broadcast (in-app banner, push, email) with language variants; push composer with hard-enforced quiet hours (23:00–06:00), frequency caps and a blocked-phrase list for failure-framed copy; templated transactional notices (rescore, key revision, incident, refund); status-banner control for any content still being uploaded; notification-preference administration; grievance officer inbox with 48-hour acknowledgement and 30-day resolution timers.

### 4.12 Governance plane
Feature flags and per-module kill switches with an owner and an expiry; deploy-freeze calendar auto-derived from scheduled tests; immutable audit log across every plane above, queryable by actor, entity and time; DPDP console (consent ledger, notice-version manager per language, DSR/erasure queue with SLA, breach runbook with a running 72-hour timer, subprocessor and data-flow register, DPIA repository); retention-class administration (consent records 7 years, exam evidence per policy, PII per notice); and an "explain this decision" export that assembles, for any disputed attempt, the pinned paper, the shuffle seed, the marking rules, the key version, the rescore history and the audit trail into one artefact.

---

## 5. DOMAIN MODEL SKETCH

Notation: `→` = FK. **[RLS]** = row-level security mandatory. **[PART]** = partitioned. **[PRIV]** = lives in a non-exposed schema, reachable only via RPC. **[IMM]** = append-only / immutable, no UPDATE or DELETE grants.

**Identity & consent**
1. `org` — tenant (self-serve default org + institute orgs). Parent of batches, brand, rank-publication policy.
2. `profile` → `auth.users` — exam target, category, gender, home state, target year, DOB, language, `org_id`. **[RLS]**
3. `user_roles(user_id, org_id, role)` + `role_permissions(role, permission)` — server-owned; role projected into JWT by `custom_access_token_hook`. **[RLS]** **[PRIV]** Never in `user_metadata`.
4. `guardian_link(child_id, guardian_id, basis: parent|guardian, verification_method, evidence_ref)` — Rule 10 (minor) and Rule 11 (PwD guardianship) are distinct bases. **[RLS]**
5. `consent_event(principal_id, purpose, notice_version_id, lang, source, action: grant|withdraw, ts, ip)` + `notice_version(id, lang, body, effective_from)` — 7-year retention class. **[IMM]**

**Taxonomy & exam metadata**
6. `subject → chapter → topic → sub_topic` — the FSRS card key is `sub_topic_id`.
7. `exam(JEE_MAIN|JEE_ADVANCED|NEET)` → `exam_pattern(exam, year, paper)` → `pattern_section(ordinal, name, question_count, max_marks, question_type)` → `marking_rule(section_id, rule jsonb)` — a 2027 pattern change is an INSERT.
8. `exam_calendar_event(exam, year, session, shift, starts_at, status: scheduled|cancelled|re_exam)` — absorbs mid-cycle cancellations.

**Content**
9. `question(id, org_slug_prefixed_slug, subject_id, current_version_id)` — stable identity only. **[RLS]**
10. `question_version(id, question_id, version_no, status, body_latex, body_html, body_mathml, plain_text, authored_difficulty, shuffle_options, created_by, approved_by CHECK(<> created_by), published_at)` — **[IMM]** once published. Content edit forks; metadata edit updates in place.
11. `question_option(id uuid, question_version_id, ordinal, body_latex, rationale_latex, option_group, pinned_position)` — option identity is a UUID, never an index.
12. `question_stimulus(id, body)` + `question_version.stimulus_id` — shared paragraph/matching-list stem, referenced once, never duplicated.
13. `question_translation(question_version_id, lang, stem, options[], solution, translated_by, reviewed_by, status)` — no key, no marks; English parent is authoritative.
14. `question_solution(question_version_id, body, per_option_rationales, video_url, spoken_text)` — **[PRIV]** no GRANT to `authenticated`.
15. `answer_key(question_version_id, version, correct_option_ids[], numeric_value, tolerance, effective_from, reason, authored_by)` — **[IMM]**, **[PRIV]**.
16. `question_relation(a_id, b_id, kind: EXACT_DUPLICATE|NEAR_DUPLICATE|VARIANT_OF|SUPERSEDES, score)` — VARIANT_OF feeds assembly exclusion.
17. `content_source(question_version_id, provenance, source_ref, licence_status, evidence_url)` — non-nullable; gates the serving query.
18. `item_statistic(question_version_id, context_id, statistic_name, value, case_count, std_error, computed_at)` + `distractor_statistic(..., option_id, ...)` — QTI 3.0 vocabulary; cohort-scoped.
19. `question_challenge(question_version_id, attempt_id, user_id, reason, evidence, status, resolution_note, resolved_by)` + `error_report` — UNIQUE per (user, question). **[RLS]**

**Tests**
20. `blueprint(id, exam, constraints jsonb)` — chapter counts, difficulty histogram, PYQ spread, key balance.
21. `test(id, org_id, exam, pattern_id, blueprint_id, ranking_mode, shuffle_scope, starts_at, ends_at, late_join_cutoff, solutions_visible_from, attempts_policy, published_at, test_version)` — publish freezes composition by trigger.
22. `test_section(test_id, ordinal, name, duration_seconds, lock_policy, max_marks)`.
23. `test_question(test_id, section_id, question_version_id, display_order, marks_correct, marks_incorrect, marks_unattempted, partial_scheme jsonb)` — marking lives on the join, not on the question. **[IMM]** post-publish.

**Attempts**
24. `attempt(id, user_id, test_id, test_version, status, started_at, deadline_at, question_order uuid[], option_order jsonb, shuffle_seed, active_session_token, active_device_id, is_ranked, shortened, scoring_config_hash)` — **[RLS]**; partial UNIQUE `(user_id, test_id) WHERE status='in_progress'` and `WHERE is_ranked`.
25. `attempt_section(attempt_id, section_id, opened_at, section_deadline_at, locked_at)`.
26. `attempt_response(attempt_id, question_version_id, selected_option_ids[], numeric_raw, numeric_canonical, marked_for_review, visited, time_spent_ms, client_seq, answered_at)` — **[RLS]** **[PART]** monthly RANGE on `answered_at`; BTREE `(attempt_id, question_version_id)`, BRIN on `answered_at`.
27. `attempt_response_event(...)` — **[IMM]** **[PART]**; the dispute-reconstruction log.
28. `attempt_focus_event` + `attempt_incident(attempt_id, kind, duration_ms, server_corroborated)` — anti-cheat signal and the input to the compensation ladder.
29. `attempt_deadline_extension(attempt_id, extra_seconds, reason, granted_by, incident_id)` — **[IMM]**, admin-only RLS.
30. `attempt_result(attempt_id, answer_key_version_map jsonb, raw_score, positive_marks_earned, percentile_7dp, subject_percentiles jsonb, predicted_rank, computed_at)` + `attempt_question_result(...)` — UNIQUE `(attempt_id, answer_key_version)`; new rows on rescore, never overwrites. **[RLS]**
31. `leaderboard_snapshot(id, test_id, computed_at, is_current)` + `leaderboard_entry(snapshot_id, user_id, rank, tie_break_vector)` — pointer swap, never in-place mutation. Redis ZSET is a rebuildable cache of this.

**Learning loop**
32. `srs_card(user_id, sub_topic_id, stability, difficulty, state, due_at, params_version)` + `srs_review_log(...)` — **[PART]** by month; the log is the FSRS retraining corpus.
33. `seen_ledger(user_id, question_id, first_seen_at)` — prevents repeat serving of a burned MCQ.
34. `note(user_id, question_version_id, body, updated_at)` + `note_conflict` + `bookmark` — **[RLS]**; never silently overwrite student text.

**Economy & comms**
35. `coin_ledger(user_id, delta, earn_reason ENUM, sink_reason ENUM, ref_type, ref_id, attempt_id)` — **[IMM]**; UNIQUE `(user_id, ref_type, ref_id)` for natural idempotency; no purchase-origin credit reason exists in the enum. **[RLS]**
36. `streak(user_id, current, longest, freezes_available, rest_days_used, last_qualifying_day)`.
37. `contest(id, rules_text, winner_count, entry_deadline, award_date, free_entry_path)` + `contest_entry(contest_id, user_id)` UNIQUE.
38. `subscription(user_id, plan, source: ios|play|web, entitlement_until, status)` + `payment_event` **[IMM]** + `refund`.
39. `notification` + `notification_preference` + `announcement`.

**Governance**
40. `audit_log(actor_id, capability, entity_type, entity_id, before, after, reason, ts)` — **[IMM]**, trigger-enforced, admin-read RLS.
41. `idempotency_key(key PK, scope, request_hash, response jsonb, created_at)` — 24h TTL.
42. `feature_flag(key, scope, value, owner, expires_at)`.
43. `dsr_request(principal_id, kind: access|erasure|correction, status, sla_due_at)`.

**Cross-cutting notes.** Every table in the exposed schema has RLS enabled and at least one policy, asserted in CI. Solutions, answer keys, `user_roles`, `role_permissions` and `content_source.evidence_url` live in a private schema with zero `authenticated` GRANTs. `attempt_response`, `attempt_response_event` and `srs_review_log` are the only tables that need partitioning at 10k-concurrent scale (~1.8M rows per full mock, ~180M/year). All analytics views carry `security_invoker = on`; any admin reporting view lives in a private schema. Erasure is two-tier: identity columns crypto-shredded, statistical contribution retained with the mapping key dropped so percentiles for the other 9,999 students stay sound.

---

## 6. RISK REGISTER

| # | Risk | L | I | Mitigating decision |
|---|---|---|---|---|
| R1 | **DPDP child-consent architecture retrofitted too late.** Majority of users are 16–18; s.9(1) VPC and s.9(3) tracking ban apply from day one, and MeitY's Feb 2026 consultation may compress the runway to 13 Nov 2026. | High | Existential (₹200 cr; Board erasure order) | Build VPC as a hard gate in the signup state machine before the first 1,000 real users, not before a legal deadline. Two physically separate telemetry pipelines: pedagogical (defensible, disclosed, parent-visible) and engagement (disabled entirely for under-18 at the API gateway). Assume zero "educational institution" exemption. Plan to 13 Nov 2026. |
| R2 | **Rewards layer classified as an online money game.** PROGA 2025 s.2(i) captures "other stakes" including coins "equivalent or convertible to money"; skill is irrelevant; the constitutional challenge is pending before a larger SC bench. | Medium | Existential (3 yrs + ₹1 cr, personal officer liability) | Closed-loop coin invariant enforced in the database: earn-reason enum with no purchase origin, no transfer (trigger-blocked), no cash/voucher/third-party sink, redemption only into our own supply. Free-entry path on every giveaway. FMV cap ₹10,000. Entire rewards module behind a documented kill switch. |
| R3 | **Answer-key or question leak during a live window.** 2026 NEET leak: 120–140 of 180 questions matched, ₹2–10 lakh per access, CBI, arrests including NTA subject experts. Column-level exposure via PostgREST is one query away. | Medium | Severe (product credibility) | Solutions and keys in a private schema, zero `authenticated` GRANTs, served only via an RPC gated on attempt status and window close. Questions served per-section, never the whole paper. Per-attempt watermark. No bulk-export endpoint for student tokens. Fixed live-start windows only for ranked papers. |
| R4 | **Content operations under-resourced; a 1% error rate on 100k items = 1,000 wrong questions.** Every serious competitor gets caught here (Embibe "mistakes in questions", Allen mis-labelled difficulty). | High | Severe (trust is unrecoverable per incident) | Two-approver publish workflow with `approved_by <> created_by` as a CHECK constraint; provenance mandatory; auto-flag engine at caseCount ≥ 100 feeding a human queue; "report an error" on every question with a published SLA; rescore pipeline built *before* launch, not after. Budget editorial headcount as a first-class line item, not overhead. |
| R5 | **PYQ / NCERT / coaching-material copyright.** s.52(1)(i) covers reproduction "as part of the questions to be answered in an examination" — a commercial subscription app is neither a teacher nor an examination body. NCERT publicly threatened action for use "in whole or in part". | Medium | Severe (injunction or store takedown on complaint, no court needed) | `licence_status` as a serving-query filter so any provenance class can be dark-launched in one flag. Written permission request to NTA. Original commissioned artwork for every diagram, no traces. NCERT referenced by chapter pointer, never reproduced. SME contracts carry IP warranties and indemnity. Counsel opinion before launch. |
| R6 | **Thundering-herd failure at the exact minute of a 10k live mock.** Connection exhaustion, Realtime join caps (2,500/s), CDN-bypassing signed URLs, retry amplification. | High | Severe (the single most visible failure possible) | Single-RPC paper fetch; Supavisor transaction mode; jittered admission tokens (±90s) and mandatory prefetch before the timer starts; one signed/public URL per object per window with tiered cache and a warm job; Broadcast not `postgres_changes`; spend cap off; submit is an O(1) status flip with scoring in pgmq; full-jitter client backoff with a retry token bucket; k6 at 1.5–2× before every event. |
| R7 | **Scoring correctness bug shipped.** Positional answer mapping under shuffle, proportional partial-marking formula, dropping answered-and-marked responses, averaged subject percentiles. Each is silent and looks like poor student performance. | Medium | Severe (destroys the core claim) | `{question_version_id, option_id}` wire format with server-side membership assertion; `scoreMultiCorrect()` as a pure function locked by a golden suite generated from the verbatim 2026 paper example; attempt state as a `(visited, answer, marked)` tuple with derived palette states; a contract test asserting shuffled and unshuffled attempts score identically. |
| R8 | **A student suicide is publicly linked to the app's ranking or streak mechanics.** NEET-linked suicides 4 (2021) → ≥32 (2025); Kota concentration; SC *Sukdeb Saha* guidelines bind "coaching institutes … irrespective of affiliation". | Low | Existential | Bucketed pseudonymous opt-in leaderboards; personal-improvement track as the primary metric; no loss-framed or shaming copy anywhere (blocked-phrase list in the push composer); quiet hours; generous streak forgiveness with schedulable rest days; gamification confined to low-stakes practice and kept off the mock-result screen entirely; Tele-MANAS persistent; admin alert on sustained decline routed to human outreach, never an automated nudge. |
| R9 | **MARKS or SATHEE closes the gap, or MARKS ships a native iOS app.** MARKS is free forever with 1 lakh+ PYQs, 4.8★, 1M+ downloads and 2M+ questions solved daily. | Medium | High (kills the free-tier acquisition thesis) | Do not compete on free content. Match MARKS at the free tier (PYQs + custom builder + CBT engine) and monetise the loops they structurally cannot: FSRS on your own errors, teacher-graded rich-text solutions, sectioned mocks with predicted rank, tutor mode, notebook. Ship a first-class native iOS app as day-one share capture. |
| R10 | **A 2027 pattern change (NEET CBT, JEE Advanced marking) invalidates hardcoded assumptions.** The multi-correct penalty already moved −2 → −1 in one year; the NEET 2027 CBT bulletin is unpublished. | High | Medium (mitigated by design) | Everything pattern-shaped is data: `exam_pattern → pattern_section → marking_rule(jsonb)`, versioned by year, pinned per test, admin-editable without a release. Build NEET CBT-first now so the same console serves all three exams. Admin-editable exam calendar absorbs cancellations and re-exams. |
| R11 | **Unit economics inverted by store commission + GST + egress.** iOS ₹999 nets ~₹590–720 after 15–30% commission and 18% GST; per-user signed URLs turn ~13.5 MB into ~135 GB of origin egress per test. | Medium | High | Model list → commission → GST → PSP → net *before* pricing. Anchor ₹1,799–1,999/yr with a UWorld-shaped ladder (long durations barely cost more). Web checkout via Razorpay honoured in-app by entitlement, with no in-app mention. Fix the CDN caching pathology and pre-generate image derivatives before scaling the bank. Bundle-size discipline (Testbook 63.9 MB vs PW 428.8 MB). |
| R12 | **Admin console scope-creeps into a 12-month build and delays the student app past an exam cycle.** The full control surface in §4 is a multi-year product. | High | High (missed cycle = a full year of lost acquisition) | Phase the admin console ruthlessly (§7): Phase 1 ships authoring + review workflow + marking rules + test builder + rescore only. OCR ingest, MILP assembly, psychometrics, institute tenancy and the DPDP console are Phase 2–4. Every admin feature must be justified by a specific launch-blocking failure or a signed institutional customer. |

---

## 7. PHASED ROADMAP

### Phase 0 — Engine Truth (pre-alpha, internal)
**Build:** immutable content model (`question / question_version / question_option / answer_key`); marking rules as data with all four JEE Advanced scoring engines plus JEE Main and NEET; the golden test suite generated from the verbatim 2026 Paper 1 worked example; server-authoritative attempt state machine with the `(visited, answer, marked)` tuple; percentile and three tie-break chains; idempotent rescore with all three key-revision flags; RLS style guide + CI persona suite + splinter lint gates; KaTeX pre-render pipeline; the single-WebView math renderer measured on a 4 GB Android device.

**Done when:** a seeded historical JEE Advanced 2026 Paper 1 scores identically to the published key for 100 synthetic attempts; a simulated key revision rescores 10,000 synthetic attempts idempotently, re-emits ranks and writes an audit trail with zero drift; a student JWT hitting PostgREST directly during an in-progress attempt returns 403 or empty on every solution and key column; one WebView renders a 15-line LaTeX question in <400 ms first paint on the reference device.

**Kills it:** the marking engine cannot be made data-driven without unacceptable complexity (i.e. you find yourself writing per-year `if` branches) — that means the core differentiation is not buildable and the thesis is wrong.

---

### Phase 1 — The Free Engine (public v1)
**Ships:** everything tagged MVP in §3. Free PYQ bank + custom test builder with question-state filters + tutor/timed modes + NTA-faithful CBT player + full analytics (percentile, time-per-question vs cohort, mistake taxonomy, chapter scatter) + FSRS review loop + notebook + bookmarks + per-option rationales + offline practice + bucketed opt-in leaderboards + streak with forgiveness + weekly live mock. Admin: authoring with validation gate, review workflow, marking-rule editor, test builder with publish freeze, key versioning, challenge triage, rescore/void console, attempt inspector, compensation console, comms, feature flags, audit log, DPDP console. Paid tier live at ₹1,799–1,999/yr.

**Done when:** three consecutive weekly live all-India mocks run at ≥3,000 concurrent with zero attempts stuck `in_progress`, zero duplicate results, zero rescore drift, p99 answer-sync <800 ms from an Indian 4G device, and a published incident-and-remedy record for anything that did go wrong; iOS rating ≥4.6★ with ≥300 ratings; D7 retention on the FSRS review loop ≥35%; ≤2 confirmed content errors per 1,000 served questions.

**Kills it:** a scoring or key-revision incident during a live mock that cannot be explained and remediated within 24 hours — that destroys the one claim the whole product rests on. Second kill condition: free-tier acquisition fails to beat 20k installs in 90 days, meaning MARKS/SATHEE parity is not enough and the thesis needs re-cutting.

---

### Phase 2 — Content Ops at Scale + Monetisation Proof
**Ships:** OCR ingest pipeline with diff review and `edits_per_ingested_item` instrumentation; duplicate-detection triad; bulk import (own JSON → GIFT); Hindi UI + bilingual stacked content; per-cohort item statistics and the auto-flag engine; test reliability reporting; predicted percentile/rank anchored to national marks-vs-percentile tables with confidence intervals; scored self-assessment papers; QBank reset; formula cards; confidence tagging; exam countdown mode; AI doubt as a lower rung of the escalation ladder; parent view; Play Integrity / App Attest tiered attestation; watermarking; BigQuery analytics.

**Done when:** the bank exceeds 60,000 published, provenanced, statistically-monitored items with ingest cost per verified item below a stated target; free-to-paid conversion ≥3% at 90 days with refund rate <5%; 10,000-concurrent live mock executed cleanly; predicted rank within a published error band against the actual JEE Main / NEET cycle.

**Kills it:** ingestion economics fail — human verification per OCR'd item costs more than commissioning original items, meaning the bank cannot scale without a content-licensing deal. Second: conversion below ~1.5%, meaning the free tier cannibalises rather than funnels and the price ladder must be redesigned.

---

### Phase 3 — Institutional Control Plane (B2B2C)
**Ships:** institute tenancy (org, batches, roster import, institute admin role, batch-scoped leaderboards with rank publication off by default, institute-branded test series); blueprint editor + MILP auto-assembly; translation management; Moodle XML in/out; async bulk export; per-institute analytics and cohort comparison; SLA-backed support tier; optional proctored paid mocks with explicit separate consent (iOS AAC hard lock, Android soft controls, honest capability claims).

**Done when:** five paying coaching centres are live with their own authored content on the platform, renewing; institutional ARR exceeds 25% of total; the admin NPS from institute content leads is materially above the category baseline (Unacademy Educator 3.33★ is the bar to beat by a wide margin).

**Kills it:** coaching centres will not put their proprietary question banks on a third-party platform at any price — a real possibility given content is their only moat. If so, pivot the admin console to a paid standalone authoring/paper-generation tool (the ExamBro model, 4.85★ with no platform at all) rather than a tenancy play.

---

### Phase 4 — Adaptivity and Prediction
**Ships:** offline 2PL/3PL calibration (girth) on items with ≥200 responses feeding a theta-based predictor; adaptive *practice* item selection driven by Elo with decaying K (never adaptive testing); study planner from declared availability; college/counselling predictor; human doubt escalation with visible SLA and coin auto-refund on breach; regional languages by state share; possible CAT for practice only.

**Done when:** the theta-based predictor beats the cohort-percentile predictor on out-of-sample accuracy against a real exam cycle, and adaptive practice demonstrably beats random-within-topic on time-to-mastery in an internal A/B.

**Kills it:** nothing at this stage kills the project; failure here means the product plateaus as an excellent non-adaptive engine, which is still a viable business. Do not bet the company on adaptivity.

---

## 8. WHAT WOULD MAKE THIS FAIL

**1. Content operations, not engineering.** The engine is the interesting part and will get the attention; the bank is the product. A 100,000-item bank at a 1% error rate is 1,000 wrong questions, and each one a student meets during a scored mock destroys trust irrecoverably. Every competitor gets caught here — Embibe on spelling-sensitive grading and "mistakes in questions", Allen on practice-question difficulty that does not match its stated level. The failure mode is specific and predictable: a small engineering team ships a beautiful CBT player against a thin, hastily-ingested bank, the first live mock surfaces four broken questions, the review record fills with "wrong answers in the app", and the defensible-scoring positioning becomes an active liability because the product loudly claims correctness it does not have. Editorial headcount and a two-approver workflow are not overhead here; they are the product.

**2. Regulatory collision with the child user base.** The majority of users are 16–18, which makes DPDP s.9(1) verifiable parental consent and the s.9(3) tracking/behavioural-monitoring prohibition the default path rather than an edge case — and makes every standard growth mechanic (optimised push timing, personalised offers, churn-triggered nudges, engagement A/B tests) legally unavailable. Compounding it: PROGA 2025 turns any coin that touches money into a criminal exposure with personal officer liability, and the constitutional challenge is unresolved. The realistic failure is not a ₹200 crore fine; it is shipping a growth engine that has to be amputated at month nine, taking the retention model with it, while a competitor that never built it grows unimpeded.

**3. A visible failure during a live all-India mock.** The single most important product moment is 10,000 students starting a paper at the same second and finishing at the same second. The dossier documents every way this breaks: connection pool exhaustion, per-user signed URLs bypassing the CDN, Realtime join caps at 2,500/s against 10,000 simultaneous joins, retry amplification turning a 20% error rate into a self-inflicted DDoS, a missing pg_partman partition failing every INSERT at once, a mid-window migration taking ACCESS EXCLUSIVE on the hottest table. Any of these on a Sunday afternoon costs three hours of work for thousands of students who cannot get it back, and no amount of engineering quality elsewhere survives it. This is the risk most likely to be under-rehearsed, because load testing at 1.5× target is unglamorous and always slips.

**4. Admin-console scope swallowing the calendar.** The control surface in §4 is genuinely a multi-year product, and it is simultaneously the most defensible wedge and the most seductive place to over-build. The failure is mundane: eighteen months building the authoring, psychometrics, tenancy and compliance consoles, launching the student app after the exam cycle it was aimed at, and discovering that the free-tier acquisition window (which is exam-cycle-synchronised, clustering around Jan/Apr/May) has closed for a year. The discipline required — Phase 1 admin is authoring, review, marking rules, test builder and rescore, and nothing else — will be under constant pressure from the very institutional conversations that make the wedge attractive.

**5. Being right about the product and wrong about distribution.** Every conclusion in the dossier can hold — incumbents are stagnant, teacher tooling is abandoned, nobody ships SRS or tutor mode or correct partial marking — and the product can still die because acquisition in this market is a paid-and-brand game. PW spends against 78 lakh YouTube subscribers and 100+ physical cities; SATHEE gives away lectures, DPPs, mocks and AI analytics in 12 languages at zero cost with the Ministry of Education's name on it; MARKS already has 1M+ downloads and 4.8★ for free. The bet is that a genuinely better engine plus screenshot-able insight cards produces organic growth. If it does not — if the rank card is not shared, if the FSRS loop does not produce daily return, if word of mouth in coaching batches does not fire — then a correct product with no distribution is indistinguishable from a wrong one, and the only remaining path is the institutional channel, which is a slower, lower-margin business than the one being planned for.