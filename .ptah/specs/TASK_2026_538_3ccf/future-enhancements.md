# Future enhancements - TASK_2026_538_3ccf

This file lists every follow-up recorded in `batches.md` for Batches 1-16. None of them blocks this task. Each item
names where it was recorded and the evidence on branch `feat/task-538-surface-contract-v2`.

Priority: **P1** is a security gap or an unmet requirement; **P2** is a correctness or robustness gap; **P3** is
maintenance.

## P1 - security and unmet requirements

1. **The shared MCP dispatcher returns raw exception text for tools other than the surface tools.**
   - Two catches do this:
     - `handleIndividualTool`'s catch answers "Tool X failed: <message>";
     - the top-level `handleMCPRequest` catch returns a JSON-RPC error carrying the message and the stack.
   - Location: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:227`, `:1903`.
   - The surface tools already return fixed public text (`SURFACE_TOOL_UNEXPECTED_FAILURE`,
     `SURFACE_DELIVERY_FAILED_PUBLIC`).
   - Changing the shared catches alters the result of every tool, so it was left out of this task.
   - Recorded in: Batch 13 review F2 (`code-logic-review-batch-13.md`, re-review "Failure modes").
2. **The main `@ptah-extension/shared` barrel is not zod-free.**
   - The task-description NFR (Compatibility) says the main barrel stays zod-free. That was already false before this
     task: the barrel reaches zod through three modules that predate it:
     - `libs/shared/src/lib/providers/provider-registry.ts:20`
     - `libs/shared/src/lib/types/origin-sidecar.types.ts:31`
     - `libs/shared/src/lib/utils/codex-token-freshness.ts:1`
   - Req 1.5 is met. `index.zod-free.spec.ts` guards the import closure of `surface.types.ts` and
     `surface-catalog.ts`.
   - To finish the job, move those three modules' zod use behind a subpath entry point and widen the spec to the
     whole barrel.
   - Recorded in: Batch 6 (orchestrator decision, `context.md`).
3. **Manual check A2: MCP tool permissions in an Electron dev build.**
   - Confirm that `mcp__ptah__ptah_surface_update` and `mcp__ptah__ptah_surface_get_state` get the same permission
     handling as the other `ptah_*` tools in a real Electron dev session. No automated test covers this.
   - Recorded in: plan assumption A2, Task 16.1, `handoff-494.md`.

## P2 - correctness and robustness

4. **`surface:release` RPC (Q3) is not built.**
   - The UI has no way to tell the host that a surface is no longer shown. Surfaces leave the store only by agent
     delete or by LRU and byte eviction.
   - Recorded in: plan Q3, Task 16.1, `handoff-494.md`.
5. **The "indeterminate" doc comment overstates what `require-idle` guarantees.**
   - Location: `libs/backend/rpc-handlers/src/lib/chat/session/surface-submit-turn.service.ts:132`.
   - The comment says the second of two live sends is always refused. In fact, a stalled older send can be accepted
     after a newer turn ends. The guarantee is "no concurrent turn while one is queued or in flight".
   - The fixed client detail already describes `indeterminate` correctly as "may still run". Only the comment needs
     qualifying.
   - If the product later needs cancellation or strict ordering, that is new work.
   - Recorded in: the Batch 11 re-review (minor), and carried to `handoff-494.md`.
6. **`http-server.handler.spec.ts` collides on ports under parallel runs.**
   - The failing test is "tries no more than the configured port and next two ports after collisions". It binds a
     random port and then the next two, so it hit `EADDRINUSE` and a 5 s timeout when two nx runs overlapped (seen
     in the Batch 11 and Batch 15 verifications).
   - It passes when it runs alone.
   - Fix: retry the port pick, or reserve the three ports up front.
   - Recorded in: Batches 11, 13 and 15 verification.
7. **Specs that spawn processes time out when a large multi-project run loads the machine.**
   - This task did not change any of these specs or the code they test. In the final Mode 3 cross-check (8 projects
     in one nx run) they all timed out, and each passed when re-run alone:

     | Spec | Project | Re-run alone |
     | --- | --- | --- |
     | `libs/backend/vscode-core/src/services/git-info.service.review.spec.ts` (also seen in Batch 7; last changed in `e7f80d3c8`) | vscode-core | 2/2 |
     | `libs/backend/vscode-core/src/services/git-info.service.remote-stash.spec.ts` (737 s under load) | vscode-core | 24/24 in 157 s |
     | `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.spec.ts` | agent-sdk | 25/25 |
     | `libs/backend/rpc-handlers/src/lib/handlers/voice-rpc.handlers.spec.ts` | rpc-handlers | 58/58 |

   - Fix: give them explicit timeouts, or run the real-process specs outside the parallel pool (a separate Jest
     project, or `--runInBand` for those files).
   - Recorded in: Batch 7 and Mode 3.
8. **The per-host composition specs should assert exact values.**
   - Specs: `apps/ptah-extension-vscode/src/di/surface-composition.spec.ts`,
     `apps/ptah-electron/src/di/surface-composition.spec.ts`,
     `libs/backend/cli-engine/src/lib/surface-composition.spec.ts`.
   - Electron and CLI: the MCP-write-then-RPC-read direction does not assert the content values it reads back.
   - All three hosts: the RPC-write-then-MCP-read direction checks substrings only.
   - The terminal operation lookup checks only its status.
   - Recorded in: the Batch 14 re-review (minor).
9. **The dead conflict branch in `planV1Proposal`.**
   - Location: `libs/backend/vscode-lm-tools/src/lib/surface/surface-agent-mutations.ts:273`.
   - Its `'rejected'` branch cannot be reached, because `checkSurfaceConflict` always accepts
     `kind: 'v1-proposal'`.
   - Either remove the branch, or add a test that documents why it is kept.
   - Recorded in: Batch 12 review (minor, left unchanged as instructed).

## P3 - maintenance

10. **Files over the 700-line soft ceiling.** All spec growth was appended as the task rules required. Split these in
    a housekeeping task:
    - `libs/shared/src/mcp-apps-contracts/surface-validator.spec.ts`: 908 lines (Batch 4).
    - `libs/shared/src/mcp-apps-contracts/dashboard-trust-boundary.spec.ts`: 769 lines, after the v2 blocks were
      appended (Batch 15).
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/dashboard-namespace.builder.spec.ts`:
      720 lines. It was already 709 before this task (Batch 12).
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`: 2,034 lines. It
      was already far over the ceiling before this task; Batch 13 appended to it.
11. **`surface-state.service.ts` is at exactly 700 lines** (Batch 11). The next addition to the facade must first move
    another pure plan into a helper (`surface-commit.ts`, `surface-operation-gate.ts` and `surface-ui-mutations.ts`
    set the pattern).
12. **The v2 fixtures are not exported from `@ptah-extension/shared/testing`.**
    - Location: `libs/shared/src/testing/fixtures/surface.ts`, which holds `makeSurfaceEnvelope` and related helpers.
    - Specs inside shared import them by relative path. TASK_2026_494's renderer specs will need them from the
      testing entry point.
    - Recorded in: `handoff-494.md`.
13. **Jest warnings.**
    - The "worker process has failed to exit gracefully" warning and module-loading notices appear in the combined
      shared, rpc-handlers and vscode-lm-tools runs.
    - Find the open handles with `--detectOpenHandles`, and `.unref()` or clear the timers involved.
    - The new specs pass when run alone.
    - Recorded in: Batches 4, 10 and 11.
14. **The "Nx Cloud encountered some problems" notice** (401, organization disabled) appears on every run. It does not
    affect results. Disable the Nx Cloud runner for local runs, or restore the organization.
