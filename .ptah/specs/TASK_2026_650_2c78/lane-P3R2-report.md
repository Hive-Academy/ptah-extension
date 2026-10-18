# Phase 3 review revision round 2

## N1 — owned messages survive tab rebinds

Chose option (a): retain ownership per tab in `ownedMessages` (`generation-run-event-adapter.ts:24,149-168,176-188`). The adapter no longer discards ownership when the bound run changes. On return, the store's bound run lookup supplies the terminal status; `finish()` closes only the matching tab/run/message, after `flushSync` and the `currentMessageId` check. It still skips a live real chat turn. Finalization removes ownership, so repeated terminal observation cannot close it again. The separate tab B owner remains intact. Evidence: `GenerationWorkflowStore.bind` calls `refresh`, `refresh` reads the bound run, and `MessageFinalizationService.finalizeCurrentMessage` resolves background tabs by ID. This keeps the in-progress A tree open until its actual terminal status is known, rather than prematurely marking a running generator successful.

Real-service spec: `finalizes tab A after a terminal lookup on return without closing tab B` (`generation-run-event-adapter.spec.ts:243`). It uses real `TabManagerService`, `StreamingHandlerService`, and `MessageFinalizationService`, streams A, rebinds and streams B, marks A completed while away, returns to A, and checks exactly one finalization of A, A no longer busy, a new start admitted, and B's owned message unchanged. Existing consecutive-run and real-turn protection specs remain green.

## N2 — terminal interruption status

`generation-run-event-adapter.ts:164-167` passes `isAborted = status !== 'completed'`. In `MessageFinalizationService.finalizeCurrentMessage` (`chat-streaming/src/lib/message-finalization.service.ts:143-163`), the second parameter marks still-streaming tree nodes as interrupted when true. Spec `finalizes %s with isAborted=%s` (`generation-run-event-adapter.spec.ts:225`) covers completed=false and failed/cancelled/timed-out=true. The existing cancelled-run assertion was updated (`:188`).

## Checks

- Prettier applied to both changed files.
- Focused Jest: 2 suites, 13 tests passed (rechecked after the final assertion).
- Nx typecheck and lint: successfully ran both targets for 2 projects (`@ptah-extension/setup-wizard`, `ptah-extension-webview`).
- Nx test: confirmed `Running target test for 2 projects`; successfully ran test for 2 projects.
- Scoped `ptah_get_diagnostics` after edits: compiler tool reported 5 errors: three pre-existing tuple-inference errors in the adapter spec's mock call inspection (line 110), and two BigInt target errors in shared `capability-id-codec.ts` (lines 262-263). The required project Nx typecheck passed.

## Final line counts

| File | Lines |
| --- | ---: |
| `generation-run-event-adapter.ts` | 233 |
| `generation-run-event-adapter.spec.ts` | 488 |
| `generation-workflow-shell.component.ts` (unchanged) | 105 |
| `generation-workflow-shell.component.spec.ts` (unchanged) | 198 |

## Decisions

- **Per-tab ownership.** Options: retain ownership until terminal lookup, or finalize on rebind. Evidence: `bind()` refreshes the run when the user returns; terminal status is then authoritative. Closing during a still-running generator would misrepresent its outcome. Reversible: yes.
- **Interrupted terminal nodes.** Options: always complete, or pass the terminal status to the finalizer's aborted flag. Evidence: the finalizer marks unfinished nodes interrupted when that flag is true. Reversible: yes.

## Deviations

No source scope or check deviations. The scoped diagnostics service disagreed with the successful Nx typecheck as noted above.

## Proposed Removals

None.
