# Batch 11 + Batch 14 report — TASK_2026_614_327a

Executor: backend-developer. Worktree: `.claude-worktrees/task-614-d-e`. No git writes (one read-only
`git diff --stat` was run to list the changed files).

## Batch 11 — Task 11.1: no turn-sum fallback for Codex (E.1, S4-a M3)

- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts`
  - `contextFigure()`: for `cli === 'codex'`, a missing rollout (`null`) or a rollout read that throws
    now returns `tokens: null`, `source: 'estimate'`. The streamed figure (the `turn.completed` sum) is
    never used for Codex. The gate then decides on idle time only. The `note` (`no rollout figure` /
    `rollout unreadable: …`) is kept in the log line. Non-Codex CLIs are unchanged.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.spec.ts`
  - Replaced the test that pinned the old fallback (missing rollout + streamed 70k → fresh).
  - Regression tests: Codex, no rollout, streamed 120k, idle 2 min → `resume`, `contextTokens: null`;
    same at idle 11 min → `fresh` (`idle 660s exceeds 600s`); unreadable rollout with streamed 120k →
    `resume`, `contextTokens: null`, reason logged.

## Batch 14 — Decision 4 option (a)

### Task 14.1: gate `spawnFromSdkHandle` resumes (E.4, S4-a M6)

- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`
  - `gateResume(task, resumeSessionId, cli)` now takes a task, not a `SpawnAgentRequest`, and returns
    the exported `GatedResume` (`task`, `resumeSessionId` absent on `fresh`, `resumeDecision`,
    `originalTask`). `doSpawn` builds its request from it. Behaviour of `spawn()` is unchanged.
  - New public `prepareSdkHandleSpawn({ cli, task, model?, resumeSessionId? })`: runs the blocked-model
    check and, with a resume id, the same resume gate. It must run BEFORE the handle is built, because
    the Ptah CLI registry builds and starts the SDK query inside `spawnAgent`, before
    `spawnFromSdkHandle` is ever called.
  - `spawnFromSdkHandle` meta gains `resumeDecision?` and `originalTask?`; `originalTask` is stored on
    the record and `resumeDecision` is returned on the result (same shape as `doSpawnSdk`).
  - Doc comment on `continueConversation` stating why live continuation stays ungated (Decision 4 a):
    the context is kept in the running process, `SDK_IDLE_RELEASE_MS` (5 min) is below the 10 min idle
    rule, so only the 60k rule could apply, and swapping a live lane mid-conversation costs its context.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`
  - Ptah CLI branch calls `prepareSdkHandleSpawn` first (before `reserveAgentId` and
    `registry.spawnAgent`). The lane prompt is the gated task plus the completion contract; the registry
    and `spawnFromSdkHandle` get the gated `resumeSessionId`; `resumeDecision` and `originalTask` are
    passed on; the record keeps the caller's `request.task`.
- Tests:
  - `agent-process-manager.service.spec.ts` › `Ptah CLI resumes (TASK_2026_614, E.4)`: resume over 60k →
    handoff task, no resume id, `spawnFromSdkHandle` result carries `resumeDecision: fresh` and the
    record keeps `originalTask`; `resume` keeps id and task; no resume id → gate not consulted.
  - `agent-namespace.builder.spec.ts`: gated `fresh` → registry gets the handoff prompt and no resume id,
    `spawnFromSdkHandle` gets `resumeDecision`/`originalTask`, result surfaces `resumeDecision`.

### Task 14.2: blocked-model check on the Ptah CLI path (D.12 B-m2)

- `agent-process-manager.service.ts`: the R9.5 check is extracted into `assertLaneModelAllowed(cli, model)`,
  used by `doSpawnSdk` (unchanged behaviour) and by `prepareSdkHandleSpawn`.
- A model left to the agent's configured default or tier is resolved inside `PtahCliRegistry.spawnAgent`
  and stays unchecked (recorded, not fixed, per brief).
- Tests: `agent-process-manager.guard.spec.ts` — blocked model on `prepareSdkHandleSpawn` →
  `LaneModelBlockedError`, no `agent:spawned`, no record; no model → passes unchecked.
  `agent-namespace.builder.spec.ts` — a refusal stops the spawn before `reserveAgentId`,
  `registry.spawnAgent` and `spawnFromSdkHandle`.

## Checks

| Command | Exit |
| --- | --- |
| `npx nx run-many -t typecheck,lint,test -p cli-agent-runtime,vscode-lm-tools --parallel=2` | 0 (tests 1800 passed/1 skipped; 2784 passed; lint 0 errors, pre-existing warnings only) |
| `npx nx run di-lint:lint` | 0 |
| `npx nx run degradation-audit:lint` | 0 |
| `npx nx run cli-agent-runtime:lint` (rerun after `prettier --write` on the manager) | 0 |

`npx eslint` on the 7 changed files: 0 errors; 2 warnings in the manager (`max-lines`, an existing empty
arrow at the file's lower half), both pre-existing in kind.

## Deviations

- Task 14.2 says "run the same check in `spawnFromSdkHandle` before the handle starts". The handle is
  already started when `spawnFromSdkHandle` runs (the registry starts the query), so the check and the gate
  live in `prepareSdkHandleSpawn`, which the caller runs before building the handle.

## Out of scope (not touched)

- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1143` also calls `spawnFromSdkHandle`
  (frontend-initiated Ptah CLI resume). It does not call `prepareSdkHandleSpawn`, so that path is still
  ungated and unchecked. Fix: call `prepareSdkHandleSpawn` before its `registry.spawnAgent`, same as the
  namespace builder.
