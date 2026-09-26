# Code-logic review — Batch 12 (TASK_2026_494)

Reviewer: code-logic reviewer (read-only). Date: 2026-09-25.
Scope: `libs/frontend/mcp-apps-page/src/lib/services/apps-workspace-slice.ts`, `apps-surface-sync.ts` (+spec), `apps-session.service.ts` (+spec). No file was edited by this review.

**Score: 9/10**
**Verdict: APPROVED**

Independent verification: `npx nx run-many -t test -p @ptah-extension/mcp-apps-page --skip-nx-cache` — exit 0, Test Suites 7/7, Tests 132/132. This matches the executor report.

---

## 1. Quality-requirement hunt — results

All lifecycle and concurrency requirements from batches.md hold. Evidence per item:

### 1.1 Claim order — PASS

`claimConversation` runs synchronously inside `start()` before `rpc.call('chat:start')`: the call is at `apps-session.service.ts:180`, the RPC at `:183`. Inside `claimConversation` the order is: slice patched with the conversation first (`:410-412`), then `inbox.claim` (`:414`), `workflowClaims.claim` (`:415`), `surfaceRegistry.register(..., { interactive: true })` (`:416-425`), `streamRouter.onSurfaceCreated` (`:426`). There is no `await` before the claim, so two racing `start()` calls cannot both pass the `conversation !== null` guard at `:176`. The spec records `inbox.isClaimed(routingId)` at RPC call time, which pins the order.

The comment at `:408-409` ("the slice holds the conversation before the claim, so the first push already finds the slice it writes to") is correct and matters: a push that arrives between `inbox.claim` and the RPC cannot be lost, because `patchOwned` (`:550-558`) already accepts writes for the slice.

### 1.2 Rollback on a failed start — PASS

`rollBackFailedStart` (`apps-session.service.ts:441-453`) checks `isAppsSliceOf` at `:450` before touching anything. This guard correctly handles a `discard()` or a workspace removal that happened during the awaited `chat:start` — in that case the resources were already released and the method returns without a double release. The `!result.success || result.data?.success === false` check at `:197` covers both the transport-shaped failure and the app-shaped failure. The `catch` at `:206-220` distinguishes `conversation !== null` (rollback) from a pre-claim failure (error patch only), so a throw inside `claimConversation` cannot trigger a rollback of a conversation that was never claimed.

### 1.3 discard() releases everything — PASS

`discard()` (`:321-331`) → `teardown` (`:470-476`) → `releaseConversation` (`:478-498`): inbox release, workflow claim release, `streamRouter.onSurfaceClosed`, `sync.dispose()`. Each step is isolated in its own try/catch (`:488-497`), so one failing release cannot skip the others. The real `onSurfaceClosed` also unbinds the surface and removes the conversation when it is the last consumer (`stream-router.service.ts:271-302`), so no registry residue remains. `sync.dispose()` aborts the in-flight read, which releases the RPC service's own timeout timer (`claude-rpc.service.ts:184-199` clears it on abort) — no timer leaks.

### 1.4 One surface:read in flight, coalescing — PASS

`requestRead` (`apps-surface-sync.ts:122-133`): while `inFlight` is set, only `followUp = true` is recorded. `runRead` resets `followUp` at start (`:192`) and sends at most one follow-up after settling (`:235`). `runRead` executes synchronously up to the `await` (`:198`), so `inFlight` is set before any interleaving. The spec pins `maxOpen() === 1` across every trigger kind (gap ops, stale-revision, unknown surface, grace) — B11 F7 is discharged.

### 1.5 10 s read timeout — PASS

`{ timeout: APPS_SURFACE_READ_TIMEOUT_MS (10_000), signal }` at `apps-surface-sync.ts:201`. `ClaudeRpcService.call` honors `options.timeout` (`claude-rpc.service.ts:135, :154-167`) and `options.signal` (`:137-143, :184-199`). The timing MockRpc in the spec mirrors this, including timer cleanup on abort.

### 1.6 Single 1,500 ms grace timer — PASS

Armed only when none is armed (`apps-surface-sync.ts:150-155`); cleared when every expectation is met (`reconcileExpected` → `clearGrace`, `:261, :264-268`); cleared by `dispose()` (`:172`); `onGraceElapsed` clears the timer reference first (`:239`) and requests exactly one read (`:242`). The specs assert `jest.getTimerCount()` transitions for arming, catch-up, and dispose.

### 1.7 No timers after dispose() — PASS

`dispose()` (`:170-178`) clears the grace timer, drops the follow-up and aborts the in-flight read. After `disposed = true`, `onPush`, `requestRead` and `expectRevision` all return early (`:107, :124, :142`). The aborted read's continuation checks `this.disposed || this.inFlight !== controller` (`:203, :220`) and returns before any store write. The spec advances 10 s + 1.5 s + 1 ms after dispose and asserts zero timers and no further RPC.

### 1.8 Only a push or a read advances the materialized revision — PASS

`expectRevision` writes only the private `expected` map (`:144-148`). The only paths to `store.setSurfaces` are `applySurfacePush` (`:109-110`) and `applySurfaceRead` (`:205-211`). The facade's `updateOverlays` goes through `updateSurfaceOverlays`, which never touches a materialized revision (reducer `apps-surface-reducer.ts:455`, verified in Batch 10). Rules 1-2 hold.

### 1.9 Pushes for another routing id stay out of the slice — PASS

Two independent barriers: the inbox dispatches by routing id (only the claimed listener receives the payload), and `isOwnPush` (`apps-surface-sync.ts:180-187`) drops any payload whose `routingId` differs before the reducer runs. Store writes additionally pass through `patchOwned`, which checks `isAppsSliceOf`. The sync spec asserts zero reducer-visible changes and zero writes for a foreign payload.

### 1.10 Workspace switch and removal — PASS

`workspaceKey` (`apps-session.service.ts:112-114`) reads only `activeWorkspacePath$`. A switch changes which slice the public computeds read; each slice keeps its own conversation, surfaces and sync. The removal effect (`:161-167`) uses its own seq cursor over the append-only `removedWorkspace$`, so each removal runs exactly once, and `dropSlice` (`:500-509`) tears the conversation down before removing the slice.

### 1.11 No TabManagerService mutation — PASS

The service touches `tabManager` only through `activeWorkspacePath$()` (`:113`) and `removedWorkspace$()` (`:162`). The spec's Proxy probe records any prototype-member touch or property set and asserts `[]`.

### 1.12 No public method throws — PASS

`start`, `send`, `abort` wrap the RPC in try/catch; `discard` (`:322-330`), `updateOverlays` (`:374-389`) and `dropSlice` (`:501-508`) catch; `requestSurfaceRead` / `expectSurfaceRevision` delegate to `AppsSurfaceSync` methods that catch internally (`apps-surface-sync.ts:123-132, :141-158`), and `syncFor` (`:529-532`) is a pure Map lookup. `clearError` (`:334-338`) has no try/catch but performs only signal reads and an identity-preserving patch — it cannot throw.

### 1.13 No payload values in logs — PASS

`AppsSurfaceSync` warnings carry only a step name and an error *name* (`apps-surface-sync.ts:67-69`) or an `RpcUserErrorCode` (`:216-217, :230-232`); the reasons are category words, not payload. `AppsSessionService` warnings carry method and step names (`:214, :237, :446, :461`). The one `failureText` used inside `console.warn` (`:328, :387, :494, :506`) appears only in catch blocks over internal Map and signal operations, not over payloads. The user-visible `error` field carries the host's failure message — that is the intended surface (the harness does the same) and is not a log. The spec asserts that no warning contains a planted secret value.

### 1.14 Races between start resolution, send() and discard() — PASS

- `discard()` during the awaited `chat:start`: teardown releases everything; when the result lands, `isAppsSliceOf` at `:450` fails and the rollback is skipped. No double release.
- Workspace switch during the await: `start` captured `key` at entry (`:175`), so the rollback still targets the slice that owns the conversation. The conversation stays pinned to its own workspace.
- `send()` during the await: the conversation exists but `sessionFor` returns null, so `send` sets a user error and returns without adding a bubble (`:236-243`) — no phantom turn enters the transcript.
- `sessionFor` is reactive: `conversationForSurface` reads the `_bySurface` signal (`tab-session-binding.service.ts:233-235`) and `getRecord` reads the `_byId` signal (`conversation-registry.service.ts:105-107`), so the `sessionId` computed (`apps-session.service.ts:143-146`) re-evaluates once the host binds the session. There is no stale-null caching defect.

---

## 2. Per-deviation rulings

### Deviation 1 — grace deadline not restarted on a repeated ack — **ACCEPT**

`apps-surface-sync.ts:144-155`: a second `expectRevision` while the timer is armed raises the expected revision but keeps the existing deadline. A read is the host's complete state and supersedes any pending ack, so firing on the original deadline is sufficient; restarting would let an ack storm postpone the read indefinitely. There is still exactly one timer. Evidence: spec `fires exactly one read when the echo is lost (reconciliation case 5)` asserts `jest.getTimerCount() === 1` after two `expectRevision` calls.

### Deviation 2 — after a read, expectations for surfaces the host no longer holds are dropped — **ACCEPT**

`apps-surface-sync.ts:251-262`: the deletion of unmet expectations for absent entries runs only when `afterRead` is true. The read is the complete host state, so such an expectation can never be met. If the host later re-creates the surface, it does so through a snapshot push, which materializes it on its own — no grace read is needed. Push-time reconciliation (`afterRead = false`) keeps expectations for held surfaces, so a tombstone-eviction does not silently cancel a pending echo.

### Deviation 3 — dispose() aborts the in-flight read — **ACCEPT**

`apps-surface-sync.ts:175-177`. The plan names only the read timeout, but aborting through `RpcCallOptions.signal` is strictly better: `ClaudeRpcService` clears its timeout timer on abort (`claude-rpc.service.ts:184-199`), so `dispose()` leaves zero timers even mid-read, and the continuation's `disposed` / controller checks (`:203, :220`) ignore the aborted result. Verified by the spec (`signal?.aborted === true`, `jest.getTimerCount() === 0`).

### Deviation 4 — Batch 13 hooks keyed by routing id — **ACCEPT**

`requestSurfaceRead` / `expectSurfaceRevision` / `updateOverlays` (`apps-session.service.ts:345-390`) resolve the slice through `findAppsSliceKey` / `syncFor` (`:529-532`), not through the active slice. This is the correct design: a mutation that settles after a workspace switch must hit its own slice. These are the plan-named triggers (stale-revision :553, Rule 1→3 :549, Rule 4 :574). `updateOverlays` never touches a materialized revision (reducer `:455`).

### Deviation 5 — chat:start workspacePath is the slice key — **ACCEPT** (with one boot-window note)

- **Electron**: `activeWorkspacePath$` is set only through the `WorkspaceCoordinatorService.switchWorkspace` fan-out, driven from the open workspace folders. The slice key is therefore one of the open folders, and the host-side authorization (`chat-session.service.ts:415-446`, `workspace-authorization.ts:13-22`) passes. Pinning the conversation to the workspace whose slice holds it is more correct than the harness's `vscode.config().workspaceRoot`: two Apps conversations in two workspaces cannot cross.
- **VS Code webview**: the `apps` route is Electron-only by design (D2, guard lands in Batch 16); today no route exists at all, so the service is unreachable there. The difference from the harness default is moot in that host.
- **Null slice key** (implicit sentinel): `workspacePath` is omitted (`apps-session.service.ts:187-189`), and the host falls back to `workspaceProvider.getWorkspaceRoot()`. When no folder is open the host refuses ("No workspace folder open..."), and that refusal flows back through `rollBackFailedStart` into the slice's `error` — correct user-visible behaviour.
- **Note (finding N2 below)**: during the Electron boot window before the workspace restore drives the first `switchWorkspace`, `activeWorkspacePath$` is null and a started conversation is pinned to the implicit slice.

### Deviation 6 — send() before the session resolves shows an error — **ACCEPT**

`apps-session.service.ts:236-243` sets a user-visible error and returns *before* the bubble is appended, so no phantom turn enters the transcript. The harness drops silently; a visible message is better UX. The typed prompt is not preserved in state (see N4).

### Deviation 7 — a failed start resets the slice including the first message — **ACCEPT**

`rollBackFailedStart` (`:452`) resets to `createAppsWorkspaceSlice()` with `error` set. The plan requires a clean rollback, and the page must not keep a half-started conversation. Keeping the draft text is a composer concern (Batch 15 owns the composer). See N4.

### Deviation 8 — session spec uses a fake StreamRouter with the real registry, inbox and claims — **ACCEPT**

The plan requires the real `StreamingSurfaceRegistry`, `SurfaceUpdateInbox` and `WorkflowSessionClaimService`; the router was not required to be real. The fake's `onSurfaceClosed` delegates to the real `registry.unregister`, mirroring `stream-router.service.ts:282`, so the release path exercises real registry state. One fidelity gap, accepted: the real `onSurfaceCreated` (`stream-router.service.ts:248-249`) also creates the conversation record and binds the surface, which is what later makes `sessionFor` resolve. The fake omits this, and the spec stubs the binding and registry, so the production chain `start → onSurfaceCreated → sessionFor resolves` has no end-to-end test here. The router contract itself is pinned by its own tests, and B13's submit flow will exercise the resolved-session path; see N5.

---

## 3. Findings (non-blocking)

**N1 — no re-arm after a failed grace read.** After the grace timer fires and its read fails (timeout or transport), `expected` survives (reconciliation runs only on success, `apps-surface-sync.ts:225-227`) but no timer is armed and no retry is scheduled. The view stays behind until the next push or a Batch 13 trigger. This matches the plan's "retry once on the next trigger", and the user still sees the acknowledged value through the overlay (Rule 4), so it is acceptable. Batch 13 must not assume the service retries on its own: its submit step must request its own read.

**N2 — Electron boot window can strand a conversation in the implicit slice.** If `start()` runs before the workspace restore drives the first `switchWorkspace`, the conversation is pinned to `APPS_IMPLICIT_WORKSPACE` while the host falls back to `getWorkspaceRoot()` (deviation 5). When `activeWorkspacePath$` later resolves, the page switches to the real workspace's slice and the implicit conversation — with its live claims and running agent — is no longer reachable, because nothing ever removes the implicit slice. The window is short and requires a typed prompt before the restore lands, and the design follows the plan's own slice-key definition, so this is an observation for the team-leader rather than a revision demand.

**N3 — discard() materializes an empty slice.** `patch(key, () => createAppsWorkspaceSlice())` at `apps-session.service.ts:325` goes through `patchAppsSlice`, which creates an entry for a missing key. Calling `discard()` on a workspace that never started adds a permanent empty slice to the map. Harmless (an empty slice reads as the default) but wasteful.

**N4 — the typed prompt is lost on a failed start and on a send-before-resolve.** The user must retype. Both paths are correct for state (no half-started conversation, no phantom turn); keeping the draft belongs to the composer (Batch 15).

**N5 — no end-to-end test of the session-resolution chain.** See deviation 8. Suggest one integration-level spec in a later batch (or B13) that runs the real `onSurfaceCreated` wiring and asserts `sessionId` resolves once the host binds the session.

**N6 — partial-claim rollback closes a surface that was never created.** If `inbox.claim` threw inside `claimConversation` (`:427-431`), `releaseConversation` would call `onSurfaceClosed` for a surface whose `onSurfaceCreated` never ran. This is safe today — the real `onSurfaceClosed` treats an unbound surface as unregister-only (`stream-router.service.ts:273-277`) and `unregister` is a no-op for unknown ids (`streaming-surface-registry.service.ts:101-102`) — and a throw requires a ulid collision, which is unreachable. No action needed; recorded for completeness.

`isProcessing` was checked for a stale `turnPending` (it is set by `start`/`send` and cleared only by `failTurn` and a successful `abort`): once `sessionId` resolves, the computed reads the liveness status instead (`apps-session.service.ts:148-155`), and while the session is unresolved `turnPending = true` is the correct display. No defect.

---

## 4. Exact fix list

Nothing blocks approval. Ordered by value:

1. **(N2, low)** When `activeWorkspacePath$` first resolves to a real path, drop (or migrate) a conversation held by the `APPS_IMPLICIT_WORKSPACE` slice, so a boot-window start cannot be stranded with live claims. A one-line effect in `AppsSessionService`, plus a spec. Until then, document the window in batches.md for Batch 13/16.
2. **(N1, note for Batch 13)** In the Batch 13 plan, record that `AppsSurfaceSync` does not re-arm the grace timer after a failed grace read. The submit flow must request its own read; do not wait for the service.
3. **(N3, low)** In `discard()`, use `removeAppsSlice` when the active key had no slice, instead of patching a fresh empty slice in.
4. **(N4, Batch 15)** The composer should keep the draft text on a failed start and on a send-before-resolve.
5. **(N5, optional)** Add one integration spec that covers `start → onSurfaceCreated (real) → sessionFor resolves`.

---

## 5. Verdict

The batch meets every quality requirement in batches.md: claim ordering, full release on rollback and discard, one in-flight read with coalescing, the 10 s timeout, the single grace timer, no timers after dispose, Rules 1-4, foreign-routing isolation, workspace partition, no TabManager mutation, non-throwing public methods, and payload-free logs. All eight deviations are accepted with evidence. The findings are low-severity and none demands a revision of this batch.

**APPROVED — score 9/10.**