# Hostile Completeness Review — JEE/NEET Platform Dossier

**Verification note:** web-search budget was exhausted before I could run checks. I verified two claims against primary PDFs already cached locally: the JEE Advanced 2026 Paper 1 marking scheme (**confirmed** — Section 2 is `Negative Marks : −1 In all other cases`, with the exact +3/+2/+1 ladder as stated; 12 sections; List-I 4 entries / List-II 5 entries; numerical truncate/round to two decimals) and the NEET UG 2026 Information Bulletin (**confirmed** — 03 May 2026, pen-and-paper, 180 Q / 180 min, 14:00–17:00 IST, plus a compensatory-hour and pro-rata scribe provision the dossier never mentions). Everything else in §2 is flagged, not disproven.

---

## 1. UNCOVERED DOMAINS

Ranked by how much they change the architecture or the business, not by how much text is missing.

### 1.1 The AI layer — a total blind spot, and it is not a defensible omission in 2026
The dossier mentions AI exactly twice, both times to say *don't lead with AI doubt-solving*. That is a positioning conclusion masquerading as research coverage. Nothing was researched on:
- **AI as the content-ops engine, not a feature.** The dossier's headline differentiator is *per-option rationales* — "explain why each distractor is wrong." At 100k questions that is ~400k rationales. At Indian SME rates (₹30–150/question) that is ₹1.2–6 crore of human writing. Nobody costed it, and nobody asked whether an LLM writes the first draft. This single omission invalidates the feasibility of the #1 recommended differentiator.
- **Answer-key QA by model disagreement.** The dossier's own pitfall is "a 1-lakh bank at 1% error = 1,000 wrong questions," and the only proposed detectors are student reports and psychometrics needing ≥100 responses per item — i.e. both fire *after* a student has been harmed. Running 3 independent models per item and flagging disagreement is the cheapest pre-publication key check that exists. Absent.
- **Question variant generation** (numerically-perturbed clones of a seed), which is exactly the `VARIANT_OF` relation admin-authoring proposes but never explains how to populate.
- **LLM grading of numeric/derivation answers**, RAG over a student's own error history, and adaptive hint generation.
- **Token economics in INR at 10k DAU** — no cost model at all. A doubt-solving feature at 3 doubts/student/day is a real recurring cost line nobody sized.
- **Prompt injection**: an admin-facing LLM that OCRs a student-uploaded image, or a doubt-solver that reads student text, is an injection surface into a system holding answer keys.
- **Cross-border + child data**: sending a 16-year-old's error history to a US model provider is simultaneously a DPDP transfer question and arguably s.9(3) profiling. The compliance stream never touches AI.
- **Platform policy**: Apple 4.7 and Google Play's Generative AI policy require in-app reporting of offensive AI output and specific disclosures. Not researched.
- **IP**: AI-generated questions likely have no human author and therefore no Indian copyright — your generated bank may be legally unprotectable, which matters enormously if content is the moat.

### 1.2 The web companion app — and the fact that the flagship feature may be undeliverable on mobile
The flagship recommendation is a *pixel-faithful NTA CBT simulator*. The real exam is a desktop CBT with a mouse, a 15–24" screen, physical rough sheets, and no touch. Practising it on a 6" phone is not a fidelity clone; it is a different exam. Nobody researched a web build. Consequences nobody drew:
- MARKS explicitly ships a "distraction-free web version"; Quizrr's NTA-clone is web.
- The admin console *must* be web anyway (MathLive, TipTap, Ketcher are all web-only per the RN stream), so a web codebase exists regardless.
- **A 3-hour full-length mock on a phone is arguably the wrong product entirely.** The mobile product may be practice + SRS + review, with mocks on web. Nobody asked.

### 1.3 B2B2C / coaching-institute sales — repeatedly gestured at, never researched
Three separate streams conclude "the admin authoring suite is how you win coaching centres," and then nobody researches the business. Missing entirely: **multi-tenancy** (tenant isolation in RLS is a fundamentally different and harder problem than per-user isolation, and it is a schema decision that cannot be retrofitted); white-labelling; per-institute branding; batch/section/roster management; teacher dashboards; institute-admin role hierarchy; procurement cycles and payment terms; B2B GST (reverse charge, e-invoicing above ₹5 cr); channel conflict between a ₹1,999 B2C price and a per-seat institute price; SOC2/ISO as a procurement gate; contract length and churn. If B2B2C is the real model — and the evidence in the dossier points that way — then the entire schema and RBAC design in the Supabase stream is wrong from line one.

### 1.4 The parent as a *user*, not just a consent artefact
Compliance requires a verified adult for VPC. Nobody researched the parent as a persona with a product surface: parent dashboard, weekly progress digest, parent-paid subscription mechanics, **the fact that in India the parent is the buyer and the student is the user** (which inverts the funnel, the pricing page, the ad creative and the churn model), and the tension that parent visibility is both the strongest retention lever and a documented wellbeing hazard for this exact cohort. The "no telesales, self-serve, don't collect a phone number" brand position is *structurally incompatible* with a parent-verified, parent-paid onboarding — and nobody noticed.

### 1.5 Doubt resolution and any form of UGC
Named as "the most reliably broken promise in the category" and then never designed. Missing: community Q&A economics, human doubt-solver unit cost, moderation tooling and cost, and — critically — **child-safety liability**. A predominantly-minor user base with any student-to-student or student-to-tutor messaging is a grooming-risk surface that is a category-ending liability, plus IT Intermediary Rules obligations, plus Apple 1.2 (filtering, reporting, blocking, published contact). Zero research.

### 1.6 Video / solution hosting — the business model rests on it and it was never examined
"YouTube solution links" is the stated cost-structure advantage. Unresearched:
- **YouTube ToS.** You must use the official IFrame/native player, may not strip ads, may not download or background-play, and monetising a paid experience around third-party content you do not own is at minimum a policy question.
- **Embedding the standard player for a minor sets Google identifiers** — the compliance stream flags this as an s.9(3) problem, but the video/solution stream doesn't exist to receive it.
- **Link rot** — creators delete videos; you need a link-health crawler and a fallback, or solutions silently 404 at scale.
- **YouTube is throttled or blocked** on many coaching-centre and school networks.
- **The alternative economics were never modelled**: Mux/Cloudflare Stream/Bunny per-minute-delivered vs YouTube's zero, HLS ABR for Indian 4G, DRM if you ever license content.

### 1.7 Notifications and re-engagement — the India-specific failure mode is absent
Only FCM v1 and the Expo 600/sec cap are mentioned. Missing:
- **Chinese-OEM battery killers.** MIUI/ColorOS/FunTouch aggressively kill background processes and drop FCM delivery. Real-world push delivery loss on exactly the devices this market uses is large and well known. This makes push an unreliable channel for "your live test starts in 10 minutes."
- **WhatsApp Business API** — the actual notification channel in Indian edtech, with its own per-conversation/per-message pricing, template approval, opt-in rules and 24-hour session window. Completely absent, despite being how every competitor reaches students.
- Android 13+ `POST_NOTIFICATIONS` runtime permission and realistic grant rates; quiet hours; notification taxonomy; and the engineering consequence of the legal ban on ML-timed nudges for minors.

### 1.8 Onboarding and diagnostic placement
Zero research. No time-to-first-value design, no diagnostic-test design (how do you place a student without a 3-hour test?), no activation metric, and — structurally — **FSRS and the Elo item-difficulty engine both have a cold-start problem on day one for both the item and the student**, which the open-source stream acknowledges for items and ignores for students.

### 1.9 Search and discovery
Absent, despite "a searchable Notebook with backlinks" being named a top-5 differentiator. Unresearched: **LaTeX is not usefully searchable by `tsvector`** — you cannot text-index `\frac{d}{dx}` and get useful recall; formula search is a genuinely hard problem needing a normalised symbolic index or embeddings. Also: **Postgres has no built-in Hindi/Devanagari stemmer or dictionary**, so bilingual full-text search needs a third-party config. Neither is mentioned.

### 1.10 Printing and PDF export — and OMR
Indian students and institutes print papers. Allen still ships 8 of 19 NEET tests as pen-and-paper. The admin blueprint generator's most-demanded output is a print-ready PDF plus an OMR sheet, and TCExam (the closest OSS analogue) ships OMR scanning. Nobody researched server-side LaTeX/Typst→PDF, per-student watermarking, or OMR generation/scanning — nor the direct tension with the anti-leak posture.

### 1.11 Study planner / timetable integration
UWorld's Study Planner is named as one of the *two highest-perceived-value paid features* and then never researched. No calendar model, no syllabus-to-exam-date planning, no coaching-timetable import.

### 1.12 Growth, acquisition and pricing experimentation
The legal stream covers referral *fraud*; nobody covers growth. Missing: CAC benchmarks for Indian edtech, ASO for JEE/NEET keywords, Google UAC/Meta install economics, YouTube-teacher partnerships (the dominant Indian acquisition channel, and it collides with ASCI influencer-disclosure rules), and the entire monetisation mechanic layer — paywall design, trial length, freemium boundary, EMI/BNPL (a post-Byju's regulatory minefield), scholarship waivers. **Free-to-paid conversion rate is listed as an open question and never answered — it is the single most important number in the business model and the whole ₹1,499–1,999 recommendation is unanchored without it.**

### 1.13 Content operations as a business function
Admin *tooling* is well covered. Content *operations* is not: how many editors, cost per question, SME recruitment and IP-assignment contracts, throughput to reach 100k items, make-vs-license (MathonGo/Quizrr licensing is an open question with no market research), and **the sequencing problem — you cannot launch with an empty bank, and the dossier never sequences content acquisition against engineering.**

### 1.14 Support, ops and account recovery
Grievance officers and SLAs are covered as *law*. The actual stack is not: helpdesk tooling, support volume per 1,000 users, the refund workflow, the live-mock ops runbook, and **account recovery when a student loses their phone number** — endemic in India, and fatal in an OTP-only auth design.

### 1.15 Syllabus as a first-class versioned object
Everyone assumes Subject→Chapter→Topic. Nobody researched: JEE and NEET have *overlapping but different* chapter taxonomies (a single tree is wrong); NCERT vs NTA syllabus divergence; the 2025 NEET syllabus reduction/restoration; class-11 vs class-12 split; and **syllabus versioning across years** — a question tagged to a chapter that leaves the syllabus in 2027 must remain scorable in a PYQ replay but excluded from a 2027 blueprint.

### 1.16 Also entirely absent
Tablet/large-screen layout design; dark mode and long-session ergonomics (including the non-trivial problem of inverting KaTeX-rendered math, which collides with the reported 0.18 CSS class rename); handwriting/stylus input for rough work and notes; internationalisation beyond language (NRI/Gulf students; export markets); analytics/BI event schema and DPDP-safe product analytics for minors (Amplitude/Mixpanel are US processors profiling children); A/B-testing infrastructure *and whether A/B-testing minors is lawful under s.9(3)*; admin account compromise and insider threat (an SME contractor exfiltrating the bank — students are barred from bulk export, admins are not); testing strategy for a timed engine (deterministic time, device farm, visual regression for LaTeX, chaos-testing the timer); exam-scope expansion (state CETs, BITSAT, CUET, boards — the actual TAM lever); and competitive response (every named differentiator is a 4–8 week feature for a company with 200 engineers).

---

## 2. UNVERIFIED OR SUSPECT CLAIMS

**Confirmed on inspection (so you can stop worrying about these):** JEE Advanced 2026 Paper 1 Section 2 negative marking is indeed **−1**, with the exact partial ladder described, and the four-section structure is as stated — verified verbatim from [jeeadv.ac.in Paper 1](https://jeeadv.ac.in/documents/p1_english.pdf). NEET UG 2026 was scheduled 03 May 2026, pen-and-paper, 180 Q / 180 min, 14:00–17:00 IST, per the [official Information Bulletin](https://neet.nta.nic.in/). The exam-fidelity stream is the most reliable stream in the dossier.

**The single most load-bearing unverified claim: the NEET 2026 cancellation narrative.** The whole flagship recommendation ("ship an NTA CBT clone, market it against the 2027 NEET CBT transition") rests on: a 12 May 2026 cancellation, a 21 June 2026 re-exam, and a 15 May 2026 ministerial CBT announcement. I could not verify any of it (search budget exhausted, `neet.nta.nic.in` returned 403). Three reasons for suspicion: (a) it is structurally near-identical to the *real, well-documented* NEET 2024 controversy, which the compliance stream cites separately with 2024 dates and 2024 details (paper photographed 08:02, answers distributed 10:40) — the same event may have been duplicated forward two years; (b) the suicide counts are inconsistent across streams ("at least 12 linked to the 2026 leak" vs "≥32 in 2025, ≥14 already in 2026"); (c) NEET-to-CBT has been a live proposal since the 2024 Radhakrishnan Committee, so a plausible-sounding 2026 announcement is exactly what a low-quality source would confabulate. **Verify this against primary NTA public notices before a single architectural decision is justified by it.**

Other suspect items, by severity:

| Claim | Problem |
|---|---|
| Twilio India SMS cost | **supabase-scale says ₹0.45–0.63/SMS; edge-scale-security cites Twilio's published $0.0832 ≈ ₹7.3/SMS.** ~12–15× apart. The derived launch costs differ by 15× ($75–105 vs $1,500). At least one is wrong. |
| "10,000 concurrent is ~0.25% of the NEET cohort" | Arithmetic error. 10,000 / 22,79,743 = **0.44%**. 0.25% is roughly the combined JEE+NEET funnel. Small, but it is a sanity-check number used to justify the target. |
| "180M answer rows ≈ 25–35 GB ≈ $4/mo" | Row-byte arithmetic. Supabase bills *provisioned disk*, which includes indexes, WAL, bloat and headroom — realistically 3–4× the row estimate. The "storage is a non-issue" conclusion is directionally right but the number is not. |
| PowerSync "~$319/mo at 10k concurrent" | Conflates *peak concurrency* with *billed concurrent connections*. Also assumes every student holds a sync connection for the whole billing period. The comparison against a hand-rolled sync is decided on this number. |
| Duolingo retention figures (2.4× at 7-day streak; streak freeze −21% churn; leagues +25%; 30.63 vs 18.87 days) | These are growth-blog reconstructions, not Duolingo research publications. The 30.63/18.87 figure is suspiciously precise. More importantly they are **correlational** — users who hold streak freezes are users who engage more. The dossier treats them as causal design targets. |
| iOS rating counts as evidence that "iOS is under-served, polished iOS is cheap share" | India is ~4–5% iOS by units. Tiny iOS rating counts are evidence the *market* is small, not that it is under-served. The iTunes Search API also returns inconsistent rating-count fields across versions. The conclusion may be exactly backwards for a market that is >95% Android. |
| "MARKS has no native iOS app — confirmed via iTunes Search API" | The Search API is unreliable for *negative* claims (region, name normalisation, bundle vs display name). A strategic wedge rests on a negative result from a fuzzy-matching endpoint. |
| "Testbook 63.9 MB vs PW 428.8 MB → bundle size is a competitive variable" | Comparing iOS IPA sizes; Android AAB/APK sizes differ materially, and PW's size reflects offline video capability the practice app does not need. Not a like-for-like comparison. |
| KaTeX 0.17 (2026-05-22) and 0.18 (2026-07-17) with a breaking CSS class-prefix change | KaTeX sat on 0.16.x for ~4 years. Two majors in two months with a breaking change is an unusual cadence. Verify before designing a dark-mode/theming strategy around it. |
| react-native-webview: Expo pins 13.16.1, npm latest 14.0.1, "with 15.0.0 and 16.0.0 already published" | Three majors in short order for a library that has been on 13.x for years. Verify. |
| "TrueSkill is patent-encumbered — avoid" | Microsoft's TrueSkill patents were filed ~2005–2007; US patents run ~20 years from filing, so the core patents are expiring or expired around now. The advice may be stale. (openskill is still the right choice for other reasons.) |
| "CTFd handles ~1,000 concurrent" | Sourced to an unnamed "third-party 2026 assessment," i.e. a blog. Used to argue a scaling ceiling. |
| Gamified-learning meta-analyses (d≈0.57; g=0.654) | No publication-bias analysis (funnel plot, Egger's test) in a literature notorious for it. The dossier correctly discounts the d=1.12 / I²=99% figure and then treats the others as solid. |
| PROGA 2025 section numbers (s.2(f)/(h)/(i), s.5/6/7) and the 2026 Rules | Section numbering varies between summaries; the 2026 Rules and the Online Gaming Authority are entirely post-cutoff and unverified. Criminal-liability advice should not rest on secondary numbering. |
| "DGGI v. Gameskraft, 2026 INSC 595, 27 May 2026" | Specific citation, unverified. The substantive holding is plausible; the citation should be checked before it is quoted to anyone. |
| ALLEN ₹999 test series; Quizrr pricing | The dossier itself flags these as third-party/unverified — but then uses them to anchor the ₹999–₹3,500 addressable band and the ₹1,499–1,999 recommendation. The pricing recommendation is built on data the dossier admits it could not verify. |
| Rajasthan Coaching Centres Act applicability | Whether an app is a "coaching centre" (>100 students) is flagged as open — yet the leaderboard design recommendation is presented as settled compliance. |
| MoE 2024 coaching guidelines' **below-16 enrolment bar** | Mentioned once at "confidence: medium" and never followed up. If it applies to online platforms, it is an existential constraint on any class 9–10 offering. |

---

## 3. CONTRADICTIONS

1. **Offline practice vs anti-leak.** competitors + react-native-math: "ship genuine offline practice, pre-download question sets — this is impossible for video-first incumbents." Security streams: "never expose a bulk question-export endpoint to STUDENT-role tokens; serve one screen at a time; watermark per session; content leakage is now a legal hazard." **An offline chapter download IS a bulk export to a device you do not control.** Unreconciled.

2. **Prefetch-everything vs serve-one-at-a-time.** EC-HERD-03 and EC-DATA-05 mandate downloading all 90 questions and images before the timer starts (for CDN and resilience reasons). EC-LEAK-10 mandates *not* shipping later sections until earlier ones are submitted (for section-lock and leak reasons). These are mutually exclusive designs for the same screen.

3. **Leaderboards.** competitors: All-India Rank/percentile after every mock is *table stakes*, and the shareable rank card is the organic growth loop. gamification-legal: global rank is a wellbeing hazard, Rajasthan bars publishing assessment results, ship bucketed ~30-peer cohorts and make it opt-in. exam-fidelity: compute NTA-style percentile across the full cohort. Three streams, three incompatible defaults on the product's most visible surface.

4. **FSRS card granularity.** open-source: the card **must** be `(student, sub_topic)` — "treating FSRS as a drop-in for MCQs will fail." competitors: copy UWorld SmartCards — "one-tap convert a wrong answer into a spaced-repetition card carrying the question image," i.e. `(student, question)`. Directly opposed, and the dossier recommends both.

5. **Two-role RBAC.** admin-authoring: "two roles is the single biggest architectural mistake in the brief." supabase-scale: builds its entire canonical RBAC recommendation on `app_role ('admin','student')`. The Supabase stream implements the mistake the authoring stream identifies.

6. **PYQ copyright.** competitors: "NTA papers are public"; the only flagged risk is coaching-institute *solutions*. edge-compliance EC-IP-01: s.52(1)(i) does **not** cover commercial reproduction, NTA requires written permission, and the exposure is the *questions themselves*. One stream treats the core content asset as free; the other treats it as an injunction risk.

7. **Compute headroom.** supabase-scale: "a 4XL is ample headroom for 10k concurrent; mobile clients don't consume connections." edge-scale-security EC-HERD-01/09: the pooler is the bottleneck, Supabase warns against exceeding 40% of max_connections under heavy PostgREST, and "each PostgREST request consumes a pooler connection for its duration." Both technically true; the risk pictures are opposite.

8. **Realtime.** supabase-scale: use Broadcast for leaderboards and live counters. edge-scale-security EC-HERD-05: "do NOT make Realtime load-bearing," and 10k is *exactly* the Pro-no-spend-cap ceiling with zero headroom.

9. **Randomisation as anti-cheat vs randomisation as fairness risk.** competitors recommends "per-student randomisation" as a defensible anti-leak claim; admin-authoring warns that randomising *content* destroys rank comparability without parallel-form equating. The two uses of the word "randomisation" are conflated throughout.

10. **Coin expiry.** gamification-legal: 180-day inactivity decay, "legally safe only because coins are never purchased." edge-compliance EC-REWARD-02: if coins ever ride inside an IAP subscription SKU, Apple 3.1.1 forbids expiry. The dossier recommends coins as a subscription-adjacent perk *and* expiry.

11. **Frictionless signup vs verifiable parental consent.** competitors: self-serve, no phone number, no sales calls — a brand differentiator with "zero engineering cost." edge-compliance: a majority-minor user base needs verified parental consent *before any processing*, with the parent as the contracting party for payments. These cannot both be true.

12. **Deploy freeze.** EC-DATA-02 and EC-SESSION-06 require a hard deploy/OTA freeze during live tests. react-native-math and competitors position EAS Update as the hotfix mechanism. Nobody states the resulting operational constraint: **you cannot hotfix during your highest-risk window.**

---

## 4. THE HARD QUESTIONS THE USER HAS NOT ANSWERED

Each is a human decision that blocks code. Default in bold.

1. **Who is the customer — the student, the parent, or the coaching institute?** This determines schema (multi-tenant or not), auth, pricing, compliance posture and the entire funnel. → **Default: build multi-tenant + parent-as-payer from line one; sell B2C first, but never ship a single-tenant schema.** Retrofitting tenancy is a rewrite.
2. **Mobile-only, or web + mobile?** The flagship NTA CBT clone arguably cannot be honestly delivered on a phone. → **Default: web-first for full-length mocks (which also gives you the admin console for free); RN for practice, SRS, review and notifications.**
3. **Do you serve under-18s?** Serving them means VPC, no behavioural tracking, no ads, parent contracting, and a 2026/2027 compliance deadline. Not serving them removes ~80% of TAM. → **Default: serve them, build VPC and the two-pipeline telemetry split now.** There is no cheap middle.
4. **Where does content come from — license, commission, OCR the PYQs, or AI-generate?** Each has a different cost, timeline, and IP risk, and this decision sequences the entire launch. → **Default: NTA-permissioned PYQs + 5k commissioned originals + AI-drafted rationales under mandatory human review.** Get the NTA permission letter first; it is cheap.
5. **Is the free tier at MARKS parity (full PYQ bank free) or is the bank the paywall?** → **Default: full PYQ bank free.** You cannot acquire against a free 1-lakh-question competitor otherwise, and the dossier's own monetisation thesis depends on it.
6. **Public All-India rank, or private cohort rank?** Growth loop vs wellbeing/regulatory exposure. → **Default: private bucketed cohort + a private predicted percentile + a shareable card that displays only *your* number, version-stamped.**
7. **Are graded mocks ever available offline?** → **Default: no. Offline = untimed practice and flashcards only; never the timer, never the key.**
8. **Are coins ever purchasable with money?** → **Default: never.** This one invariant keeps you out of PROGA, Apple 3.1.1 expiry, and the GST/actionable-claim analysis simultaneously.
9. **Do you run prize contests at all?** The Prize Competitions Act's ₹1,000/month and 2,000-entry caps make meaningful prizes unlawful in the states that matter. → **Default: no prize contests. Recognition, in-app utility and subscription credit only.**
10. **Any UGC — doubts, community answers, shared notes?** → **Default: none in v1.** UGC triggers intermediary obligations, moderation cost, Apple 1.2, and child-safety liability in a minors-only product.
11. **Which exams in v1 — JEE Main only, or all three?** JEE Advanced fidelity (four scoring engines, matching-list, shared stems, asymmetric papers) is roughly 3× the engine complexity for ~11% of the funnel. → **Default: JEE Main + NEET in v1; JEE Advanced in v2 with the data-driven marking schema already in place.**
12. **YouTube embed, deep-link-out, or self-host?** → **Default: deep-link-out with an interstitial for under-18s; self-host only content you own.** Embedding is a DPDP and platform-policy problem, not just a UX one.
13. **Hindi at launch, or English-only?** It is a schema decision (translations as versioned children with the key on the English parent), not a later feature. → **Default: ship English UI + English content, but build the bilingual schema now** and add Hindi content for NEET first.
14. **Is the answer-key rescore pipeline pre-launch or post-launch?** → **Default: pre-launch, non-negotiable.** You will need it within the first three mocks and it is unbuildable once leaderboards and coins are denormalised.
15. **Venture-scale or profitable-niche?** The entire "no telesales, transparent refund, self-serve" positioning is a *growth-capping* choice. It is the right brand and the wrong growth engine. Nobody asked which business this is. → **Default: decide before you set the price band**, because ₹1,999/year × any realistic conversion does not fund a venture-scale burn.

---

## 5. TEN EDGE CASES NOBODY LISTED

1. **Rough work happens on paper, off-screen — which corrupts every time-based analytic and trips the anti-cheat.** A 3-hour JEE mock needs ~15 sheets of paper. The student's `time_spent_ms` on a question measures *time with the question visible*, not time thinking; a student who screenshots-in-their-head, works on paper for four minutes and returns generates a wildly wrong "fast answer." This poisons the overtime flag, the cohort-median comparison, **and the FSRS grade derivation** ("correct & fast = Easy"), which the open-source stream makes load-bearing. Worse, putting the phone down triggers screen-lock and, on Android, the `background` AppState transition that EC-CHEAT-05 records as a cheating signal. The most diligent students look most like cheaters. *Fix: model rough-work explicitly (an in-app scratchpad the student can toggle, which keeps the app foregrounded and produces an honest dwell signal), and never derive an SRS grade from response time on a paper-and-pencil-heavy subject.*

2. **The app must know the real exam calendar and kill its own gamification for the cohort sitting the exam.** A student writes NEET on 3 May and does not open the app for three days. On 4 May the app breaks their 187-day streak, relegates them from their league, and sends a re-engagement push — on the worst possible day of their life. Nobody built the obvious rule: an admin-maintained exam calendar that auto-freezes streaks, suppresses all notifications, pauses league relegation, and hides leaderboards for every user whose declared exam is *today*. Extends to Class 12 board exams (Feb–Mar), which empty every league for three weeks simultaneously.

3. **Indian phone-number recycling is an account-takeover vector into a minor's account.** Disconnected Indian mobile numbers are reallocated after ~90 days. In an OTP-only auth design with no password, whoever receives the recycled number can OTP straight into the former owner's account — inheriting attempt history, coins, notes and a minor's PII. That is simultaneously an ATO and a DPDP disclosure of a child's data to a stranger. *Fix: bind identity to email + phone, force a second factor on first login from a new device after N days dormancy, and expire dormant OTP-only sessions.*

4. **The shared family phone.** Two siblings — one JEE, one NEET — share one device. Either they share one account (poisoning FSRS state, mastery analytics, the leaderboard, and the DPDP consent record which now names the wrong child), or they create two accounts and are caught by the one-device-per-account anti-fraud rule (EC-REW-01) and the device-bound attempt session (EC-CHEAT-02). The second sibling also cannot borrow the phone mid-mock without triggering `SESSION_SUPERSEDED`. Device-lineage anti-fraud and Indian household device economics are in direct conflict, and nobody modelled it.

5. **An exam date moving invalidates every student's SRS schedule and creates a review-debt cliff.** FSRS "exam mode" raises `desired_retention` as the target date approaches. If an exam is cancelled and re-run seven weeks later, every card's interval was computed against the wrong horizon: naively re-targeting makes thousands of cards simultaneously not-due, then all due at once. Test-series schedules, contest calendars and streak goals keyed to the old date break too. *Fix: make the exam date a user-level parameter that the scheduler re-optimises against with interval smoothing, and treat a date change as a batch re-plan job, not a config edit.*

6. **A PYQ's correct answer can become wrong because the world changed, not because the key was wrong.** NCERT revises a value; a taxonomic classification changes; a chapter leaves the syllabus. The dossier's key-versioning models "we made a mistake." It does not model "this was correct in 2019 and is incorrect under the 2027 syllabus." A PYQ replay must score against *its own year's key and its own year's syllabus*, while the same item must be excluded from a 2027 blueprint and flagged in the notebook as superseded. Temporal correctness is a distinct axis from key revision.

7. **The collusion detector will flag entire coaching batches, because a shared teacher produces shared wrong answers.** EC-CHEAT-04 proposes Jaccard similarity on *wrong* answers as the strong collusion signal — which is right in general and catastrophically wrong here. Four hundred students taught the same misconception by the same faculty member will select the same distractor at high rates. So will twins, hostel roommates, and anyone working from the same photocopied module. The base rate of legitimately correlated errors in this market is enormous. *Fix: score similarity against a batch/institute-conditioned baseline, not a global one; never act on similarity without an independent second signal (device, IP, timing lockstep).*

8. **Predicted rank is simultaneously your most-shared artefact and a regulated claim — and a rescore turns a screenshot into evidence you lied.** The CCPA coaching guidelines prohibit false statements of ranks or success rates, and ASCI requires a "past record is no guarantee of future prospects" disclaimer. "Predicted AIR 4,200" published to a 17-year-old, followed by an actual 40,000, is arguably a misleading representation. Separately: a student screenshots AIR 412 and posts it; an upheld key challenge moves them to 590; the screenshot is now circulating as proof the platform is unreliable. Every number a student can share must be immutable or carry a `result_version` plus a short link that resolves to the current, annotated result with a public revision log.

9. **Anti-cheat lockdown locks out disabled students, and there is no accommodations model at all.** Android accessibility services are exactly what a cheating overlay uses — so hardening against overlays blocks TalkBack. FLAG_SECURE and iOS AutomaticAssessmentConfiguration further restrict the assistive surface. Meanwhile the NEET UG 2026 bulletin (verified above) provides **a compensatory hour, a scribe, and pro-rata additional time** for PwD candidates. The dossier's server-authoritative deadline has no concept of an accommodation entitlement attached to a *user* — only ad-hoc extensions attached to an *incident* — and the leaderboard has no way to compare a lawful 240-minute attempt against 180-minute attempts. A blind NEET aspirant cannot use this product at all.

10. **The custom-test builder returns empty sets on day one — and the error-report channel can be brigaded to manufacture marks.** Two failure modes on the two flagship features:
    - *Filter sparsity:* "Rotational Motion + Hard + Unattempted + PYQ 2019–2023" over a young bank returns two questions. UWorld-style combinatorial filters promise depth the bank cannot supply; an empty state on the headline feature reads as a broken app. *Fix: constraint relaxation with an explicit "we widened X to find these" banner, and a live count next to every filter chip.*
    - *Report brigading:* a WhatsApp group instructs 3,000 students to report Q42 as ambiguous, hoping for a void that awards everyone +4. Report volume becomes an attack on scoring. *Fix: dedupe by (question, user), weight reports by the reporter's historical report precision, require a written reason, and never let volume alone trigger a void — statistical signals (negative point-biserial, distractor out-discriminating the key) must corroborate.*

**Honourable mentions that also appear nowhere:** 400 devices on one coaching-centre AP all prefetching a 30 MB paper simultaneously (the AP dies, nobody starts, and the CDN sees one IP pull 12 GB and rate-limits it as abuse); a student deliberately toggling airplane mode to manufacture a "platform-caused time loss" incident and claim a re-attempt on an equivalent paper *after having seen the questions* — a hole in the compensation ladder itself; dual-exam PCMB students who need two cohorts, two blueprints and two difficulty targets from one FSRS card; and a student switching target exam mid-year, which orphans all mastery, SRS state and predicted-rank calibration in a taxonomy that does not map across exams.

**Sources used for verification:** [JEE (Advanced) 2026 Paper 1](https://jeeadv.ac.in/documents/p1_english.pdf), [NTA NEET (UG) 2026 Information Bulletin](https://neet.nta.nic.in/)