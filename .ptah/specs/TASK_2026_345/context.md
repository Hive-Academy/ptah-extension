# TASK_2026_345 — one user-layer pass, one catalog sync, one plugin read per switch

## Evidence

All line numbers are `D:\projects\ptah-extension\tmp\logs\log.log`.

### Backend — one switch to `property-hub` (1109-1225)

| line                   | event                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1109                   | `workspace:addFolder property-hub` — fires `onDidChangeWorkspaceFolders` while `qa3elhamor` is STILL active |
| 1119-1122              | that listener's propagation runs `mirrorAll` + `reconcile` for `qa3elhamor`                                 |
| 1123                   | `workspace:switch` → `property-hub`                                                                         |
| 1124                   | `Booting deferred backend services for workspace...` (the one-shot heavy boot for the new root)             |
| 1210-1213              | **two `mirrorAll complete` back to back**, both `skipped: 44`                                               |
| 1214-1215              | **two `reconcile complete`** — `noop:25, fastForwarded:15` and `noop:40, fastForwarded:0`                   |
| 1206, 1216, 1218, 1220 | **four `skill_registry catalog synced`** (45, 46, 46, 46)                                                   |
| 1223                   | `Harness propagated (workspace-folders-changed)`                                                            |
| 1225                   | `mirrorAll complete, skipped: 45` — the content-download pass                                               |

The two `reconcile complete` lines are the important half. `fastForwarded: 15`
against `fastForwarded: 0` for the SAME clones in the same second is not two
passes doing the same work twice — it is two passes INTERLEAVING, one
fast-forwarding a clone while the other reads it. Neither pass reported anything
wrong.

### Backend — first `qa3elhamor` switch (861-896)

Three catalog syncs, all `upserted: 45`: the boot's ungated
`void syncSkillRegistryCatalog`, `reconcileUserLayer`'s own gated one (`diverged: 2`),
and the content-download pass's.

### Frontend

- `plugins:get-config` + `plugins:list-available` issued as DUPLICATE PAIRS per
  view: 978-993, 1907-1924, 1949-1968.
- `config:models-list` six times in one session: 628, 868, 1195, 1624, 1800,
  2046 (plus 2132, 2257).

## Root cause

### 1. Two independent full passes fire for the same switch

`apps/ptah-electron/src/activation/wire-runtime.ts:285-303` — the
`onDidChangeWorkspaceFolders` listener did BOTH of these, unconditionally:

```ts
booter.startOrJoin(active); // the heavy boot
void propagateHarness(container, active, 'workspace-folders-changed');
```

`bootHeavyServicesOnce` (`boot-heavy-services.ts:186-250`) runs
`mirrorUserLayer` → `reconcileUserLayer` → `reconcileHarness('activation')`.
`propagateHarness` → `HarnessPropagationService.propagate` →
`IUserLayerRefresher.refresh` → `mirrorUserLayer` → `reconcileUserLayer` →
`reconcile`. The two are the same pass. On a FIRST switch to a root the boot
always runs, so the propagation beside it is pure duplication — and because
nothing serialized them, they ran concurrently.

The propagation is not wrong in general: the boot is one-shot per normalized
root, so the second and every later switch back to a root gets no boot at all
and the propagation is the only thing that runs. The listener simply had no way
to tell the two cases apart.

### 2. The catalog sync had two call sites and no owner

- `plugin-activation.ts:247-255` — `reconcileUserLayer` synced when
  `fastForwarded || diverged || reaped || orphaned`.
- `boot-heavy-services.ts:195-197` — the boot fired an UNGATED
  `void syncSkillRegistryCatalog(container)` immediately after the call that had
  just conditionally done it.

Two sites x two passes per switch = the four syncs at 1206-1220.

### 3. Frontend: no shared store, no in-flight dedupe

- `plugins:get-config` / `plugins:list-available` had NO shared store at all.
  `PluginStatusWidgetComponent.fetchPluginStatus()`
  (`plugin-status-widget.component.ts:174-175`, `ngOnInit`) and
  `PluginBrowserModalComponent.loadPlugins()`
  (`plugin-browser-modal.component.ts:1094-1095`, an `effect()` on `isOpen`)
  each fetched the pair into component-local signals, and both are mounted in
  the SAME view twice over — the chat empty state and the Marketplace plugins
  surface. `ChatEmptyStateComponent.checkSkillsConfiguration()`
  (`chat-empty-state.component.ts:378`) issued a THIRD bare `get-config` on a
  view whose widget had already read it. The chat empty state is rendered PER
  TRANSCRIPT (`chat-view.component.html:65`), so N idle tabs meant N pairs.
- `config:models-list` DOES have a shared store — `ModelStateService`
  (`model-state.service.ts:227`) is its only caller — but `loadModels()` had no
  in-flight guard, and `refreshModels()` has six callers, several of which fire
  for one cause: `TabManagerService.createTab()` (`tab-manager.service.ts:779`)
  runs it for EVERY new tab, and `WorkspaceCoordinatorService`
  (`workspace-coordinator.service.ts:205`) runs it on every workspace switch —
  which is also when tabs are created.
- `ClaudeRpcService` keeps only a `pendingCalls` map keyed by `correlationId`
  for response routing. It does not dedupe identical concurrent methods, and
  nothing in `libs/frontend` uses `resource()`, `httpResource` or `shareReplay`.

## Files

**New**

- `apps/ptah-electron/src/activation/coalesced-job.ts` — the per-key,
  trailing-window coalescer.
- `apps/ptah-electron/src/activation/workspace-root-key.ts` —
  `normalizeWorkspaceRoot` + `NO_WORKSPACE_KEY`, extracted so the boot latch and
  the coalescer share one key without a cycle.
- `apps/ptah-electron/src/activation/coalesced-job.spec.ts`
- `libs/frontend/core/src/lib/services/plugin-catalog.service.ts` — the shared
  plugin store.
- `libs/frontend/core/src/lib/services/plugin-catalog.service.spec.ts`

**Changed**

- `apps/ptah-electron/src/activation/plugin-activation.ts` — `refreshUserLayer`
  (the coalesced pass), `runUserLayerPass`, the catalog sync's single owner;
  `reconcileUserLayer` no longer syncs.
- `apps/ptah-electron/src/activation/boot-heavy-services.ts` — both call sites
  route through `refreshUserLayer`; `isReserved` added to the booter.
- `apps/ptah-electron/src/activation/wire-runtime.ts` — the folder listener
  propagates only for an already-reserved root.
- `apps/ptah-electron/src/activation/boot-order.spec.ts`,
  `wire-runtime.boot-order.spec.ts`, `plugin-activation.spec.ts`
- `libs/frontend/core/src/lib/services/model-state.service.ts` — in-flight
  dedupe for `config:models-list`.
- `libs/frontend/core/src/lib/services/model-state.service.spec.ts`,
  `libs/frontend/core/src/lib/services/index.ts`
- `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-status-widget.component.ts`,
  `plugin-browser-modal.component.ts`, `plugin-browser-modal.component.spec.ts`
- `libs/frontend/chat/src/lib/components/molecules/setup-plugins/chat-empty-state.component.ts`
- `libs/frontend/marketplace/src/lib/plugins-surface.component.ts`

**Deliberately NOT changed**

- `libs/backend/**` — nothing. The duplicate triggers are a HOST concern; the
  reconciler already serializes per workspace (`serializePerWorkspace`), and
  `harness-sync` is being edited concurrently by TASK_2026_354.
- The deliberate double harness reconcile (`activation` +
  `content-download-complete`). Both call sites stay.
- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` — a pre-existing
  foreign typecheck failure lives there.

## Plan

1. `createCoalescedJob<TPayload>` — per-key trailing window, serialized runs,
   reason list preserved, never rejects.
2. `refreshUserLayer(container, root, reason)` in `plugin-activation.ts` — the
   ONE entry point for mirror + reconcile + catalog sync, behind that coalescer,
   keyed by the normalized root.
3. Both boot call sites and the DI-registered `IUserLayerRefresher` go through
   it.
4. `booter.isReserved(root)` + the guard in the folder listener.
5. `PluginCatalogService` in `libs/frontend/core`, consumed by the widget, the
   modal and the chat empty state; `refresh()` on save.
6. In-flight dedupe in `ModelStateService.loadModels()`.
7. Tests, then `run-many -t test|typecheck` for the five touched projects.

## Acceptance criteria

1. N triggers for one root inside the window produce exactly ONE user-layer
   pass, and that pass is told every reason (the log line names all of them).
2. A trigger that arrives after a pass has drained produces a SECOND pass — the
   coalescer is not a cache.
3. Two passes for one root never overlap; a trigger arriving mid-run joins the
   single batch queued behind it rather than starting a third.
4. Exactly one `skill_registry` catalog sync per pass, and none when SQLite is
   closed.
5. A FIRST switch to a root does not fire `propagateHarness` beside the boot; a
   switch back to an already-booted root does.
6. `isReserved` is read before `startOrJoin`, with no `await` between them.
7. The deliberate double harness reconcile survives: two `reconcileHarness` call
   sites and two `refreshUserLayer` call sites in `boot-heavy-services.ts`.
8. Four concurrent `ensureLoaded()` callers cost ONE
   `plugins:get-config` + `plugins:list-available` pair; a caller arriving after
   the read costs none; `refresh()` always re-reads.
9. A burst of concurrent `refreshModels()` costs ONE `config:models-list`; a
   refresh after the previous settled still re-reads.
10. `run-many -t test` over the five touched projects reports
    `Running target test for 5 projects` and passes.

## Test projects

- `ptah-electron`
- `@ptah-extension/core`
- `@ptah-extension/chat-ui`
- `@ptah-extension/chat`
- `@ptah-extension/marketplace`

## Implementation notes

### 1. `createCoalescedJob` — the primitive

`apps/ptah-electron/src/activation/coalesced-job.ts`. Per-key, trailing window,
serialized runs, reason list preserved, never rejects.

- **Trailing, not leading.** A leading-edge runner starts the first trigger
  immediately and can only offer the stragglers a SECOND pass — which is two
  passes, the thing being fixed. The cost is one window of latency per burst,
  paid in the post-window boot phase, behind the visible window by construction
  (TASK_2026_331), and on nothing the renderer waits for.
- **At most one pending batch per key, by construction.** A batch is removed
  from `pending` inside the chain link that drains it, and only a key with no
  entry creates a new batch (and therefore a new timer). That invariant is what
  lets a trigger arriving mid-run attach to the batch already queued behind the
  in-flight one instead of starting a third. It also means each timer maps to
  exactly one batch and no waiter can be stranded.
- **The batch is read at RUN time, not at arm time**, so everything that joined
  while the previous run was in flight belongs to the pass that follows it.
- **Timers are unref-ed.** An open window must never be the reason the process
  cannot exit.

### 2. `refreshUserLayer` — one owner for the pass

`plugin-activation.ts`. `runUserLayerPass` is private and reached only through
the coalescer: `mirrorAll`, then `reconcileAll`, then `syncSkillRegistryCatalog`
— the one order that is ever correct. Reconciling an unmirrored layer copies
nothing; syncing before the reconcile records a state the pass is about to
change.

The catalog sync is now **unconditional when SQLite is open**, rather than gated
on `fastForwarded || diverged || reaped || orphaned`. This is strictly LESS work
than the baseline, not more: the boot already fired an ungated sync beside the
gated one, so the old cost was two per pass and the new cost is one. What it
buys is that the decision lives in exactly one place. A pass that changed
nothing costs one upsert sweep over already-current rows.

`reconcileUserLayer` keeps the half of its old tail that is genuinely its own —
writing per-slug divergence into `SkillRegistryStore` — and loses the
whole-catalog refresh.

`normalizeWorkspaceRoot` moved to `workspace-root-key.ts` because
`boot-heavy-services.ts` imports `plugin-activation.ts`; leaving the key
function in the former and importing it from the latter would be a cycle.
`boot-heavy-services.ts` re-exports it so no importer had to change, and the
`normalizeWorkspaceRoot(workspaceRoot)` call site the source spec pins is still
there.

### 3. The structural half — `isReserved`

The coalescer alone would have turned two concurrent passes into two sequential
ones. Getting to ONE needed the duplicate trigger to stop firing.

`HeavyServicesBooter.isReserved(root)` answers "has a boot for this root already
been reserved — in flight, finished or failed". The folder listener reads it
BEFORE `startOrJoin` (which creates the entry, so reading after always answers
"yes") and propagates only when it was already true. A first switch to a root is
fully covered by the boot, which does the same user-layer pass and its own
`activation` harness reconcile; a switch BACK to a root finds its one-shot latch
taken, no boot runs, and the propagation is the only thing that will.

Deliberately a separate predicate rather than a richer return from
`startOrJoin`: the "same root returns the same promise" identity is a contract
three existing tests assert, and widening the return type would have broken it
for no gain.

### 4. Frontend

`PluginCatalogService` (`libs/frontend/core`) is the one place the webview asks
what plugins exist and which are on. `ensureLoaded()` is idempotent — the first
caller does one round trip, concurrent callers share the promise, later callers
resolve from signals. `refresh()` is the explicit "I changed it" call and also
dedupes against a read in flight. Consumers: `PluginStatusWidgetComponent`
(counts are now `computed` off the store), `PluginBrowserModalComponent` (keeps
its own `harness:get-skill-selection` and `plugins:list-skills` — per-workspace,
different failure semantics, single reader) and `ChatEmptyStateComponent`.

No TTL and no polling: the host's plugin config changes because this webview
changed it, and that path invalidates through `refresh()`. A TTL would put the
duplicate round trips back for a case that does not happen.

Two imperative pokes disappeared with it — `ChatEmptyStateComponent`'s
`@ViewChild(PluginStatusWidgetComponent)` and `PluginsSurfaceComponent`'s
`viewChild(...)`, both of which existed only to re-fetch the widget after a
save. The modal re-reads the shared catalog before it emits `saved`, so both
surfaces are current without a second pair of RPCs.

`ChatEmptyStateComponent.hasConfiguredSkills` is now
`!isLoaded() || hasEnabledPlugins()`. The warning is suppressed until the
catalog has been read: flashing "you have no skills" at a user who has plenty is
worse than showing nothing for one round trip.

`ModelStateService.loadModels()` gained an in-flight promise. A LATER refresh
still re-reads — an auth change or a provider switch must — and the latch is
released in a `finally`, so a failed read does not swallow the retry.

### 5. Tests

New:

- `coalesced-job.spec.ts` (12) — one run for N reasons in the window with every
  reason named and duplicates folded; all joiners share one promise; last
  payload wins; a trigger after the drain gets its own run; the window is not a
  poll; a second batch serializes behind an in-flight run; several mid-run
  triggers fold into the ONE queued batch; different keys are independent and
  concurrent; a rejected run reports through `onError`, warns by default, still
  resolves its requesters, and does not poison the next batch.
- `plugin-catalog.service.spec.ts` (10) — four concurrent `ensureLoaded` callers
  cost one pair; a later caller costs none; signals expose the answer; opt-out
  plugins count as enabled unless denied; `isLoading` reflects someone else's
  read; `refresh` re-reads but joins an in-flight one; a failed config read is
  recorded without rejecting; a throwing transport does not reject and a retry
  still goes through.

Extended:

- `plugin-activation.spec.ts` — a `refreshUserLayer coalescing` block (9): the
  four triggers of a switch produce ONE mirror / reconcile / catalog sync; the
  log line names every trigger; the pass order is mirror, reconcile, catalog; a
  trigger after the drain gets a second pass; two spellings of one directory
  join; two workspaces stay apart (asserted on `agentSourceDir`); no sync when
  SQLite is closed; never rejects. The two old catalog cases moved: the sync is
  no longer `reconcileUserLayer`'s to make, and the divergence writes that ARE
  still its own got their own case.
- `boot-order.spec.ts` — the `plugin-activation` mock now records
  `refreshUserLayer` (the boot has one call site where it had three), plus two
  `isReserved` cases: false before `startOrJoin` and true after, still true once
  the boot has FINISHED, a different root unaffected, two spellings of one root
  equal, and "no folder open" as its own key.
- `wire-runtime.boot-order.spec.ts` — the guarded propagation pinned textually
  (`isReserved` read before `startOrJoin`, no `await` between them, exactly one
  `propagateHarness(` call site) and the double-pass count restated as two
  `refreshUserLayer(` call sites, with `mirrorUserLayer(` and
  `syncSkillRegistryCatalog(` gone from the booter.
- `model-state.service.spec.ts` — a `config:models-list request coalescing`
  block (3): a burst of four concurrent refreshes is one request; a refresh
  after the previous settled re-reads; a failed request releases the latch.
- `plugin-browser-modal.component.spec.ts` — `settle()` now drains three passes
  instead of one. The load gained an indirection (the shared promise, its
  `Promise.all` and a `finally`), and a single `whenStable()` left the modal on
  its loading skeleton with no Save button to click. Test-settling only; the
  production path is an `effect()` that awaits nothing.

### 6. Results

- `npx nx run-many -t test -p ptah-electron @ptah-extension/core
@ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/marketplace
--skip-nx-cache` — `Successfully ran target test for 5 projects`.
  - ptah-electron: 405 passed / 4 skipped of 409, 32 of 33 suites (1 skipped)
  - @ptah-extension/core: 578 passed, 25 suites
  - @ptah-extension/chat-ui: 92 passed, 20 suites
  - @ptah-extension/chat: 872 passed / 2 skipped of 874, 59 suites
  - @ptah-extension/marketplace: 164 passed, 10 suites
- `npx nx run-many -t typecheck -p ptah-electron @ptah-extension/core
@ptah-extension/chat-ui @ptah-extension/marketplace` — passed (4 projects).
- `npx nx typecheck @ptah-extension/chat` — FAILS, on three pre-existing TS2339s
  in `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` (1253, 1285,
  1317: `agentId` on `AgentProgressEvent` / `AgentStatusEvent` /
  `AgentCompletedEvent`). Concurrent work by another agent in this shared tree;
  deliberately not touched. No error in any file this task changed.
- `npx nx run-many -t lint -p` the same five — passed, 0 errors. The warnings
  are pre-existing `max-lines` and `no-non-null-assertion` findings in files this
  task did not touch.
- NOT verified: a live `nx serve ptah-electron` log showing one `mirrorAll`, one
  `reconcile` and one catalog sync per switch. A desktop launch is not available
  from this session, and the webview build is blocked by the foreign
  `agent-monitor.store.ts` failure above. The mechanism is covered by the specs.

### Working-tree note

Three files were silently reverted on disk mid-session by something outside this
session (other agents share this working tree; TASK_2026_347 recorded the same
behaviour): `model-state.service.ts`, `chat-empty-state.component.ts` and
`plugins-surface.component.ts`. They were re-applied and verified present. Worth
re-checking those three before committing.

## Revision (judge round 1)

The judge passed the backend half and failed two frontend defects. Both were the
same mistake with different symptoms: **a cache key that omitted the dimension
the value actually varies over.** They are fixed by one new primitive rather than
two local patches.

### The shared cause

Electron keeps several workspace roots open at once and switches between them
without a page reload (`TabWorkspacePartitionService`;
`PluginStatusWidgetComponent` mounts per transcript). Two of the RPCs this
webview caches are resolved by the HOST against its own active workspace and
carry no workspace parameter:

- `plugins:get-config` reads `{ws}/.ptah/plugins`.
- `config:models-list` resolves the active provider at RPC-PROCESSING time —
  `WorkspaceCoordinatorService.refreshWorkspaceProviderState`'s own comment says
  so, and calls it after a switch precisely to obtain the NEW provider's models.

Round 1 gave both a session-wide latch. Round 2 gives them a key.

### `WorkspaceScopeService` (new)

`libs/frontend/core/src/lib/services/workspace-scope.service.ts`. Zero
dependencies, no I/O, no data — one `generation` counter, one
`activeWorkspacePath`, and a `scopeKey` computed from the two. A cache files each
read under the key that was current when the read STARTED, and serves or joins
that read only while the key still matches.

**A generation, not just the path.** Rapid A -> B -> A returns to the same path.
A request issued during the first A can be resolved by the host after the switch
to B, so its answer describes B — and a path-only key would hand that answer to a
caller who is back on A. The monotonic counter makes the third A a different
scope from the first.

**Bumped only on a REAL change.** `TabManagerService.switchWorkspace` and
`AppStateManager.switchWorkspace` both early-return on a switch to the workspace
already active, so that call is reachable. Treating it as a change would throw
away every cache for nothing and undo the "one fetch per view" property this task
exists to establish.

**Not `AppStateManager`.** It already tracks the active workspace path, but it is
a 766-line view-state object that reads `window` and `localStorage` on
construction. A cache needs one string from it; injecting the whole thing to get
that string is the dependency these services were written to avoid — the
`effort-state.service.spec.ts` header names that pull explicitly.

**Deliberately not merged with `WorkspaceCoordinatorService.switchGeneration`.**
They answer different questions. `switchGeneration` bumps on EVERY call so the
coordinator can drop a superseded continuation of its own; the scope bumps only
on an actual workspace change. Collapsing them would make a redundant switch
invalidate every cache, or make a real switch fail to.

`WorkspaceCoordinatorService.switchWorkspace` calls `workspaceScope.switchTo`
**first** in its synchronous fan-out — ahead of the tab, session, picker and
view resets — so nothing can read a scoped cache between the switch and the
invalidation, and the detached `refreshWorkspaceProviderState` it dispatches
already runs under the new scope.

### Defect 1 — `PluginCatalogService`

`_isLoaded: boolean` became a `_snapshot` signal carrying `{ scopeKey, plugins,
config }`, and `inFlight` became `{ scopeKey, promise }`.

- `plugins`, `config`, `isLoaded`, `enabledCount`, `hasEnabledPlugins` and
  `pluginTotal` all derive from a `current` computed that returns the snapshot
  ONLY while its `scopeKey` still matches. The stamp and the data it belongs to
  are one signal, not three, because a `plugins` signal that had been overwritten
  while a separate `loadedScope` had not is exactly how the previous workspace's
  list would leak into the new one's view. The instant the scope changes the
  widget shows its loading state rather than the old count.
- `load()` joins an in-flight request only when the scopes match; a stale one is
  left to run and is discarded on arrival.
- `fetch()` re-checks the scope after the `await` and returns without publishing
  if it moved. A response that arrived after the switch describes a workspace we
  can no longer name; publishing it would be the original defect with an extra
  step.
- A failed read still stamps the snapshot, so `isLoaded` means "we asked" and the
  Retry button is what asks again — otherwise every re-mounting widget would
  re-issue the failing pair.

### Defect 2 — `ModelStateService`

`modelsInFlight` became `{ scopeKey, promise }`, and `fetchModels` takes the
scope key it was issued under.

- A caller that arrives after a switch is asking a DIFFERENT question and gets
  its own request.
- A caller within one scope still joins — the round-1 coalescing (four tabs
  opening at once are one `config:models-list`) is intact and pinned by a test.
- `fetchModels` now DROPS a response whose scope has moved on, instead of
  writing `_availableModels`. This closes the residual window
  `refreshWorkspaceProviderState`'s comment documents and could not close from
  its side: without it, a stale reply landing after the fresh one would clobber
  the new provider's list with a coin flip.

### Tests

New — `workspace-scope.service.spec.ts` (6): starts at generation 0 with no
workspace; a real switch bumps the generation and the key; a redundant switch to
the active workspace does not; A -> B -> A gives A two different keys; the key
names the workspace; "no workspace" is a scope of its own.

`plugin-catalog.service.spec.ts` — a `workspace scope` describe (5), driven by an
RPC stub modelled on the real host (it resolves the workspace when it PROCESSES
the call, not when it receives it): a switch produces a fresh
`plugins:get-config` + `plugins:list-available` pair for the new root while a
re-mount on the same root produces none; the previous workspace's counts stop
being reported the instant the scope changes; a caller on the new workspace does
not join the old workspace's request; a stale response landing after the switch
is discarded; a workspace revisited after a detour is re-read.

`model-state.service.spec.ts` — a `config:models-list across a workspace switch`
describe (4): a post-switch caller is not answered with the pre-switch request
and ends up with the new provider's models and selection; a stale response
landing after the switch is discarded; a burst of four callers WITHIN one
workspace is still one request; a redundant switch does not invalidate an
in-flight one. (Promise identity is deliberately not asserted — `refreshModels`
is an async wrapper and mints a new promise per call, so identity would pass
vacuously; the request count is the observable contract.)

`workspace-coordinator.service.spec.ts` — `workspaceScope` added to the recorded
synchronous fan-out and asserted FIRST in it, plus a `workspace scope
invalidation` describe (4): the scope moves before the switch is even awaited;
it has already moved by the time `refreshModels` is called (the ordering the
whole defect turned on); one bump per real switch and none for a repeat; a
revisited workspace gets a distinct scope.

### Round-2 results

- `npx nx run-many -t test -p @ptah-extension/core @ptah-extension/chat-ui
@ptah-extension/chat @ptah-extension/marketplace --skip-nx-cache` —
  `Running target test for 4 projects`, all green.
- `npx nx run-many -t typecheck -p` the same four — passed. The foreign
  `agent-monitor.store.ts` TS2339s are gone, so `@ptah-extension/chat` is green
  for the first time in this task.
- `npx nx run-many -t lint -p` the same four — 0 errors.
- `ptah-electron` was not touched this round; its round-1 result stands.

## Revision (judge round 2)

One defect: `ElectronLayoutService` could reach **zero folders** without anyone
being told, so `WorkspaceScopeService` went on naming a folder that was no longer
open. Reopening that same folder was then a switch to the workspace already
active — which correctly early-returns — and every scope-keyed cache served its
pre-closure snapshot. The folder's `.ptah/plugins` can change while it is closed
(harness-sync, another window, `ptah tui`), so that snapshot is exactly the thing
not to trust. It also broke `WorkspaceScopeService`'s own header contract:
"`scopeKey` changes iff the active workspace changes."

There were **two** such branches, not one. The judge named `removeFolder`; the
trace below found the second.

### Where the transition is made, and who reaches the scope

Every site in `electron-layout.service.ts` that moves the active workspace,
after this change:

| line    | site                                                                         | reaches `switchTo`? | why                                                                                                                                                             |
| ------- | ---------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 340     | `removeFolder` — `_activeWorkspaceIndex.set(0)` when the list emptied        | via 352             | index bookkeeping only; the transition is made below it                                                                                                         |
| 342     | `removeFolder` — clamp the index when it ran past the new end                | via 347             | same; the surviving folder is coordinated below                                                                                                                 |
| 347     | `removeFolder` — `coordinateWorkspaceSwitch(newActive.path, …)`              | **yes**             | folders remain, so this is an ordinary switch                                                                                                                   |
| 352     | `removeFolder` — `coordinateWorkspaceCleared()`                              | **yes** (new)       | **the reported defect.** Was a bare `updateWorkspaceRoot('')`                                                                                                   |
| 379     | `switchWorkspace(index)` — optimistic `_activeWorkspaceIndex.set(index)`     | via 428             | UI-only, before the debounced RPC; the real transition is 428                                                                                                   |
| 424     | `switchWorkspace` — revert on a failed `workspace:switch` RPC                | no — correct        | the switch never happened, so the scope never moved                                                                                                             |
| 428     | `switchWorkspace` — `coordinateWorkspaceSwitch` after RPC success            | **yes**             | the main switch path                                                                                                                                            |
| 433     | `switchWorkspace` — revert on a thrown RPC                                   | no — correct        | as 424                                                                                                                                                          |
| 469     | `coordinateWorkspaceSwitch` — `updateWorkspaceRoot(newPath)`                 | **yes**             | inside the coordinated switch; `coordinator.switchWorkspace` fires just above it                                                                                |
| 485     | `coordinateWorkspaceSwitch` — revert after a coordination failure            | no — correct        | the coordinator already threw; re-entering it would be a second failure                                                                                         |
| 512-531 | `coordinateWorkspaceCleared()` (NEW)                                         | **yes**             | the "no workspace" mirror of `coordinateWorkspaceSwitch`                                                                                                        |
| 640     | `syncFromBackend` — `_activeWorkspaceIndex.set(activeIndex)` from host state | via 654             | index bookkeeping; the transition is 654                                                                                                                        |
| 654     | `syncFromBackend` — `coordinateWorkspaceSwitch(activePath, …)`               | **yes**             | host reported folders; ordinary switch                                                                                                                          |
| 669-671 | `syncFromBackend` — host reported ZERO folders and nothing cached            | **yes** (new)       | **the second instance of the same defect**, not in the report. Was `_activeWorkspaceIndex.set(0)` + `setWorkspaceInfo(null)` + a bare `updateWorkspaceRoot('')` |
| 703     | `restoreWorkspaceFoldersFromCache` — index clamp                             | via 719             | index bookkeeping                                                                                                                                               |
| 719     | `restoreWorkspaceFoldersFromCache` — `coordinateWorkspaceSwitch`             | **yes**             | restore ends in a real switch                                                                                                                                   |

Everything not marked "yes" is either pure index bookkeeping that a coordinated
call on the next line completes, or a rollback of a transition that did not
happen. Rollbacks deliberately do **not** touch the scope: the scope only ever
moved if the transition succeeded, so re-clearing it would invalidate every
cache for a switch that never occurred.

### The fix

**`IWorkspaceCoordinator.clearWorkspace()`** (new, in
`libs/frontend/core/src/lib/tokens/workspace-coordinator.token.ts`).

A sibling of `switchWorkspace` rather than `switchWorkspace(null)`: every
service the coordinator fans out to takes a `string` path, and widening that
signature would push a null check into all of them for a case only this
transition has.

Routed through the coordinator rather than injecting `WorkspaceScopeService`
into `ElectronLayoutService` directly, so **`switchTo` keeps exactly one owner**
— the same property the judge used to find this bug (`grep switchTo` returns
production call sites only inside `WorkspaceCoordinatorService`). Core defines
the port; the chat library implements the fan-out.

`WorkspaceCoordinatorService.clearWorkspace()` is two lines:
`switchGeneration += 1` and `workspaceScope.switchTo(null)`. The generation bump
is not decoration — a `switchWorkspace` whose editor-chunk `await` resolves
_after_ the last folder closed would otherwise carry on and re-resolve
auth/model/effort for a workspace that is gone. That is the same class of defect
as the one being fixed, one line away, so it is closed here and pinned by a test.

Deliberately nothing more: the per-folder teardown (tabs, sessions, editor
state) is already done by `removeWorkspaceState`, which `ElectronLayoutService`
calls for the folder being removed _before_ it reaches this branch. What was
missing is only the transition itself.

`coordinateWorkspaceCleared()` in `ElectronLayoutService` is the mirror of
`coordinateWorkspaceSwitch`: it calls the coordinator (guarded, non-fatal — a
coordinator that throws must not leave the sidebar showing a folder that is
gone) and then does the `updateWorkspaceRoot('')` both branches already did.

One inconsistency found and **left alone**: the sync branch (669) also calls
`appState.setWorkspaceInfo(null)` and the `removeFolder` branch (352) does not,
so closing the last folder leaves stale workspace info in `AppStateManager`.
That is a separate defect with separate user-visible symptoms, outside this
task's scope, and fixing it inside a minimal round-3 edit would be exactly the
sort of drive-by that makes a revision hard to review.

### Tests

`electron-layout.service.spec.ts` — `clearWorkspace` added to the coordinator
stub, plus three cases: closing the last folder calls `clearWorkspace` exactly
once and `switchWorkspace` never (the reported scenario); a `clearWorkspace`
that throws still clears the workspace root and logs; removing a folder when
others remain calls `switchWorkspace('/b')` and _not_ `clearWorkspace` (the
other half of the branch — firing the clear on every removal would throw away
every scope-keyed cache for a removal that did not empty the window).

`plugin-catalog.service.spec.ts` — "re-reads a workspace closed to zero and then
reopened": load QA, `switchTo(null)`, change QA's plugins _while it is closed_,
reopen the same path, and assert a second `plugins:get-config` +
`plugins:list-available` pair with the NEW contents. `PER_WORKSPACE` /
`ENABLED_PER_WORKSPACE` moved from `const` to a `beforeEach` rebuild, because
this is the first case that mutates a workspace's plugins and a shared object
would leak that into whatever ran next.

`workspace-coordinator.service.spec.ts` — three cases: the scope is cleared and
the generation bumped when the last folder closes; a reopened folder gets a
scope distinct from its pre-closure one (the user-visible defect, end to end);
and `clearWorkspace` supersedes a switch still in flight, so a continuation
resolving after the closure does not re-resolve auth/model for a workspace that
is gone.

### Round-3 results

- `npx nx run-many -t test -p @ptah-extension/core @ptah-extension/chat
--skip-nx-cache` — `Running target test for 2 projects`, all green.
- `npx nx run-many -t typecheck -p @ptah-extension/core @ptah-extension/chat` —
  passed.
- Files touched this round: `workspace-coordinator.token.ts`,
  `workspace-coordinator.service.ts`, `electron-layout.service.ts` and the three
  specs. Nothing under `apps/`, nothing in `chat-ui` or `marketplace`, and no
  backend file — their round-1/round-2 results stand.
