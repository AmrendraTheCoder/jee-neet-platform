# Skills — Operating Procedures

**Status:** Phase 3 of 4.
**Date:** 2026-07-25
**Depends on:** [requirement.md](requirement.md) · [00-IDEATION.md](00-IDEATION.md)

---

## How to use this file

Each section below is a self-contained skill. Copy it to `.claude/skills/<name>/SKILL.md` in the repository, keeping the frontmatter block. Claude Code will then surface it by name (`/<name>`) and load it automatically when the described situation arises.

These are not documentation. They are procedures with gates — each one exists because skipping a step in it produces a specific, catalogued failure. Where a step cites a requirement ID (`FR-*`, `NFR-*`) or an edge case (`EC-*`), that citation is the reason the step is there.

**The ten skills, and what each prevents:**

| Skill | Prevents |
|---|---|
| `author-item` | A wrong or unrenderable question reaching a scored mock |
| `publish-paper` | A malformed paper, or composition changing mid-window |
| `run-live-mock` | The single most visible failure mode the platform has |
| `execute-rescore` | A key correction silently corrupting ranks and coin balances |
| `add-table` | A table shipping without RLS, or a cross-tenant leak |
| `verify-isolation` | Answer keys readable before submission |
| `add-marking-rule` | Scoring against a marking scheme copied from a wrong secondary source |
| `load-rehearsal` | Discovering the pooler ceiling during a real exam |
| `apply-compensation` | Negotiating fairness policy live, during an incident |
| `privacy-review` | Processing a child's data without a lawful basis |

---

## 1. author-item

```yaml
---
name: author-item
description: Author, review and publish a question item through the editorial workflow. Use when adding a new question to the bank, editing an existing one, or reviewing a submitted draft. Covers LaTeX validation, provenance, shuffle safety, rationales and the two-approver gate.
---
```

**Applies to:** `FR-ITM-*`, `FR-MTH-*`, `FR-AUT-*`, `NFR-QLT-*`

### Before you start

Establish which of two operations this is. They are not the same and choosing wrong is the most common authoring error.

- **New item** — proceed through the whole procedure.
- **Edit to an existing item** — first check whether attempts exist against it. If they do, this forks a new version (`FR-ITM-02`) and you must make an explicit choice between "future attempts only" (the default) and "void and rescore" (which is the `execute-rescore` skill, not this one). Never edit in place to "just fix a typo" on an item with attempt history — the students who attempted before and after answered materially different questions but are ranked together (`EC-DATA-04`).

### Procedure

1. **Capture provenance first, not last.** Set one of `ORIGINAL`, `PYQ_NTA`, `LICENSED`, `THIRD_PARTY_UNCLEARED` with a `source_ref` (`FR-ITM-06`). `THIRD_PARTY_UNCLEARED` cannot publish. If you are unsure of the source, the answer is `THIRD_PARTY_UNCLEARED` — not a guess.
2. **Write the stem in LaTeX** using the console editor. The editor's renderer version must match the student client's; if a preview looks different from production, stop and report it rather than working around it (`FR-AUT-01`).
3. **Create options with stable identity.** Options are UUIDs. Never reason about them as A/B/C/D — the letter is a rendering artefact (`FR-ITM-03`).
4. **Decide shufflability explicitly.** Default is off (`FR-ITM-10`). The linter will force it off for order-dependent phrasing, but read the options yourself: "both (A) and (C)" is unanswerable once options move. Matching, assertion-reason, sequencing and comprehension types are never shufflable.
5. **Write per-option rationales.** Every distractor gets an explanation of why it is wrong (`FR-AUT-04`). This is a mandatory field, and it is the product's most-cited differentiator — a rationale that says "this is incorrect" is not a rationale.
6. **Write the solution and, if available, attach a video link.** The link goes on the solutions record, never on the item row (`FR-SOL-03`).
7. **Add alt-text and spoken-text.** Required for every item, not only image-bearing ones (`FR-ITM-12`). A screen reader reading `\int_0^1` as "backslash int" is a failure.
8. **Tag the taxonomy** down to sub-topic, plus exam cross-tags, PYQ year/shift/number where applicable, and `authored_difficulty` (`FR-TAX-*`). `authored_difficulty` is your estimate; it is deliberately a separate column from the empirical value so the delta can be measured against you later.
9. **Save as DRAFT.** Server-side LaTeX validation runs here and blocks on failure (`FR-MTH-02`). Fix, do not bypass.
10. **Submit for review.** A different person approves. `approved_by <> created_by` is a database constraint, not a convention — you cannot approve your own item even with super-admin rights (`FR-AUT-03`).

### Gate — do not publish unless all are true

- [ ] LaTeX validates strictly, server-side
- [ ] Provenance set and not `THIRD_PARTY_UNCLEARED`
- [ ] Every option has a rationale
- [ ] Shuffle decision made deliberately; linter clean
- [ ] Alt-text and spoken-text present
- [ ] Tagged to sub-topic
- [ ] Approved by someone other than the author
- [ ] Duplicate warnings reviewed and acknowledged (warnings do not block — `VARIANT_OF` is an asset, `FR-ITM-13`)

### Do not

- Hard-delete an item. Retire it (`FR-ITM-04`).
- Reuse an option UUID for different text.
- Define a LaTeX macro expecting it to be available in another question (`FR-MTH-04`).
- Publish an item you cannot source.

---

## 2. publish-paper

```yaml
---
name: publish-paper
description: Assemble, validate and publish a test paper. Use when creating a new mock test, scheduling a live test, or changing a paper that is already published. Covers pattern binding, blueprint validation, publish freeze and scheduling.
---
```

**Applies to:** `FR-TST-*`, `FR-PAT-07`, `FR-PAT-08`

### Procedure

1. **Bind the pattern.** Select `exam_pattern(exam, year, paper)`. The pattern carries the sections and marking rules; you are not choosing marks per question by hand (`FR-PAT-01`).
2. **Assemble items.** Manually or by blueprint (`FR-AUT-09`). If by blueprint, read the "why this item" explanation before accepting — the assembler optimises constraints, not pedagogy.
3. **Check variant families.** Two members of the same `VARIANT_OF` family in one paper is a defect the assembler should have excluded; verify.
4. **Set `ranking_mode` deliberately** (`FR-TST-05`):
   - `strict` — every student gets the identical item set, only presentation order varies. The leaderboard is valid. **This is the default for anything ranked.**
   - `pooled` — per-student draw from a larger pool. The leaderboard becomes percentile-within-pool and the UI must badge it as a randomised paper. Do not use `pooled` for a headline weekly mock.
5. **Schedule.** One absolute `starts_at` and one `ends_at` (`FR-TST-03`). Never a per-timezone window. The UI will render IST alongside the viewer's local time.
6. **Set `late_join_cutoff`** so nobody starts a materially truncated paper (`FR-TST-06`).
7. **Set `solutions_visible_from`.** For a live test this is no earlier than window close for everyone (`FR-TST-08`). Getting this wrong is an answer-key leak, not a UX preference.
8. **Set the attempt policy** — max attempts, which attempt ranks (default: first), cooldown (`FR-TST-07`).
9. **Run the publish validator.** It refuses the paper if section max-marks do not sum to the declared total, if any item lacks a marking scheme, or if any multi-correct item lacks an explicit partial policy (`FR-PAT-08`).
10. **Publish.** Composition freezes. A database trigger now rejects writes to the item set (`FR-TST-02`).
11. **Register the deploy freeze.** Publishing a scheduled test adds its window to the freeze calendar automatically (`FR-ATT-20`). Confirm it appeared.

### Changing a published paper

You cannot. Create `test_version = N+1`, which by default applies only to attempts started after it (`FR-TST-09`). If the change must apply retroactively because an item is genuinely broken, that is `execute-rescore`, not this skill.

### Do not

- Publish a paper 20 minutes before its start with no cache-warm run (`NFR-SCL-05`). Publish at least an hour ahead.
- Resolve paper composition at render time. It is resolved once, at attempt start (`FR-TST-10`).
- Use an open multi-hour window for a ranked test (`NFR-SEC-11`). Early takers will publish the paper.

---

## 3. run-live-mock

```yaml
---
name: run-live-mock
description: Operate a scheduled live mock test end to end. Use before, during and after any test with significant concurrent participation. Covers pre-flight scaling, cache warming, live monitoring, incident handling and post-test scoring verification.
---
```

**Applies to:** `NFR-SCL-*`, `FR-ADM-04`, `FR-ADM-06`, `NFR-AVL-*`

This is the highest-risk recurring operation the platform performs. The failure mode is 10,000 students losing three hours simultaneously, and it is unrecoverable by apology.

### T minus 48 hours

- [ ] Paper published and frozen (`publish-paper` complete)
- [ ] Compute pre-scaled and held; scaling is not instant
- [ ] Load rehearsal run at 1.5–2× expected concurrency (`load-rehearsal` skill) with results reviewed, not just executed
- [ ] Deploy freeze confirmed active for the window
- [ ] Dead-letter queue drained to zero
- [ ] Partition coverage verified for the response tables — at least three future partitions exist (`NFR-SCL-08`). A missing partition fails **every** insert at once, for everyone.

### T minus 60 minutes

- [ ] Cache-warm job completed against every asset in the manifest (`NFR-SCL-05`)
- [ ] Asset URLs verified identical for every student — one URL per object, not per user (`NFR-SCL-04`). Per-user signed URLs turn ~13.5 MB into ~135 GB of origin egress and bypass the CDN entirely.
- [ ] Admission token jitter confirmed active (`NFR-SCL-03`)
- [ ] Status surface reachable and someone owns it

### During

Watch, in priority order:

1. **Attempts stuck in progress** past their deadline — the sweeper should be finalising them (`FR-SYN-07`). A growing count means the sweeper is behind or dead.
2. **Pooler saturation.** This is the ceiling that bites first, not CPU (`NFR-SCL-06`).
3. **Cache hit ratio.** A collapse here has no slow-query signature and will look like a mystery (`NFR-AVL-05`).
4. **Incident stream** — image-load failures, sync errors, heartbeat gaps.
5. **Dead-letter queue depth.**

If an item accumulates image-failure incidents above threshold, it auto-flags for void review (`FR-ADM-14`). Do not void during the window; flag and decide after.

**If something breaks:** you cannot hotfix the client (`FR-ATT-20`). Your levers are server-side only — feature flags, RPC behaviour, configuration. This constraint is by design; if you find yourself needing a client change mid-window, note it as a design defect to fix later, not a rule to break now.

### After

- [ ] Whole-cohort scoring completes within target (`AC-SCL-03`)
- [ ] Zero attempts stuck in progress
- [ ] Zero duplicate results
- [ ] Abandoned attempts correctly classified as not-counted rather than scored zero (`FR-ATT-18`)
- [ ] Reconciler found nothing to re-enqueue
- [ ] Run `apply-compensation` if any platform-caused time loss was recorded
- [ ] Publish the incident and its remedy if anything went wrong (`NFR-AVL-06`). Silence is worse than the incident.

---

## 4. execute-rescore

```yaml
---
name: execute-rescore
description: Revise an answer key or void a question after attempts have been scored, and rescore affected students. Use when a key challenge is upheld, an item is found broken, or an item must be dropped. Covers key versioning, void policy, rank re-emission and reward compensation.
---
```

**Applies to:** `FR-SCR-11` to `FR-SCR-16`, `FR-ADM-07`, `FR-ADM-08`

This is the most consequential fairness operation the platform performs, and the one most likely to be attempted with a naive `UPDATE`. Do not.

### Decide the operation

| Situation | Operation | Eligible population |
|---|---|---|
| A second option is also correct | `MULTI_KEY` | Anyone who selected any correct option |
| The item is ambiguous but answerable | `ALL_CORRECT` | Everyone who attempted it |
| The item is out of syllabus or unanswerable | `DROPPED` | Everyone who appeared |
| The item is broken and marks should be redistributed | Void with `drop_and_rescale` | Per the recorded policy |

The void policy must be **chosen and recorded per void** (`FR-SCR-14`). There is no default.

### Procedure

1. **Triage the challenge queue.** It ranks by distinct challenger count *and* statistical signal (`FR-ADM-07`). Trust the statistics over the volume: negative discrimination, or a distractor out-discriminating the key, is the classic miskey signature. High report volume alone is not evidence — it can be manufactured (`FR-SUP-04`).
2. **Create key version N+1.** Immutable row, with author and reason (`FR-SCR-11`). Never mutate version N.
3. **Enqueue the rescore.** It writes **new** result rows and never overwrites (`FR-SCR-12`).
4. **Verify idempotency before letting it touch production ranks.** Run it twice against a snapshot and assert zero drift (`AC-SCR-01`).
5. **The pointer swap is atomic.** New results and a new leaderboard snapshot land in one transaction (`FR-SCR-10`, `FR-SCR-12`).
6. **Adjust rewards by compensating top-up only.** Never claw back coins (`FR-SCR-16`). A clawback is a worse trust event than the original error, and students may already have spent them.
7. **Notify every affected student** with an explicit before/after delta and the reason (`FR-SCR-15`).
8. **Write the public resolution note**, visible to every challenger (`FR-ADM-08`).
9. **Check shared artefacts.** A student who screenshotted a rank now has a stale number circulating. Their share link must resolve to the corrected value with an explanation (`FR-ANL-08`).

### Do not

- `UPDATE` a key row in place. Every existing score becomes silently wrong, analytics corrupt, and there is no way to explain the change to a student.
- Recompute ranks and results at different times. They must be one transaction.
- Claw back rewards.
- Rescore during a live window.

---

## 5. add-table

```yaml
---
name: add-table
description: Add or alter a database table. Use for any schema migration. Covers RLS-first discipline, tenancy predicates, column-level isolation, indexing the policy columns, partitioning and migration safety.
---
```

**Applies to:** `FR-TEN-*`, `NFR-SEC-01` to `NFR-SEC-07`, `NFR-SCL-08`, `NFR-AVL-03`

### The rule that matters most

**A table ships with RLS enabled and at least one policy, or it does not ship.** CI enforces this (`NFR-SEC-01`). There is no "we'll add the policy next sprint" — a table without a policy in the exposed schema is readable by every authenticated user, which at this point includes every student.

### Procedure

1. **Decide the schema first.** Does this hold answer keys, solutions, role assignments, or licence evidence? Then it goes in the **non-exposed** schema with zero grants to the authenticated role, reachable only through a state-checking RPC (`NFR-SEC-02`). RLS controls rows, never columns — a permissive table with a sensitive column is one `?select=` away from a full dump.
2. **Add `org_id`** if the data is org-scoped, non-nullable (`FR-TEN-01`).
3. **Enable RLS.** Before inserting a single row.
4. **Write policies scoped `TO authenticated`,** not to `public`.
5. **Wrap `auth.uid()` in a subselect.** `(select auth.uid())` rather than a bare call — the difference is measured in orders of magnitude at scale and is invisible with a thousand development rows (`NFR-SCL` rationale in requirement.md).
6. **Constrain on `org_id` in the policy**, in addition to the user predicate (`FR-TEN-02`).
7. **Index every column the policy references.** An unindexed policy column is a full scan per row check.
8. **Avoid joins in policies.** Use a `SECURITY DEFINER` helper function with an explicitly empty search path instead.
9. **Partition if the table is response-scale.** Range partition by time with automated future-partition maintenance (`NFR-SCL-08`).
10. **Run the persona suite.** Anon, student in org A, student in org B, admin in org A, admin in org B. Every table probed for read and write (`AC-TEN-01`, `NFR-SEC-07`).
11. **Run the database lint pass.** Missing RLS, definer views and mutable search paths fail the build (`NFR-SEC-06`).

### Views

Views default to definer semantics and therefore **bypass RLS**. Any view in the exposed schema must be created with invoker security. Admin reporting views live in the private schema (`NFR-SEC-03`).

### Migration timing

- Never during a live test window (`NFR-AVL-03`). Check the freeze calendar.
- Index creation uses the concurrent path. A non-concurrent index build takes an exclusive lock on the hottest table and loses every in-flight attempt.
- A `NOT NULL` column addition with a default on a large table is a rewrite. Treat it as a multi-step migration.

---

## 6. verify-isolation

```yaml
---
name: verify-isolation
description: Verify that answer keys, solutions and cross-tenant data are genuinely unreachable. Use after any change to RLS policies, views, RPCs, or the client data layer, and as a pre-launch gate. This is an adversarial check, not a code review.
---
```

**Applies to:** `NFR-SEC-01` to `NFR-SEC-08`, `FR-SOL-05`, `FR-NTS-04`, `FR-TEN-04`

Do not read the policy and conclude it is correct. Attack the API.

### Procedure

Mint a real student JWT for a student with an **in-progress attempt**, then attempt each of the following directly against the API, bypassing the client entirely:

1. Select every column on the items table, including solution and video-URL columns. **Expect 403 or empty** (`AC-SOL-01`).
2. Select from the answer-key table by any path. Expect nothing.
3. Use resource embedding to traverse from a readable table into a solutions or keys table. Expect nothing.
4. Select from every view in the exposed schema. Expect only own-row, own-org data.
5. Read another student's attempt, responses, notes, coin ledger.
6. Read another **org's** anything (`FR-TEN-04`).
7. Read items belonging to a later, time-locked section of the current paper (`FR-SYN-11`).
8. Read any item content for a test whose `starts_at` has not passed (`FR-TST-03` embargo).
9. Attempt to write to the audit log, the coin ledger, a key row, or `user_roles`.
10. Set `user_metadata.role = 'admin'`, refresh the token, and retry every admin-only read (`AC-IDN-02`).

Then, with an admin JWT from **org A**, repeat 5–9 against **org B**.

### Also verify

- [ ] No privileged service credential appears in any client bundle — grep the built artefact, not the source (`NFR-SEC-04`)
- [ ] No OTA bundle contains question content, keys or credentials (`NFR-SEC-05`)
- [ ] The client issues no select-all against the items table anywhere in the codebase (`FR-SOL-06`)
- [ ] The note editor's query during an attempt fetches the stem only (`FR-NTS-04`)

### Escalation

Any failure here is a launch blocker, not a bug ticket. An answer-key leak during a live window is the failure mode that ends product credibility, and the research documents real precedent for organised key trading in this market.

---

## 7. add-marking-rule

```yaml
---
name: add-marking-rule
description: Add or change an exam pattern and its marking rules, and build the golden test suite that proves the scoring is correct. Use when a new exam year is announced, a pattern changes, or a new exam is added.
---
```

**Applies to:** `FR-PAT-*`, `FR-SCR-05` to `FR-SCR-09`, `AC-PAT-01`

### The rule

**Source the marking scheme from the examining body's own PDF. Never from a coaching site, a summary article, or a search result.**

This is not pedantry. The JEE Advanced multi-correct negative mark moved from −2 to −1 between 2025 and 2026, and major coaching sites — including pw.live and aakash.ac.in — still publish the stale value. The proportional partial-credit formula that circulates widely online is wrong; the real scheme is a fixed ladder. If the platform's differentiating claim is scoring correctness, a scheme copied from a wrong secondary source is an own goal.

### Procedure

1. **Locate the primary PDF** on the examining body's own domain. Save it. Record the URL and retrieval date.
2. **Extract the scheme verbatim**, including the worked example if the PDF provides one.
3. **Insert the pattern as data** — `exam_pattern → pattern_section → marking_rule` (`FR-PAT-01`). This is an INSERT. If you find yourself editing application code, stop: that means the schema is not general enough and that is the defect to fix (`FR-PAT-02`).
4. **Express the full rule**: full marks, negative marks, zero-on-unanswered, partial ladder, numeric precision, and whether negative marking applies to numeric responses (`FR-PAT-03`).
5. **For numeric questions**, specify tolerance as data — either absolute tolerance or decimals-plus-rounding-mode. Note that rounding conventions differ between exams; encode the actual one, per question (`FR-SCR-06`).
6. **Build the golden test from the PDF's own worked example.** If the PDF gives a partial-marking example, that example is a test case, verbatim.
7. **Add pathological numeric fixtures**: Devanagari digits, Unicode minus variants, comma decimal separators, `2.50` versus `2.5`, fractional input, scientific notation, leading and trailing whitespace (`AC-SCR-02`). These run as a CI gate.
8. **Add the tie-break chain** for this exam, and surface it in the UI (`FR-SCR-09`).
9. **Verify percentile is computed on the total score**, per cohort, at the published precision — not as an average of subject percentiles (`FR-SCR-07`).
10. **Run the full golden suite:** a seeded historical paper must score identically to the official published key across 100 synthetic attempts (`AC-PAT-01`).
11. **Run the shuffle-invariance contract test:** a shuffled attempt and an unshuffled attempt with identical answers must score identically (`AC-ITM-02`).

### Do not

- Hardcode a year constant anywhere.
- Attach the marking scheme to the item. It belongs on the `(test_section, question)` join, because one item cross-tagged into two exams must score differently in each (`FR-PAT-04`).
- Let scoring read `marked_for_review` (`FR-ATT-03`). Assert this with a test.

---

## 8. load-rehearsal

```yaml
---
name: load-rehearsal
description: Run a load rehearsal before a scheduled live test. Use before every event with significant concurrency, and after any change to the attempt path. Covers scenario design, what to measure and how to interpret the ceiling.
---
```

**Applies to:** `NFR-SCL-01` to `NFR-SCL-12`, `AC-SCL-01` to `AC-SCL-03`

### Design the scenario to match the real shape

The dangerous moments are not steady state. They are:

1. **Start herd** — every virtual user hits start within a ten-second band.
2. **Steady state** — the coalesced heartbeat-plus-answer-sync at its real interval, for the full duration (`FR-ATT-08`).
3. **Submit herd** — everyone finishing within the same minute.
4. **Result read** — everyone opening their result at once, immediately after.

Rehearse at 1.5–2× the expected concurrency (`NFR-SCL-12`).

### Measure

| Signal | Why it matters |
|---|---|
| Pooler client saturation | The ceiling that bites first, before CPU |
| p99 answer-sync latency | Target under 800 ms from a representative Indian network (`AC-SCL-02`) |
| Whole-cohort scoring duration | Target under 60 s (`AC-SCL-03`) |
| Origin egress volume | If it scales with *students* rather than with *assets*, per-user signed URLs have crept back in (`NFR-SCL-04`) |
| Cache hit ratio | Collapse here has no slow-query signature |
| Requests per screen | An N+1 pattern shows up as a browse screen exhausting the pool (`NFR-SCL-11`) |
| Dead-letter depth | Scoring failures that would otherwise be invisible |

### Interpret

- A single test that "passes" tells you little. What you want is the **ceiling** — raise load until something breaks, and know what breaks first.
- If retries amplify a transient error into a sustained failure, backoff jitter is missing or the retry budget is unbounded (`FR-SYN-08`).
- If realtime messaging degrades and the exam degrades with it, realtime has become load-bearing, which is prohibited (`NFR-SCL-07`). The exam must pass this rehearsal with realtime disabled entirely.

### Gate

Do not schedule a live event whose expected concurrency exceeds the last rehearsed ceiling divided by 1.5.

---

## 9. apply-compensation

```yaml
---
name: apply-compensation
description: Apply the platform time-loss compensation ladder after an incident affecting a live test. Use when an outage, degradation or bad deploy costs students time mid-attempt. Covers measurement, corroboration, the ladder and communication.
---
```

**Applies to:** `FR-ADM-05`, `FR-ADM-06`, `EC-FAIR-07`

The policy is published in the terms before launch precisely so that it is never negotiated during an incident. Follow it; do not improvise.

### Procedure

1. **Measure, do not estimate.** Per-attempt lost seconds derive from recorded incident rows — sync failures, image failures, heartbeat gaps (`FR-ADM-06`).
2. **Corroborate against server-observed error rates in the same window.** A student's own poor network is not compensated. Only server-corroborated loss counts. This distinction is what keeps the mechanism from being farmed.
3. **Apply the ladder** as configured, in ascending order of loss: none below the lower threshold; automatic in-flight deadline extension in the middle band; re-attempt on an equivalent paper plus exclusion of the broken attempt from ranking above the upper threshold.
4. **Every extension is audited and mandatorily linked to an incident** (`AC-ADM-02`). An extension with no incident reference cannot be granted, by design.
5. **Notify affected students in-app** with what happened and what was done.
6. **Publish the incident and its remedy** on the status surface (`NFR-AVL-06`).

### Watch for

A student toggling airplane mode deliberately to manufacture a "platform-caused" incident and claim a re-attempt on an equivalent paper — **after having seen the questions**. Server corroboration (step 2) is the primary control. If a re-attempt is granted above the upper threshold, the equivalent paper must genuinely be a different item set, not a reshuffle of the same one.

---

## 10. privacy-review

```yaml
---
name: privacy-review
description: Review a change for privacy and children's-data compliance before it ships. Use for any change that collects, processes, transmits or exposes personal data, adds a third-party SDK, adds telemetry, or changes consent or notification behaviour.
---
```

**Applies to:** `FR-IDN-02` to `FR-IDN-07`, `NFR-PRV-*`, `FR-NOT-03`, `FR-RWD-13`

The majority of users are legally children. This is the default path, not an edge case, and it makes several standard engineering moves unlawful rather than merely inadvisable.

### Ask, in order

1. **Does this process personal data of a principal who may be under 18?** If yes, verifiable parental consent must already be in place (`FR-IDN-03`). A tick-box is explicitly insufficient.
2. **Which telemetry pipeline does this write to?** Pedagogical or engagement. The engagement pipeline is disabled for under-18 principals **at the gateway**, not by a client flag (`NFR-PRV-02`). If the change writes engagement events, verify the gateway block covers it.
3. **Does this profile, track, or behaviourally monitor a child?** Prohibited (`NFR-PRV-03`). This includes: per-user optimised notification timing (`FR-NOT-03`), churn-triggered nudges, personalised offers, and engagement A/B tests.
4. **Does this add a third-party SDK or processor?** Audit for cross-border transfer of child data (`NFR-PRV-04`). A US-based analytics processor receiving a 16-year-old's error history is both a transfer question and arguably profiling.
5. **Does this run an experiment on minors?** Requires legal assessment before it runs (`NFR-PRV-08`). This is an unresolved dependency, not a settled question.
6. **Does this touch the consent record?** Consent events are immutable and long-retention (`FR-IDN-04`).
7. **Does this delete data?** Erasure is two-tier — identity columns cryptographically shredded, statistical contribution retained with the mapping key destroyed, so other students' cohort percentiles stay sound (`NFR-PRV-05`).
8. **Does this notify?** Quiet hours are enforced server-side and are not overridable by campaign configuration (`FR-NOT-01`). Check the blocked-phrase list for failure-framed copy (`FR-A11Y-09`).
9. **Does this touch gamification?** Verify the exam-calendar suppression still holds — no streak breakage, relegation, leaderboard or re-engagement push for a student whose declared exam is imminent (`FR-RWD-13`).

### Gate

- [ ] Lawful basis identified and recorded
- [ ] Correct telemetry pipeline
- [ ] No behavioural profiling of minors
- [ ] Third-party processors assessed
- [ ] Notice version updated if the purpose changed
- [ ] Retention class assigned

### Escalate rather than decide

Anything touching the definition of verifiable consent, cross-border transfer, or experimentation on minors goes to counsel. These are listed as blocking external dependencies B2 and B5 in [requirement.md](requirement.md) §7 and are not engineering judgement calls.
