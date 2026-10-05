# S4-b fix round 1a — `TASK_2026_597_ab22`

Scope: logic review B findings S1, M1, M2 and style review Serious 1. Worktree `task-597-s4`. Nothing committed.

## Findings

| Finding | Verdict | What changed |
| --- | --- | --- |
| B-S1: guard steer went through `sendToAgent` | FIXED | `steerLane` (agent-process-manager.service.ts) now calls `tracked.sdkHandle.steer(message)` directly and is synchronous. With no `steer` on the handle it logs `Lane budget steer not delivered (no mid-turn steer); the stop threshold still applies` and returns. The steer cannot be queued or interrupt-resumed. The guard asks once per turn, so this line is logged once per turn. `applyLaneGuard` still runs only while the status is `running`. |
| B-M1: counts carried over to caller turns | FIXED | Added `LaneBudgetGuard.reset()`, which clears the counts, the repeat map and the `steered` flag. A guard that has already stopped stays stopped. `continueConversation` calls it when it moves the record to `running`. After S1, every turn starts in `continueConversation`: direct calls, router flush of queued caller messages, and the caller's interrupt-resume. All of these are caller-initiated, because the guard never starts a turn now. The comments in `handleExit` and on `discardPending` were reworded to match. |
| B-M2: coarse repeat key on Codex file changes | FIXED (exclusion) | Codex `file_change` segments carry no content or diff, only `{ file_path }`, so a content hash is not available. I chose the smaller change: tools in `FILE_EDIT_TOOLS` (`write`, `edit`, `multiedit`, `delete`, `notebookedit`, `apply_patch`, matched case-insensitively) skip the repeat check but still count toward steer and stop. |
| Style S1: `stopReason` widened to `string` | FIXED | Added `export type LaneStopReason = 'tool-call-budget' \| 'repeat-call'` to `agent-process.types.ts` and set `AgentProcessInfo.stopReason?: LaneStopReason`. `LaneBudgetStopReason` is deleted. The guard and the manager now import `LaneStopReason` from `@ptah-extension/shared`. The JSDoc now says only that the field is stamped on the terminal record and the `agent:exited` payload; it no longer claims readers. The only other writer is `stopLaneForBudget`, and the typecheck below covers it. `agent-wait.tool.ts` does not read the field yet. |

## Files

- MODIFIED `libs/shared/src/lib/types/agent-process.types.ts`: adds `LaneStopReason`, narrows the field type and rewrites its JSDoc in neutral terms.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-budget-guard.ts`: imports the shared type, adds the file-edit exclusion and `reset()`.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`: direct mid-turn steer, guard reset in `continueConversation`, shared type, updated comments.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-budget-guard.spec.ts`: new tests for the file-edit exclusion (still counts toward the budget), `reset` (counts, repeats and steer start from zero) and reset after a stop (no effect).
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.guard.spec.ts`: the fake lane can now have optional `steer` and `continuation`. Tests:
  - the steer goes through `handle.steer` and never through `sendToAgent`;
  - a handle with continuation but no steer does not call `sendToAgent` and logs "not delivered (no mid-turn steer)" exactly once;
  - after a caller's `continueConversation` the lane gets a fresh budget and a second steer, and is not stopped.

## Checks

- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/shared`: exit 0. shared: 87 suites, 2519 tests passed. cli-agent-runtime: 89 suites, 1785 passed, 1 skipped. Jest printed a "worker failed to exit gracefully" warning.
- `npx nx affected -t typecheck --files=libs/shared/src/lib/types/agent-process.types.ts --exclude='api-*,ptah-license-server,ptah-landing-page-e2e'`: exit 0, typecheck passed for 63 projects.
- `npx nx run di-lint:lint`: exit 0.
- `npx nx run degradation-audit:lint`: exit 1. The only failing directory is `libs/backend/agent-sdk: 5 FAIL (baseline 4)`. That is a parallel developer's area and none of my files are in it. `libs/backend/cli-agent-runtime` and `libs/shared/src` pass their baselines.
- Earlier, a parallel developer's syntax error in `libs/backend/tool-output-reducers/src/lib/output-budget/spool.ts` (a literal newline inside a string) blocked the manager spec and the audit. I reported it to main, waited until it was fixed, then ran the checks above.
- `*.png`: none rewritten (`git status -- '*.png'` is empty).

## Out of scope

- B-S2 (no reader for `stopReason` in `agent-wait`) belongs to the parallel developer. The JSDoc no longer claims a reader.
- `discardPending` in `stopLaneForBudget` now only drops queued caller messages for a lane that is stopping. It was kept because it is correct, and the comment was reworded.
