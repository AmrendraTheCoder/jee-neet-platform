# JEE / NEET Assessment Platform

A multi-tenant assessment platform for Indian competitive-exam aspirants — Physics, Chemistry, Mathematics, Biology.

Students practise, sit timed mock tests that replicate the examination interface faithfully, review their errors, and are scheduled back to weak concepts by a spaced-repetition engine. Administrators author and version questions, define exam patterns and marking rules **as data**, assemble papers, and operate the platform through twelve control planes.

---

## The commitment that shapes everything

**Exam mechanics are versioned data, not code.**

Marking schemes, paper composition, question content and answer keys are immutable versioned rows. An attempt pins the exact versions it was scored under. That means a paper can be replayed byte-identically months later, a key revision produces a visible before-and-after delta instead of a silent score change, and a dropped question triggers an idempotent rescore that re-emits ranks and reward ledgers rather than corrupting them.

If you find yourself writing a year constant or a per-exam branch in the scoring path, the schema is wrong and that is the defect to fix.

---

## Layout

```
docs/           requirements, operating procedures, agent roster, research corpus
packages/
  domain/       scoring and attempt engine — pure TypeScript, zero dependencies
  db/           PostgreSQL migrations, RLS policies, scoring functions, security tests
apps/
  web/          examination client (ranked mocks) and admin console
  mobile/       React Native practice, spaced-repetition review, notes
scripts/        CI quality gates
```

**Web owns full-length ranked mocks and the admin console. Mobile owns practice, review and notes and never renders a ranked mock.** The real examination is a desktop computer-based test with a mouse and a large screen; a three-hour pixel-faithful clone on a six-inch phone is not a fidelity clone, it is a different exam.

---

## Start here

| Document | What it is |
|---|---|
| [docs/00-IDEATION.md](docs/00-IDEATION.md) | Positioning, the three wedges, locked decisions, resolved contradictions |
| [docs/requirement.md](docs/requirement.md) | 224 functional + 41 non-functional requirements, 51 acceptance criteria |
| [docs/skill.md](docs/skill.md) | Ten operating procedures, each with a gate |
| [docs/agent.md](docs/agent.md) | Project invariants and the specialist review-agent roster |
| [docs/mcp.md](docs/mcp.md) | MCP servers, and the security rules for connecting them |
| [packages/domain/README.md](packages/domain/README.md) | The scoring engine and the five things it exists to get right |

Requirement IDs (`FR-*`, `NFR-*`) are stable. Cite them in commit messages. Edge case IDs (`EC-*`) resolve to `docs/research/agent_edge-*.json` — read the referenced case before implementing a requirement that traces to one, because the mitigation there is more specific than the requirement statement.

---

## The nine invariants

Violating any of these is a defect regardless of what the ticket says. Full text in [docs/agent.md](docs/agent.md).

1. Exam mechanics are data, not code.
2. Nothing a student has seen is ever edited in place.
3. A table ships with row-level security and at least one policy, or it does not ship.
4. Every org-scoped table carries `org_id`, and every policy constrains on it.
5. Roles come from a server-owned table projected into the JWT — never from user-writable metadata.
6. Answers are `{question_version_id, option_id}`. Never positional indices.
7. The deadline is server-authoritative and immovable.
8. Realtime messaging is never load-bearing.
9. Coins are earn-only and never purchasable.

---

## Developing

Node 22, pnpm 11.

```bash
pnpm install
```

```bash
./node_modules/.bin/vitest run
```

```bash
node scripts/lint-sql.mjs
```

The domain engine has no dependencies and no I/O, so its tests need nothing installed beyond vitest.

---

## Two things that are deliberately unfinished

**The built-in exam patterns ship as `UNVERIFIED` and will refuse ranked use.** `assertRankable()` throws on them by design. Marking schemes must be sourced from the examining body's own document, not from a search result — major coaching sites currently publish a stale negative mark and a partial-credit formula that has never been the real scheme. To clear the gate, follow [docs/skill.md](docs/skill.md) → `add-marking-rule`.

**Five external dependencies block launch** and cannot be resolved by engineering. They are listed in [docs/requirement.md](docs/requirement.md) §7. The two with the longest lead time are written permission to reproduce previous-year questions commercially, and counsel opinion on the verifiable-parental-consent mechanism — most users are legally children, which makes that the default path rather than an edge case.

---

## Contributing

Read [docs/agent.md](docs/agent.md) Part A first — it is short, and it lists the traps specific to this codebase that a general code review will not catch.

No emoji, anywhere. It is a product requirement, not a style preference.
