# Handoff - TASK_2026_596_0a19 (plan-limit windows and reset detection)

Date: 2026-10-04. Phase: IMPLEMENTATION, not started. Next action: run Batch 1.

## Where things are

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets`
- Branch: `feat/task-596-quota-resets` at `origin/main` 5bb19f9fb. No upstream set (on purpose). No commits yet.
- `node_modules` is a junction to the main checkout (`D:\projects\ptah-extension\node_modules`).
- Uncommitted work in the worktree:
  - `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts` and `.spec.ts`:
    the "Main context" -> "Context" rename (done, 11/11 tests pass). It is Task 16.2 in `batches.md`;
    the team-leader stages it in the Batch 16 commit.
  - `.ptah/specs/TASK_2026_596_0a19/` (untracked): all task artifacts.

## Approved artifacts (all gates passed)

| Gate | Artifact | Status |
| --- | --- | --- |
| 1 | `task-description.md` Rev 3 | user APPROVED, Codex APPROVED |
| 1.7 | `design-spec.md` Rev 5 + §3.3 amendments A1-A3 (binding) | user APPROVED; Codex N1/N2 closed by A1/A2 |
| 2 | `implementation-plan.md` Rev 3 + "Gate 2 amendments" G1-G3 at the top (binding) | user APPROVED; final Codex review REVISE at the cap, its 2 blockers closed by G2/G3 |
| - | `batches.md` | 22 batches, 52 tasks, 7 phases; Batch 1 marked IN_PROGRESS but NOT yet executed |

Reviews: `task-description-review.md`, `design-spec-review.md`, `implementation-plan-review.md`.
Full decision log: `context.md` (read "User Decisions", "Rebase" and "CLI Lanes").

## User rules that bind the rest of the task

1. Commit per batch: the team-leader commits each batch on the feature branch after its scoped checks pass
   (`npx nx run-many -t typecheck,test,lint -p @ptah-extension/<project>`). Never push. Never commit
   anything outside the batch.
2. Executors: Claude subagents author code (backend-developer, frontend-developer, senior-tester).
   CLI lanes allowed: `codex` and `opencode` only, used as cross-side reviewers (one review per phase,
   max 2 revise rounds). Antigravity and Glm are NOT allowed. OpenCode has no messaging: read it with
   `ptah_agent_read`.
3. Codex model: do not pass `model`; it resolves from `~/.ptah/settings.json`
   `agentOrchestration.codexModel` (currently `gpt-5.6-terra`, effort `medium`).
4. Do NOT edit settings page files (a separate settings refactor PR is in flight, live session
   `ptah-ptah-extension-settings-last-round-df90180000eo82pxnz8p901`).
5. No live network checks of Ollama, Antigravity or Codex rollout files. Fixtures only.
6. Do not re-implement TASK_2026_597 deferred follow-ups (batches 11, 12, 13, 22, 26, 27 of
   `.ptah/specs/TASK_2026_597_ab22/batches.md`). See `context.md` "Rebase".
7. Spawn tools warn and list alternatives; they never block a spawn. Unknown is never shown as 0.
8. UI batches need visual-reviewer screenshots (dark + light, 280/360/440 px) compared with
   `prototype/` and shown to the user before merge.

## Phases (from batches.md)

| Phase | Batches | Scope | Executor | Ends with |
| --- | --- | --- | --- | --- |
| 1 | 1-3 | shared types | backend-developer | codex/opencode review |
| 2 | 4-5 | agent-sdk: Claude event mapper (no `utilization`, G1), account probe (per-turn re-read, G2) | backend-developer | review |
| 3 | 6-10 | auth-providers: owner resolver, Codex re-pin 0.147.0 -> 0.155.1, ledger, Antigravity + Ollama readers | backend-developer | review |
| 4 | 11-13 | cli-agent-runtime: lane failures, per-run `quotaOwner` (G3), owner discovery | backend-developer | review |
| 5 | 14-15 | vscode-lm-tools spawn/list output, rpc-handlers | backend-developer | review |
| 6 | 16-21 | webview stats tiles + dashboard card (+ Context rename) | frontend-developer | review + visual-reviewer |
| 7 | 22 | test sweep F1-F83 + G2/G3 fixtures | senior-tester | - |

Main risk: R3, the Codex protocol re-pin (Task 6.2). If the regenerated types are incompatible, Task 6.2
stops and reports; Batch 7 onward wait for the user.

## How to continue

1. Read this file, `context.md`, the top of `implementation-plan.md` (Gate 2 amendments) and `batches.md`.
2. Run Batch 1 with the executor prompt the team-leader gave (backend-developer, sequential): implement
   every Batch 1 task, use `quotaOwner` never `quotaOwnerKey` (D3/AS2), no stubs, do not edit
   `batches.md`, do not commit, return every file path and how each listed risk was handled.
3. Re-invoke the team-leader (verify-and-commit mode) after each executor returns. It verifies,
   commits the batch, and names the next batch.
4. At each phase end, spawn one codex or opencode review lane on the phase diff (`ptah_agent_list`
   first; follow the agent-lanes skill task contract; declare `code-logic-review.md` or a
   phase-named review file as the deliverable).
5. Report to the user at each phase end and stop on any blocker.
