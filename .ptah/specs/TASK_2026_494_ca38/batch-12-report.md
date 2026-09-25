# Batch 12 report — TASK_2026_494, Task 12.1

Session facade, workspace slices and surface sync. Executor: frontend-developer. No git was run.

## Files (all CREATED; no committed file was modified)

Root: `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\mcp-apps-page\src\lib\services\`

| File | Lines | Purpose |
| --- | --- | --- |
| `...\services\apps-workspace-slice.ts` | 162 | Pure slice types and transitions: `AppsWorkspaceSlice` (conversation, routing id, sync, streaming state, reducer-held surfaces, notices), `APPS_IMPLICIT_WORKSPACE`, `appsSliceKey`, `patchAppsSlice`, `removeAppsSlice`, `findAppsSliceKey`, `isAppsSliceOf`, `startAppsSlice` |
| `...\services\apps-surface-sync.ts` | 269 | `AppsSurfaceSync`, a plain class with one instance per slice: push intake, `surface:read` coordination, the Rule 3 grace timer, `dispose()` |
| `...\services\apps-surface-sync.spec.ts` | 494 | 16 specs, jest fake timers, deferred and timing `MockRpc` |
| `...\services\apps-session.service.ts` | 559 | `AppsSessionService`, the root facade: signals, DI, workspace partition, conversation lifecycle |
| `...\services\apps-session.service.spec.ts` | 605 | 19 specs. Uses the real `StreamingSurfaceRegistry`, `SurfaceUpdateInbox` and `WorkflowSessionClaimService`, plus a `MockRpc` |

Every file is under 700 lines. `src/index.ts`, the `state/` files, other libraries, configs, `batches.md` and `task.md` are untouched.

## Quality requirements

| Requirement | How it is met | Pinned by |
| --- | --- | --- |
| `inbox.claim` before `chat:start` | `claimConversation` (`apps-session.service.ts:414`) runs synchronously inside `start()` before `rpc.call('chat:start')` (`:183`). The slice holds the conversation before the claim, so the first push finds its slice | `claims the inbox BEFORE chat:start and sends the Apps start params` (the MockRpc records `inbox.isClaimed(tabId)` at call time) |
| Rollback on a failed start releases the inbox, the claims, the surface and the sync | `rollBackFailedStart` (`:441`) calls `teardown`, which calls `releaseConversation` (`:483-486`). That runs `inbox.release`, `workflowClaims.release`, `streamRouter.onSurfaceClosed` and `sync.dispose()`, each step isolated in its own try/catch, and then resets the slice with `error`. It covers a `success:false` result and a thrown RPC. A partial claim (a throw inside `claimConversation`) is undone there | `rolls a failed chat:start back: ...`, `rolls back when the chat:start RPC fails at transport level` |
| `discard()` releases the same four | `discard()` (`:321`) → `teardown` → `releaseConversation`, then a fresh slice | `getAdapter is null and the inbox is released after discard() (Req 2.5)` (also asserts that the in-flight read's `AbortSignal` is aborted), `a late read result after discard() changes nothing` |
| One `surface:read` in flight per slice, extra requests coalesced into at most one follow-up | `requestRead` (`apps-surface-sync.ts:122`): while `inFlight` is set, it only sets `followUp = true` (`:126`). `runRead` sends the single follow-up after it settles | `coalesces read requests ...`, `keeps AT MOST ONE surface:read in flight per slice (B11 F7)` (the deferred MockRpc tracks `maxOpen === 1` across every trigger kind) |
| 10 s read timeout | `{ timeout: APPS_SURFACE_READ_TIMEOUT_MS, signal }` (`apps-surface-sync.ts:201`) | `a gap push requests a surface:read ... 10 s timeout`, `a read timeout leaves the slice consistent and the next read goes out` |
| Stale results dropped via `readSeq` | `readSeq = surfaceReadSeq(...)` is captured at send time (`:194`) and passed to `applySurfaceRead` | `drops the stale part of a read result via readSeq: ...` |
| One grace timer per slice (1,500 ms), cleared on catch-up and on `dispose()`, fires one read | `expectRevision` arms a timer only when none is armed (`:150-151`). `reconcileExpected` clears it once every expectation is met (after each push and each read). `dispose()` clears it. `onGraceElapsed` requests exactly one read | `fires exactly one read when the echo is lost (reconciliation case 5)`, `is cleared when the echo catches the view up ...`, `is never armed when the echo arrived before the result (case 2)` |
| Only a push or a read advances the materialized revision | `expectRevision` writes only the private `expected` map. Only `applySurfacePush` and `applySurfaceRead` results reach `store.setSurfaces` | `an acknowledged revision never materializes by itself (Rules 1-2)`, `an acknowledged revision is expected, never materialized (Rule 1)` |
| Pushes for another routing id never reach the slice | The inbox dispatches by routing id. `AppsSurfaceSync.onPush` also drops any payload whose `routingId` differs (`isOwnPush`, `:107`) before the reducer runs. Store writes go through `patchOwned`, which checks `isAppsSliceOf` | `drops a push for another routing id before the reducer sees it`, `a push for its routing id reaches the slice; one for another routing id never does (Req 3.3)` |
| No `TabManagerService` mutation | Only `activeWorkspacePath$()` (`workspaceKey` computed) and `removedWorkspace$()` (`:162`) are read | `never mutates TabManagerService (start, send, abort, discard, switch)`. A Proxy records any `TabManagerService.prototype` member or property set; the result is `[]` |
| Public methods never throw; `catch (error: unknown)`; no payload in `console.warn` | Every public method has a try/catch or delegates to one. Warnings carry only a step name, an error `name`, or an `RpcUserErrorCode` | `a malformed push changes nothing and logs no payload value`; the transport-failure spec asserts `resolves.toBeUndefined()` |
| Signals and DI in the service, pure helpers in the slice file | The slice file has no Angular import. The sync class has no Angular import | — |

## Spec pins

| Pin | Spec name |
| --- | --- |
| `isInteractive` true after start | `registers an interactive surface: isInteractive is true after start (Req 2.2)` |
| `getAdapter` null and inbox released after `discard()` | `getAdapter is null and the inbox is released after discard() (Req 2.5)` |
| No `TabManagerService` mutation (spy) | `never mutates TabManagerService (start, send, abort, discard, switch)` |
| Workspace switch shows the other slice | `a workspace switch shows the other slice, and switching back restores it (Req 2.6)` |
| Push for another routing id never reaches the slice | `a push for its routing id reaches the slice; one for another routing id never does (Req 3.3)` (session); `drops a push for another routing id before the reducer sees it` (sync) |
| State survives component destroy and re-create | `state survives component destroy and re-create (Req 2.4)`. A probe component is destroyed, a push arrives while it is away, and a re-created component sees the same service and both surfaces |
| Sync: read coalescing | `coalesces read requests made while one is in flight into ONE follow-up read` |
| Sync: at most one `surface:read` in flight (F7) | `keeps AT MOST ONE surface:read in flight per slice (B11 F7)` (deferred MockRpc, `maxOpen() === 1`) |
| Grace read fires exactly once (case 5) | `fires exactly one read when the echo is lost (reconciliation case 5)` |
| No timer after `dispose()` | `leaves no timer and sends no read after dispose()`. It advances 10 s + 1.5 s + 1 ms and asserts `call` count 1, `jest.getTimerCount() === 0`, and that the RPC signal is aborted |
| A read timeout leaves the slice consistent | `a read timeout leaves the slice consistent and the next read goes out` (a timing MockRpc that mirrors `claude-rpc.service.ts:145-199`) |

Additional specs: rollback on transport failure; a late read after discard; unknown-surface ops trigger a coalesced read; a removed workspace releases its conversation; `discard()` touches only the active workspace; a failed read or a malformed read result keeps the last good view and sets the notice; `chat:continue` and `chat:abort` params; `markIdle`; a failed continue only sets `error`; the implicit slice key.

## APIs used (verified in source)

- `SurfaceUpdateInbox`: `claim(routingId, listener)` `libs/frontend/chat-routing/src/lib/surface-update-inbox.service.ts:61-68` (throws on a duplicate); `release` `:71-73`; `isClaimed` `:75-77`; `handleMessage` `:79-86` (used by the specs).
- `ClaudeRpcService.call(method, params, options?)` `libs/frontend/core/src/lib/services/claude-rpc.service.ts:129-133`; `RpcCallOptions.timeout` `:25`, `.signal` `:37`; `RpcResult.isSuccess()` `:55-57`; `.errorCode` `:49`; timeout result `RPC timeout: <method>` `:154-167`; abort path `:184-198`.
- `surface:read`: registry `libs/shared/src/lib/types/rpc.types.ts:2220`; `SurfaceReadParams` `libs/shared/src/lib/types/rpc/rpc-surface.types.ts:33-36`; `SurfaceReadResult` `:90-96`.
- `chat:start`, `chat:continue` and `chat:abort`: `rpc.types.ts:678,679,685`; `ChatStartParams.options.systemPrompt` and `.effort: EffortLevel` in `rpc-chat.types.ts` (options block at `:60-80`).
- `StreamingSurfaceRegistry.register(..., { interactive: true })` `libs/frontend/chat-routing/src/lib/streaming-surface-registry.service.ts:66-89`; `isInteractive` `:92`; `getAdapter` `:121`.
- `StreamRouter.onSurfaceCreated` `libs/frontend/chat-routing/src/lib/stream-router.service.ts:226`; `onSurfaceClosed` `:271-302` (unregisters the adapter).
- `WorkflowSessionClaimService.claim` `workflow-session-claim.service.ts:10`, `release` `:18`, `surfaceFor` `:27`.
- `TabManagerService.activeWorkspacePath$` `libs/frontend/chat-state/src/lib/tab-manager.service.ts:734`; `removedWorkspace$` `:741` (read only).
- Reducer: `applySurfacePush` `state/apps-surface-reducer.ts:319`; `applySurfaceRead` `:386`; `surfaceReadSeq` `:112`; `updateSurfaceOverlays` `:455`; `createAppsSurfaceState` `:97`.

## Deviations

1. **Grace timer "re-arm".** A second `expectRevision` while the timer is armed keeps the existing deadline. It does not restart the timer, so a stream of acks cannot postpone the read forever. There is still exactly one timer. After the grace read, the timer re-arms only on the next `expectRevision`, which is Rule 3's "at the next interaction". This avoids a read loop against a host that never reaches the expected revision.
2. **After a read, expectations for surfaces the host no longer holds are dropped.** The read is the complete state, so such an expectation can never be met.
3. **The in-flight read is aborted on `dispose()`** through `RpcCallOptions.signal`, so the RPC service's own timeout timer is released too. The plan names only the timeout.
4. **Facade hooks for Batch 13, keyed by routing id rather than by the active slice:** `requestSurfaceRead(routingId, reason)`, `expectSurfaceRevision(routingId, surfaceId, revision)` and `updateOverlays(routingId, surfaceId, update)`. These are the plan-named triggers (stale-revision :553, Rule 3 :549, Rule 4 :574). The service is the only writer of slice state, and a mutation must hit its own slice even after a workspace switch.
5. **`chat:start` `workspacePath` is the slice key** (the TabManager path; omitted for the implicit sentinel), not `vscode.config().workspaceRoot` as in the harness. This pins the conversation to the workspace whose slice holds it.
6. **`send()` before the session resolves** sets a user-visible `error` instead of only warning (the harness drops silently). A failed start resets the slice, including its bubbles, and keeps only `error`.
7. **Session spec doubles.** `StreamRouter` is a double whose `onSurfaceClosed` delegates to the real registry's `unregister` (mirroring `stream-router.service.ts:271-283`). `ConversationRegistry`, `TabSessionBinding`, `SessionLivenessRegistry`, `ModelStateService` and `EffortStateService` are stubs. The registry, the inbox and the workflow claims are real, as the plan requires.

No committed `state/` module needed a change.

## Verification

Command (worktree root): `npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page --skip-nx-cache`

Result: exit 0. Test Suites: 7 passed, 7 total. Tests: 132 passed, 132 total (97 before this batch, 35 new). Lint reported no errors or warnings.

Last 10 lines:

```



 NX   Successfully ran targets lint, typecheck, test for project @ptah-extension/mcp-apps-page


  Run duration:      9.5s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     9.4s (1 task)
  Recoverable time:  48ms (1% of the run)
```
