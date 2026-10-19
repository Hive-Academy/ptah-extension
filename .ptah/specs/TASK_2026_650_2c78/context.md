# Context — TASK_2026_650_2c78

Phase 3 of epic TASK_2026_647_1b0f (wizard plan 1). Read the epic first:
`../TASK_2026_647_1b0f/context.md` and `../TASK_2026_647_1b0f/research/setup-wizard-analysis.md`.

## Request

User, 2026-10-13 (epic plan 1): extract subagent generation and system-prompt generation out of
the overall workspace analysis. User, 2026-10-15 (649 Gate 1.7, D10): the goal for the Setup Hub
is context separation — subagent generation and system-prompt generation separate from the
workspace analysis. User, 2026-10-16: start the next epic task while PR #736 (649) is in CI.

## Fixed inputs (user decisions, epic `context.md`)

- Keep and fix: no user-visible capability is removed without user approval. Only duplicated
  chat infrastructure may go; every removal goes under `## Proposed Removals`.
- Epic decision 2: setup sessions are normal chat tabs with a workflow tag (`Tab.workflow`, 648).
- Epic decision 4: agent generation and the project system prompt must gather all the context
  they need themselves when no analysis exists or the analysis is old. This needs a freshness
  check on the analysis. (This overrides the research open question 1 recommendation.)
- 649 D10/D12: the Setup Hub home screen keeps its visual design; functional fixes reuse its
  existing styles. New design is allowed on internal wizard pages only.

## Scope boundary

- In 650: generation (agents, enhanced project prompt) as independent workflows that do not
  require the 4-phase analysis run; self-gather context; analysis freshness check.
- Not in 650 (TASK_2026_651_2fb8): running the 4 analysis phases as chat sessions and the new
  manifest version with sessionId / attempt / fingerprints per phase.
- Not in 650: TASK_2026_680_bc6c (open flagged sessions in their builder page) and
  TASK_2026_682_f705 (649 review follow-ups).

## Dependency note

Base was `main` at `6c0490f1f` (648 merged as PR #733). PR #736 (649) merged on 2026-10-16
(`3c153c574`); this branch was fast-forwarded to it, so the 649 builder-on-chat pieces
(builder-local tab adapter, `chrome="bare"` session embed, builder sidebar) are available.

## Strategy

Type FEATURE, depth Full (see `decisions.md` D1). Flow:
PM (`task-description.md` + `parity-inventory.md` from the OLD code) → cross-side review → Gate 1
→ [designer → prototype → Gate 1.7, if an internal wizard page is added or redesigned]
→ architect → cross-side review → Gate 2 → team-leader → batches → one code-logic review → QA.

## Location

- Worktree `D:\projects\ptah-extension\.claude-worktrees\task-650-wizard-generation`,
  branch `refactor/task-650-wizard-generation` from `main` `6c0490f1f`.

## CLI Lanes

- Preference source: memory (`orchestration-executor-preference`, `implementation-lane-preference`,
  `lane-review-approval-mode`): lanes first, codex first, cross-side review.
- Mode: `enabled`. Approval: `lane-review` (removals and user-reserved decisions still go to the
  user).
- `ptah_agent_list` 2026-10-16 ~18:25 UTC:

| Agent | Type | Status | Limit state |
| ----- | ---- | ------ | ----------- |
| codex | cli | installed | confirmed room (Weekly 42%) |
| copilot | cli | disabled (installed) | unknown |
| cursor | cli | not installed | unknown |
| antigravity | cli | installed | unknown (reader failed) |
| opencode | cli | installed | near limit (Go Monthly 92%) |
| pi | cli | not installed | unknown |
| grok | cli | installed | unknown (API key, no plan) |
| Glm | ptah-cli | available (Ollama Cloud) | unknown |
