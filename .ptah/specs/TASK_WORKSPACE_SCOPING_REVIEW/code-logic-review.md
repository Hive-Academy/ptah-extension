# Code Logic Review - Workspace-Scoping Sync (Tribunal/Tasks/Memory/Cron/Harness Builder)

Commit reviewed: `ef32f9c4b` — "fix: sync all pages to the active workspace with per-workspace state"

## Review Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall Score       | 5/10           |
| Assessment          | NEEDS_REVISION |
| Critical Issues     | 2              |
| Serious Issues      | 3              |
| Moderate Issues     | 3              |
| Failure Modes Found | 6              |

The memory-curator implementation (monotonic `entriesReqSeq`/`statsReqSeq`/`symbolsReqSeq` stamps) is the strongest piece of this diff and should be the template for the others — tasks-store and cron-state both fall short of that bar in different ways. Tribunal's per-workspace partitioning is structurally sound for how mutators are _currently_ wired, but the `removedWorkspace$` cleanup path has a real cross-consumer ordering hazard. Harness builder's "pin survives a switch" guarantee has a hole big enough to defeat the feature's stated purpose in the pre-`start()` window. Cron's new `workspaceRoot` filter is an unnormalized exact-match string comparison with no protection anywhere in its pipeline, unlike the parallel `normalizeWorkspaceRoot`/`normalizeRootKey` machinery the same commit adds for Tasks.

## The 5 Paranoid Questions

### 1. How does this fail silently?

- `TasksStore.openTask()` (tasks-store.service.ts:236-253) applies whatever `tasks:get` response arrives last, with no id/workspace stamp check. A user who double-clicks two task cards in quick succession, or switches workspace mid-fetch, can end up with `selectedTaskId` pointing at task B while `taskDetail` silently holds task A's (or another workspace's) content — no error, no visual indication.
- `HarnessBuilderStateService`'s workspace-switch effect calls `reset()` (wiping `_pinnedWorkspaceRoot`, `_availableAgents/Skills/Presets`, config, conversation) whenever the active workspace changes while `_buildInProgress()` is `false` — which is true for the entire "conversational config" phase before the user's first message. Nothing re-triggers `harness:initialize` afterward, so the view is left silently empty with no error banner.
- Cron jobs created under one on-disk representation of a workspace path and later filtered under a different (but logically identical) representation simply disappear from "This workspace" with no error — they still exist under "All workspaces," so nothing looks broken, it just looks like the job you created isn't there.

### 2. What user action causes unexpected behavior?

- Clicking a task, then quickly clicking a different task (or switching the active Electron workspace) before the first `tasks:get` resolves → wrong detail content rendered under the correct `selectedTaskId`.
- Opening Harness Builder, browsing available agents/skills, then tabbing to another open workspace before typing the first message, then coming back → config/agent list silently wiped, pin lost.
- Rapidly switching away from and back to the same workspace on the Tasks board (or issuing a manual refresh while a workspace-switch revalidation is already in flight) → two `fetchBoard` calls for the _same_ workspace key race, and the slower one (not necessarily the most recent one) wins.

### 3. What data makes this produce wrong results?

- Any workspace path whose string representation captured at `cron:create` time (via `workspaceInfo().path` when the user clicked "New Job") differs — by trailing separator, or by full-string case beyond just the drive letter, or `/` vs `\` — from the path captured at `cron:list` time later (e.g. after switching CLI vendor, reopening the folder via a different launcher, or a future Electron path-resolution change). SQLite's `workspace_root = ?` is a byte-exact string comparison; nothing upstream or downstream normalizes it.
- A `harness:apply` call whose `workspaceRoot` param is attacker/bug-supplied as a relative path or containing `..` segments — the new `HarnessWorkspacePinParamsSchema` only checks `z.string().min(1)`, unlike the sibling `assertSafeCronUserInput` added in the very same commit, which requires absolute + no-`..`.

### 4. What happens when dependencies fail?

- `TabManagerService.removedWorkspace$` is a single shared signal with a documented single-shot ack contract ("OrchestraCanvasComponent owns the shared single-shot ack"). If `TribunalStateService`'s cleanup `effect()` is flushed _after_ `OrchestraCanvasComponent`'s ack effect within the same Angular effect-flush pass (a function of injection/creation order, which depends on whichever page mounts first — canvas is very likely to exist before the user ever opens the Tribunal tab), Tribunal's effect reads `removedWorkspace$()` as already-cleared `null` and its `if (removed)` guard skips `deleteSlice()` entirely. The workspace's Tribunal slice leaks forever, and if the same workspace path is later reused (folder closed and reopened), a stale run resurfaces under what the user perceives as a fresh workspace.
- If `tasks:changed` push races two workspace's caches, `boardCache.set(key, slice)` is written unconditionally regardless of arrival order — a slower response for a workspace that has since received a newer push can overwrite the cache with older data with no way to recover until the next real change event.

### 5. What's missing that the requirements didn't mention?

- No monotonic per-request sequence number in `TasksStore.fetchBoard`/`openTask` (contrast with the `entriesReqSeq` pattern in `memory-state.service.ts` and `refreshSeq` in `cron-state.service.ts`) — the tasks-store guard is a workspace-key equality check, not a request-ordering guard, so it only blocks _cross_-workspace overwrite, not _same_-workspace out-of-order overwrite.
- No path-normalization anywhere in the cron `workspaceRoot` write/read pipeline, despite the same commit introducing exactly that normalization concept twice elsewhere (`task-specs` backend `normalizeWorkspaceRoot`, and a hand-rolled frontend `normalizeRootKey` in `tasks-store.service.ts`).
- No re-initialization path for Harness Builder after an idle-switch reset while the component stays mounted (which it must, since the whole point of this diff is that these pages survive workspace switches without remounting).

## Failure Mode Analysis

### Failure Mode 1: Stale task-detail response wins over a newer one (`openTask` has no stamp guard)

- **Trigger**: User opens task T1 (`openTask('T1')` issues `tasks:get`), then before it resolves opens task T2 (`openTask('T2')`), and T1's response resolves after T2's (plausible under any real network/IPC jitter, or if the two tasks' markdown bodies differ significantly in size).
- **Symptoms**: `selectedTaskId` correctly shows `'T2'`, but `taskDetail` silently gets overwritten with T1's frontmatter/body — the detail panel renders the wrong task's content under the right task's header/selection state.
- **Impact**: Serious — user-visible data-integrity bug with no error surfaced; also reachable via a workspace switch mid-fetch (A's slow `tasks:get` response landing after the user has switched to B and selected a task there).
- **Current Handling**: None. `updateStatus()` (line 293-305) _does_ guard re-opening with `if (this._selectedTaskId() === taskId ...)`, showing the author was aware of this exact hazard elsewhere in the file, but the guard was not applied inside `openTask()` itself, which is the method every other caller (including `updateStatus` and `refreshActiveFromPush`) funnels through.
- **Recommendation**: Stamp `openTask` with the same kind of per-call sequence token used in `fetchBoard`/`memory-state.service.ts` (`const seq = ++this.detailReqSeq(); ...; if (seq !== this.detailReqSeq()) return;`), or at minimum re-check `taskId === this._selectedTaskId()` before `this._taskDetail.set(...)`.

### Failure Mode 2: Harness Builder pin is wiped before the build even starts, silently defeating the "apply targets the right workspace" guarantee

- **Trigger**: User mounts Harness Builder (`ngOnInit` → `initializeBuilder()` pins `_pinnedWorkspaceRoot = A`), then switches the active Electron workspace _before_ sending their first chat message (i.e. before `HarnessWorkflowService.startWorkflow()` sets `buildInProgress = true`).
- **Symptoms**: `HarnessBuilderStateService`'s workspace-switch effect (`harness-builder-state.service.ts:167-175`) sees `_buildInProgress() === false` and calls `onWorkspaceSwitched()` → `reset()` (line 564-586), which clears `_pinnedWorkspaceRoot`, `_availableAgents`, `_availableSkills`, `_existingPresets`, and all config/conversation state. Nothing in `HarnessBuilderViewComponent` re-invokes `initializeBuilder()` in response — it's only called from `ngOnInit` (once, at mount) and a manual retry button gated on an _error_ state (`initError`), not on this silent reset.
- **Impact**: Critical — this is precisely the bug class the feature was built to close. If the user then types a message anyway, `startWorkflow()` fires `chat:start` against whatever workspace is active _at that moment_ (via `vscode.config().workspaceRoot`), while `_pinnedWorkspaceRoot` stays `null` for the rest of the session (nothing re-populates it). When `applyConfig()` eventually runs, `pinnedWorkspaceRoot()` is `null`, so the `workspaceRoot` param is omitted entirely and the backend falls back to "the active workspace at apply time" (`harness-rpc.handlers.ts:354-357`) — which can be a _third_, different workspace if the user switched again during the (often multi-turn) conversation. The exact failure the fix set out to prevent is fully reachable, just gated behind one extra idle-phase switch.
- **Current Handling**: The service-level test (`harness-builder-state.service.spec.ts`, "idle workspace switch resets state so the next initialize re-pins") only asserts the reset happens; it does not — and cannot, since it's a service-only unit test — verify that anything actually calls `initialize()` again. The integration gap is invisible from that test.
- **Recommendation**: Either (a) don't reset on an idle switch before the first message is sent (there's nothing to protect yet — `chat:start` hasn't happened), only reset+re-pin lazily on the _next_ `startWorkflow()` call using the then-current workspace, or (b) have the component's switch handling actively re-call `initializeBuilder()` when it observes the pin was cleared while idle.

### Failure Mode 3: Cron's `workspaceRoot` filter is a raw string exact-match with zero normalization anywhere in its pipeline

- **Trigger**: A scheduled job's `workspace_root` column, stamped verbatim from `cron-scheduler-tab.component.ts`'s `this.appState.workspaceInfo()?.path` at `cron:create` time, differs as a raw string from the value the same signal holds at a later `cron:list({ workspaceRoot })` call — e.g. a trailing separator appears/disappears, or the drive letter/path case differs between sessions (folder reopened via a different launcher, Electron path-resolution change, etc.).
- **Symptoms**: The job silently vanishes from the "This workspace" scoped view (and from the `ThothStatusService.loadCron()` dashboard pillar count, which uses the same unnormalized param) while still existing and still firing on schedule — visible only under "All workspaces." Looks exactly like "my job got deleted."
- **Impact**: Serious. Concretely worse than the equivalent Tasks feature in the same commit: `tasks-rpc.handlers.ts`'s `resolveRoot()` always calls `normalizeWorkspaceRoot()` (strips trailing separator, lowercases the drive) on every board fetch regardless of source, and the frontend's `normalizeRootKey()` independently reimplements the same idea for its cache keys. Cron has neither: `JobStore.list()` (`job.store.ts:118-133`) does a bare `workspace_root = ?` bind, and `assertSafeCronUserInput()` (`cron-rpc.handlers.ts:79-91`) computes `path.normalize(wr)` _only_ to validate the absence of `..` segments — the normalized value is discarded, and the raw `params.workspaceRoot` is what actually gets passed to `scheduler.create()`/`scheduler.update()` (`cron-rpc.handlers.ts:184`, `201`) and stored.
- **Current Handling**: None. The added `JobStore.list` tests (`job.store.spec.ts`) only assert exact-string matches by construction (`/ws-a` vs `/ws-a`) — they don't exercise a case/separator mismatch, so the gap is untested as well as unhandled.
- **Recommendation**: Normalize `workspaceRoot` the same way `task-specs`' `normalizeWorkspaceRoot` does, both on write (`JobStore.create`/`upsert`/`update`, or in the RPC handler before calling the scheduler) and on read (`JobStore.list`'s filter value), so the exact-match comparison operates on a canonical key regardless of how the string arrived.

## Critical Issues

### Issue 1: Harness Builder pin can be silently discarded before a build starts, then never re-established

- **File**: `libs/frontend/harness-builder/src/lib/services/harness-builder-state.service.ts:167-186, 564-586`; `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:452-492`
- **Scenario**: See Failure Mode 2 above.
- **Impact**: The specific bug this commit's harness-builder change was written to close (`harness:apply` writing into the wrong workspace after a switch) remains reachable.
- **Fix**: Don't tear down the pin/agent list on an idle-phase switch before `startWorkflow()`, or re-trigger `initializeBuilder()` automatically when the pin is found cleared while the component is still mounted and idle.

### Issue 2: `TasksStore.openTask()` has no stale-response guard

- **File**: `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts:236-253`
- **Scenario**: See Failure Mode 1 above.
- **Impact**: Wrong task content silently displayed under the correct task selection; no error surfaced.
- **Fix**: Add a monotonic request stamp (matching the pattern already used in `fetchBoard` in the same file, and in `memory-state.service.ts`), and re-check it (or `taskId === this._selectedTaskId()`) before applying the response.

## Serious Issues

### Issue 3: `removedWorkspace$` single-shot ack is racy across independent consumers

- **File**: `libs/frontend/tribunal-panel/src/lib/services/tribunal-state.service.ts:112-121` (the `removedWorkspace$` effect + `deleteSlice`); `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:320-325` (the ack owner)
- **Scenario**: Both `TribunalStateService` (root-provided, effect registered whenever it's first injected — typically on first navigation to the Tribunal tab) and `OrchestraCanvasComponent` (typically mounted much earlier, at app/canvas bootstrap) run independent `effect()`s over the same shared `removedWorkspace$` signal. If canvas's effect — which calls `this.tabManager.clearRemovedWorkspace()` synchronously inside its own body — is flushed before Tribunal's effect within the same Angular effect-flush pass (governed by creation order, not by any explicit sequencing contract), Tribunal's effect reads `removed = null` when it finally runs, and its `if (removed) { ... }` guard skips cleanup entirely.
- **Impact**: The dead workspace's Tribunal run slice is never deleted — a memory leak in the common case, and a resurrected-stale-run bug if the same workspace path is later reopened (the old slice reappears under what the user believes is a fresh workspace).
- **Evidence**: The code comment at `tribunal-state.service.ts` even acknowledges the shared-signal design ("OrchestraCanvasComponent owns the shared single-shot ack, so this never competes for `clearRemovedWorkspace()`") but the reasoning only addresses _who calls the clear_, not _the read-after-clear ordering hazard_ for every other consumer of the same signal.
- **Fix**: Either give `TribunalStateService` its own dedicated removal signal (not shared with canvas), or have the shared signal carry a per-consumer ack mechanism (e.g., a small `Set` of consumer ids that must all ack before the signal clears), or process cleanup + a self-tracked "already handled this emission" guard keyed by workspace path + emission identity rather than relying on flush ordering.

### Issue 4: `TasksStore.fetchBoard` guards cross-workspace overwrite but not same-workspace out-of-order overwrite

- **File**: `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts:451-484`
- **Scenario**: Two `fetchBoard(key, root)` calls for the _same_ `key` can be in flight simultaneously (e.g., the switch-effect's stale-while-revalidate fetch racing a user-triggered manual `loadBoard()`/reindex-triggered reload). `isActive()` only compares `key === this.activeKey()`; it has no per-call sequence number, so if the earlier-issued request resolves later, its (possibly stale) data unconditionally overwrites both `boardCache` and, if still active, the visible board — clobbering a fresher result that already landed.
- **Impact**: Board can flash back to older data, or (more importantly) the cache can be left holding stale data that a later workspace-switch-back will paint instantly as if it were fresh.
- **Fix**: Add a per-key (or global) monotonic sequence counter analogous to `memory-state.service.ts`'s `entriesReqSeq`, and drop responses whose stamp is not the latest for that key.

### Issue 5: `harness:apply`'s `workspaceRoot` param is validated far more loosely than the equivalent Cron field, in the same commit

- **File**: `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.schema.ts:16-27`; contrast with `libs/backend/rpc-handlers/src/lib/handlers/cron-rpc.handlers.ts:67-92`
- **Scenario**: `HarnessWorkspacePinParamsSchema` only requires `z.string().min(1).optional()`. Unlike `assertSafeCronUserInput`, it never checks `path.isAbsolute()` nor rejects `..` segments, even though this value flows straight into `harness-rpc.handlers.ts`'s `writePresetToDisk`/CLAUDE.md-generation file-write path (`workspaceRoot = requestedRoot ?? this.workspaceProvider.getWorkspaceRoot()`).
- **Impact**: Not exploitable through the current UI (the frontend only ever echoes back the backend's own `harness:initialize` response), but it's an RPC-surface boundary that any other caller (buggy or malicious) can hit directly with a relative or traversal path, and the codebase's own stated guideline is "Zod schemas mandatory... every handler method validates params via its schema file before doing work."
- **Fix**: Reuse (or mirror) the same absolute-path + no-`..` validation used for cron's `workspaceRoot`.

## Moderate Issues

### Issue 6: Frontend `normalizeRootKey` (tasks) is a hand-duplicated reimplementation of backend `normalizeWorkspaceRoot`, and the two happen to agree only by coincidence of inputs

- **File**: `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts:62-83`
- Frontend unifies both separators to `/` and lowercases only the drive letter; backend's `path.resolve` canonicalizes to the OS-native separator and also lowercases only the drive letter. For the _Tasks_ feature specifically, this currently converges because both sides trace back to the same backend-resolved root string and neither does anything that would diverge (no `..`/`.` collapsing needed since inputs are already absolute). This is fragile-by-coincidence rather than fragile-by-design — a future change to either normalization function (e.g., if `normalizeWorkspaceRoot` starts lowercasing UNC share names, or resolving symlinks) would silently break the frontend cache-key parity assumed here, and nothing tests that parity directly (the specs test each side's behavior in isolation, not cross-consistency).
- **Recommendation**: At minimum, add a test asserting `normalizeRootKey(x) `'s equivalence class matches `normalizeWorkspaceRoot(x)`'s for representative Windows path variants (trailing slash, mixed separators, drive case).

### Issue 7: First-emission "record baseline, don't fetch" guard has a narrow but real timing hole (cron/tasks/memory/harness all share this pattern)

- **File**: `cron-state.service.ts` (`lastWorkspaceRoot`), `tasks-store.service.ts` (`lastWorkspaceKey`), `harness-builder-state.service.ts` (`lastObservedWorkspaceRoot`), `memory-curator-tab.component.ts` (`lastWorkspacePath`)
- **Scenario**: Each of these constructs an `effect()` whose first execution is deferred to the next Angular effect-flush after construction (not synchronous with the constructor), while the corresponding `ngOnInit`/first-load fetch is either synchronous or fired earlier. If the active workspace changes in the narrow window between component/service construction and the effect's first flush, the effect's first observation silently records the _new_ (post-switch) workspace as the baseline without ever fetching for it — because "first emission never fetches" by design — leaving the view showing the _old_ workspace's data under the new workspace's name until the _next_ switch occurs.
- **Impact**: Low probability (requires a switch within a single microtask/CD-cycle window), and self-heals on the next switch, but it is a real, reachable hole in a pattern applied identically across four different services in this commit, so it is systemic rather than a one-off.
- **Recommendation**: Compare the baseline captured at construction time against the value read at first flush, and treat a mismatch as a "already switched, must fetch" case rather than a no-op.

### Issue 8: `resetVisibleForLoading()` briefly asserts `specsDirExists: true` while loading a never-before-seen workspace

- **File**: `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts:479-484`
- On a cache-miss workspace switch, the visible board is reset to `{ columns: empty, excludedCount: 0, specsDirExists: true }` before the real fetch resolves. If the UI conditionally renders a "no specs directory" empty-state versus the board based on `specsDirExists`, this transient `true` will briefly show the (wrong) "board" empty-columns state instead of a neutral loading state, for a workspace that may turn out to have no `.ptah/specs/` at all. Cosmetic/UX only, not a data-integrity bug, but worth confirming intentional.

## Data Flow Analysis (Tasks board + detail, the most complex path reviewed)

```
User clicks task card (workspace A active)
        │
        ▼
openTask(taskId) ── sets _selectedTaskId = taskId, _detailLoading = true
        │                                         [NO STAMP CAPTURED HERE]
        ▼
rpc.call('tasks:get', { taskId, workspaceRoot: <A> })  ── async, in flight
        │
        │   (user switches active workspace to B)
        │           │
        │           ▼
        │   onWorkspaceSwitch(B) → closeTask() → _selectedTaskId=null, _taskDetail=null
        │           │
        │           ▼
        │   user clicks a task in B → openTask('T2') issues its own tasks:get(B)
        │
        ▼ (A's response finally arrives, possibly AFTER T2's response)
result.isSuccess() → this._taskDetail.set(result.data.task)   ◄── GAP: unconditional
        │
        ▼
Detail panel (gated on selectedTaskId, now 'T2') renders A's stale task content
```

### Gap Points Identified:

1. `openTask` never stamps or re-validates against `_selectedTaskId`/workspace before writing `_taskDetail` — the only point in the whole file without this protection despite the pattern existing one call site away in `updateStatus`.
2. `fetchBoard`'s workspace-key guard prevents cross-workspace paint but is silent to same-workspace out-of-order responses (Issue 4).
3. `boardCache.set(key, slice)` (line 471) is unconditional — always wins regardless of arrival order.

## Requirements Fulfillment

| Requirement                                                             | Status   | Concern                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tribunal: per-workspace run partitioning                                | PARTIAL  | Mutator routing is correct for all currently-wired call sites (synchronous, always issued while the target workspace is active); `removedWorkspace$` cleanup has the cross-consumer ordering race (Issue 3). `addTile`/`replaceTile`/`removeTile` are unused dead API surface today — fine now, but would need workspace-stamping (not "current active slice") the moment anything calls them from an async/streamed context. |
| Tasks: explicit workspaceRoot + per-workspace cache + push routing      | PARTIAL  | Board-level guard is solid for cross-workspace but not intra-workspace ordering (Issue 4); `openTask` has no guard at all (Issue 2, Critical).                                                                                                                                                                                                                                                                                |
| Memory: refresh-on-switch with stale-response guards                    | COMPLETE | Correct monotonic-sequence pattern; best-implemented piece of this diff.                                                                                                                                                                                                                                                                                                                                                      |
| Cron: workspaceRoot list filter, This workspace/All workspaces toggle   | PARTIAL  | Functionally wired end-to-end, but the filter is an unnormalized exact string match with no protection anywhere in the pipeline (Issue 3/Failure Mode 3) — will silently misbehave for any workspace path whose string form isn't byte-identical between job-creation time and list time.                                                                                                                                     |
| Harness builder: pin workspace at initialize, apply targets pinned root | PARTIAL  | Works correctly _after_ `startWorkflow()`, but the pin (and the whole initialize-fetched state) is destroyed by an idle-phase workspace switch with no recovery path (Issue 1, Critical) — reintroducing the exact bug the fix targets.                                                                                                                                                                                       |

### Implicit Requirements NOT Addressed:

1. Parity/consistency testing between the frontend's hand-rolled `normalizeRootKey` and the backend's `normalizeWorkspaceRoot` (Issue 6) — nothing asserts they agree, they just currently happen to.
2. A defined behavior for "workspace switches while still on the idle/pre-start screen" for Harness Builder — the tests assert the _service's_ reset behavior in isolation but never exercise the component-level consequence (no re-init).
3. Path validation parity between the two new `workspaceRoot`-accepting RPC surfaces added in this same commit (`cron:create`/`cron:update` vs `harness:apply`) — one validates absolute+no-traversal, the other doesn't (Issue 5).

## Edge Case Analysis

| Edge Case                                        | Handled                    | How                                                                            | Concern                                                   |
| ------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Rapid double task-open (same workspace)          | NO                         | —                                                                              | Stale response can overwrite fresh detail (Issue 2)       |
| Task open in-flight during workspace switch      | NO                         | `closeTask()` clears selection but doesn't cancel/guard the in-flight response | Detail data leak into next selection (Issue 2)            |
| Two concurrent board fetches, same workspace     | NO                         | workspace-key equality only                                                    | Older response can win (Issue 4)                          |
| Board fetch during/after workspace switch        | YES                        | `isActive()` key comparison                                                    | Correctly blocks cross-workspace paint                    |
| Cron job workspace_root case/separator drift     | NO                         | none                                                                           | Job silently disappears from scoped view (Failure Mode 3) |
| Harness switch before first message              | Handled, but destructively | `reset()` wipes pin+config with no recovery                                    | Defeats the feature's purpose (Issue 1)                   |
| Harness switch during active build               | YES                        | `buildInProgress` guard keeps pin, flags badge                                 | Correct                                                   |
| Tribunal workspace removed while a run is staged | Handled, but racy          | shared `removedWorkspace$` + independent consumer effects                      | Ordering-dependent leak/resurrection (Issue 3)            |
| Memory workspace switch mid-request              | YES                        | monotonic req-seq per loader                                                   | Correct, best-in-class in this diff                       |

## Integration Risk Assessment

| Integration                                                                | Failure Probability                                                                                                           | Impact                                             | Mitigation                                                 |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| TasksStore.openTask ↔ tasks:get RPC                                        | MEDIUM (ordinary UI double-click reachable)                                                                                   | Wrong task content shown                           | NEEDED: stamp guard                                        |
| HarnessBuilderStateService switch-effect ↔ component re-init               | MEDIUM (any pre-message workspace glance)                                                                                     | Silent state wipe, apply-target guarantee defeated | NEEDED: skip reset while pre-start, or re-init hook        |
| TribunalStateService ↔ OrchestraCanvasComponent (shared removedWorkspace$) | LOW-MEDIUM (depends on component mount order, plausible in the common case where canvas mounts before Tribunal tab is opened) | Slice leak / stale-run resurrection                | NEEDED: decouple ack from consumption, or per-consumer ack |
| Cron JobStore.list workspaceRoot filter                                    | LOW-MEDIUM (depends on OS/Electron path-resolution stability across sessions)                                                 | Job silently invisible in scoped view              | NEEDED: normalize on write + read                          |

## Verdict

**Recommendation**: REVISE
**Confidence**: HIGH
**Top Risk**: Harness Builder's workspace pin can be silently discarded before a build starts (Issue 1) — this fully reopens the exact bug ("apply writes into a different workspace after a switch") that this specific sub-change was written to close, and it is reachable through completely ordinary user behavior (glancing at another workspace tab while composing the harness intent).

## What Robust Implementation Would Include

- A single shared "stale-response guard" utility (monotonic sequence stamp compare-and-swap) used identically by every one of these five features, instead of three different ad hoc strategies (memory's proper `reqSeq`, tasks's workspace-key-only compare, cron's counter-based `refreshSeq` for list-only, harness's binary in-progress flag with no per-request stamping at all).
- A single shared workspace-root normalization function usable from both frontend and backend (or at minimum a documented, tested equivalence contract between the two independent implementations that currently exist).
- Explicit backend absolute-path + traversal validation on every new `workspaceRoot`-accepting RPC param, not just the ones the author happened to think of first.
- A dedicated, non-shared "workspace removed" cleanup signal per consumer (or an ack-count/id-set based multi-consumer design) instead of one shared single-shot signal raced by independent `effect()`s.
- Component-level recovery (auto re-init) whenever a service-level reset silently clears state the component's own mounted lifecycle depends on, rather than relying on the user to notice something is empty and manually retry.
