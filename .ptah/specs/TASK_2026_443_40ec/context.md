# Task Context - TASK_2026_443_40ec

## User Request

> Continue TASK_2026_439_1310 (Thoth rework umbrella) with PHASE 2: memory age lifecycle.
>
> Memory age lifecycle: recall → archival after N days unused, delete after M more days; salience used
> for ranking only (today salience feeds itself, so nothing ever archives); per-workspace cap. Root
> cause from the verdict: `MemoryDecayJob` was built and tested but never scheduled, and nothing ever
> deletes a memory.

Rules from the user (binding for every executor):

- Requirements source: `../TASK_2026_439_1310/tribunal/verdict.md` (section A) and `tribunal/brief.md`.
- Reuse phase 1 (`../TASK_2026_440_834c/`) retention gates (boot-deferred, on-battery,
  foreground-active, budgets, `BEGIN IMMEDIATE` per batch) and its cron pattern
  (`@ptah/memory-retention` in Electron `startThothCron` and CLI `cli-engine` thoth-runtime). Do not
  invent new gates or a second job.
- Ship a REACHABILITY PROOF: a boot/integration spec that fails if the production path does not call
  the new code or the job is not registered. Unit specs alone do not close the phase.
- Measure destructive or long-running SQL on a TEMP COPY of the snapshot with production pragmas (WAL,
  synchronous=NORMAL). Under Node use `node:sqlite` (better-sqlite3 has the Electron ABI). Temp copy
  names must not start with "ptah".
- NEVER open, write, rename or delete `C:\Users\abdal\.ptah\state\ptah.sqlite` (or -wal/-shm) or
  `ptah.pre-migration-20260909T230600Z.sqlite`.
- `npx nx run-many -t ... -p a b c` only; check the N-projects header. No `nx reset` while other agents
  share the worktree.
- Commits per batch after review, never skip hooks. Never commit or merge to main. Push and PR only on
  the user's word.

## Task Type

FEATURE

## Complexity

Complex

## Strategy

Full depth. Gate 0.1 → architect (`implementation-plan.md`) → Gate 2 → team-leader batches → Gate 3.
No separate PM phase: the tribunal verdict is the approved requirements source, and the plan carries
the acceptance criteria.

Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle`, branch
`feat/task-439-phase2-memory-lifecycle`, based on `origin/feat/task-440-memory-retention` (5e34e39cc)
because PR #513 is not merged. Upstream unset so a push cannot land on the phase 1 branch.

## CLI Lanes

Mode: enabled (user: prefer CLI lanes until they hit limits, then subagents).

`ptah_agent_list` 2026-09-15:

| Agent | Type | Status | Capabilities |
| ----- | ---- | ------ | ------------ |
| codex | cli | installed | messaging: queue, role delivery: preamble/developer-instructions |
| copilot | cli | disabled (installed) | messaging: queue, role delivery: preamble/task-prompt |
| cursor | cli | not installed | messaging: interrupt, role delivery: preamble/task-prompt |
| antigravity | cli | installed | messaging: none, role delivery: preamble/task-prompt |
| opencode | cli | not installed | messaging: none, role delivery: preamble/task-prompt |
| pi | cli | not installed | messaging: steer, role delivery: preamble/task-prompt |
| ollama cloud | ptah-cli | available | provider: Ollama Cloud, ptahCliId: pc-85830910-3d81-4248-84c1-4fa52752dd19, messaging: queue |
| claude cli | ptah-cli | available | provider: Claude (Subscription), ptahCliId: pc-effaa2c4-0d41-4e95-980a-89d3bf971b4d, messaging: queue |

Roster (user choice at Gate 0.1):

| Phase | Lane | Spawn args | Deliverable |
| --- | --- | --- | --- |
| Architecture | claude cli | `{ ptahCliId: 'pc-effaa2c4-…', modelTier: 'opus', role: 'software-architect' }` | `implementation-plan.md` |
| Decomposition / verify | team-leader subagent | — | `batches.md` |
| Implement | codex | `{ cli: 'codex', role: 'backend-developer' }` | code + `batch-N-report.md` |
| Review | ollama cloud | `{ ptahCliId: 'pc-85830910-…', modelTier: 'opus', role: 'code-logic-reviewer' }` | `code-logic-review-batch-N.md` |

Lane completion is watched with file-existence watchers (TASK_2026_438). Revise cap: 2 rounds. A lane
that fails twice is dropped and its work moves to a subagent.

## Conversation Summary

- 2026-09-15: PR #513 open → worktree from the phase 1 branch. Umbrella spec copied from
  `docs/skill-corpus-tasks`.
- 2026-09-15: `implementation-plan.md` written by the claude cli lane (lane record lost on host restart;
  deliverable complete). Gate 2 APPROVED by the user with the recommended option of every decision:
  D1 N=30, M=60, cap 25,000 evictable rows per workspace, 7-day cap grace; D2 ship enabled; D3 "used" =
  injected hits, MCP search hits, `memory:get`, `mem:getObservations`, curator merge; D4 delete hit-based
  promotion/demotion; D5 corpus members exempt; D6 delete decay diagnostics and tile.
- R1 (contentless `memory_concepts_fts` drift) filed as a follow-up task, out of scope here.
- Phase 1 follow-ups filed as separate backlog tasks (TUI MemoryPanel storage, `formatSnapshot`
  locale, memory-curator `*.test-support.ts` exclude).
