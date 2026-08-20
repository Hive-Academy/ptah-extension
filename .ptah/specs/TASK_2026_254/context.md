# Context — TASK_2026_254

## Why now

Came out of TASK_2026_233. That task killed hardcoded vendor rosters in the
agent-facing strings the extension _compiles in_. These two corpora are the
agent-facing text the extension _ships as files_, and neither has had a review
pass. They are the largest ungoverned prompt surface in the repo.

The governing question is the one 233 settled for descriptions, asked of prose:
**what in these files is load-bearing, and what is repetition that will drift?**

## Corpus A — subagent templates

`libs/backend/agent-generation/templates/agents/` — 15 files, ~248KB. Each is a
complete system prompt for one specialist, injected when that agent is spawned.

| Template                 | Lines | KB   |
| ------------------------ | ----- | ---- |
| software-architect       | 773   | 35.0 |
| senior-tester            | 682   | 32.5 |
| team-leader              | 548   | 26.3 |
| backend-developer        | 453   | 18.7 |
| frontend-developer       | 443   | 18.3 |
| project-manager          | 359   | 17.7 |
| visual-reviewer          | 399   | 16.1 |
| code-logic-reviewer      | 373   | 14.3 |
| researcher-expert        | 265   | 12.3 |
| technical-content-writer | 367   | 12.1 |
| devops-engineer          | 397   | 11.4 |
| modernization-detector   | 203   | 11.3 |
| code-style-reviewer      | 288   | 11.3 |
| ui-ux-designer           | 124   | 6.7  |
| video-director           | 69    | 4.4  |

The spread is the first question: `video-director` does its job in 69 lines and
`software-architect` takes 773. Either the long ones carry instruction the short
ones need, or they carry padding. Nobody has checked which.

### A1 — three blocks are copy-pasted, not shared

Counting identical headings across the 15 files:

- `## 🚨 CLARIFICATION PROTOCOL — RETURN, DO NOT ASK` — in **10** of 15
- `## Task-Spec File Contract (.ptah/specs/)` — in **6** of 15
- `### 🔴 ANTI-BACKWARD COMPATIBILITY MANDATE` — in **5** of 15

These are cross-cutting rules, not per-specialist instruction. Duplicated into
ten independently-edited files, the failure mode is not size — it is that a
correction lands in one copy and the other nine keep teaching the old rule, with
nothing comparing them. This is the same defect class as the vendor rosters:
a fact written down in N places instead of derived from one.

**Direction**: hoist the shared blocks to one composed-in preamble, the way the
task tools share `CARRIER_OWNERSHIP_NOTE`. Then a per-template diff shows only
what is actually specialist-specific.

### A2 — the CLI-delegation instruction is in 2 of 15

The orchestrator rule is that every spawned sub-agent gets told it may delegate
to CLI agents via `ptah_agent_spawn`. Only `team-leader` (8 mentions) and
`video-director` (1) contain anything of the sort. Either the rule is injected
at spawn time and the two templates are redundantly restating it, or thirteen
specialists never hear it. Resolve which, then make it one or the other —
having it in exactly two files is the one state that cannot be correct.

### A3 — verify the shared blocks are still true

`Task-Spec File Contract` appears in 6 templates. `libs/backend/task-specs`
owns that contract and has changed since (labels, estimates, relations,
`DOC_FILES`). Check each copy against `task-spec.contract.ts` rather than
against each other.

## Corpus B — plugin skills

`apps/ptah-extension-vscode/assets/plugins/` — **219 files, 1.74MB**, 5 plugins
(`ptah-core` 8 skills, `ptah-nx-saas` 7, `ptah-angular` 3, `ptah-react` 3,
`ptah-video` 1). Every skill directory has its `SKILL.md`, so nothing is
structurally dark — checked.

These download at runtime through `ContentDownloadService` (they cannot be VSIX
assets — see the marketplace rules in the root `CLAUDE.md`), so weight is paid
twice: once on download, once per context load.

### B1 — `ptah-react` ships compiled build output

- `ptah-react/skills/react-best-practices/AGENTS.md` — **79.9KB**, the single
  largest file in the bundle
- `ptah-react/skills/composition-patterns/AGENTS.md` — 21.9KB

Both are marked **"Compiled output (generated)"** by their own `README.md`,
which also documents a `pnpm build` step, a `test-cases.json`, and an upstream
contribution workflow. So the runtime bundle carries generated artifacts, their
source rules, and the toolchain docs for a build that never runs here. Each
`SKILL.md` points at its `AGENTS.md` for "the complete guide with all rules
expanded", so the compiled file is reachable and 80KB of it can land in context.

**Direction**: decide what the runtime needs — almost certainly the `SKILL.md`
and the compiled guide, not the README, the rule sources or the test cases.

### B2 — the `orchestration` skill is ~133KB in one skill

`SKILL.md` 24.1 + `agent-catalog.md` 25.7 + `cli-agent-delegation.md` 24.8 +
`strategies.md` 21.4 + `checkpoints.md` 20.6 + `creative-trace.md` 16.1. It is
the most-loaded skill in the product and the least audited for redundancy.

`ptah-cli-usage/SKILL.md` at 62.6KB is the second-largest single file and was
partly verified during 233 — its per-provider auth sections are legitimate.

### B3 — repeated example blocks, the concrete case

`orchestration/references/cli-agent-delegation.md` (600 lines / ~6.3k tokens)
carries **eight near-identical `ptah_agent_spawn` blocks**, one per agent type,
differing only in the `task` string. That is ~2k tokens of repeated block
structure to convey eight task strings; one block plus a table of task lines
conveys the same thing.

Explicitly NOT the vendor names in those blocks. `cli: "codex"` inside a code
sample is substitutable — a model with a different CLI installed fills in what
it has. Only assertions of availability and priority are unsubstitutable, and
233 already removed those. **Do not genericise concrete examples in this pass**:
`cli: "<a cli from the list>"` costs the same tokens and is harder to copy. The
working pattern is concrete illustrations plus one stated rule that they are
illustrations.

## Out of scope

- Rewriting what any agent or skill actually _teaches_. This is a review of
  duplication, staleness and weight — behaviour of the prompts stays put unless
  a copy is found to be factually wrong.
- The `.github/skills` clones (TASK_2026_233 F3) — they reconcile on deploy.

## Verification

- No shared block exists in more than one file, or a test compares the copies.
- Every claim carried in a shared block is checked against the lib that owns it.
- The CLI-delegation instruction reaches all 15 templates or none.
- No file marked "generated" ships in the runtime bundle without a stated reason.
- Total bundle KB before and after is recorded here — this task is judged on it.
