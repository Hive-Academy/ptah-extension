# TASK_2026_263 — Implementation report (2026-08-16)

Uncommitted on `ak/tui-defects`. All batches complete; logic review run + fix pass applied.

## Batch 1 — Question routing on interactive surfaces

- `PermissionHandlerService.hasSurfaceQuestionTargets()` (chat-streaming) — the shared fix for the bug patched locally in tribunal (54c24f85f) and never lifted.
- `StreamRouter`: `interactiveSurfacesForSession()`; microtask fallback + `refreshQuestionTargetsForSession` + `refreshStaleQuestionTargets` resolve to interactive surfaces.
- `ChatMessageHandler.handleSessionIdResolved`: claimed surface gets `realSessionId` appended before refresh.
- Backend `AskUserQuestionService` honours delivery boolean (auto-picks instead of hanging 5 min); `listPendingBySession()`; new RPC `chat:pending-questions` (dual-registered).

## Batch 2 — Persistence + intake

- `HarnessWorkflowService` (root) owns mode/bubbles/claim/surface/pinned workspaceRoot/error; view no longer disposes on destroy; Stop (`workflow-stop`), Start over (abort+dispose), error alert (`workflow-error`).
- localStorage `ptah.harness.workflow.v1`; rehydrate re-claims surface, binds session, replays `chat:resume` history, restores pending questions; `workflow-resumed-note`.
- Setup Hub Resume state; duplicate-open guard per mode; cross-mode discard confirm; presets shape guard.
- Intake modal (what / audience / constraints / stack + other) → `harness:start-new-project { intake }` (Zod) → `buildNewProjectSeedPrompt(intake)`; visible bubble = intake summary, `chat:start` gets seed prompt.

## Batch 3 — Skill content (4 mirrors synced)

- `saas-workspace-initializer`: mandatory two-round AskUserQuestion discovery (business → stack w/ Recommend), Step a2 invokes `ddd-architecture` + `nx-workspace-architect` in Stage A; links fixed for junction layout; roadmap example marked illustrative.
- `/init-saas` rewritten to match; orchestration SAAS_INIT defers to the skill.

## Batch 4 — E2E

- `apps/ptah-electron-e2e/src/specs/harness/new-project.spec.ts` (6 tests) + `UiDriver.getObservedMessages/waitForObservedMessage`. 6/6 passing (55s).

## Verification

Jest green: harness-builder 93, core 762, shared 530, agent-sdk 924, chat-streaming 282, chat-routing 112, rpc-handlers 2142, chat 795. Typecheck/lint 0 errors on touched projects. vscode-core `tokens-uniqueness` failure is TASK_2026_262's skill-synthesis diff, not this task.
