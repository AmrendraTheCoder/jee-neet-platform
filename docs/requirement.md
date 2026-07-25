# Requirements — JEE / NEET Practice and Mock-Test Platform

**Status:** Phase 2 of 4. Draft 1.
**Date:** 2026-07-25
**Depends on:** [00-IDEATION.md](00-IDEATION.md) · research corpus in [docs/research/](research/)
**Next:** `skill.md`, `agent.md`, `mcp.md`

---

## 1. Scope

### 1.1 What this is

A multi-tenant assessment platform for Indian competitive-exam aspirants, covering Physics, Chemistry, Mathematics and Biology. Students practise questions, sit timed mock tests that faithfully replicate the NTA computer-based-test experience, review their errors, and are scheduled back to weak concepts by a spaced-repetition engine. Administrators author and version questions, define exam patterns and marking rules as data, assemble and publish papers, and operate the platform through twelve control planes.

The defining architectural commitment: **exam mechanics are versioned data, not code.** Marking schemes, paper composition, question content and answer keys are immutable versioned rows. Every mark is reproducible, explainable and auditable months after the fact.

### 1.2 Locked decisions

| ID | Decision | Consequence for these requirements |
|---|---|---|
| D1 | **Multi-tenant from day one.** B2C first, institutes in Phase 3. | `org_id` on nearly every row. Every RLS policy is tenancy-aware from the first migration. |
| D2 | **Web for full-length ranked mocks and the admin console. React Native (Expo) for practice, SRS review, notes, analytics, notifications.** | Two clients, one API. `FR-ATT` ranked-mock requirements apply to web only. RN never renders a ranked mock. |
| D3 | **JEE Main + NEET in v1. JEE Advanced in v2.** | Two marking schemes at launch. `FR-PAT` must remain general enough that JEE Advanced's four scoring engines are data entry in v2. |
| D4 | **Profitable niche, self-funded.** | Single paid tier. No growth mechanics that depend on behavioural profiling. Cost ceilings are hard requirements, not aspirations. |
| D5 | Serve under-18s, with verifiable parental consent. | `FR-IDN` consent requirements are on the critical path, not deferrable. |
| D6 | Full PYQ bank free; paid tier is mocks, analytics depth, SRS scale and self-assessment. | Free tier must be genuinely useful or acquisition fails against MARKS. |
| D7 | Coins are never purchasable. No prize contests. | `FR-RWD` is a closed-loop economy enforced in the database. |
| D8 | No UGC in v1. | No student-to-student messaging, community answers, or public note sharing. |
| D9 | English UI and content at launch; bilingual schema built now. | `FR-ITM` translation model is v1 schema, v1.5 content. |
| D10 | Rescore pipeline ships pre-launch. | Non-negotiable. Unbuildable once leaderboards and coin ledgers are denormalised. |

### 1.3 Priority tiers

- **MVP** — required for public v1. A missing MVP requirement blocks launch.
- **P1.5** — within 90 days of launch.
- **P2** — post product-market-fit.

### 1.4 Requirement conventions

- **MUST** — mandatory. **SHOULD** — strongly recommended; deviation requires a recorded decision. **MAY** — optional.
- Each requirement has an ID, a tier, a statement, acceptance criteria (`AC`), and where relevant a trace to catalogued edge cases (`EC-*`, see [research/agent_edge-*.json](research/)).
- "The system" means the platform as a whole. Client-specific requirements name `WEB` or `RN`.

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **Org** | A tenant. The default self-serve org, or a coaching institute. |
| **Item** | A question. Has a stable identity (`question`) and immutable content versions (`question_version`). |
| **Pattern** | A versioned description of an exam's structure and marking, e.g. `JEE_MAIN / 2026 / Paper 1`. |
| **Paper / Test** | A specific assessment instance assembled from items against a pattern. |
| **Attempt** | One student's sitting of a test. Pins the test version, question versions, question order and option order. |
| **Ranked attempt** | The single attempt per student per test that is leaderboard- and analytics-eligible. |
| **Key version** | An immutable answer-key revision. Scores reference the key version they were computed against. |
| **Rescore** | Idempotent recomputation of results and ranks against a new key version. |
| **Card** | An SRS scheduling unit, keyed on `(user, sub_topic)`. |
| **Seen ledger** | Per-student record of which items have been served, preventing repeat delivery. |
| **VPC** | Verifiable parental consent, per DPDP Act 2023 s.9(1) and DPDP Rules 2025 r.10. |

---

## 3. Actors

| Actor | Description | Client |
|---|---|---|
| **Anonymous** | Pre-signup. May browse marketing surfaces only. | WEB, RN |
| **Student** | Primary user. Predominantly 16–18, therefore a Child under DPDP. | WEB (mocks), RN (everything else) |
| **Guardian** | Legally required consent-granting party; commercially the buyer in most Indian households. Read-only progress view. | WEB, RN |
| **Admin** | Ships as one user-facing role. Internally decomposed into six capability sets (see FR-IDN-08). | WEB only |
| **Institute admin** | P2/P3. Manages batches, rosters, institute-scoped tests and analytics. | WEB only |
| **System** | Scheduled jobs, sweepers, scoring workers, reconcilers. | — |

---

## 4. Functional requirements

### FR-TEN — Tenancy

| ID | Tier | Requirement |
|---|---|---|
| **FR-TEN-01** | MVP | Every table holding org-scoped data MUST carry a non-nullable `org_id`. A default org exists for self-serve B2C users. |
| **FR-TEN-02** | MVP | Every RLS policy on an org-scoped table MUST constrain on `org_id` in addition to any user-level predicate. Tenancy MUST NOT be enforced in application code alone. |
| **FR-TEN-03** | MVP | `org_id` MUST be projected into the JWT via the auth hook and MUST NOT be readable from a client-writable claim namespace. |
| **FR-TEN-04** | MVP | Cross-org data access MUST be impossible for any non-super-admin principal, including via PostgREST resource embedding, views, and RPC. |
| **FR-TEN-05** | P2 | An org MUST be able to publish tests visible only to its own batches, with an institute-controlled rank-publication toggle defaulting to **off**. |

**AC-TEN-01** — A CI persona suite runs on every migration with at least five principals: anon, student in org A, student in org B, admin in org A, admin in org B. Every table is probed for read and write. Any cross-org leak fails the build.
**AC-TEN-02** — Setting `org_id` in `user_metadata` and re-issuing a JWT does not change what the principal can read.

> **Rationale.** Tenancy in RLS is a materially harder problem than per-user isolation and cannot be retrofitted. D1 accepts ~2 weeks of cost now to avoid a rewrite. FR-TEN-05 is also a compliance feature: Rajasthan Coaching Centres Act 2025 s.12(viii)/(ix) bars centres from publishing internal assessment results.

---

### FR-IDN — Identity, authentication, consent, roles

| ID | Tier | Requirement |
|---|---|---|
| **FR-IDN-01** | MVP | The system MUST support phone OTP, email, Google and Apple sign-in. Phone MUST NOT be mandatory on the email path. |
| **FR-IDN-02** | MVP | A neutral date-of-birth capture MUST occur before any processing beyond authentication. Copy MUST NOT be leading (no "Are you 18+?" prompt, which teaches users to lie). |
| **FR-IDN-03** | MVP | Where the user is under 18, the system MUST obtain verifiable parental consent before processing any personal data beyond what is strictly necessary to obtain that consent. Verification MUST use a permitted mechanism under DPDP Rules 2025 r.10 — identity/age details already held, details voluntarily supplied, a virtual token from an authorised entity, or a DigiLocker service provider. A tick-box is explicitly insufficient. |
| **FR-IDN-04** | MVP | Every consent grant and withdrawal MUST be recorded as an immutable event carrying purpose, notice version, language, source and timestamp. Consent records are a 7-year retention class. |
| **FR-IDN-05** | MVP | The system MUST maintain a guardian channel for every child principal, because DPDP r.7 requires intimating the *verified parent* on a breach. |
| **FR-IDN-06** | MVP | The system MUST NOT assume the Fourth Schedule "educational institution" exemption applies. |
| **FR-IDN-07** | P1.5 | On a student's 18th birthday the system MUST transition the lawful basis, re-obtain consent directly from the now-adult principal, and auto-revoke guardian read access. |
| **FR-IDN-08** | MVP | Roles MUST live in a server-owned `user_roles` table with a `role_permissions` capability vocabulary, projected into the JWT by a custom access token hook. Roles MUST NOT be read from `user_metadata`. |
| **FR-IDN-09** | MVP | The capability vocabulary MUST exist from v1 even though only ADMIN and STUDENT are populated: `questions.write`, `questions.approve`, `tests.publish`, `keys.revise`, `attempts.extend`, `rewards.configure`, `users.ban`, `analytics.read`, `audit.read`. |
| **FR-IDN-10** | MVP | Destructive capabilities MUST be re-verified inside a `SECURITY DEFINER` RPC against the live database, not against a cached JWT claim. |
| **FR-IDN-11** | MVP | Account recovery MUST NOT rely on phone number possession alone. Identity MUST be bound to email plus phone, with a second factor required on first login from a new device after a dormancy period. |
| **FR-IDN-12** | MVP | Auth MUST be hardened before launch: custom SMTP (the built-in provider is rate-limited to 2 emails/hour project-wide), a DLT-registered Indian SMS provider, CAPTCHA on signup/signin/reset, raised OTP quotas, per-phone and per-device issuance caps, and a +91 country allowlist. |

**AC-IDN-01** — A synthetic under-18 signup cannot reach any question content, create an attempt, or emit a telemetry event until VPC completes.
**AC-IDN-02** — Setting `user_metadata.role = 'admin'` and refreshing the token grants no additional access. Asserted in CI.
**AC-IDN-03** — An automated SMS-pumping simulation (10,000 OTP requests from rotating numbers in 10 minutes) is rate-limited and cost-capped without blocking legitimate signups from a shared NAT IP.

**Traces:** EC-DPDP-01, EC-DPDP-02, EC-DPDP-04, EC-DPDP-07, EC-DPDP-10, EC-LEAK-04, EC-SIGNUP-01, EC-SIGNUP-02, EC-SIGNUP-04, EC-SIGNUP-06.

> **Open risk.** FR-IDN-03 collides with the "frictionless self-serve, no sales calls" brand position. Resolution per ideation §5.11: guardian contact is collected under a `contact_purpose` enum that has no marketing value available, enforced at the database level. The promise is "we will never call you", not "we will never collect a number".
> **EC-SIGNUP-06 note.** A coaching centre of 400 students behind one NAT IP must not be rate-limited as an attacker. Per-IP limits alone are wrong here.

---

### FR-TAX — Taxonomy and syllabus

| ID | Tier | Requirement |
|---|---|---|
| **FR-TAX-01** | MVP | The content hierarchy MUST be Subject → Chapter → Topic → Sub-topic. The sub-topic is the SRS card key. |
| **FR-TAX-02** | MVP | Items MUST be cross-taggable to multiple exams. A single item may belong to both a JEE and a NEET taxonomy path. |
| **FR-TAX-03** | MVP | The taxonomy MUST NOT assume a single tree shared across exams. JEE and NEET have overlapping but different chapter structures. |
| **FR-TAX-04** | P1.5 | Syllabus MUST be a versioned first-class object keyed by `(exam, year)`. An item tagged to a chapter that leaves the syllabus in 2027 MUST remain scorable in a PYQ replay while being excluded from a 2027 blueprint. |
| **FR-TAX-05** | MVP | Items MUST carry `authored_difficulty` and, separately, `empirical_difficulty_p`. The delta is an author-calibration signal, so they MUST NOT share a column. |
| **FR-TAX-06** | MVP | Items MUST carry exam cross-tags, PYQ paper/year/shift/question-number where applicable, and question type. |

**AC-TAX-01** — A PYQ from 2019 tagged to a chapter removed in 2027 scores correctly in a replay and does not appear in a 2027 blueprint draw.

> **Gap.** FR-TAX-04 was identified by the critic as unresearched. The 2025 NEET syllabus reduction and restoration, and NCERT/NTA divergence, need a dedicated research pass before this is implemented.

---

### FR-ITM — Item model and versioning

| ID | Tier | Requirement |
|---|---|---|
| **FR-ITM-01** | MVP | Item identity MUST be separate from item content. `question(id)` is stable; `question_version(id, question_id, version_no, …)` holds content. |
| **FR-ITM-02** | MVP | A published `question_version` MUST be immutable. A content edit forks a new version and resets item statistics. A metadata-only edit updates in place. |
| **FR-ITM-03** | MVP | Options MUST have stable UUID identity. Answers MUST NEVER be stored or transmitted as positional indices or letters. |
| **FR-ITM-04** | MVP | Items MUST NEVER be hard-deleted. Retirement is a status transition; retired versions remain readable because past attempts depend on them. Foreign keys MUST use `ON DELETE RESTRICT` where an attempt exists. |
| **FR-ITM-05** | MVP | The item lifecycle MUST be `DRAFT → IN_REVIEW → CHANGES_REQUESTED → APPROVED → PUBLISHED → FLAGGED → RETIRED`. |
| **FR-ITM-06** | MVP | Provenance MUST be non-nullable: one of `ORIGINAL`, `PYQ_NTA`, `LICENSED`, `THIRD_PARTY_UNCLEARED`, with a `source_ref`. `THIRD_PARTY_UNCLEARED` MUST NOT publish. |
| **FR-ITM-07** | MVP | `licence_status` MUST be a filter on the serving query, so an entire provenance class can be dark-launched with a single flag change. |
| **FR-ITM-08** | MVP | Shared stems (comprehension paragraphs, matching lists) MUST be referenced by a single `question_stimulus` row, never duplicated across child items. |
| **FR-ITM-09** | MVP (schema) / P1.5 (content) | Translations MUST be versioned *children* of the English version. Answer keys and marks MUST live only on the English parent, which is authoritative on ambiguity — mirroring NTA's own rule. |
| **FR-ITM-10** | MVP | Option shuffling MUST be an authored property defaulting to **off**, with `option_group` for options that move together and `pinned_position` for options that must stay last. |
| **FR-ITM-11** | MVP | An authoring-time linter MUST scan option text for order-dependent phrasing ("all of the above", "none of these", "both (A) and (C)") and force `shuffle_options = false` with a visible warning. Matching, assertion-reason, sequencing and comprehension types are hard-coded non-shufflable. |
| **FR-ITM-12** | MVP | Every item MUST carry alt-text and a spoken-text string for accessibility. |
| **FR-ITM-13** | P1.5 | Near-duplicate detection MUST run on ingest: normalised-stem hash, MinHash/Jaccard, and embedding cosine similarity, plus perceptual hashing for images. Results surface as a **warning**, never a block — `VARIANT_OF` is an asset, not a defect. |

**AC-ITM-01** — Editing a published item that has attempts produces a new version and requires an explicit admin choice between "future attempts only" (default) and "void and rescore". The admin sees an attempt-count warning first.
**AC-ITM-02** — A contract test asserts that a shuffled attempt and an unshuffled attempt with the same answers score identically.
**AC-ITM-03** — Attempting to hard-delete an item with attempts raises a foreign-key error, not a cascade.

**Traces:** EC-DATA-04, EC-RAND-02, EC-IP-01, EC-IP-02, EC-IP-03.

---

### FR-MTH — Mathematical, chemical and image content

| ID | Tier | Requirement |
|---|---|---|
| **FR-MTH-01** | MVP | LaTeX MUST be pre-rendered server-side on write, storing `body_html`, `body_mathml` and `plain_text` alongside the LaTeX source. Rendering MUST NOT happen per-view at runtime. |
| **FR-MTH-02** | MVP | Server-side LaTeX validation MUST be a hard publish gate. A version failing strict validation MUST NOT publish, and the failure MUST be stored with the error detail. |
| **FR-MTH-03** | MVP | At render time the client MUST use non-throwing mode with a per-question error boundary, so one bad item can never crash an attempt. On fallback, show the raw source in monospace plus a "Report this question" action, and auto-create an incident. |
| **FR-MTH-04** | MVP | Macro definitions MUST NOT persist between questions. Each render gets a fresh macro scope. |
| **FR-MTH-05** | MVP | RN MUST use at most **one** WebView per screen with a locally bundled renderer. A WebView per list row is prohibited — WebViews cost 150–200 MB each and the 2026 India baseline device has 4 GB RAM. Non-mathematical prose MUST render as native text. |
| **FR-MTH-06** | MVP | Chemistry notation (mhchem-style) MUST render in the same pipeline as mathematics. |
| **FR-MTH-07** | MVP | Question images MUST be pre-resized server-side to a small fixed set of widths at upload. Transform-on-read MUST NOT be used at scale. |
| **FR-MTH-08** | MVP | Questions MUST NOT be delivered as PDFs. |
| **FR-MTH-09** | P1.5 | A MathML output path MUST exist for screen readers, with a per-expression spoken-text override. |

**AC-MTH-01** — A 15-line LaTeX question reaches first paint in under 400 ms on the reference low-end Android device.
**AC-MTH-02** — Publishing a paper containing any item that fails LaTeX validation is refused by CI, not just by the UI.
**AC-MTH-03** — A question whose LaTeX is deliberately corrupted renders a fallback and reports an incident; the attempt continues normally.

**Traces:** EC-DATA-06.

> **Rationale for FR-MTH-08.** PDF delivery is the single root cause of the category's worst UX complaints — laggy, non-zoomable, position-losing viewers in incumbent apps.

---

### FR-AUT — Authoring and editorial workflow

| ID | Tier | Requirement |
|---|---|---|
| **FR-AUT-01** | MVP | The admin console MUST provide LaTeX-first rich-text authoring with a live preview that uses the **same renderer version** as the student client. Editor and reader MUST NOT be able to disagree. |
| **FR-AUT-02** | MVP | A virtual mathematics keyboard MUST be available for authors who do not write LaTeX fluently. |
| **FR-AUT-03** | MVP | Publication MUST require a second approver. `approved_by <> created_by` MUST be enforced as a database CHECK constraint, not application logic. |
| **FR-AUT-04** | MVP | Per-option rationales (why each distractor is wrong) MUST be a mandatory authoring field, not optional. |
| **FR-AUT-05** | MVP | Version history MUST show a content diff and require an explicit fork-vs-update decision. |
| **FR-AUT-06** | P1.5 | An OCR ingestion pipeline MUST convert scanned papers into DRAFT items, presenting a side-by-side original-crop vs rendered-LaTeX diff for human verification. |
| **FR-AUT-07** | P1.5 | The pipeline MUST instrument `edits_per_ingested_item` as the content-operations north-star metric. |
| **FR-AUT-08** | MVP (own format) / P1.5 (GIFT) | Bulk import MUST support a documented native JSON/CSV format with explicit LaTeX and image-URL fields. GIFT and Moodle XML follow only if demand appears. |
| **FR-AUT-09** | P1.5 | Blueprint-driven paper assembly MUST support constraints on chapter counts, difficulty histogram, PYQ-year spread, key balance, variant-family exclusion and recency exclusion, with a "why this item" explanation panel and manual override. |

**AC-AUT-01** — A single admin account cannot author and publish the same item. Attempting it raises a constraint violation.
**AC-AUT-02** — An item authored in the console renders byte-identically in the student client.

> **Unresourced dependency.** FR-AUT-04 at 100k items is roughly 400k rationales — ₹1.2–6 crore at Indian SME rates. This is the largest uncosted line in the plan and the critic flagged it as potentially invalidating the headline differentiator. An AI-drafted-then-human-reviewed pipeline is the obvious answer and has not been researched. **This must be resolved before committing to bank size.**

---

### FR-PAT — Exam patterns and marking rules

| ID | Tier | Requirement |
|---|---|---|
| **FR-PAT-01** | MVP | Exam structure MUST be data: `exam_pattern(exam, year, paper) → pattern_section(ordinal, name, question_count, max_marks, question_type) → marking_rule(jsonb)`. |
| **FR-PAT-02** | MVP | A pattern change for a future year MUST be achievable by an admin as an INSERT, with **no application release**. |
| **FR-PAT-03** | MVP | The marking rule schema MUST express: full marks, negative marks, zero-on-unanswered, a partial-credit ladder, numeric precision, and whether negative marking applies to numeric responses. |
| **FR-PAT-04** | MVP | The marking rule MUST be attached to the `(test_section, question)` join, not to the item and not to global configuration. A single item cross-tagged into a JEE Main paper and a NEET paper MUST score differently in each. |
| **FR-PAT-05** | MVP | v1 MUST implement JEE Main (MCQ +4/−1; Section B numeric +4/0) and NEET (+4/−1). |
| **FR-PAT-06** | P2 | v2 MUST implement JEE Advanced's four distinct scoring engines including the partial ladder (+4 full, +3/+2/+1 partial) with the **current** negative value, which moved from −2 to −1 between 2025 and 2026. |
| **FR-PAT-07** | MVP | The entire `test_questions` scoring configuration MUST be snapshotted into the attempt result as a `scoring_config_hash`, so a later configuration change cannot silently alter historical scores. |
| **FR-PAT-08** | MVP | A publish-time validator MUST refuse a paper where the sum of section max-marks does not equal the declared total, where any item lacks a scheme, or where any multi-correct item lacks an explicit partial policy. |
| **FR-PAT-09** | MVP | An admin-editable exam calendar MUST exist, recording sessions, shifts, cancellations and re-exams. |

**AC-PAT-01** — A golden test suite, generated from verbatim published papers, scores a seeded historical paper identically to the official key across 100 synthetic attempts.
**AC-PAT-02** — The scoring function is a pure function of `(attempt, key_version, scoring_config_hash)` with no reference to wall-clock time or global configuration.

**Traces:** EC-DATA-08.

> **Verification note.** JEE Advanced 2026 Section 2 negative marking is **−1**, confirmed from the primary jeeadv.ac.in PDF. Widely-published secondary sources including pw.live and aakash.ac.in still state −2, and the proportional formula `4 × correct/total` that circulates online is wrong. Author the golden suite from primary PDFs only.

---

### FR-TST — Test assembly and lifecycle

| ID | Tier | Requirement |
|---|---|---|
| **FR-TST-01** | MVP | Test lifecycle MUST be `create → schedule → publish (freeze) → run → close → score → publish results → rescore`. |
| **FR-TST-02** | MVP | Publishing a strict-ranked test MUST freeze its composition. A database trigger MUST raise on any write to the test's item set after `published_at` is set. |
| **FR-TST-03** | MVP | A live test MUST have exactly one absolute `starts_at` and one `ends_at`. Per-timezone windows are prohibited. |
| **FR-TST-04** | MVP | The UI MUST render both the canonical IST time and the viewer's local time side by side. |
| **FR-TST-05** | MVP | `ranking_mode` MUST be explicit: `strict` (identical item set for all attempts, only presentation order randomised — leaderboard valid) or `pooled` (per-student draw from a larger pool — leaderboard is percentile-within-pool and MUST display a "randomised paper" badge). |
| **FR-TST-06** | MVP | A `late_join_cutoff` MUST prevent new attempts starting materially truncated papers. Late joiners MUST see a blocking confirmation stating their actual available time, and their attempts MUST be tagged `shortened` and excluded from the ranked leaderboard. |
| **FR-TST-07** | MVP | Attempt policy MUST be configurable: max attempts, which attempt is ranked (default: first), cooldown between attempts. Only one attempt per student per test may be ranked, enforced by a partial unique index. |
| **FR-TST-08** | MVP | `solutions_visible_from` MUST gate solution and key visibility. For a live test this MUST be no earlier than window close for everyone. |
| **FR-TST-09** | MVP | Mid-window changes MUST create `test_version = N+1`, applying by default only to attempts started afterwards. Each attempt records its `test_version`. |
| **FR-TST-10** | MVP | Paper composition MUST be resolved once at attempt start, never lazily at render time. |

**AC-TST-01** — An attempt to modify a published strict-ranked paper raises a database exception.
**AC-TST-02** — A student starting at 15:40 for a 14:00–17:00 window sees an explicit "you will have 1h 20m, not 3h" confirmation before any question is revealed.

**Traces:** EC-RAND-05, EC-FAIR-04, EC-FAIR-05, EC-FAIR-08, EC-FAIR-10.

---

### FR-ATT — The attempt: CBT player, timer, session

> Applies to **WEB** for ranked mocks (D2). RN implements only the untimed practice variant, FR-PRC.

| ID | Tier | Requirement |
|---|---|---|
| **FR-ATT-01** | MVP | The player MUST replicate the NTA CBT interface: the five-state question palette (Not Visited, Not Answered, Answered, Marked for Review, Answered and Marked for Review) with matching colour semantics, Save & Next, Mark for Review & Next, Clear Response, section tabs, auto-advance on section-last Save & Next, a Question Paper view, an instructions screen, and a submit-confirmation summary. |
| **FR-ATT-02** | MVP | Clicking a palette entry MUST navigate **without saving** the current response, matching NTA behaviour. This is the most commonly mis-implemented fidelity detail. |
| **FR-ATT-03** | MVP | `marked_for_review` and `visited` MUST be columns orthogonal to the answer. Scoring MUST read only the answer fields and MUST be provably blind to `marked_for_review`. |
| **FR-ATT-04** | MVP | The submit confirmation MUST show counts per state (Answered / Not Answered / Marked) and require an explicit confirm. |
| **FR-ATT-05** | MVP | An on-screen virtual numeric keypad MUST be provided for numeric-response questions, emitting ASCII digits regardless of device locale. **No calculator** — NTA banned calculators across all three exams. |
| **FR-ATT-06** | MVP | The deadline MUST be server-authoritative: `deadline_at = min(started_at + duration, test.ends_at)`, set once at attempt creation and immovable by any client action. |
| **FR-ATT-07** | MVP | The client countdown MUST derive from a monotonic clock offset captured once, never from device wall-clock time, and MUST reconcile against the server on every heartbeat. |
| **FR-ATT-08** | MVP | Heartbeat and answer-sync MUST be a **single** HTTP request, at an adaptive interval (60 s normally, 30 s in the final ten minutes), with jitter. Per-second heartbeats are prohibited. |
| **FR-ATT-09** | MVP | Pausing a ranked attempt MUST be structurally impossible. This MUST be stated explicitly on the pre-attempt screen. Practice mode uses a separate accumulated-elapsed model implemented as a distinct code path. |
| **FR-ATT-10** | MVP | Question order and option order MUST be materialised server-side once at attempt start from a seeded shuffle where `seed = hmac(server_secret, attempt_id)`, persisted on the attempt row. The seed MUST NEVER be sent to the client. |
| **FR-ATT-11** | MVP | The order MUST be identical on every resume, every device and after reinstall, for the attempt and for the post-submission review. |
| **FR-ATT-12** | MVP | The wire format for a response MUST be `{question_version_id, option_id}`. The server MUST assert that each submitted `question_version_id` is a member of that attempt's persisted order, rejecting with 422 otherwise. |
| **FR-ATT-13** | MVP | Attempt start MUST be idempotent, guarded by a client-supplied idempotency key **and** a partial unique index on `(user_id, test_id) WHERE status = 'in_progress'`. A duplicate call returns the existing attempt. |
| **FR-ATT-14** | MVP | Attempt start MUST return an asset manifest with hashes and byte sizes. The client MUST prefetch all assets before the timer starts, showing determinate progress. |
| **FR-ATT-15** | MVP | Resume on a different device MUST be supported with explicit session takeover: the new session wins, the previous session receives a distinct status and goes read-only. |
| **FR-ATT-16** | MVP | The access token MUST outlive the attempt, or an attempt-scoped write token MUST be issued with an expiry of `deadline_at + grace`. A student MUST NOT be logged out mid-exam by token expiry. |
| **FR-ATT-17** | MVP | Token refresh MUST be single-flighted. Concurrent refreshes with the same rotating token cause the whole session to be revoked as suspected compromise. |
| **FR-ATT-18** | MVP | An attempt with zero answers and zero recorded question views MUST finalise as `abandoned`, excluded from scores, averages, analytics and the leaderboard, and MUST NOT consume the ranked-attempt slot. |
| **FR-ATT-19** | MVP | An explicit "Abandon this attempt" action MUST be available in the first five minutes with a clear warning. |
| **FR-ATT-20** | MVP | OTA updates and deploys MUST be frozen during live test windows, derived automatically from the test calendar. |

**AC-ATT-01** — Setting the device clock back 45 minutes mid-attempt grants no additional time.
**AC-ATT-02** — Killing the app at minute 100 of a 180-minute paper and relaunching at minute 140 shows 40 minutes remaining, not 80.
**AC-ATT-03** — Double-tapping Start on a slow network produces exactly one attempt row.
**AC-ATT-04** — A scripted client sending positional indices is rejected with 422.
**AC-ATT-05** — The post-submission review renders content and ordering pixel-identical to what was on screen during the attempt.

**Traces:** EC-TIMER-01 through EC-TIMER-10, EC-SESSION-01 through EC-SESSION-06, EC-DATA-09, EC-DATA-10, EC-DATA-11, EC-DATA-12, EC-RAND-01, EC-RAND-04, EC-FAIR-06, EC-NOTES-03, EC-HERD-07.

---

### FR-SYN — Sync, offline and resilience

| ID | Tier | Requirement |
|---|---|---|
| **FR-SYN-01** | MVP | Answers MUST be written to local durable storage before optimistic UI update, and synced in batches. |
| **FR-SYN-02** | MVP | Each local operation MUST carry a monotonic `client_seq`. Out-of-order arrivals MUST be **dropped by the sequence guard**, never applied. |
| **FR-SYN-03** | MVP | A batch sync MUST be atomic within a single database transaction and MUST return a per-operation result array. The client clears only acknowledged operations. |
| **FR-SYN-04** | MVP | Batch size MUST be capped so the server-side call stays well inside the platform's per-request CPU ceiling. |
| **FR-SYN-05** | MVP | The client MUST show a passive "N answers pending" indicator. A per-answer error toast is prohibited. |
| **FR-SYN-06** | MVP | Answers received after `deadline_at + grace` MUST be rejected. The grace period MUST be a documented constant. |
| **FR-SYN-07** | MVP | A server-side sweeper MUST finalise attempts whose deadline has passed, running frequently, batched, with row-level skip-locking. No client may be trusted to call submit. |
| **FR-SYN-08** | MVP | All client retries MUST use full-jitter exponential backoff with a capped attempt count and a client-side retry token bucket. Fixed-delay retry is prohibited. |
| **FR-SYN-09** | MVP | The system MUST remain correct if the sync API is unavailable for 20 minutes: the client keeps writing locally and the sweeper still finalises correctly. |
| **FR-SYN-10** | MVP | Offline availability MUST be limited to **untimed practice and SRS review only**. Ranked mocks are online-only, served per-section where sections are time-locked, and never cached. |
| **FR-SYN-11** | MVP | Prefetch scope MUST equal the widest set of content the student may legally navigate to at that moment. Keys and solutions MUST NEVER be in any prefetch payload. |

**AC-SYN-01** — A 25-minute offline period mid-attempt loses no answers and grants no extra time.
**AC-SYN-02** — Answering Q17 as B, then D, then going offline and changing to A, results in A — not a later-arriving B or D.
**AC-SYN-03** — Killing the sync endpoint for the last 20 minutes of a test still produces correct, complete results for every attempt.

**Traces:** EC-NET-01 through EC-NET-10, EC-DATA-01, EC-DATA-04 (scale-security), EC-HERD-04.

---

### FR-SCR — Scoring, ranking and rescore

| ID | Tier | Requirement |
|---|---|---|
| **FR-SCR-01** | MVP | Submission MUST be decoupled from scoring. Finalisation is an O(1) status flip that enqueues a durable message; scoring runs in bounded workers using set-based SQL. |
| **FR-SCR-02** | MVP | Scoring MUST be a pure, idempotent function of `(attempt_id, answer_key_version)`, written through an upsert so replay is always safe. |
| **FR-SCR-03** | MVP | A reconciler MUST periodically find submitted attempts lacking results and re-enqueue them. Messages exceeding a read-count threshold MUST route to a dead-letter queue with an admin alert. |
| **FR-SCR-04** | MVP | The student MUST see "Score being computed" with an ETA, never a bare indefinite spinner. |
| **FR-SCR-05** | MVP | Numeric responses MUST store the raw input verbatim **and** a normalised canonical form. Normalisation MUST include Unicode NFKC, mapping of Unicode minus variants to ASCII, whitespace and thousands-separator stripping, and decimal (not floating-point) parsing. |
| **FR-SCR-06** | MVP | Numeric tolerance MUST be data per question: either an absolute tolerance or a decimals-plus-rounding-mode specification. String equality is prohibited. |
| **FR-SCR-07** | MVP | Percentile MUST be computed on the **total** raw score per cohort, to the published precision. It MUST NOT be an average of subject percentiles. |
| **FR-SCR-08** | MVP | `positive_marks_earned` MUST be persisted separately from the net score. It cannot be backfilled and is required for JEE Advanced tie-breaking in v2. |
| **FR-SCR-09** | MVP | Tie-breaking MUST use an explicit, published, deterministic chain ending in a stable identifier so ordering is never ambiguous. The chain MUST be exam-specific and MUST be visible in the UI. |
| **FR-SCR-10** | MVP | Leaderboards MUST be materialised into immutable snapshots with an atomic pointer swap. Live leaderboard rows MUST NEVER be mutated in place. |
| **FR-SCR-11** | MVP | Answer keys MUST be immutable versioned rows. A correction creates version N+1 and enqueues a rescore. |
| **FR-SCR-12** | MVP | Rescore MUST write **new** result rows, never overwrite, then atomically swap the published pointer and emit a new leaderboard snapshot in one transaction. |
| **FR-SCR-13** | MVP | Rescore MUST support three key-revision flags with distinct eligible populations: `MULTI_KEY` (credit anyone selecting any correct option), `ALL_CORRECT` (credit all who attempted), `DROPPED` (credit all who appeared). |
| **FR-SCR-14** | MVP | Voiding MUST require an explicit recorded policy per void: full marks to all, full marks to attempted only, or drop and rescale. |
| **FR-SCR-15** | MVP | Every affected student MUST receive a notification carrying an explicit before/after delta and the reason. |
| **FR-SCR-16** | MVP | Reward adjustments arising from a rescore MUST be **compensating top-ups only**. Clawback is prohibited — it is a worse trust event than the original error. |
| **FR-SCR-17** | MVP | The review screen MUST display server-computed per-question marks. Scores MUST NEVER be computed on the client. |
| **FR-SCR-18** | MVP | The review screen MUST show the marks-awarded breakdown in plain language, explaining partial credit where it applies. |

**AC-SCR-01** — A simulated key revision rescores 10,000 synthetic attempts idempotently, re-emits ranks, writes an audit trail, and produces zero drift on a second run.
**AC-SCR-02** — The numeric comparator passes a fixture set of pathological inputs (Devanagari digits, Unicode minus, comma separators, `2.50` vs `2.5`, `1/2`, scientific notation) as a CI gate.
**AC-SCR-03** — A student's displayed rank does not change between page loads for an unchanged snapshot.

**Traces:** EC-DATA-02, EC-DATA-03, EC-DATA-07, EC-DATA-08, EC-FAIR-01, EC-FAIR-02, EC-FAIR-03, EC-HERD-08.

---

### FR-PRC — Practice and custom test builder

| ID | Tier | Requirement |
|---|---|---|
| **FR-PRC-01** | MVP | The full previous-year-question bank MUST be available on the free tier, tagged by exam, year, chapter, topic, difficulty and question type. |
| **FR-PRC-02** | MVP | A custom test builder MUST support filtering by **question state**: unused, incorrect, correct, marked, and correct-but-guessed. |
| **FR-PRC-03** | MVP | The builder MUST offer Tutor Mode (solution revealed immediately after each question) and Timed Mode as distinct behaviours. |
| **FR-PRC-04** | MVP | Every filter chip MUST show a live matching count. |
| **FR-PRC-05** | MVP | When a filter combination returns too few items, the system MUST relax constraints and state explicitly which constraint it widened. A bare empty state on the headline feature is prohibited. |
| **FR-PRC-06** | MVP | Practice sessions MUST support a small guaranteed-completable daily target (on the order of ten questions or one card session), separate from any full-length mock. |
| **FR-PRC-07** | P1.5 | Practice item selection MAY use an Elo-style difficulty rating with decaying K. Adaptive *testing* (CAT) is out of scope. |

**AC-PRC-01** — "Rotational Motion + Hard + Unattempted + PYQ 2019–2023" against a sparse bank returns a relaxed result set with a visible "we widened the year range" banner, never zero results with no explanation.

> **Cold start.** Both the SRS scheduler and any Elo-style difficulty model have a cold-start problem for the *student*, not just the item. A diagnostic placement flow is unresearched and is Phase 2 scope.

---

### FR-SRS — Spaced repetition

| ID | Tier | Requirement |
|---|---|---|
| **FR-SRS-01** | MVP | Review cards MUST be keyed on `(user_id, sub_topic_id)`, not on the question. |
| **FR-SRS-02** | MVP | Cards MUST be created automatically from wrong answers, marked-for-review questions and formulas. |
| **FR-SRS-03** | MVP | When a card falls due, the engine MUST serve a **fresh unseen** item of matched difficulty from that sub-topic, drawn against a per-student seen ledger. |
| **FR-SRS-04** | MVP | Scheduling state MUST survive item content corrections. Editing a question MUST NOT invalidate any student's review history. |
| **FR-SRS-05** | MVP | The review log MUST be retained as the retraining corpus for scheduler parameters. |
| **FR-SRS-06** | MVP | The SRS grade MUST NOT be derived from response time in a form that penalises off-screen rough work. See the rough-work constraint below. |
| **FR-SRS-07** | P1.5 | Desired retention MAY ramp as the student's declared exam date approaches. |
| **FR-SRS-08** | P1.5 | A change to the student's exam date MUST trigger a batch re-plan with interval smoothing, never a naive re-target that makes thousands of cards simultaneously due. |
| **FR-SRS-09** | MVP | "Revisit this exact question" MUST be a separate bookmark/redo feature, distinct from the scheduler. |

**AC-SRS-01** — Correcting a typo in a published item leaves every student's card state unchanged.
**AC-SRS-02** — A student never receives the same item twice through the scheduler while unseen items remain in that sub-topic.

> **Rough-work constraint (FR-SRS-06).** A 3-hour mock needs roughly 15 sheets of paper. `time_spent_ms` measures time with the question *visible*, not time thinking. A student working on paper for four minutes generates a spurious "fast answer". This corrupts the overtime flag, the cohort-median comparison and any time-derived SRS grade — and on Android, putting the phone down triggers the background transition the integrity layer records as a cheating signal. **The most diligent students look most like cheaters.** Mitigation: model rough work explicitly with an in-app scratchpad that keeps the app foregrounded and produces an honest dwell signal, and do not derive grades from response time on paper-heavy subjects.

---

### FR-NTS — Notes and bookmarks

| ID | Tier | Requirement |
|---|---|---|
| **FR-NTS-01** | MVP | Students MUST be able to bookmark items. |
| **FR-NTS-02** | MVP | A persistent notebook MUST support rich text and LaTeX, with full-text search and backlinks to source questions. |
| **FR-NTS-03** | MVP | In-attempt notes MUST be supported. |
| **FR-NTS-04** | MVP | The note editor MUST fetch **only** the question stem during an attempt. It MUST NOT join to, embed, or prefetch solution or key data under any circumstance. |
| **FR-NTS-05** | MVP | Note edits MUST never silently overwrite student text. Concurrent edits produce a recorded conflict, not a lost write. |

**AC-NTS-01** — A student JWT hitting the data API directly during an in-progress attempt returns 403 or empty on every solution and key column. Asserted in CI.

**Traces:** EC-NOTES-01, EC-NOTES-02, EC-NOTES-04.

> **Search gap.** FR-NTS-02 is harder than it looks. LaTeX is not usefully searchable by standard full-text indexing — you cannot text-index `\frac{d}{dx}` and get useful recall. Formula search needs a normalised symbolic index or embeddings. Postgres also ships no Devanagari stemmer, which affects FR-ITM-09 content later. Unresearched; Phase 2 scope.

---

### FR-SOL — Solutions

| ID | Tier | Requirement |
|---|---|---|
| **FR-SOL-01** | MVP | Every published item MUST have a text solution. |
| **FR-SOL-02** | MVP | Per-option rationales MUST explain why each distractor is wrong. |
| **FR-SOL-03** | MVP | A video solution link MAY be attached. The link MUST live on the solutions table, never on the item row. |
| **FR-SOL-04** | MVP | Solution video links MUST be opened by deep-link-out, not an embedded player, for under-18 sessions. The standard embedded player transmits platform identifiers and may serve interest-based advertising to a child. |
| **FR-SOL-05** | MVP | Solutions, keys and video URLs MUST be unreadable while any attempt containing that item is in progress. This MUST be enforced by RLS **and** by revoking direct grants and exposing them only through a state-checking RPC. |
| **FR-SOL-06** | MVP | The client MUST NEVER issue a select-all against the items table. Explicit column lists or a dedicated attempt view that physically excludes solution columns. |
| **FR-SOL-07** | P1.5 | A link-health crawler MUST detect dead video links and flag them, with a documented fallback. |

**AC-SOL-01** — An automated test hits the data API with a student JWT mid-attempt and asserts 403 or empty on every solution column, including the video URL and its metadata.

**Traces:** EC-NOTES-04, EC-LEAK-01.

> **Unresearched.** Video hosting economics, the third-party platform's terms of service around monetising a paid experience built on content you do not own, and the fact that video platforms are blocked on many coaching-centre and school networks. Phase 2 scope.

---

### FR-ANL — Student analytics

| ID | Tier | Requirement |
|---|---|---|
| **FR-ANL-01** | MVP | Results MUST show raw score (negative-capable), percentile computed by the official method, subject-wise percentiles and a section breakdown. |
| **FR-ANL-02** | MVP | Time-per-question MUST be shown against the cohort median, with an overtime flag. |
| **FR-ANL-03** | MVP | Students MUST be able to self-tag each reviewed question with a mistake taxonomy: conceptual, calculation, misread, silly, guessed-right, unattempted. |
| **FR-ANL-04** | MVP | Analytics MUST be prescriptive, not decorative. A chapter-weightage-versus-accuracy view MUST resolve to a concrete "study these next" recommendation. |
| **FR-ANL-05** | MVP | Only ranked attempts MUST feed mastery analytics. Re-attempts MUST be badged and excluded. |
| **FR-ANL-06** | P1.5 | Confidence tagging before submission (sure / unsure / guessed) MAY feed an accuracy-by-confidence matrix. |
| **FR-ANL-07** | P1.5 | Predicted percentile and rank MUST be anchored to published national marks-versus-percentile data, MUST carry a confidence interval, and MUST state the cohort size it is based on. A naive extrapolation over a self-selected cohort is prohibited. |
| **FR-ANL-08** | P1.5 | Any shareable number MUST carry a result version and resolve, via a short link, to the current annotated result with a public revision log. |

**AC-ANL-01** — A student who screenshots a rank and later has it revised by an upheld key challenge has a share link that resolves to the corrected value with an explanation, not a stale number.

> **Regulated claim.** Predicted rank is simultaneously the most-shared artefact and a regulated representation. Coaching-sector guidelines prohibit false statements of ranks, and advertising standards require a "past record is no guarantee" disclaimer. FR-ANL-07 and FR-ANL-08 exist because of this, not for UX polish.

---

### FR-RWD — Rewards, streaks, leaderboards

| ID | Tier | Requirement |
|---|---|---|
| **FR-RWD-01** | MVP | Coins MUST be earn-only, non-purchasable, non-transferable and non-convertible. The earn-reason enumeration MUST NOT contain a purchase origin, making a purchase-derived credit structurally impossible at the database level. |
| **FR-RWD-02** | MVP | Coin sinks MUST be in-app utility only. No cash, vouchers, or third-party goods. |
| **FR-RWD-03** | MVP | The coin ledger MUST be append-only with a natural idempotency key, so a retried grant cannot double-credit. |
| **FR-RWD-04** | MVP | Earn rules MUST be a whitelist with per-action values, daily and lifetime caps, and a **global daily mint cap** that bounds farm damage even when abuse goes undetected. |
| **FR-RWD-05** | MVP | Coins MUST NEVER be bundled inside a purchasable subscription SKU. |
| **FR-RWD-06** | MVP | Streaks MUST be earnable by a small daily action, not by completing a full-length mock. |
| **FR-RWD-07** | MVP | Streak forgiveness MUST be generous and bounded: auto-applied freezes replenished on a schedule, effort-based repair (not paid repair), and schedulable rest days. |
| **FR-RWD-08** | MVP | Leaderboards MUST be bucketed peer groups of roughly thirty, pseudonymous, opt-in, with a one-tap permanent opt-out. |
| **FR-RWD-09** | MVP | A public all-India rank wall is **prohibited**. |
| **FR-RWD-10** | MVP | The primary always-visible metric MUST be personal improvement (percentile delta against the student's own recent history, chapter mastery). Competitive comparison is secondary and optional. |
| **FR-RWD-11** | MVP | Gamification MUST be confined to low-stakes practice and MUST NOT appear on a mock result screen. |
| **FR-RWD-12** | MVP | The entire rewards module MUST sit behind a documented kill switch that is a configuration change, not a re-architecture. |
| **FR-RWD-13** | MVP | The system MUST auto-suspend streak breakage, league relegation, leaderboards and re-engagement notifications for any student whose declared exam is imminent or in progress, driven by the admin exam calendar. |
| **FR-RWD-14** | MVP | Prize contests and giveaways are **out of scope for v1**. |

**AC-RWD-01** — There is no code path, and no enum value, by which a coin balance can increase as a result of a payment.
**AC-RWD-02** — A student who writes NEET on 3 May and does not open the app until 6 May does not lose their streak, is not relegated, and receives no re-engagement push in that window.
**AC-RWD-03** — Nightly ledger reconciliation reports zero drift; drift raises an alarm.

**Traces:** EC-REWARD-01, EC-REWARD-02, EC-REW-01 through EC-REW-04, EC-DPDP-03, EC-OPS-01.

> **Legal basis.** The Promotion and Regulation of Online Gaming Act 2025 captures "other stakes" including coins equivalent or convertible to money; skill is irrelevant; exposure includes personal officer liability and the constitutional challenge is pending. FR-RWD-01 and FR-RWD-05 together are the single invariant that keeps the platform outside that Act, outside the app stores' virtual-currency expiry rules, and outside the GST actionable-claim analysis. FR-RWD-08 through FR-RWD-13 respond to documented student-wellbeing obligations and to state coaching legislation.

---

### FR-ADM — Admin control planes

The twelve planes from ideation §8. Each is stated here as its v1 requirement floor; the full surface is Phase 2–4.

| ID | Tier | Requirement |
|---|---|---|
| **FR-ADM-01** | MVP | **Content plane.** Author, review, approve, publish, flag, retire. Never delete. Version history with diff. Provenance and licence gating. |
| **FR-ADM-02** | MVP | **Assessment-design plane.** Pattern and marking-rule authoring as data, with save-time validation (FR-PAT-08). |
| **FR-ADM-03** | MVP | **Test-lifecycle plane.** Sections, durations, windows, ranking mode, attempt policy, solutions-visible-from, publish freeze. |
| **FR-ADM-04** | MVP | **Live-operations plane.** Live attempt count and completion curve, incident stream, per-attempt inspector that replays the exact paper a student saw, and the actions in FR-ADM-05. |
| **FR-ADM-05** | MVP | **Compensation console.** Grant a deadline extension (audited, mandatorily linked to an incident), offer an equivalent re-attempt, or exclude an attempt from ranking. |
| **FR-ADM-06** | MVP | Platform-caused time loss MUST be measured, not negotiated: per-attempt lost seconds derived from incident rows and corroborated against server-observed error rates, with an automatic compensation ladder published in the terms before launch. A student's own poor network MUST NOT be compensated. |
| **FR-ADM-07** | MVP | **Key-and-rescore plane.** Key versioning, challenge triage queue ranked by distinct challenger count and by statistical signal, rescore and void consoles per FR-SCR-11 to FR-SCR-16. |
| **FR-ADM-08** | MVP | Every challenge resolution MUST write a public note visible to every challenger. |
| **FR-ADM-09** | P1.5 | **Psychometrics plane.** Per-cohort item statistics (difficulty index, discrimination, distractor analysis), gated at a minimum case count, routed to a human review queue with a recorded disposition. Items MUST NEVER be auto-retired. |
| **FR-ADM-10** | P1.5 | Test-level reliability MUST be reported and MUST be suppressed below a minimum item count, because the statistic rises mechanically with item count and would otherwise mislead. |
| **FR-ADM-11** | MVP | **People plane.** User search, role assignment, ban with reason, session revoke, entitlement grant, appeals queue. |
| **FR-ADM-12** | MVP | **Commerce plane.** Per-storefront plans and prices with commission and GST modelled into list price, coupons, entitlement overrides, refunds. |
| **FR-ADM-13** | MVP | **Rewards plane.** Configuration per FR-RWD-04, plus nightly reconciliation with a drift alarm. |
| **FR-ADM-14** | MVP | **Moderation and integrity plane.** Error-report triage with SLA and disposition; image-failure aggregation with automatic void-review flagging above a threshold. |
| **FR-ADM-15** | P1.5 | Integrity signals (velocity outliers, wrong-answer similarity, device fingerprint reuse, sustained background episodes) MUST route to a human review queue. Automated leaderboard removal or banning is **prohibited** — a false positive on a genuine topper is catastrophic. |
| **FR-ADM-16** | P1.5 | Wrong-answer similarity MUST be scored against a batch- or institute-conditioned baseline, never a global one, and MUST NOT be acted upon without an independent second signal. |
| **FR-ADM-17** | MVP | **Communications plane.** Announcement broadcast, push composer with hard-enforced quiet hours and a blocked-phrase list for failure-framed copy, in-app status banners. A silent empty state is prohibited — content still being uploaded MUST say so with an ETA. |
| **FR-ADM-18** | MVP | **Governance plane.** Feature flags and per-module kill switches with an owner and expiry; a deploy-freeze calendar auto-derived from scheduled tests; an append-only trigger-enforced audit log across every plane. |
| **FR-ADM-19** | MVP | **Privacy console.** Consent ledger viewer, notice-version manager per language, data-subject-request queue with SLA, breach runbook with a running statutory timer, subprocessor register. |
| **FR-ADM-20** | MVP | An **"explain this decision" export** MUST assemble, for any disputed attempt, the pinned paper, shuffle seed, marking rules, key version, rescore history and audit trail into a single artefact. |
| **FR-ADM-21** | P1.5 | Bulk export MUST be asynchronous, paginated and streamed to storage. Large result sets MUST NOT go through the synchronous data API, which silently truncates. |
| **FR-ADM-22** | MVP | Admin analytics queries MUST NOT be able to lock or saturate the database serving a live exam. |

**AC-ADM-01** — Every mutation across all twelve planes appears in the audit log with actor, capability, entity, before/after and reason.
**AC-ADM-02** — A deadline extension cannot be granted without an incident reference.
**AC-ADM-03** — Opening a full-cohort analytics dashboard during a live 10,000-student mock does not degrade attempt-path latency.

**Traces:** EC-FAIR-01, EC-FAIR-02, EC-FAIR-07, EC-CHEAT-04, EC-COST-03, EC-OPS-02.

---

### FR-COM — Commerce

| ID | Tier | Requirement |
|---|---|---|
| **FR-COM-01** | MVP | A **single** paid tier. Multiple tiers are prohibited — they create entitlement bugs and "I paid and it isn't available" failures. |
| **FR-COM-02** | MVP | Purchase MUST be fully self-serve. No sales call is ever placed. This MUST be stated in-app. |
| **FR-COM-03** | MVP | The refund window MUST be published and honoured, with one-tap cancellation. |
| **FR-COM-04** | MVP | List price MUST be computed from net-revenue-backwards: store commission, GST, and payment-processor fees modelled explicitly before the price is set. |
| **FR-COM-05** | MVP | Entitlement MUST be honoured server-side from the platform's own subscription record, never from a client-supplied receipt. |
| **FR-COM-06** | MVP | Store-initiated refunds and revocations MUST automatically revoke entitlement. |
| **FR-COM-07** | MVP | Where a minor is the account holder, the contracting and paying party MUST be the verified guardian. |
| **FR-COM-08** | MVP | Dark patterns are prohibited: no resetting countdown timers, no pre-ticked auto-renew, no hidden cancellation. |
| **FR-COM-09** | MVP | GST invoicing MUST be generated with the correct service classification and place of supply from the declared state. |

**AC-COM-01** — Cancelling is reachable in no more than two taps from the account screen and takes effect without contacting support.

**Traces:** EC-PAY-01 through EC-PAY-04, EC-BIZ-01, EC-BIZ-02, EC-OPS-03.

> **Platform constraint.** In-app third-party payment for digital goods is prohibited on iOS. Web checkout honoured by account entitlement, with no in-app mention or link, is the compliant path. Verify the current Indian alternative-billing position on the Android side before implementation.

---

### FR-NOT — Notifications

| ID | Tier | Requirement |
|---|---|---|
| **FR-NOT-01** | MVP | Quiet hours MUST be enforced server-side and MUST NOT be overridable by campaign configuration. |
| **FR-NOT-02** | MVP | Frequency caps MUST be enforced per user across all channels. |
| **FR-NOT-03** | MVP | Notification timing MUST NOT be optimised per user by behavioural modelling for under-18 principals. |
| **FR-NOT-04** | MVP | Transactional notices (rescore, key revision, incident, refund) MUST be delivered reliably and MUST NOT be suppressed by marketing frequency caps. |
| **FR-NOT-05** | MVP | Push MUST NOT be the sole channel for time-critical information such as a live test start. An in-app surface MUST carry the same information. |
| **FR-NOT-06** | P1.5 | A second delivery channel MUST be evaluated for time-critical notices. |

> **Delivery reality.** Push is unreliable on exactly the devices this market uses — several Chinese OEM Android skins aggressively kill background processes and drop push delivery. FR-NOT-05 exists because of this. The messaging channel that Indian edtech actually relies on, and its pricing, template approval and session-window rules, is unresearched. Phase 2 scope.

---

### FR-SUP — Support, grievance and error reporting

| ID | Tier | Requirement |
|---|---|---|
| **FR-SUP-01** | MVP | Every question MUST carry a "Report an error" action. |
| **FR-SUP-02** | MVP | A time-boxed "Challenge this answer" flow MUST route to the admin triage queue. |
| **FR-SUP-03** | MVP | Reports MUST be deduplicated per (question, user), MUST require a written reason, and MUST be weighted by the reporter's historical report precision. |
| **FR-SUP-04** | MVP | Report **volume alone MUST NEVER trigger a void.** A statistical signal MUST corroborate. |
| **FR-SUP-05** | MVP | A grievance channel MUST exist with automatic acknowledgement and a resolution timer, and a named grievance officer MUST be published. |
| **FR-SUP-06** | MVP | Account recovery MUST be available to a student who has lost access to their registered phone number. |

**AC-SUP-01** — A coordinated campaign of 3,000 reports against one question raises it for review but does not void it absent a corroborating statistical signal.

> **Attack surface.** A messaging group instructing thousands of students to report a question as ambiguous, hoping for a void that credits everyone, turns report volume into an attack on scoring. FR-SUP-03 and FR-SUP-04 are the control.

---

### FR-A11Y — Accessibility and wellbeing

| ID | Tier | Requirement |
|---|---|---|
| **FR-A11Y-01** | MVP | Text MUST remain readable and functional at 200% scale without loss of content or function. |
| **FR-A11Y-02** | MVP | Touch targets MUST meet the platform minimum. Both orientations and tablet layouts MUST be supported. |
| **FR-A11Y-03** | MVP | A reduce-motion preference MUST be honoured. |
| **FR-A11Y-04** | P1.5 | Mathematical content MUST be screen-reader navigable via a MathML output path with a per-expression spoken-text override. |
| **FR-A11Y-05** | P1.5 | **Accommodations MUST be modelled as an entitlement attached to a person**, not as an ad-hoc extension attached to an incident. Where an examining body grants a candidate additional time or a scribe, the platform MUST be able to grant the equivalent, and the leaderboard MUST be able to represent a lawfully longer attempt without misranking it. |
| **FR-A11Y-06** | P1.5 | Integrity hardening MUST NOT disable assistive technology. Any anti-overlay measure MUST be evaluated against screen-reader compatibility, and where they conflict, accessibility wins. |
| **FR-A11Y-07** | MVP | A session cap with a break prompt MUST exist. |
| **FR-A11Y-08** | MVP | A mental-health helpline link MUST be persistently reachable. |
| **FR-A11Y-09** | MVP | Failure-framed and shaming copy is prohibited across the product, enforced by a blocked-phrase list in the communications composer. |

**AC-A11Y-01** — A blind student can complete a practice question containing an integral and a fraction using a screen reader alone.
**AC-A11Y-02** — A student granted an accommodation entitlement sits a lawfully longer attempt that is ranked correctly and is not flagged by the integrity layer.

**Traces:** EC-A11Y-01, EC-A11Y-02, EC-A11Y-03, EC-OPS-01.

> **FR-A11Y-05 is a gap the research nearly missed.** The verified NEET 2026 bulletin grants a compensatory hour, a scribe and pro-rata additional time to PwD candidates. As currently designed elsewhere in this document, the server-authoritative deadline has no concept of a per-person entitlement. Without FR-A11Y-05, a blind NEET aspirant cannot use this product at all.

---

## 5. Non-functional requirements

### NFR-SCL — Scale and concurrency

| ID | Tier | Requirement |
|---|---|---|
| **NFR-SCL-01** | MVP | The system MUST sustain 10,000 concurrent attempts for a 3-hour window. |
| **NFR-SCL-02** | MVP | Attempt start MUST be a **single** server round trip returning attempt, sections and item stems. Multi-call paper fetch is prohibited. |
| **NFR-SCL-03** | MVP | Admission MUST be gated by a server-issued token with a randomised start-allowed offset, spreading a simultaneous start over minutes without changing graded duration. |
| **NFR-SCL-04** | MVP | Shared immutable assets MUST be served from a CDN-cacheable URL that is **identical for every student**. Per-user signed URLs for shared assets are prohibited — they eliminate CDN caching entirely and turn ~13.5 MB of assets into ~135 GB of origin egress per test. |
| **NFR-SCL-05** | MVP | A cache-warm job MUST run before every scheduled test. |
| **NFR-SCL-06** | MVP | All database access from application workers MUST go through a transaction-mode connection pooler with prepared statements disabled. Students MUST NOT hold direct database connections. |
| **NFR-SCL-07** | MVP | Realtime messaging MUST NOT be load-bearing. Broadcast-style fan-out only; per-row change subscriptions are prohibited. The exam MUST function correctly with realtime entirely unavailable. |
| **NFR-SCL-08** | MVP | High-volume response tables MUST be range-partitioned by time with at least three future partitions maintained automatically. A missing partition means every insert fails mid-exam, simultaneously, for everyone. |
| **NFR-SCL-09** | MVP | Counters with economic meaning (coin balances, seat counts) MUST use atomic database operations. Read-modify-write in application code is prohibited. |
| **NFR-SCL-10** | MVP | The cache layer MUST be strictly a cache. Question order, option order, deadlines, answers and results MUST live in the primary store, with read-through on miss. A cache flush MUST NOT be able to change a student's paper or timer. |
| **NFR-SCL-11** | MVP | No screen may issue more than a small fixed number of network calls. An N+1 query pattern from the client is a build failure, enforced by lint and by a per-screen request budget in development builds. |
| **NFR-SCL-12** | MVP | A load rehearsal at 1.5–2× target MUST run before every scheduled live event, with a published runbook. |

**AC-SCL-01** — Three consecutive live mocks at ≥3,000 concurrent complete with zero attempts stuck in progress, zero duplicate results, zero rescore drift.
**AC-SCL-02** — p99 answer-sync latency stays under 800 ms from a representative Indian mobile network.
**AC-SCL-03** — Whole-cohort scoring for 10,000 attempts completes within 60 seconds.

**Traces:** EC-HERD-01 through EC-HERD-09, EC-SCALE-01, EC-SCALE-02, EC-HOT-01 through EC-HOT-05, EC-COST-01, EC-COST-02.

---

### NFR-SEC — Security

| ID | Tier | Requirement |
|---|---|---|
| **NFR-SEC-01** | MVP | Every table in the client-exposed schema MUST have row-level security enabled and at least one policy. Asserted in CI; a new table without a policy fails the build. |
| **NFR-SEC-02** | MVP | Solutions, answer keys, role tables and licence evidence MUST live in a non-exposed schema with **zero** grants to the authenticated role, reachable only through state-checking RPCs. RLS controls rows, never columns — a column-select is otherwise one query away from dumping the key. |
| **NFR-SEC-03** | MVP | Analytics views MUST run with invoker security. Admin reporting views MUST live in a private schema. Views default to definer semantics and would otherwise bypass RLS entirely. |
| **NFR-SEC-04** | MVP | Privileged service credentials MUST NEVER appear in any client bundle. A build-time secret scan MUST fail the build on detection. |
| **NFR-SEC-05** | MVP | OTA update bundles MUST be code-signed, and MUST NOT contain question content, keys or credentials. |
| **NFR-SEC-06** | MVP | A static analysis and lint pass over database configuration MUST run in CI, failing on missing RLS, definer views and mutable search paths. |
| **NFR-SEC-07** | MVP | A per-persona RLS test suite MUST run on every migration (anon, two students in different orgs, admin, cross-org admin). |
| **NFR-SEC-08** | MVP | The API MUST be safe under direct scripted access with a legitimate student token. Every content endpoint MUST enforce state gating server-side. |
| **NFR-SEC-09** | P1.5 | Device attestation MAY be used to tier access: unattested devices get practice, not ranked papers. Honest students on custom ROMs MUST NOT be blocked, and an appeals path MUST exist. |
| **NFR-SEC-10** | P1.5 | Per-attempt visible watermarking MUST be applied to ranked papers. Second-device photography is undefeatable; deterrence and traceability are the achievable goals. |
| **NFR-SEC-11** | MVP | Ranked papers MUST use fixed live windows. Open multi-hour windows for ranked tests are prohibited. |
| **NFR-SEC-12** | P1.5 | Insider threat MUST be addressed: admin bulk-export is audited, rate-limited and alerting. Students are barred from bulk export; contractors currently are not. |

**AC-SEC-01** — A student token used to script the API directly cannot enumerate items outside an active attempt, cannot read any key or solution before submission, and cannot read another org's data.
**AC-SEC-02** — Introducing a table without an RLS policy fails CI.

**Traces:** EC-LEAK-01 through EC-LEAK-10, EC-CHEAT-01 through EC-CHEAT-07, EC-DATA-01 (scale-security), EC-DPDP-05.

---

### NFR-PRV — Privacy

| ID | Tier | Requirement |
|---|---|---|
| **NFR-PRV-01** | MVP | Data MUST be hosted in-country, in a region selected at project creation, because region is immutable afterwards. |
| **NFR-PRV-02** | MVP | Two **physically separate** telemetry pipelines MUST exist: pedagogical (disclosed, defensible, guardian-visible) and engagement. The engagement pipeline MUST be disabled entirely for under-18 principals at the API gateway, not by a client flag. |
| **NFR-PRV-03** | MVP | Behavioural advertising, tracking and behavioural monitoring of children are prohibited. |
| **NFR-PRV-04** | MVP | Third-party SDKs MUST be audited for cross-border transfer of child data. Any analytics processor operating outside the jurisdiction MUST be assessed before inclusion. |
| **NFR-PRV-05** | MVP | Erasure MUST be two-tier: identity columns cryptographically shredded, statistical contribution retained with the mapping key destroyed, so cohort percentiles for other students remain sound. |
| **NFR-PRV-06** | MVP | Retention classes MUST be administered explicitly, with consent records held as a distinct long-retention class. |
| **NFR-PRV-07** | MVP | A breach runbook with a statutory notification timer MUST exist and MUST be rehearsed before launch. |
| **NFR-PRV-08** | MVP | A/B testing and experimentation on under-18 principals MUST be legally assessed before any experiment runs. |

**AC-PRV-01** — Disabling the engagement pipeline for a minor is verifiable at the gateway: no engagement event for an under-18 principal reaches any processor.

**Traces:** EC-DPDP-01 through EC-DPDP-10, EC-LOC-01, EC-LOC-02.

---

### NFR-AVL — Availability, durability, operability

| ID | Tier | Requirement |
|---|---|---|
| **NFR-AVL-01** | MVP | Point-in-time recovery MUST be enabled, **plus** an independent nightly logical dump of the item bank and keys to separate storage under a different credential domain. |
| **NFR-AVL-02** | MVP | The restore path MUST be rehearsed and the real recovery time recorded. Restoring a whole project to fix one table discards every in-flight attempt — a table-level restore path MUST exist. |
| **NFR-AVL-03** | MVP | Schema migrations MUST NOT run during a live test window. Index creation MUST use the concurrent path. |
| **NFR-AVL-04** | MVP | Statement timeouts MUST be set per role, tighter for interactive traffic than for background workers. |
| **NFR-AVL-05** | MVP | Alerting MUST cover cache-hit-ratio collapse (which has no slow-query signature), pooler saturation, dead-letter queue depth, sweeper backlog and reward-ledger drift. |
| **NFR-AVL-06** | MVP | A public status surface MUST exist, and incidents affecting an exam MUST be published with their remedy. |

**Traces:** EC-DATA-02, EC-DATA-03 (scale-security), EC-COST-03.

---

### NFR-QLT — Content quality

| ID | Tier | Requirement |
|---|---|---|
| **NFR-QLT-01** | MVP | Confirmed content errors MUST stay below 2 per 1,000 served questions. |
| **NFR-QLT-02** | MVP | Editorial capacity MUST be budgeted as a first-class line item, not as overhead. |
| **NFR-QLT-03** | MVP | Every published item MUST have passed two-approver review, LaTeX validation, provenance capture and the shuffle linter. |

> **This is the requirement most likely to be missed.** A 100,000-item bank at a 1% error rate is 1,000 wrong questions. The specific predictable failure: a small team ships an excellent CBT player against a thin, hastily-ingested bank; the first live mock surfaces four broken questions; and the defensible-scoring positioning becomes an *active liability* because the product loudly claims a correctness it does not have. Every competitor gets caught here.

---

## 6. Explicitly out of scope

| Excluded | Reason |
|---|---|
| AI tutor as the headline product | Commoditised, and the category's most-broken promise. Include later, never lead with it. |
| Video lectures, live classes, faculty brand | Capital-intensive; incompatible with D4. |
| Purchasable coins, loot boxes, spin wheels, cash or voucher prizes, entry-fee contests | Criminal exposure under the 2025 gaming legislation, with personal officer liability. |
| Public all-India rank wall | Wellbeing risk, state coaching legislation, reputational exposure. |
| Telesales, auto-mandate, non-refundable subscriptions | The category's most hated pattern. Refusing it is the moat. |
| Multiple subscription tiers | Entitlement bugs and support load. |
| Full assessment-interchange-standard compliance | XML-heavy and lossy against the internal model. Align naming now; build an adapter only when a buyer pays for it. |
| Real-time adaptive testing at launch | Requires hundreds of responses per item plus exposure control. Nothing to calibrate at cold start. |
| Webcam proctoring on free tiers | Children's-data liability, storage cost, product-inappropriate. |
| Kids app-store category | A one-way door that bars links out and purchase flows even after deselection. |
| In-app third-party payment on iOS | Guaranteed rejection. |
| Questions as PDFs | Root cause of the category's worst UX complaints. |
| Social feed, direct messages, community answers, public note sharing | Intermediary obligations, moderation cost, and child-safety liability in a majority-minor product. |
| Any copyleft-licensed code in the bundle or backend | Study the designs, clean-room the ideas, paste nothing. |
| 13-language content at launch | 13× editorial and review cost. |
| JEE Advanced in v1 | D3. Schema supports it; content and scoring engines land in v2. |

---

## 7. Blocking external dependencies

These are not engineering tasks and cannot be resolved by the team alone. Each blocks a launch-critical requirement.

| # | Dependency | Blocks | Action |
|---|---|---|---|
| B1 | **Written permission from the examining body** to reproduce previous-year questions commercially, plus counsel opinion on the educational-use exception. | FR-ITM-06, FR-ITM-07, FR-PRC-01 — i.e. the entire free tier | Request early; it is cheap and it de-risks the primary content asset. |
| B2 | **Counsel opinion on the DPDP verifiable-parental-consent mechanism** and on whether any exemption applies. | FR-IDN-03 through FR-IDN-06 | Assume no exemption until advised otherwise. |
| B3 | **Verification of the NEET 2026 cancellation and 2027 CBT-transition narrative** against primary notices. | Go-to-market positioning, not code | See ideation §1. Do not justify architecture with an unverified event. |
| B4 | **Costing decision on per-option rationales** — human, AI-drafted with human review, or reduced scope. | FR-AUT-04, and therefore the headline differentiator | The largest uncosted line in the plan. |
| B5 | **Legal position on experimentation and analytics involving minors.** | NFR-PRV-08 | Determines whether standard product analytics can run at all for the core cohort. |

---

## 8. Assumptions recorded

Decisions taken on the stated default in ideation §4 that have not been separately confirmed:

A1. Under-18s are served, with VPC (D5). A2. Content comes from permissioned PYQs plus commissioned originals plus AI-drafted rationales under human review. A3. The full PYQ bank is free (D6). A4. Ranks are private and bucketed (FR-RWD-08). A5. Graded mocks are never available offline (FR-SYN-10). A6. Coins are never purchasable (D7). A7. No prize contests (FR-RWD-14). A8. No UGC in v1 (D8). A9. Video solutions are deep-linked, not embedded (FR-SOL-04). A10. English at launch, bilingual schema now (D9). A11. The rescore pipeline ships pre-launch (D10).

Any change to A1, A3, A5 or A6 has schema consequences and must be raised before implementation begins.

---

## 9. Traceability

139 catalogued edge cases live in [docs/research/](research/) as structured JSON: `agent_edge-exam-session.json` (59), `agent_edge-scale-security.json` (48), `agent_edge-compliance.json` (32). Each carries a scenario, failure mode, mitigation, severity and layer.

Every `EC-*` reference in this document resolves to one of those records. Before implementing any requirement carrying a trace, read the referenced edge cases — the mitigations there are more specific than the requirement statements here, and several encode a mechanism choice that is not obvious from the requirement alone.

Coverage note: this draft traces the critical and high-severity cases. Medium and low-severity cases are catalogued but not yet lifted into numbered requirements. That pass belongs with the implementation plan, not here.
