# Task Context - TASK_2026_652_7284

## User Request

"lets do that work on the backend until i merge that task and update you" — the backend-only part
of epic TASK_2026_647_1b0f that does not overlap TASK_2026_629 (canvas board redesign, branch
`feat/task-629-canvas-board`), while 629 is finished and merged.

Epic context, user decisions and verified defects: `.ptah/specs/TASK_2026_647_1b0f/context.md`.
Research: `.ptah/specs/TASK_2026_647_1b0f/research/*.md`.

## Scope

1. (TASK_2026_649, backend) `ptah_harness_propose_config` becomes session-scoped (carries the
   calling session id) and proposals persist in the backend (`HarnessConfigStore` or a sibling),
   so a preview can be rebuilt after reload. Add an RPC to read the latest proposal for a session.
2. (TASK_2026_649, backend) `harness:start-new-project` returns the composed seed prompt (plus
   intake and plugin results) to the caller instead of broadcasting `HARNESS_OPEN_WORKFLOW`.
   The existing harness-builder frontend consumer is adapted so New Project keeps working.
3. (TASK_2026_651, backend) Analysis manifest new version: per phase `sessionId`, attempt,
   input fingerprints and output verification status; version migration, no reinterpretation of v3.
4. (TASK_2026_650, backend) Analysis freshness check (workspace fingerprint vs. manifest).
5. (TASK_2026_650, backend) Agent generation and project system-prompt generation gather their
   own context when the analysis is missing or stale (user decision 4).

## Constraints

- **Do not modify** files in `libs/frontend/{canvas,chat,chat-ui,chat-streaming,chat-state,chat-types}`
  or `apps/ptah-extension-webview` — TASK_2026_629 changes them. `libs/frontend/harness-builder` and
  `libs/frontend/setup-wizard` are not touched by 629 and may receive minimal adapter changes.
- **Keep and fix** (user rule): no user-visible capability is removed. Any removal goes to the user.
- Memory-safe verification per CLAUDE.md: scoped `nx run-many -t typecheck,test,lint -p <changed>`
  with `--parallel=1`.

## Task Type

FEATURE

## Complexity

Complex (3 backend libs plus small frontend adapters; persisted format migration)

## Strategy

FEATURE, Partial depth: software-architect (parity-inventory.md + implementation-plan.md) →
cross-side plan review → Gate 2 → team-leader → batches → one code-logic review per phase → QA.
PM phase skipped: requirements, decisions and research already exist in the epic folder
(decisions.md D1).

## CLI Lanes

- Preference source: memory `orchestration-executor-preference` (lanes-first, most recent) over the
  older quota-sensitive memories; this session the user invoked `/agent-lanes`.
- Mode: **enabled**
- Approval: **lane-review**
- `ptah_agent_list` (2026-10-13): codex cli installed; antigravity cli installed; opencode cli
  installed; grok cli installed; Glm ptah-cli available (Ollama Cloud,
  pc-355b645d-35af-4974-84cf-9cf961ea0164); copilot disabled; cursor, pi not installed. All limit
  states unknown, none AT LIMIT.

### Roster

| Phase | Executor | Side / family |
| --- | --- | --- |
| Architecture (`parity-inventory.md`, `implementation-plan.md`) | codex lane | CLI / codex |
| Plan review (`implementation-plan-review.md`) | in-process subagent (software-architect) | in-process / claude |
| Decomposition | team-leader subagent | in-process |
| Implement batches | codex lane per batch | CLI / codex |
| Code-logic review | antigravity lane | CLI / antigravity (different family from codex) |

## Conversation Summary

- No hotfix for the builder; normal session tiles; one chat session per analysis phase; generation
  self-gathers context when analysis is missing or old (epic context.md).
- Work happens in worktree `.claude-worktrees/task-647-setup-hub-chat-sessions`, branch
  `task-647-setup-hub-chat-sessions`.

## Gate decisions

- **Gate 2** (implementation-plan.md, revision round 2): **APPROVED by user** on 2026-10-13.
  Escalation reason: reviewer verdict REVISE at the revise cap (F18 Serious open). User accepted
  the orchestrator recommendation: F18-F21 become binding notes for team-leader decomposition
  (F18: register only `harness:get-proposal` in C, move `wizard:analysis-status` registry and
  baseline entries into G, move `agent-generation/src/index.ts` from G to E; F19: scoped
  `cli-engine` test after the RPC batches; F20: E keeps `loadManifest` compatible for
  `wizard-generation-checkpoint.service.ts:133`; F21: D1 owns the frontend `getProposal` wrapper).
