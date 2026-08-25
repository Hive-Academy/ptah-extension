# TASK_2026_155 — Goal Workflow (/goal) for Ptah

## Status

- Phase: ARCHITECTURE_REVIEW (implementation-plan.md written, awaiting Checkpoint 2 user approval)
- Strategy: FEATURE (Full: PM -> Architect -> Team-Leader -> QA)
- Created: 2026-07-14
- Branch at start: ak/fix-canvas-issue

## User Intent

Implement a Claude Code-style `/goal` workflow in Ptah: the user defines a goal with a
measurable completion condition, and the session keeps working across turns until the
condition is met — without the user prompting each step.

Approved research findings (from prior conversation, based on official Claude Code docs
https://code.claude.com/docs/en/goal, shipped in Claude Code v2.1.139):

1. `/goal <condition>` stores a session-scoped completion condition (<= 4000 chars) and
   immediately starts a turn with the condition as directive.
2. Core mechanism = session-scoped Stop-hook evaluator loop: after each turn, condition +
   conversation transcript are sent to a small fast model (Haiku-class). Evaluator returns
   yes/no + short reason. "No" blocks the stop and feeds the reason as guidance for the
   next turn; "yes" clears the goal and records an achieved entry.
3. Evaluator does NOT run tools — it judges only what the main agent surfaced in the
   transcript. Conditions must be written as transcript-demonstrable end states.
4. One goal per session. Status view (condition, elapsed, turns, tokens, last reason),
   `/goal clear` (+ aliases stop/off/reset/none/cancel), goal restored on session resume,
   turn/time bounds expressed inside the condition text.

## Ptah Mapping (from research)

- Evaluator loop: extend existing `StopHookHandler` / `StopCallbackRegistry` in
  `libs/backend/agent-sdk` (libs/backend/agent-sdk/src/lib/helpers/stop-hook-handler.ts),
  wired via `SdkQueryOptionsBuilder`.
- Goal state: `GoalManager` (active condition, turn count, token spend, last reason);
  persist via `persistence-sqlite` so goals survive session resume.
- RPC: new `goal.*` namespace — dual registration (libs/shared rpc.types.ts +
  ALLOWED_METHOD_PREFIXES in libs/backend/vscode-core/src/messaging/rpc-handler.ts).
- UI: `/goal` chat command in webview, active-goal indicator with latest evaluator reason,
  status + clear.
- Out of scope for v1 (unless architect says otherwise): spawning extra agents (existing
  tier-1/3 hierarchy already covers delegation), cross-vendor goal passthrough.

## CLI Delegation

- cli_delegation: auto (Checkpoint 0.1 answered 2026-07-14 — team-leader recommends per batch)
- Available agents: codex (cli, installed), copilot (cli, installed),
  ollama cloud (ptah-cli pc-d8f4e156-fa15-4dc6-92ba-8e088e7e9ae9),
  claude cli (ptah-cli pc-45aa18a4-d3a1-4809-acae-e6eba6d2f95c)

## Log

- 2026-07-14: Context created from approved research; awaiting Checkpoint 0.1 + PM phase.
- 2026-07-14: Checkpoint 0.1 answered — cli_delegation: auto.
- 2026-07-14: project-manager wrote task-description.md (7 requirements / 33 acceptance criteria). Key finding: StopHookHandler currently always returns `{ continue: true }` — SDK stop-blocking contract is the architect's top verification item. Checkpoint 1 presented to user.
- 2026-07-14: Checkpoint 1 APPROVED by user.
- 2026-07-14: software-architect wrote implementation-plan.md. VERIFIED SDK `decision:'block'`+`reason` stop-blocking contract holds in installed @anthropic-ai/claude-agent-sdk (sdk.d.ts:5626 SyncHookJSONOutput). Decisions: new backend lib `@ptah-extension/goal-workflow` owns all goal state (agent-sdk stays persistence-free, gains additive StopDecisionRegistry); evaluator via InternalQueryService one-shot subprocess (re-entrant-safe, Haiku-tier, 20s timeout, tools denied); migration 0029*goals; goal: RPC namespace (not Pro-gated v1); FE indicator via pushed GOAL*\* messages. 7 batches (A→B→C→D→E spine + F/G parallel). Checkpoint 2 presented to user.
- 2026-08-09: Status set to `blocked` by the user, replacing the `in_progress`
  the task-doctor inferred during the TASK_2026_179 adoption pass.
  `status_inferred: true` was dropped from the carrier at the same time — the
  status is now declared by a human, not deduced, and leaving the marker would
  misreport a decision as a guess.

  **The blocker, stated so it is actionable**: Checkpoint 2 (the
  software-architect's `implementation-plan.md`) was presented on 2026-07-14 and
  never answered. Checkpoint 1 carries an explicit `APPROVED by user` line in
  this log; Checkpoint 2 has no answering line. Nothing can start until that
  approval — or a rejection — is recorded here.

  **State verified on 2026-08-09, not assumed**: `libs/backend/goal-workflow`
  does not exist; `GoalManager`, `goal-workflow` and `StopDecisionRegistry` have
  zero references across `libs` and `apps`; there is no `goal:` RPC namespace and
  no `/goal` command; no commit mentions the feature. The planning documents
  (`task-description.md`, `implementation-plan.md`) are intact and remain the
  starting point.

  **The plan has gone partly stale while waiting.** It reserves SQLite migration
  `0029_goals`; `0029` has since been taken by `0029_task_specs.ts`. Whoever
  unblocks this must renumber that migration, and should re-check the
  `StopHookHandler` / `SdkQueryOptionsBuilder` seams in `agent-sdk` against the
  current tree before trusting the rest of the plan's file references.
