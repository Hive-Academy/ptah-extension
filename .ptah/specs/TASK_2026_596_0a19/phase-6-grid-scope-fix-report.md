# Phase 6 fix — plan-limits scope, failure handling, lane attribution

Covers Batch 20 ruling 4 (grid scope) and the coordinator's scope extension for codex review
findings 2 and 3 (`phase-6-code-review.md`). Finding 4 (lane model scope) is not touched; it is
a recorded follow-up. No backend files were changed.

## Finding 1 — grid panes erase each other's scope (Serious)

**Cause.** `PlanLimitsStore` kept one shared `scope`, and each `load()` overwrote it. Every chat
view loaded `{sessionIds, ownerKeys}`, including a pane with no session (`[]`). The host push
repeats only the last request, so with two grid panes the pane that loaded last decided the
scope.

**Fix.**
- `libs/frontend/core/src/lib/services/plan-limits.store.ts`
  - Added `registerScope(destroyRef): PlanLimitsScopeHandle`, which returns
    `{ id, update(scope), release() }`.
    - Each surface keeps its own `{sessionIds, ownerKeys}` in a `Map<id, scope>`.
    - Released on `release()` or when the surface's `DestroyRef` is destroyed.
    - `update()` after release does nothing.
  - `load()` now accepts only `{providerId?, refresh?}`. It sends the latest `providerId` and the
    de-duplicated UNION of all registered scopes. With no surface registered, the request is
    `{providerId}` only (the dashboard on its own).
  - Release does not reload. The next load sends the smaller union.
  - Removed the unused `definedFields` helper.
- `libs/frontend/core/src/index.ts` exports the types `PlanLimitsScopeHandle` and
  `PlanLimitsSurfaceScope`.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
  - Each surface registers one scope with `registerScope(inject(DestroyRef))`.
  - Its effect calls `scope.update(...)` instead of `load(...)`.
- Dashboard `provider-account-card.component.ts` is unchanged. Its `load({providerId[, refresh]})`
  calls match the narrowed type.

**Specs.**
- `plan-limits.store.spec.ts` › `surface scopes (grid panes)` covers:
  - Two panes keep their sessions and owners after interleaved loads.
  - An id shared by two panes is sent once.
  - A pane with no session does not erase another pane's scope.
  - A dashboard `load({providerId})` keeps every chat scope.
  - `release()` drops the pane's ids from the next load and does not reload.
  - Destroying the pane's DestroyRef releases its scope.
  - An update after release is ignored.
  - Each pane has a distinct, stable id.
  - The dashboard on its own sends `{providerId}` only.
- `chat-view.component.spec.ts` covers:
  - Each surface registers once, with a DestroyRef.
  - The existing scope tests now assert on `update`.

## Finding 2 — a failed pull erases a newer push (Serious)

**Cause.** On a failed or malformed pull, `applyEmpty()` bypassed the `generatedAt` guard. It
installed an empty snapshot stamped with the browser's `Date.now()`. That replaced a newer
pushed snapshot, and it could then outrank later host snapshots.

**Fix** (`plan-limits.store.ts`).
- `applyEmpty()` is replaced by `applyLoadFailure()`:
  - Sets a new `loadError` signal.
  - Keeps any snapshot already held.
  - Installs the empty "Unavailable" placeholder only when nothing is held, stamped
    `generatedAt: 0` rather than the browser clock, so any host snapshot outranks it.
- `apply()` clears `loadError` on any valid pull or push.
- The warning text now says "keeping the last snapshot".

**Specs** (`plan-limits.store.spec.ts`).
- Regression: a push installs a snapshot, then the earlier in-flight pull fails. Run three ways:
  RPC error, malformed result, and a thrown error. The pushed snapshot stays and `loadError`
  is set.
- A first-read failure gives a placeholder with `generatedAt: 0` and `loadError`.
- A later failure keeps the last valid snapshot, and the next success clears `loadError`.
- A host push replaces the placeholder even when the browser clock is ahead.

## Finding 3 — an unresolved lane appears in every session's tiles (Serious)

**Cause.** `chat-view.component.ts` `sessionLaneRuns` used `AgentMonitorStore.agentsForSession()`,
which is falsy-tolerant. A lane with no resolved `parentSessionId` was therefore counted in
every session's quota and lane tiles, and its owner key was added to every session's scope.

**Fix.**
- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` adds
  `agentsOwnedBySession(sessionId)`, which matches the parent exactly. An unresolved parent or an
  empty id returns no agents.
- `agentsForSession()` and the agent-monitor UI keep their existing global visibility.
- `chat-view.component.ts` `sessionLaneRuns` now uses `agentsOwnedBySession`. The stats tiles and
  the plan-limits owner-key scope both read from it.

**Specs.**
- `agent-monitor.empty-session-id.spec.ts`, two sessions:
  - An unresolved lane is in neither session's owned list but is still in `agentsForSession`.
  - After the exit payload resolves its parent, it is only in that session's list.
  - An empty id returns `[]`.
- `chat-view.component.spec.ts`:
  - The stub's `agentsForSession` now follows the tolerant rule, to prove the tiles do not read it.
  - A new test: an unresolved lane counts 0 lanes under both sessions. Once it resolves to one
    session, it counts 1 there and 0 under the other.
  - TestBed mounts one ChatView per test, so this test switches the surface's session. The
    store-level spec covers both sessions side by side.

## Verification
`npx nx run-many -t typecheck,test,lint -p @ptah-extension/core @ptah-extension/chat @ptah-extension/chat-streaming @ptah-extension/dashboard ptah-extension-webview`
reported "Successfully ran targets typecheck, test, lint for 5 projects". All 15 tasks ran with
0/15 cache hits. The only stderr was an Nx Cloud plan notice, which is unrelated.

## Notes / out of scope
- Behaviour change from finding 2: a failed refresh while data is held now keeps showing the last
  data and sets `loadError()`. Before, surfaces flipped to "Unavailable". No surface reads
  `loadError` yet. Showing a stale-data hint would be a separate UI decision.
- After a pane closes, its ids stay in the host's push scope until the next load. They only add
  data and never remove any.
- The harness scenario in `libs/frontend/webview-e2e-harness/**` (owned by another agent) was not
  touched. It has no fixture that fails a pull after a success.
