# Ideation — JEE / NEET Practice and Mock-Test Platform

**Status:** Phase 1 of 4. Ideation and research synthesis.
**Date:** 2026-07-25
**Next artefacts:** `requirement.md`, `skill.md`, `agent.md`, `mcp.md` — not yet written. This document is their spine.

---

## 0. Provenance and how to read this

This is a synthesis of a 12-agent research pass: seven domain researchers, three edge-case enumerators, one strategist and one hostile critic. 632 tool calls, ~1.4M tokens. Raw output is preserved verbatim under `docs/research/` — every agent's structured findings with source URLs, plus the full 546 KB dossier. Nothing here is invented; where a claim is unverified it is marked.

Read in this order: §1 (the one thing that could be wrong), §2–3 (what we are building and why), §4 (the decisions only you can make — this blocks `requirement.md`), §5 (contradictions I have resolved on your behalf), then the rest as reference.

---

## 1. Verification caveat — read before acting on anything

One narrative in the research is load-bearing and **unverified**: that NEET 2026 was cancelled on 12 May 2026, re-run on 21 June 2026, and that a ministerial announcement on 15 May 2026 committed NEET to computer-based testing from 2027. The critic could not verify any of it — `neet.nta.nic.in` returned 403 and the search budget was exhausted. It is structurally near-identical to the real, well-documented NEET 2024 controversy, which appears separately in the same dossier with 2024 dates. It may be that event duplicated forward two years.

This matters because "ship an NTA-faithful CBT simulator ahead of the 2027 NEET CBT transition" is the sharpest go-to-market claim in the whole thesis. **Verify against primary NTA public notices before any architectural decision is justified by it.**

What *was* verified against primary PDFs: JEE Advanced 2026 Paper 1 marking (Section 2 negative marks are −1, not the −2 that pw.live and aakash.ac.in still publish; the partial ladder is +3/+2/+1, not the proportional `4 × correct/total` formula the entire Indian web repeats); and the NEET UG 2026 Information Bulletin (03 May 2026, pen-and-paper, 180 questions / 180 minutes, plus a compensatory-hour and pro-rata scribe provision for PwD candidates that nothing else in the research mentions).

That last detail is not trivia. It means a blind NEET aspirant is legally entitled to 240 minutes, and your server-authoritative deadline currently has no concept of an entitlement attached to a *person* rather than an *incident*. See §9, EC-A11Y.

A further 19 claims are flagged as suspect in `docs/research/_synthesis-critic.md` §2 — including a 12–15× discrepancy between two agents on Indian SMS pricing, and a pricing recommendation built on competitor prices the research admits it could not confirm. Treat every number in this document as a working estimate until re-verified.

---

## 2. Positioning thesis

You described a practice-and-mock app. The research says the interesting product is one level down.

**This is assessment infrastructure that goes to market as a student app.** The differentiator is that the exam's own mechanics — marking schemes, paper composition, answer keys, question content — are *versioned data rather than code*, so every mark a student receives is reproducible, explainable and auditable months later. A paper can be replayed byte-identically. A key revision produces a visible before/after delta instead of a silent score change. A dropped question triggers an idempotent rescore that re-emits ranks and reward ledgers instead of corrupting them.

That spine is what makes the second half possible: because items are immutably versioned, a student's own errors can drive a spaced-repetition schedule that content corrections never destroy. And because the whole content lifecycle is modelled, the admin console becomes a shippable product rather than internal tooling — which is your route into coaching institutes.

The market opening is stated by the incumbents themselves. Unacademy's CEO conceded in March 2026 that the sector "has not seen enough real product innovation". Allen still delivers 8 of 19 NEET test-series papers on pen and paper. Embibe marks correct answers wrong on spelling. Unacademy's *Educator* app — the teacher side — sits at 3.33★ across 391 ratings with its last update on 11 January 2024, two and a half years stale, against a learner app with 54,284 ratings. Allen publishes no teacher app at all. Meanwhile ExamBro, a standalone paper-generation utility with no platform behind it, sits at 4.85★ across 196 ratings. That is the cleanest demand signal in the entire dossier.

**Category claim:** the NTA-grade CBT engine with a memory of everything you got wrong.

---

## 3. The three wedges

### Wedge 1 — Scoring as versioned data

Marking rules, exam patterns, paper composition and answer keys are first-class versioned entities: `exam_pattern → pattern_section → marking_rule(jsonb)`. A test pins a pattern. An attempt pins `question_version_id` and `answer_key_version`. Scoring is a pure function of `(attempt, key_version, scoring_config_hash)`.

Incumbents cannot copy this quickly because their scoring lives in application code with year constants, and their attempt tables reference mutable question rows. Retrofitting item immutability is a data migration across every historical attempt plus a rewrite of the grading path. They also have no incentive — their differentiation is faculty brand and video, so scoring correctness is a cost centre.

Evidence: JEE Advanced's multi-correct penalty moved −2 (2025) → −1 (2026) and Paper 1 Section 2 went from 3 questions to 4. jeeadv.ac.in commits only to being "consistent with previous examinations" and discloses the real scheme on-screen on exam day. Three exams have three different tie-break chains, and JEE Advanced's leads with *positive marks earned* — a column that cannot be backfilled if you did not persist it from day one.

### Wedge 2 — Error memory

Every wrong answer, every marked-for-review question and every formula generates a review card scheduled by FSRS-6 (`ts-fsrs`, MIT licence). FSRS has been Anki's default since v23.10, trained on ~700M reviews, benchmarked at log-loss 0.291 / RMSE 5.3% against SM-2's 0.354 / 16.2% — roughly 20–30% fewer reviews for equal retention. No significant Indian JEE/NEET app ships anything comparable.

The card key is the *sub-topic*, not the question. When a concept comes due, the engine serves a fresh unseen item of matched difficulty drawn against a per-student seen-ledger. This is what makes content corrections non-destructive — scheduling attaches to the concept, never to mutable content. AnkiHub's entire commercial proposition (~$6/mo) is exactly this guarantee.

Incumbents are structurally blocked: it *requires* Wedge 1, it requires content-ops discipline they demonstrably lack (a live SRS loop over a 1%-error bank surfaces every error repeatedly to the same student), and it is anti-correlated with their P&L — a scheduler that says "do 22 cards and stop" competes with a business monetising lecture-hours.

### Wedge 3 — The admin console as a shipped product

Not internal tooling. LaTeX-first authoring with server-side validation as a publish gate, OCR ingestion with side-by-side original-vs-rendered diff review, duplicate detection, mandatory provenance and licence status, capability RBAC with `approved_by <> created_by` enforced as a database CHECK constraint, blueprint-driven paper assembly, per-cohort item psychometrics, a rescore console, per-institute tenancy.

This is your B2B2C wedge, and there is a compliance angle that converts customers: the Rajasthan Coaching Centres Act 2025 s.12(viii)/(ix) bars centres from publishing internal assessment results or segregating batches by performance. An off-by-default, institute-controlled rank-publication toggle is therefore not a nicety — it is the feature that makes you sellable in the Kota belt.

### The fourth moat, which is not a capability

Self-serve commerce, a published refund window, zero sales calls, and an in-app promise that the OTP number will never be dialled. Costs nothing to build. Unavailable to any funded incumbent whose revenue engine is telesales plus auto-mandate plus non-refundable subscription — the most reliably hated pattern in the category's review record. Note the tension flagged in §5.11: this collides with parental-consent onboarding, and the collision is resolvable but must be designed, not assumed away.

---

## 4. Scope decisions

The four blocking forks were decided on 2026-07-25 and are now **LOCKED**. They are architectural commitments, not preferences — each one is expensive to reverse.

| # | Decision | **LOCKED** | Consequence |
|---|---|---|---|
| 1 | Who is the customer | **Multi-tenant from day one; B2C first, parent as payer** | `org_id` on nearly every row, RLS built around tenancy from the first migration. Institute tenancy features land in Phase 3, but the schema never assumes a single org. |
| 2 | Platform split | **Web for full-length mocks + admin console; React Native for practice, SRS, review, notes, notifications** | Two clients, one API. The CBT fidelity claim is made on web where it is honest. RN never renders a 3-hour ranked mock. |
| 3 | Exam scope v1 | **JEE Main + NEET. JEE Advanced deferred to v2** | Two marking schemes at launch. The `marking_rule` schema must still be general enough that JEE Advanced's four scoring engines are data entry in v2, not a rewrite. |
| 4 | Business shape | **Profitable niche, self-funded** | Pricing for margin, not for growth-at-any-cost. The anti-telesales positioning is retained as a genuine moat. No venture-burn growth mechanics — which conveniently sidesteps the DPDP s.9(3) problem that would have removed most of them anyway. |

The remaining eleven forks proceed on the stated default and are recorded as assumptions in `requirement.md`.

| # | Question | Default | Why |
|---|---|---|---|
| 5 | Do you serve under-18s? | Yes — build verifiable parental consent and split telemetry now | Not serving them removes ~80% of TAM. There is no cheap middle. |
| 6 | Where does content come from? | NTA-permissioned PYQs + ~5k commissioned originals + AI-drafted rationales under mandatory human review | Sequences the entire launch. Get the NTA permission letter first; it is cheap and it de-risks §5.6. |
| 7 | Free tier at MARKS parity, or is the bank the paywall? | Full PYQ bank free | MARKS is free forever with 1 lakh+ PYQs, 4.8★, 1M+ downloads. You cannot acquire against that with a paywalled bank. |
| 8 | Public all-India rank, or private cohort rank? | Private bucketed cohort + private predicted percentile + a share card showing only your own number | See §5.3. |
| 9 | Graded mocks available offline? | No. Offline is untimed practice and flashcards only — never the timer, never the key | See §5.1. |
| 10 | Coins ever purchasable with money? | Never | One invariant that keeps you out of PROGA 2025, Apple guideline 3.1.1 expiry rules, and the GST actionable-claim analysis simultaneously. |
| 11 | Prize contests at all? | No prize contests. Recognition, in-app utility and subscription credit only | The Prize Competitions Act 1955 caps make meaningful prizes unlawful in the states that matter. |
| 12 | Any UGC — doubts, community answers, shared notes? | None in v1 | UGC in a majority-minor product triggers intermediary obligations, moderation cost, Apple 1.2, and grooming-risk liability that is category-ending. |
| 13 | YouTube embed, deep-link-out, or self-host? | Deep-link-out with an interstitial for under-18s | The standard embedded player transmits Google identifiers to a child — a DPDP s.9(3) problem, not a UX one. Also: link rot needs a health crawler, and YouTube is blocked on many coaching-centre networks. |
| 14 | Hindi at launch? | English UI + English content at launch, **but build the bilingual schema now** | Translations must be versioned *children* of the English version with keys and marks only on the parent. Sibling rows silently diverge. This is a schema decision, not a later feature. |
| 15 | Rescore pipeline pre-launch or post-launch? | Pre-launch, non-negotiable | You will need it within the first three mocks and it is unbuildable once leaderboards and coins are denormalised. |

---

## 5. Contradictions in the research, resolved

The critic found twelve places where agents contradicted each other. These are resolved here so the requirements doc is internally consistent.

**5.1 Offline practice vs anti-leak.** An offline chapter download *is* a bulk export to a device you do not control. Resolution: two content classes. `practice` items — the free PYQ bank, un-ranked — are downloadable. `ranked_mock` items are never cached, are served per-section, are watermarked, and are online-only. Offline means untimed practice and SRS review, nothing else.

**5.2 Prefetch-everything vs serve-one-at-a-time.** Rule: **prefetch scope equals the widest set the student may legally navigate to right now.** JEE Main allows free movement across sections, so prefetch the whole paper's rendered assets. A time-locked sectioned paper prefetches only the open section. Keys and solutions are never in any prefetch payload regardless.

**5.3 Leaderboards.** Three separate artefacts that were being conflated into one. (a) *Private percentile and predicted rank* — always computed full-cohort by the NTA method, shown to the student alone. (b) *Bucketed peer league*, ~30 students, opt-in, pseudonymous, one-tap permanent opt-out — the only competitive social surface. (c) *No public all-India rank wall, ever.* The share card renders only your own numbers. This satisfies exam fidelity, growth and wellbeing simultaneously.

**5.4 FSRS card granularity.** Two different features were being conflated. The *scheduler* keys on `(user, sub_topic)` and serves a fresh unseen item. "Revisit this exact question" is a separate bookmark/redo feature. Both ship; neither is the other.

**5.5 Two-role RBAC.** You specified two roles. One agent called that "the single biggest architectural mistake in the brief" and it is right, but the reconciliation is cheap: build a `user_roles` + `role_permissions` capability table from day one and populate it with only ADMIN and STUDENT. Adding REVIEWER, SUBJECT_LEAD, OPS and ANALYST later becomes a row insert rather than a migration. The user-facing model stays two roles until you need more. Non-negotiable regardless: roles live in a server-owned table projected into the JWT via `custom_access_token_hook` — **never in `user_metadata`, which is user-writable and therefore a one-line privilege escalation.**

**5.6 PYQ copyright.** Genuinely unresolved and not resolvable by engineering. One agent says NTA papers are public; another says s.52(1)(i) of the Copyright Act covers reproduction "as part of the questions to be answered in an examination" and a commercial subscription app is neither a teacher nor an examination body — and that NCERT publicly threatened action in April 2024 for use "in whole or in part". Resolution: `licence_status` becomes a serving-query filter so any provenance class can be dark-launched with one flag, and **you obtain a written permission request to NTA and a counsel opinion before launch.** This is a blocking external dependency, not a technical task.

**5.7 Compute headroom.** Both agents are right; the bottleneck is not CPU, it is pooler connections and PostgREST request duration. Rule: student traffic never touches PostgREST during an attempt except through a small number of fat RPCs, with heartbeat and answer-delta carried in a single request.

**5.8 Realtime.** Realtime is never load-bearing. Broadcast (never `postgres_changes`, which is single-threaded and tops out around 4,000 msg/s with RLS) carries announcements and the leaderboard tick. The timer and the answers go over HTTP. If Realtime is down, the exam still works.

**5.9 Randomisation.** Two different things sharing one word. `shuffle_scope` — same items, different sequence, per-student, safe, always on for ranked tests. `pool_draw` — different items per student, destroys rank comparability without parallel-form equating, permitted only for un-ranked practice. Name them differently in the schema so nobody conflates them again.

**5.10 Coin expiry.** Only a problem if coins ride inside an IAP subscription SKU, which Apple guideline 3.1.1 forbids expiring. Since coins are never purchasable (decision 10), expiry is fine.

**5.11 Frictionless signup vs verifiable parental consent.** The brand promise is "we will never call you", not "we will never collect a phone number". Parent contact is collected for consent, stored under a purpose-limited flag, and structurally unable to reach marketing — enforce it as a `contact_purpose` enum with no marketing value available for guardian rows.

**5.12 Deploy freeze.** Accept the constraint rather than paper over it: **you cannot hotfix the client during your highest-risk window.** Freeze windows are auto-derived from the test calendar. Therefore anything you might need to change mid-exam must be server-side — feature flags, RPC bodies, config — never a client bundle.

---

## 6. Personas

Four, not two. The brief named two.

- **Student** (16–18 predominantly, therefore a Child under DPDP). Practises, sits mocks, reviews, takes notes, reviews SRS cards.
- **Parent/Guardian.** Legally required as the consent-granting party, and in India commercially the *buyer*. Gets a linked read-only progress view, auto-revoked at the student's 18th birthday. This persona was absent from the brief and it changes the funnel.
- **Admin**, internally decomposed into capabilities: author, reviewer, subject lead, ops, analyst, super-admin. Ships as one role, modelled as six.
- **Institute admin** (Phase 3). Batches, rosters, batch-scoped leaderboards, rank-publication toggle off by default, institute-branded test series.

---

## 7. Capability inventory

The full tagged inventory — 51 student features, 39 admin features, 30 platform capabilities, each tiered MVP / 1.5 / v2 / rejected with a one-line justification — is in `docs/research/_synthesis-thesis.md` §3 and will be lifted into `requirement.md` in the next pass. Highlights of what is *distinctive* rather than table-stakes:

**Student.** Custom test builder with question-state filters (unused / incorrect / correct / marked / guessed-right) — UWorld's most-imitated global feature, entirely absent in India. Tutor Mode vs Timed Mode. Per-question marks-awarded breakdown ("+2 because you selected 2 of 3 correct; the ladder awards +2, not 2.67") which turns scoring correctness from invisible engineering into a screenshot-able differentiator. Per-option rationales explaining why each distractor is wrong. Mistake taxonomy self-tagging. Time-per-question against cohort median. FSRS review queue. Searchable notebook with backlinks.

**Admin.** Marking-rule editor so a 2027 pattern change is an INSERT rather than a release. Publish freeze enforced by trigger. Answer-key versioning with a challenge triage queue ranked by negative discrimination (the classic miskey signature). Rescore console supporting MULTI_KEY / ALL_CORRECT / DROPPED with different eligible populations per flag. Attempt inspector that replays the exact paper a student saw. Compensation console — NTA itself re-examined 1,563 candidates for time loss; without this your only options are "do nothing" or "void everything".

**Explicitly rejected**, with reasons in the source doc: AI tutor as headline product, video lectures, purchasable coins, global rank wall, telesales, four subscription tiers, full QTI 3.0 compliance, real-time adaptive CAT at launch, webcam proctoring on free tiers, Apple Kids Category, in-app Razorpay on iOS, questions delivered as PDFs, any AGPL/GPL code in the bundle.

That last one is worth calling out: Moodle, Canvas, TAO, TCExam, Anki and DOMjudge are all GPL/AGPL. Study the designs, clean-room the ideas, paste nothing. The Moodle *App* (Apache-2.0) is the one large codebase you may legally borrow from.

---

## 8. The admin control surface

Your core question was what a single admin or an organisation must be able to control end to end. The organising principle the research converged on: **an admin controls state machines and policies, never rows directly.** Every mutation is an event with an actor, a reason and a version. Nothing a student has seen is ever edited in place.

Twelve planes, detailed in `_synthesis-thesis.md` §4:

1. **Content** — author, review, approve, publish, flag, retire. Never delete.
2. **Assessment design** — exam patterns, marking rules, blueprints, as data.
3. **Test lifecycle** — create, schedule, publish/freeze, run, close, score, publish results, rescore.
4. **Live operations** — the console you use at 14:00 on a Sunday. Attempt counts, incident stream, per-attempt inspector, deadline extensions, re-attempt grants, ranking exclusions.
5. **Key and rescore** — immutable key versions, challenge triage, void policy, idempotent execution with compensating (never clawback) reward entries.
6. **Psychometrics** — per-cohort item statistics, auto-flag rules gated at ≥100 cases, routed to a human queue. Never auto-retire.
7. **People** — capability RBAC, student admin, institute tenancy.
8. **Commerce** — plans per storefront with commission and 18% GST modelled in, coupons, entitlements, refunds, e-mandate scheduling.
9. **Rewards** — earn-rule whitelist enforced in the database so a purchase-origin credit is structurally impossible, sink whitelist, caps, global daily mint cap.
10. **Moderation and integrity** — error-report triage, challenge triage, integrity queue with mandatory human review before any leaderboard action.
11. **Communications** — broadcast, push composer with enforced quiet hours and a blocked-phrase list for failure-framed copy, status banners.
12. **Governance** — feature flags with kill switches, deploy-freeze calendar, immutable audit log, DPDP console, and an "explain this decision" export that assembles the pinned paper, shuffle seed, marking rules, key version, rescore history and audit trail into one artefact for any disputed attempt.

---

## 9. Edge-case catalogue

**139 catalogued cases**, in `docs/research/agent_edge-*.json`. Distribution:

| Area | Cases | Critical | High |
|---|---|---|---|
| Exam session (timer, network, resume, data, randomisation, fairness, notes) | 59 | 24 | 27 |
| Scale, concurrency, abuse, security | 48 | 19 | 22 |
| Compliance, platform policy, payments, accessibility, IP | 32 | 8 | 16 |

The ones most likely to be underestimated:

- **EC-DATA-09** — answers mapped by *position* rather than identity. Under shuffle, every answer scores against the wrong question. It is silent and looks like poor student performance. Wire format must be `{question_version_id, option_id}` with server-side membership assertion.
- **EC-HERD-02** — per-user signed URLs for question images eliminate CDN caching entirely, turning ~13.5 MB of assets into ~135 GB of origin egress per test.
- **EC-LEAK-04** — RBAC read from `auth.jwt() -> 'user_metadata'`, which the user can write. One-line privilege escalation.
- **EC-TIMER-05/06/07** — app backgrounded, OS-killed, phone rebooted mid-test. Three hours of a student's life, unrecoverable.
- **P8** — a missing monthly partition on the responses table means every INSERT fails mid-exam, for everyone, simultaneously.

And ten the critic found that nobody else listed. Three are genuinely important:

- **Rough work happens on paper, off-screen.** A 3-hour JEE mock needs ~15 sheets. `time_spent_ms` measures time with the question *visible*, not time thinking. A student who works on paper for four minutes generates a wildly wrong "fast answer" — poisoning the overtime flag, the cohort-median comparison, and the FSRS grade derivation that makes "correct and fast = Easy" load-bearing. Worse, putting the phone down triggers the Android `background` AppState transition that the anti-cheat records as a cheating signal. **The most diligent students look most like cheaters.**
- **The app must kill its own gamification for the cohort sitting the exam.** A student writes NEET on 3 May and does not open the app for three days. On 4 May the app breaks their 187-day streak, relegates them from their league, and sends a re-engagement push — on the worst day of their life. An admin-maintained exam calendar must auto-freeze streaks, suppress notifications and hide leaderboards for every user whose declared exam is today. Extends to Class 12 boards, which empty every league for three weeks simultaneously.
- **The collusion detector will flag entire coaching batches.** Jaccard similarity on *wrong* answers is the standard strong collusion signal and is catastrophically wrong here: 400 students taught the same misconception by the same faculty member select the same distractor at high rates. So do twins, hostel roommates, and anyone working from the same photocopied module. Similarity must be scored against a batch-conditioned baseline, never a global one, and never acted on without an independent second signal.

Also: phone-number recycling (Indian numbers reallocate after ~90 days, and OTP-only auth means whoever gets the recycled number walks into a minor's account); the shared family phone (two siblings, one device, in direct conflict with device-bound attempt sessions and one-device-per-account anti-fraud); and report-brigading, where a WhatsApp group instructs 3,000 students to report Q42 as ambiguous hoping for a void that awards everyone +4.

---

## 10. Gaps — what Phase 2 research must cover

The critic found sixteen domains that received zero research. These are not nice-to-haves; three of them change the business model.

**Changes the business model:**

1. **The AI layer.** Not as a feature — as the content-ops engine. Your headline differentiator is per-option rationales. At 100k questions that is ~400k rationales, at Indian SME rates ₹1.2–6 crore of human writing. Nobody costed it and nobody asked whether an LLM writes the first draft. This omission arguably invalidates the feasibility of the number-one recommended differentiator. Also unresearched: answer-key QA by model disagreement (the cheapest pre-publication key check that exists, versus the current detectors which both fire only *after* a student is harmed); variant generation to populate the `VARIANT_OF` relation; token economics in INR at 10k DAU; prompt injection through OCR'd student images into a system holding answer keys; whether sending a 16-year-old's error history to a US model provider is a DPDP transfer *and* s.9(3) profiling problem; and whether AI-generated questions have any Indian copyright protection at all, which matters enormously if content is the moat.
2. **B2B2C as an actual business.** Three agents concluded the admin suite wins coaching centres, then nobody researched procurement cycles, per-seat pricing, channel conflict against a ₹1,999 B2C price, B2B GST and e-invoicing, SOC2/ISO as a procurement gate, or contract length. If this is the real model, the schema and RBAC design need to start from tenancy.
3. **Growth and pricing.** Free-to-paid conversion rate is listed as an open question and never answered — it is the single most important number in the model, and the entire ₹1,799–1,999 recommendation is unanchored without it. Also missing: CAC benchmarks, ASO for JEE/NEET keywords, YouTube-teacher partnerships (the dominant Indian acquisition channel, colliding with ASCI influencer-disclosure rules), paywall design, trial length.

**Changes the architecture:**

4. **Syllabus as a versioned first-class object.** JEE and NEET have overlapping but *different* chapter taxonomies — a single tree is wrong. NCERT and NTA syllabi diverge. A question tagged to a chapter that leaves the syllabus in 2027 must remain scorable in a PYQ replay but excluded from a 2027 blueprint.
5. **Search.** LaTeX is not usefully searchable by `tsvector` — you cannot text-index `\frac{d}{dx}` and get useful recall. Formula search needs a normalised symbolic index or embeddings. Separately, Postgres ships no Hindi/Devanagari stemmer, so bilingual full-text search needs a third-party configuration.
6. **Notifications.** Only FCM was researched. Missing: Chinese-OEM battery killers (MIUI/ColorOS/FunTouch aggressively drop FCM delivery on exactly the devices this market uses, making push unreliable for "your live test starts in 10 minutes"), and WhatsApp Business API, which is how every competitor actually reaches students — with its own pricing, template approval and 24-hour session window.
7. **Print, PDF export and OMR.** Allen still ships 8 of 19 NEET tests on paper. The blueprint generator's most-demanded output is a print-ready PDF plus an OMR sheet. Direct tension with the anti-leak posture, unexamined.
8. **Accommodations.** No model at all for the PwD entitlements the NEET bulletin grants — compensatory hour, scribe, pro-rata time — and hardening against Android overlay attacks blocks TalkBack, because accessibility services are exactly what a cheating overlay uses.

**Also absent:** onboarding and diagnostic placement (FSRS and Elo both have a cold-start problem for the *student*, not just the item); video hosting economics and YouTube ToS; doubt resolution and its child-safety liability; account recovery when a student loses their phone number; content operations as a business function (editors, cost per question, SME IP-assignment contracts, make-vs-license); tablet layouts; dark mode including the non-trivial problem of inverting KaTeX-rendered math; DPDP-safe product analytics for minors (Amplitude and Mixpanel are US processors profiling children); whether A/B-testing minors is even lawful under s.9(3); insider threat (students are barred from bulk export, admin contractors are not); testing strategy for a timed engine; exam-scope expansion to BITSAT/CUET/state CETs, which is the actual TAM lever.

---

## 11. Risk register

Full version with likelihood and impact in `_synthesis-thesis.md` §6. The four that could end the project:

- **DPDP child-consent retrofitted too late.** The majority of users are 16–18, so s.9(1) verifiable parental consent and the s.9(3) tracking ban are the default path, not an edge case. MeitY's February 2026 consultation may compress the runway. Exposure is ₹200 crore plus a Board erasure order. The realistic failure is not the fine — it is amputating your growth engine at month nine while a competitor that never built one grows unimpeded. Every standard growth mechanic (optimised push timing, personalised offers, churn nudges, engagement A/B tests) is legally unavailable for this cohort.
- **Rewards layer classified as an online money game.** The Promotion and Regulation of Online Gaming Act 2025 captures "other stakes" including coins equivalent or convertible to money. Skill is irrelevant. Three years plus ₹1 crore, with personal officer liability, and the constitutional challenge is pending before a larger Supreme Court bench. Mitigation is the closed-loop coin invariant enforced in the database plus a documented kill switch for the whole module.
- **Content operations under-resourced.** A 100k-item bank at a 1% error rate is 1,000 wrong questions. Every competitor gets caught here. The specific predictable failure: a small team ships a beautiful CBT player against a thin, hastily-ingested bank; the first live mock surfaces four broken questions; and the defensible-scoring positioning becomes an *active liability* because the product loudly claims correctness it does not have.
- **A visible failure during a live all-India mock.** 10,000 students starting and finishing at the same second is the single most important product moment and the most under-rehearsed risk, because load testing at 1.5× target is unglamorous and always slips.

---

## 12. Roadmap

- **Phase 0 — Engine truth (internal).** Immutable content model, marking rules as data, golden test suite generated from the verbatim 2026 papers, server-authoritative attempt state machine, idempotent rescore, RLS style guide with CI persona suite. *Done when* a seeded historical JEE Advanced 2026 Paper 1 scores identically to the published key across 100 synthetic attempts, a simulated key revision rescores 10,000 attempts idempotently with zero drift, and a student JWT hitting PostgREST directly during an in-progress attempt returns 403 or empty on every solution and key column.
- **Phase 1 — The free engine (public v1).** Everything tagged MVP. *Done when* three consecutive weekly live mocks run at ≥3,000 concurrent with zero stuck attempts, zero duplicate results, zero rescore drift, and p99 answer-sync under 800 ms from an Indian 4G device.
- **Phase 2 — Content ops at scale and monetisation proof.** OCR ingest, duplicate detection, Hindi, psychometrics, predicted rank. *Done when* the bank exceeds 60,000 published provenanced items and free-to-paid conversion clears 3% at 90 days.
- **Phase 3 — Institutional control plane.** Tenancy, blueprint MILP assembly, per-institute analytics. *Done when* five paying coaching centres are live and renewing.
- **Phase 4 — Adaptivity and prediction.** Offline IRT calibration, Elo-driven practice selection, study planner, counselling predictor. Nothing here kills the project; failure means the product plateaus as an excellent non-adaptive engine, which is still a viable business.

The dominant schedule risk is Phase 12-shaped: the admin console in §8 is genuinely a multi-year product and is the most seductive place to over-build. Phase 1 admin is authoring, review, marking rules, test builder and rescore — nothing else — and that discipline will be under constant pressure from exactly the institutional conversations that make the wedge attractive.

---

## 13. Next

`requirement.md` comes next and will lift §7's full inventory into numbered, testable requirements with acceptance criteria, cross-referenced to the 139 edge cases. It is blocked only on the four decisions marked BLOCKING in §4 — tell me those and I will write it in one pass.

Then `skill.md` (the repeatable procedures: authoring an item, publishing a paper, running a live mock, executing a rescore), `agent.md` (the subagent roster for building and operating this — content-ops agent, RLS-audit agent, scoring-golden-test agent, load-rehearsal agent), and `mcp.md` (the MCP servers worth wiring in — Supabase, GitHub, Playwright for CBT-player regression, Mathpix or a vision model for ingest, plus what to avoid).
