# @platform/domain

The scoring and attempt engine. Pure TypeScript, **zero runtime dependencies**, no I/O, no clock reads.

Every exported function is a pure function of its arguments. That is not stylistic — it is what makes a score reproducible years later during a dispute, safe to retry when a queued job is redelivered, and testable without a database.

---

## Where this sits

The **database is authoritative in production** (FR-SCR-01). Scoring runs as set-based SQL in bounded workers. This package is:

1. the **reference implementation** the SQL is ported from,
2. the **test oracle** the SQL is checked against,
3. the engine behind **tutor-mode preview** on the client.

The two implementations are kept honest by a shared fixture corpus — see [The golden oracle](#the-golden-oracle).

---

## What is in here

| Module | Responsibility |
|---|---|
| `types.ts` | Branded identifiers, `Response`, `AnswerKey`, `ResponseOutcome` |
| `exam/pattern.ts` | Exam patterns and marking rules as data, plus validation and the provenance gate |
| `exam/patterns/*` | The built-in pattern data (JEE Main, NEET; JEE Advanced marking rules) |
| `scoring/decimal.ts` | Exact fixed-point arithmetic on BigInt |
| `scoring/numeric.ts` | Unicode-aware numeric normalisation and grading |
| `scoring/scoreQuestion.ts` | Grading one response |
| `scoring/scoreAttempt.ts` | Whole-attempt aggregation |
| `scoring/percentile.ts` | Percentile on total score, exact to 7 decimal places |
| `scoring/tiebreak.ts` | Deterministic ranking |
| `scoring/rescore.ts` | Key-revision planning |
| `scoring/fingerprint.ts` | Scoring-configuration pinning |
| `attempt/palette.ts` | The five-state question palette |
| `attempt/shuffle.ts` | Deterministic seeded shuffling |
| `attempt/timer.ts` | Server-authoritative deadlines and accommodations |

---

## The five things this engine exists to get right

### 1. The partial-credit ladder is not a formula

JEE Advanced multi-correct partial credit is a **lookup ladder**, not the proportional formula `4 x correct / total` that is published across the Indian web, including on major coaching sites.

```
all correct selected   -> +4
3 correct, none wrong  -> +3
2 correct, none wrong  -> +2
1 correct, none wrong  -> +1
nothing selected       ->  0
any incorrect selected -> -1     (moved from -2; sites still publish -2)
```

Implementing the proportional formula systematically under-scores every candidate on every partial-credit paper, silently, and presents as poor student performance rather than as a bug. `test/scoreQuestion.test.ts` asserts the ladder value is **not** the proportional value, so a future "simplify this to a formula" refactor fails loudly.

### 2. Numeric answers are graded with exact arithmetic

`parseFloat` and string equality are both wrong.

A candidate on a Hindi or Tamil device locale gets a native-numeral keypad. NFKC does **not** fold Devanagari or Tamil digits to ASCII — a common and expensive assumption. `normalizeNumericInput` maps thirteen Unicode decimal digit blocks, ten dash variants, several thousands separators and three decimal separators, then parses to an exact BigInt-backed decimal.

Tolerance comparison is exact. `0.3 - 0.29` in IEEE-754 is `0.010000000000000009`, which a float implementation rejects against a `0.01` tolerance band. It must be accepted.

### 3. Scoring is blind to everything except the answer

`markedForReview`, `visited`, `timeSpentMs` and `clientSeq` never reach the scoring path. If "marked for review" were a variant of the answer rather than an orthogonal flag, marking a question could clear it — silently losing marks on precisely the questions a candidate was most careful about.

There is a test asserting this. Keep it passing.

### 4. Identity, never position

Answers are `{questionVersionId, optionId}`. Every identifier is a branded type, so passing a positional index where an identity is required is a compile error rather than a silent scoring corruption.

`scoreAttempt` throws `UnknownQuestionError` if a response references a question outside the paper, and `test/scoreAttempt.test.ts` asserts a shuffled and an unshuffled attempt with the same answers score identically.

### 5. A marking scheme cannot reach production unverified

`assertRankable(pattern)` throws unless the pattern's provenance status is `VERIFIED_PRIMARY`. Practice use is permitted; ranking is not.

**The built-in patterns currently ship as `UNVERIFIED` and will therefore refuse ranked use.** This is deliberate, not an oversight. To clear it: retrieve the primary Information Bulletin from the examining body's own domain, confirm the open points documented in each pattern file, set `status` and record `retrievedOn`. See `docs/skill.md` -> `add-marking-rule`.

---

## The golden oracle

`test/fixtures/golden-scoring.json` holds 46 cases written **from the published marking schemes**, not generated from any implementation.

- `test/golden.test.ts` asserts the TypeScript engine against it.
- `packages/db/test/04_scoring_golden.sql` asserts the SQL functions against the same file.

Neither implementation defines truth. If one fails, it is wrong — the fixture is never edited to make a failing implementation pass.

---

## Running

```bash
./node_modules/.bin/vitest run
```

Use the binary directly rather than `pnpm test` while app-level dependencies are unresolved; pnpm runs a workspace install check first.

```bash
cd packages/domain && npx tsc --noEmit
```

---

## Conventions

- Relative imports carry the `.js` extension (ESM style over `.ts` sources).
- `strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.
- Comments explain **why**, and cite the requirement (`FR-*`) or edge case (`EC-*`) that the line exists because of.
- No emoji.

## Adding a marking rule

Follow `docs/skill.md` -> `add-marking-rule`. The short version: source it from the examining body's own PDF, express it as data, build the golden fixture from the PDF's own worked example, and never add a year constant.
