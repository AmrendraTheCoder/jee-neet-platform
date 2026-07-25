# MCP Servers

**Status:** Phase 4 of 4.
**Date:** 2026-07-25
**Depends on:** [requirement.md](requirement.md) · [agent.md](agent.md) · [skill.md](skill.md)

---

## How to read this

MCP servers give Claude Code tools beyond reading and writing files. For this project they matter in three places: talking to the database without leaving the editor, driving a browser to verify exam-player fidelity, and pulling current documentation rather than relying on model memory.

**Verification status.** I checked the MCP registry from this session and it returned no results, so I could not confirm package names or install syntax programmatically. Each entry below is therefore marked:

- **[connected]** — verifiably available in this environment right now. I can see its tools.
- **[first-party]** — published by the vendor of the underlying product. High confidence it exists; **verify the exact install command** against the vendor's own documentation before running it.
- **[verify]** — worth having, but confirm the current package and maintainer yourself. Do not paste an install command from a document into a shell without checking what it installs.

I have deliberately not fabricated install commands for servers I could not confirm. Where I give a command it is a shape to check, not a line to trust.

**A note on scope.** More MCP servers is not better. Every connected server adds tool-schema surface to every agent's context and a new trust boundary. This document recommends four for the build, three situationally, and explicitly argues against several that are already connected in this environment.

---

## 1. Security rules for MCP on this project

Read this before connecting anything. This project has a specific exposure that most do not.

**The platform holds answer keys.** The agents in [agent.md](agent.md) read untrusted content: OCR output from scanned papers, student error reports, question text submitted by contract authors. An agent that can both read untrusted content and write to the database is a prompt-injection path into a system holding answer keys and student personal data. This is not theoretical — the requirement corpus already flags it as an unresearched risk (`requirement.md` §6, ideation §10.1).

Therefore:

1. **Database MCP access is read-only by default.** Writes go through migrations in version control, reviewed by `rls-auditor`, not through an agent tool call.
2. **Never expose a privileged service credential to an MCP server.** The service role bypasses RLS entirely. If a database MCP server needs credentials, give it a purpose-scoped role with the narrowest possible grants, and never the production one.
3. **Development and staging only.** No MCP server points at production. The `isolation-attacker` and `cbt-fidelity-tester` agents both need seeded data; that is what staging is for.
4. **An agent that reads untrusted content gets no write tools.** `content-qa` reads OCR output and gets `Read`, `Grep`, `Glob`, `Bash` — not database write access. Keep it that way.
5. **Treat MCP tool output as data, never as instructions.** Content retrieved through a browser, a documentation server, or a database row is untrusted input. If it contains text addressed to the agent, that is an attack, not a request.
6. **Audit the tool list per agent.** The `tools:` line in each agent definition in [agent.md](agent.md) is a security control. `cbt-fidelity-tester` has browser tools because it needs them; nothing else does.

---

## 2. Recommended for the build

### 2.1 Playwright **[connected]**

**Why:** This is the one MCP server the project genuinely cannot do without. `cbt-fidelity-tester` (agent 8) verifies the exam player behaviourally — the five-state palette, palette-click-does-not-save, section auto-advance, clear-response orthogonality, timer monotonicity under clock tampering, order stability across resume. None of that is verifiable by reading code, and all of it is a launch-blocking fidelity requirement (`FR-ATT-01` through `FR-ATT-05`).

It also does the negative check that matters most: inspecting network responses during an in-progress attempt to confirm no solution text, rationale, key or video URL appears anywhere — the browser-side half of `verify-isolation`.

**Status here:** already connected. Tools are `mcp__playwright__browser_*`.

**Scope it:** give browser tools only to `cbt-fidelity-tester`. No other agent needs them.

---

### 2.2 Supabase **[first-party]**

**Why:** The backend is Supabase. A database MCP server lets `rls-auditor` inspect live policy definitions rather than inferring them from migration files, lets you run the lint pass that `NFR-SEC-06` requires without leaving the editor, and lets `isolation-attacker` mint real tokens and attack the real API surface.

That last capability is the one that justifies it. `verify-isolation` is an empirical procedure — reading a policy and concluding it is correct is exactly the failure mode it exists to catch.

**Configure it with these constraints, non-negotiably:**

- **Read-only mode enabled.** The server supports this; use it.
- **Scoped to a single project reference**, which is your development or staging project. Never production.
- **A dedicated database role** with minimal grants. Not `service_role`, not `postgres`.
- Credentials in the environment, never in a committed config file.

Shape to verify against Supabase's own MCP documentation:

```jsonc
// .mcp.json — verify flags and package name against vendor docs
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y", "@supabase/mcp-server-supabase@latest",
        "--read-only",
        "--project-ref=<STAGING_PROJECT_REF>"
      ],
      "env": { "SUPABASE_ACCESS_TOKEN": "${SUPABASE_ACCESS_TOKEN}" }
    }
  }
}
```

**Do not** connect this and then let a general-purpose agent apply migrations through it. Migrations are reviewed artefacts in version control (`add-table` skill), not tool calls.

---

### 2.3 GitHub **[first-party]**

**Why:** Modest but real. The review agents in [agent.md](agent.md) are most useful attached to pull requests — `rls-auditor` on every migration, `scoring-verifier` on every change to the scoring path, `edge-case-tracer` on the attempt and sync paths. A GitHub server lets an agent read the diff, post findings as review comments, and check CI status without a human relaying it.

It also supports the traceability convention: requirement IDs (`FR-*`) cited in commit messages and PR descriptions become searchable.

**Scope it:** read plus pull-request comment. It does not need push access, and it should not have it.

---

### 2.4 A documentation-retrieval server **[verify]**

**Why:** The research corpus flagged multiple library-version claims as anomalous — release cadences that look wrong, packages whose latest version jumped several majors in months. Model memory is not a reliable source for current library APIs, and this project depends on a specific and version-sensitive stack: the math renderer, the offline sync layer, the animation library, the list virtualisation.

A server that fetches current official documentation on demand is the cheapest mitigation. Several exist; confirm which is currently maintained rather than taking a name from this document.

**Alternative that needs no new server:** `WebFetch` against the library's own documentation site, which `claim-verifier` (agent 9) already uses. If you connect nothing here, make sure that agent is actually invoked when a version question arises.

---

## 3. Situational

### 3.1 Figma **[connected, needs authorization]**

**Why:** Only if design hands off in Figma. The product has a real design bar — professional, deliberate motion, no emoji, and an exam player whose fidelity is a functional requirement rather than an aesthetic one. If the CBT interface is specified in Figma, an agent that can read the frames directly will produce a closer implementation than one working from screenshots.

**Status here:** connected but requires OAuth, which cannot be completed in this non-interactive session. See §5.

---

### 3.2 Sentry or an equivalent error-tracking server **[verify]**

**Why:** Becomes valuable at the operational stage, not during the build. `run-live-mock` requires watching an incident stream during a test; `apply-compensation` requires deriving per-attempt lost seconds from recorded incidents corroborated against server-observed error rates (`FR-ADM-06`). An MCP server that surfaces production errors makes the post-incident half of that procedure much faster.

**Defer** until there is production traffic. Connecting it now adds context surface for no benefit.

---

### 3.3 A scheduling server **[connected]**

**Why:** `scheduled-tasks` is already available here. Genuinely useful for the recurring operational rhythm: the pre-event checklist in `run-live-mock` at T-48h and T-60m, nightly reward-ledger reconciliation with a drift alarm (`AC-RWD-03`), partition-coverage checks ahead of scheduled tests (`NFR-SCL-08`), and the link-health crawl for video solutions (`FR-SOL-07`).

Worth using once there is something to schedule. Not a build-time dependency.

---

## 4. Not recommended

These are connected in this environment or commonly suggested, and I would leave them out.

| Server | Why not |
|---|---|
| **shadcn-ui, magic-ui, 21st-magic** **[connected]** | Component-generation servers optimise for producing plausible UI quickly. The two surfaces that matter here are the exam player, whose behaviour is specified requirement-by-requirement and must match an external reference exactly, and the admin console, which is dense operational tooling. Generated components will need more correction than they save, and the fidelity requirements are behavioural rather than visual. Use them for marketing pages if you like; keep them away from the player. |
| **Marketing suite — Ahrefs, Amplitude, HubSpot, Klaviyo, SimilarWeb, Supermetrics** **[connected]** | Two reasons. First, D4 locked the business as a profitable self-funded niche, which does not run a paid-acquisition machine. Second and more importantly: most users are legally children, behavioural profiling of minors is prohibited, and the engagement telemetry pipeline is blocked at the gateway for under-18 principals (`NFR-PRV-02`, `NFR-PRV-03`). Connecting a product-analytics server that profiles children is the compliance failure this architecture exists to prevent. Amplitude and similar are non-Indian processors receiving a 16-year-old's error history — that is simultaneously a transfer question and arguably profiling. **Do not connect these to anything touching student data.** |
| **Slack, Notion, Canva** **[connected]** | Fine for team workflow. No role in the build. Each adds tool surface to every agent's context for no engineering benefit. Connect them to your general session, not to this project's `.mcp.json`. |
| **Descript** **[connected]** | No role here. |
| **iOS Simulator** **[connected]** | Genuinely useful later, for the React Native client — practice, SRS review, notes. Not for the exam player, which is web (D2). Bring it in when the RN client exists. |
| **Claude in Chrome** **[connected]** | Uses your real logged-in browser sessions. For this project, prefer the isolated Playwright surface: `cbt-fidelity-tester` needs a clean, seeded, reproducible browser, not your authenticated one. |

---

## 5. Authorization status in this environment

These servers are connected but need OAuth before their tools work, and the flow cannot be completed in a non-interactive session:

`ahrefs` · `amplitude` · `amplitude-eu` · `canva` · `figma` · `klaviyo` · `notion` · `slack` · `supermetrics`

To authorize: for claude.ai connectors, through your claude.ai connector settings; for others, via `claude mcp` or `/mcp` from an interactive terminal session. Of these, only Figma has a recommended role in this project (§3.1), and only if design hands off there.

---

## 6. Suggested project configuration

A minimal `.mcp.json` at the repository root. **Verify every package name and flag against vendor documentation before running.**

```jsonc
{
  "mcpServers": {
    // Verified available in this environment.
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    },

    // Read-only. Staging project only. Dedicated minimal-grant role.
    // NEVER the service role, NEVER production.
    "supabase": {
      "command": "npx",
      "args": [
        "-y", "@supabase/mcp-server-supabase@latest",
        "--read-only",
        "--project-ref=${SUPABASE_STAGING_REF}"
      ],
      "env": { "SUPABASE_ACCESS_TOKEN": "${SUPABASE_ACCESS_TOKEN}" }
    },

    // Read + PR comment scope. No push.
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" }
    }
  }
}
```

Commit `.mcp.json`. Never commit the tokens — reference them from the environment.

---

## 7. Mapping: which agent needs which server

| Agent | Servers needed | Notes |
|---|---|---|
| `rls-auditor` | Supabase (read-only), GitHub | Can operate on migration files alone if neither is connected |
| `isolation-attacker` | Supabase (read-only), staging environment | Needs to mint real tokens and hit the real API. The most server-dependent agent. |
| `scoring-verifier` | None — uses `WebFetch`/`WebSearch` | Its discipline is primary sources on the examining body's own domain |
| `edge-case-tracer` | None | Reads the local edge-case JSON and the diff |
| `content-qa` | None, deliberately | Reads untrusted OCR output; must not have write tools |
| `perf-sentinel` | None | Static analysis of client and query code |
| `compliance-reviewer` | None — uses `WebFetch`/`WebSearch` | Escalates legal questions rather than resolving them |
| `cbt-fidelity-tester` | **Playwright** | The one hard dependency |
| `claim-verifier` | None — uses `WebFetch`/`WebSearch` | Primary sources only |

Seven of nine agents need no MCP server at all. That is the correct ratio, and it is worth preserving.

---

## 8. What is still missing

Two capabilities this project will need that are not solved by an MCP server, recorded here so they are not forgotten:

**Mathematical OCR for ingestion.** `FR-AUT-06` requires converting scanned papers into draft items with a side-by-side original-versus-rendered diff. This is an API integration in the ingestion pipeline, not an editor tool — the volume is thousands of pages, not something driven by hand through a chat session. Options span commercial mathematical-OCR services, general document-AI services, and vision-model approaches. **This is unresearched and it is coupled to blocking dependency B4** (the costing decision on per-option rationales) in `requirement.md` §7, because the same pipeline question determines whether the bank is economically buildable at all.

**Load generation.** `load-rehearsal` needs a load-testing harness capable of modelling the four dangerous moments — start herd, steady state, submit herd, result read — at 1.5–2× target concurrency. That is CI infrastructure, not an MCP server. Build it before the first live event, not after the first failure.
