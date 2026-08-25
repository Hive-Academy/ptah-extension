# Code Logic Review - TASK_2026_315 — Batch 3 (A2)

## Review Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall Score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Critical Issues     | 0              |
| Serious Issues      | 1              |
| Moderate Issues     | 2              |
| Minor Issues        | 1              |
| Failure Modes Found | 3              |

**Verification performed, not just read**: the four files' diff was traced end to
end against `AppStateManager`, `ElectronLayoutService`, `VSCodeService`, the
`RpcUserError → RpcHandler → ClaudeRpcService` wire path, and the palette
catalogue (`palette-entries.ts`). The suite was run (`npx nx test tasks-ui
--skip-nx-cache`: 18 suites / 571 tests, green), lint and typecheck were run
clean, and the named regression test was mechanically reverted (guard neutered
to `if (false && this._noWorkspace())`) and confirmed to fail exactly as the
report claims (`Expected: 1, Received: 6`), then restored and reconfirmed green.
All of that matches the report. The one place the report's own framing does not
hold up is item 5 below — the "whole screen" claim.

## The 5 Paranoid Questions

### 1. How does this fail silently?

It mostly doesn't — this is a materially better store than before it (three-way
outcome instead of two-way, `errorCode` matched exactly, generic failures stay
retryable). The one silent failure that remains: a `WORKSPACE_NOT_OPEN` refusal
triggered by the Command Palette's **"Create a task"** or **"Reindex the
workspace tasks"** entries (see Serious Issue 1) repaints the exact `.alert-error`
banner the whole batch exists to stop showing on this surface — silently, from
the user's point of view, because the palette gives no indication that these two
entries are different from the ones actually gated.

### 2. What user action causes unexpected behavior?

Opening the Command Palette (`Ctrl+K`/`Cmd+K`, or the always-enabled "Commands"
button) while `noWorkspace()` holds and running **"Create a task"** or
**"Reindex the workspace tasks"**. Both are wired with `disabledReason: null`
unconditionally in `palette-entries.ts` (`board:create` at `:427-432`,
`board:reindex` at `:434-441`, the latter gated only on `busy`), and
`onPaletteRun` (`tasks-view.component.ts:1225-1227`, `:1237-1239`) dispatches
them straight into `store.openCreate()` / `store.reindex()` with no check on
`store.noWorkspace()`. The create dialog opens, or the reindex RPC fires; both
write into `.ptah/specs` through the same `tasks:*` namespace the header buttons
were disabled to protect, and both land in `createTask()`'s / `reindex()`'s
generic `this._error.set(result.error ?? …)` path (`tasks-store.service.ts:1378,
1382, 1402`), because neither of those methods special-cases `WORKSPACE_NOT_OPEN`
the way `fetchBoard` now does. The result: the red banner reappears over the
calm "No folder is open" panel — the precise outcome the report says disabling
the header buttons eliminated "of the whole screen."

### 3. What data makes this produce wrong results?

Nothing exotic. `workspaceInfo` being `null` (the ordinary no-folder state) is
already sufficient to expose issue 1 above — no race, no malformed payload
required. It reproduces on every single "no folder open" session, via a control
the report explicitly signs off as safe ("the palette trigger is deliberately
left enabled: it acts on the board and the selection, both empty here") — a
justification that is simply wrong for the two board-scoped, selection-independent
entries.

### 4. What happens when dependencies fail?

Traced the whole chain from `RpcUserError` to the store: `RpcHandler` attaches
`errorCode` on a caught `RpcUserError` (`rpc-handler.ts:190-200`);
`ClaudeRpcService` threads `response.errorCode` into `RpcResult`'s 4th
constructor argument (`claude-rpc.service.ts:181`); `RpcResult.errorCode` is a
plain readonly property typed `RpcUserErrorCode` (`:50`), which does include
`'WORKSPACE_NOT_OPEN'` (`rpc-error-codes.types.ts:8`). So the claim under
scrutiny item 3 — "is `errorCode` actually populated on the frontend
`RpcResult`" — holds; this is not hypothetical, and the exact-match branch in
`fetchBoard` (`tasks-store.service.ts:2218`) works as documented. A transport
failure (timeout/abort) leaves `errorCode` `undefined`, which correctly falls
into the "generic failure" `else` branch and stays retryable — confirmed by the
store test asserting 2 calls after one focus event on a `scan-failed` error.

### 5. What's missing that the requirements didn't mention?

Two things, neither in the acceptance criteria as written but both implied by
the developer's own claims:

- The palette bypass above. Task 3.2's acceptance criterion — "The no-workspace
  state offers no 'create task' affordance" — is technically true of the
  no-workspace _block_, but the report generalizes it to "the whole screen,"
  and that generalization is false. The reviewer brief specifically asked to
  confirm the palette trigger being left enabled is safe; it is not, for these
  two entries.
- `TaskViewsService.load()` (`task-views.service.ts:285-309`) surfaces the same
  raw `'No workspace folder open.'` string as an error on the saved-views menu
  with no `noWorkspace`-style softening — the developer flags this themselves
  as a possible follow-up. See Moderate Issue 2 for whether to fold it in.

## Failure Mode Analysis

### Failure Mode 1: Command Palette re-opens the door Task 3.2 just closed

- **Trigger**: No workspace open (`store.noWorkspace() === true`). User presses
  `Ctrl+K` (or clicks "Commands," which is never disabled) and runs "Create a
  task" or "Reindex the workspace tasks."
- **Symptoms**: The create modal opens and, on submit, fails with a red
  `.alert-error` banner reading a generic "Failed to create task" (not even the
  friendlier "No folder is open" text). Reindex does the same with "Failed to
  reindex tasks." Both banners render directly above the calm no-workspace
  panel underneath.
- **Impact**: Undermines the stated purpose of Task 3.2 and the report's own
  "whole screen" claim. Not data-lossy (the write is refused server-side,
  correctly), but it is exactly the confusing, per-action-refusal UX the batch
  was supposed to eliminate, now reachable through the one control explicitly
  called out as "how a user finds out what this surface can do."
- **Current Handling**: None. `TaskPaletteContext` (`palette-entries.ts:144-164`)
  has no `noWorkspace` field at all, and the component never passes
  `store.noWorkspace()` into `buildPaletteEntries` (`tasks-view.component.ts:945-958`).
- **Recommendation**: Add `noWorkspace: boolean` to `TaskPaletteContext`, pass
  `store.noWorkspace()` from the component, and set a `disabledReason` (matching
  the existing `NO_SELECTION_REASON`/`NO_CHECKED_TASKS_REASON` convention) on
  `board:create` and `board:reindex` when it is true. Add a component test that
  opens the palette in the "no folder open" describe block and asserts both
  entries are disabled-with-reason.

### Failure Mode 2: A non-push-driven `WORKSPACE_NOT_OPEN` cannot self-heal

- **Trigger**: `resolveRoot` throws `WORKSPACE_NOT_OPEN` on some `tasks:board`
  call while, for whatever reason (a host-side race, a dropped push), the
  webview's `AppStateManager.workspaceInfo` never actually changes to reflect
  it — i.e. the refusal is transient/spurious relative to what the webview
  believes.
- **Symptoms**: `_noWorkspace` latches `true`. Because `activeKey()` never
  changes (workspaceInfo didn't move), `onWorkspaceSwitch` never re-fires, and
  `setupVisibilityReconcile`'s new guard (`tasks-store.service.ts:2285`) means
  **no** subsequent focus/visibilitychange event will retry. The only recovery
  is the manual "Check again" button.
- **Impact**: Low probability (the host only throws this when its own
  `getWorkspaceRoot()` is genuinely falsy — `tasks-rpc.handlers.ts:1458`), but
  it is a real behavioral regression versus the pre-fix code, which — despite
  looping wastefully — did at least self-heal any transient refusal on the very
  next focus. This is a real trade-off, not a bug in the strict sense (the fix's
  whole premise is that this refusal is permanent), but it is worth being
  explicit that the trade is "no more infinite retries" for "no more automatic
  recovery from a spurious refusal not reflected in `workspaceInfo`."
- **Current Handling**: The "Check again" button is the designed escape hatch
  and is genuinely reachable (not disabled by `noWorkspace()`, only by
  `store.loading()`), so this is not a dead end — just a UX regression from
  automatic to manual recovery in an edge case the fix does not (and need not)
  fully close.
- **Recommendation**: No change required for approval. Worth a one-line note in
  the `_noWorkspace` doc comment acknowledging the trade-off explicitly, since
  the comment currently implies the flag can only ever reflect a stable,
  externally-resolved truth.

### Failure Mode 3: The adjacent saved-views menu still shows the raw refusal text

- **Trigger**: No workspace open; `TaskViewsService.load()` fires once at
  `TasksViewComponent` init (component code not in this batch's diff, but wired
  in the same file) and gets the same `WORKSPACE_NOT_OPEN` refusal.
- **Symptoms**: `TaskViewsService._error` is set to `'No workspace folder open.'`
  verbatim (`task-views.service.ts:295`) and rendered "on the menu" per its own
  doc comment — i.e. a different widget on the same screen still shows the raw
  backend sentence the board used to show before this batch, with no
  distinction from a real transport failure.
- **Impact**: Cosmetic/inconsistent, not a loop (confirmed: called once at init,
  not on focus). Low severity.
- **Current Handling**: Untouched — correctly out of this batch's file list.
- **Recommendation**: Leave as a separate follow-up finding rather than folding
  into this task. Rationale: different symptom class (one-time stale text, not
  an unbounded refetch loop), different file (`task-views.service.ts`, not in
  this batch's declared scope), and the fix shape (probably: give
  `TaskViewsService` its own `noWorkspace`-style read, independent of the board)
  is a small, well-scoped piece of work on its own. The developer's own framing
  of this as "worth a follow-up" is the right call; just confirming it should
  not block this batch.

## Critical Issues

None.

## Serious Issues

### Issue 1: Command Palette bypasses the no-workspace gate for create and reindex

- **File**: `libs/frontend/tasks-ui/src/lib/components/palette/palette-entries.ts:427-441`
  (entry definitions), `libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts:945-958`
  (context assembly, no `noWorkspace` passed), `:1225-1227` / `:1237-1239`
  (dispatch with no guard)
- **Scenario**: No folder open; user opens the palette (button or `Ctrl+K`, both
  always enabled) and runs "Create a task" or "Reindex the workspace tasks."
- **Impact**: Reintroduces the exact red-banner-over-calm-panel UX this batch
  exists to remove, through a control the batch's own report calls "safe."
  Directly contradicts Task 3.2's acceptance criterion once generalized to "the
  whole screen," as the report itself generalizes it.
- **Evidence**:
  ```ts
  // palette-entries.ts:426-432 — unconditionally enabled
  {
    id: 'board:create',
    label: 'Create a task',
    group: 'board',
    disabledReason: null,
    action: { kind: 'createTask' },
  },
  ```
  ```ts
  // tasks-view.component.ts:1225-1227 — no noWorkspace check
  case 'createTask':
    this.openCreate();
    return;
  ```
- **Fix**: Add `noWorkspace: boolean` to `TaskPaletteContext`; pass
  `store.noWorkspace()` in `paletteEntries` (`tasks-view.component.ts:945-958`);
  set `disabledReason` on `board:create` and `board:reindex` when true (the
  `busy` precedent on `board:reindex` shows the pattern already exists in this
  file). Add a palette-aware test in the "no folder open" describe block.

## Moderate Issues

### Issue 1: `_noWorkspace`'s doc comment overstates the guarantee

- **File**: `tasks-store.service.ts:432-451`
- The comment frames the flag as recording only "the host refused the last
  board read" — accurate — but the surrounding design narrative (and the
  report) leans on this being a stable, permanent-until-external-event
  condition. Failure Mode 2 shows a narrow case (refusal not reflected in a
  `workspaceInfo` change) where that is not quite true. Not blocking; a
  one-line acknowledgment would keep the comment honest for the next reader.

### Issue 2: Saved-views menu inconsistency (Failure Mode 3)

- Already covered above. Recommend tracking as a separate, later finding
  rather than pulling into this batch.

## Minor Issues

### Issue 1: `board:reindex`'s `disabledReason` reasoning is now incomplete

- **File**: `palette-entries.ts:434-441`
- Once Issue 1 (Serious) is fixed, the `disabledReason` ternary will need to
  check both `context.busy` and `context.noWorkspace` — flagging only so the
  fix doesn't miss the `busy` case while adding the new one.

## Data Flow Analysis

```
Host removeFolder / addFolder+switch
        │
        ▼
 WORKSPACE_CHANGED (Electron only; VSCodeService's own handler
        │            no-ops when path is falsy — a plain VS Code
        │            webview is single-root and never hits this
        │            live-removal path, per ElectronLayoutService's
        │            own comment, so that asymmetry is not a bug here)
        ▼
 ElectronLayoutService.syncFromBackend(null)
        │  folders.length === 0 → appState.setWorkspaceInfo(null)   [RELEASE / LATCH source]
        │  folders.length > 0  → coordinateWorkspaceSwitch → setWorkspaceInfo({path,...})
        ▼
 AppStateManager.workspaceInfo (signal)
        │  read by TasksStore.activeRoot()/activeKey() ONLY
        ▼
 TasksStore.setupWorkspaceSwitch() effect — activeKey() changed?
        │  yes → onWorkspaceSwitch(key): _error=null, _noWorkspace=false,  ← RELEASE
        │        closeTask/clearSelection, fetchBoard(key, root)
        ▼
 TasksStore.fetchBoard()
        │  success            → _noWorkspace=false, _error=null           ← RELEASE
        │  errorCode===WNO    → _noWorkspace=true,  _error=null           ← LATCH
        │  other failure      → _noWorkspace=false, _error=<message>
        ▼
 setupVisibilityReconcile(): focus/visibilitychange
        │  _noWorkspace() true → return (NEW GUARD — the whole fix)
        │  _noWorkspace() false, generic error → void loadBoard() (retries)
        ▼
 tasks-view.component.ts template
        │  loading&&!loaded → spinner
        │  noWorkspace()    → third state, NO create CTA, "Check again" (loadBoard())
        │  isEmpty()        → create-CTA empty state (excludes noWorkspace by construction)
        │  else             → board / filteredEmpty
        │
        ├─ Header buttons (Registry/Sweep/Reindex/New Task): [disabled]="…||noWorkspace()"  ✓ gated
        └─ Command Palette "Create a task" / "Reindex…": NOT gated on noWorkspace()          ✗ GAP
```

### Gap Points Identified

1. The Command Palette path (bottom-right of the diagram) is the one edge that
   does not route through the `noWorkspace()` gate applied everywhere else on
   the screen — see Serious Issue 1.
2. The release path depends entirely on some external event moving
   `workspaceInfo`. If a refusal is ever returned without such a push (Failure
   Mode 2), the only release is the manual "Check again" button — by design,
   but worth knowing it's a manual-only path in that narrow case.

## Requirements Fulfillment

| Requirement                                                                                 | Status   | Concern                                                                                                                              |
| ------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `tasks:board` called at most once with no folder open, focus/visibilitychange buy no more   | COMPLETE | Verified by execution (mechanically reverted the guard, reproduced the pre-fix failure, restored, reconfirmed green)                 |
| `WORKSPACE_NOT_OPEN` recognized specifically; generic failure still surfaces as an error    | COMPLETE | Traced the full `RpcUserError → RpcResult.errorCode` chain; confirmed real, not assumed                                              |
| Workspace state read from existing `AppStateManager.workspaceInfo`; no new workspace signal | COMPLETE | `_noWorkspace` is a fetch-outcome signal, not a workspace signal; `activeRoot`/`activeKey` unchanged                                 |
| Folder opened → board loads without manual refresh                                          | COMPLETE | Verified by store test and by tracing `onWorkspaceSwitch`                                                                            |
| No backend lib import                                                                       | COMPLETE | Only `@ptah-extension/{core,shared,ui}` imports present                                                                              |
| Three distinct, visually distinguishable states; no create CTA in no-workspace state        | PARTIAL  | True of the no-workspace _block_ in isolation; false of "the whole screen" once the Command Palette is counted — see Serious Issue 1 |
| `OnPush`, signals + `inject()`                                                              | COMPLETE | Unchanged decorator, no new DI pattern introduced                                                                                    |
| `data-testid` on the new block                                                              | COMPLETE | `tasks-no-workspace` / `tasks-no-workspace-retry`, matching convention                                                               |

### Implicit Requirements NOT Addressed

1. Any surface that can reach a `tasks:*` write RPC should be disabled while
   `noWorkspace()` holds — the header buttons honor this, the palette does not.
2. No test exercises the palette in the "no folder open" state, so this gap
   shipped with 571 passing tests and would have shipped to review undetected
   without independently reading `palette-entries.ts`.

## Edge Case Analysis

| Edge Case                                                     | Handled | How                                                                | Concern                                                                  |
| ------------------------------------------------------------- | ------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Focus/visibilitychange spam while no folder open              | YES     | `_noWorkspace()` guard in `setupVisibilityReconcile`               | None — verified by reverting the guard and reproducing the pre-fix count |
| Generic RPC failure (timeout/scan crash) while no folder open | YES     | `errorCode` exact-match; falls to `_error` branch, stays retryable | None — verified by store test (2 calls after 1 focus)                    |
| Folder opened after being closed                              | YES     | `onWorkspaceSwitch` clears `_noWorkspace`, fetches fresh           | None                                                                     |
| Folder closed again after being open                          | YES     | Re-latches; verified by dedicated store test                       | None                                                                     |
| Command Palette create/reindex while no folder open           | NO      | Not gated at all                                                   | Serious Issue 1                                                          |
| Saved-views menu while no folder open                         | PARTIAL | Shows raw error text, doesn't loop                                 | Moderate Issue 2, acceptable as a separate follow-up                     |
| Transient refusal without a `workspaceInfo` push              | PARTIAL | Manual "Check again" is the only recovery                          | Failure Mode 2, low probability, acceptable trade-off                    |

## Integration Risk Assessment

| Integration                                    | Failure Probability                           | Impact                                                                                        | Mitigation                                                                    |
| ---------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `TasksStore` ↔ `AppStateManager.workspaceInfo` | LOW                                           | Latch/release depends on this signal moving; Electron pushes it reliably on add/remove/switch | Existing (unchanged) push wiring, verified by reading `ElectronLayoutService` |
| `TasksStore` ↔ Command Palette                 | HIGH (certain, on every no-workspace session) | Re-exposes the fixed banner via an always-enabled control                                     | Needs the fix in Serious Issue 1                                              |
| `TasksStore` ↔ `TaskViewsService`              | LOW                                           | Cosmetic inconsistency only, no loop                                                          | Acceptable as a separate finding                                              |

## Verdict

**Recommendation**: REVISE
**Confidence**: HIGH
**Top Risk**: The Command Palette's "Create a task" and "Reindex the workspace
tasks" entries are unconditionally enabled and undo the exact UX fix Task 3.2
was written to deliver, reachable from the very control (`Ctrl+K`, always
enabled) the report cites as evidence the fix is complete. This is a concrete,
100%-reproducible gap (no timing, no race), not a theoretical one, and it
directly contradicts an explicit acceptance criterion once read at screen scope
rather than block scope.

Everything else in this batch is solid: the design call to latch on the host's
typed refusal rather than derive from `workspaceInfo` is well-reasoned and its
release path was traced end-to-end and holds; the `_loaded`-on-error-path
non-change is correctly justified and tested; `errorCode` propagation was
verified against real source rather than assumed; the store/template mutual
exclusivity is real; and the named regression test was mechanically confirmed
to fail-before/pass-after exactly as claimed, with the "6, not 11" explanation
independently reproduced.

## What Robust Implementation Would Include

- A single source of truth for "can this surface write into `.ptah/specs` right
  now" that both the header buttons and the palette catalogue read from, so a
  future third entry point (a keyboard shortcut, a context-menu item) cannot
  reopen the same gap by construction.
- A component test that opens the palette specifically inside the "no folder
  open" describe block and asserts the create/reindex entries carry a
  `disabledReason`, closing the coverage hole that let this ship.
- A narrower framing in the `_noWorkspace` doc comment / report language:
  "no create affordance" claims should say which surfaces were checked, given
  how easy it is for a keyboard-driven command surface to be forgotten.

---

## Re-review after revision

**Scope of this pass**: the six changed files in the revision (`tasks-store.service.ts`,
`palette-entries.ts` + its new spec, `tasks-view.component.ts` + its spec; the
store spec is unchanged this round). Verified against source, not against the
report's prose, and re-verified by execution wherever a claim was checkable —
full suite, lint, typecheck, two independent fail-before/pass-after reversions
(the exhaustiveness claim and the new component test), and a manual trace of
`TaskViewsService.applyView()`.

**Housekeeping note, unrelated to the verdict**: mid-review a `git checkout --`
issued to discard a scratch verification test accidentally reverted
`palette-entries.spec.ts` all the way to its pre-batch `HEAD` version (the file
predates this task, so `checkout` did not no-op the way it would have on a
genuinely new file). This was caught immediately by comparing `git diff --stat`
against the report's claimed 6-file/691-line shape, and the developer's content
was restored verbatim from this session's own earlier `Read` of the file before
any scratch edits were made. Re-ran the full suite afterward (578/578 green)
and diffed against the original stat to confirm byte-for-byte parity before
continuing. Flagged here only for the record; it does not reflect on the
developer's work and is not a finding about the code.

### 1. Is `canWriteSpecs` genuinely the single gate?

**Confirmed, at the plumbing level.** All four header buttons now read
`!store.canWriteSpecs()` exclusively (`tasks-view.component.ts:216, 230, 243,
259`) — no button retains an independent `store.noWorkspace()` check, so there
is no drift risk between two copies of the same condition on the header side.
`TaskPaletteContext.canWriteSpecs` is populated once, from the same store
signal, in the `paletteEntries` computed (`tasks-view.component.ts:960`).
`canWriteSpecs = computed(() => !this._noWorkspace())` (`tasks-store.service.ts`)
introduces no second `_noWorkspace`-adjacent state; it is a pure derivation.

**Not confirmed, at the classification level** — see item 4/Serious Issue 2
below. The signal is unified; what is applied to it in the palette is not
uniformly correct.

### 2. Does the exhaustive `Record` actually fail closed?

**Verified independently, not just re-asserted.** Removed `reindex: true` from
`ACTION_WRITES_SPECS` and ran `npx tsc --noEmit -p libs/frontend/tasks-ui/tsconfig.lib.json`:

```
error TS2741: Property 'reindex' is missing in type '{ openTask: false; ... }'
but required in type 'Record<"reindex" | "openTask" | ... , boolean>'.
```

Restored, typecheck clean again. The structural claim holds exactly as stated:
`Record<TaskPaletteAction['kind'], boolean>` over the full 10-member union
(`openTask, applyView, setStatus, setLabels, bulkSetStatus, createTask,
setFilter, clearFilter, openExclusions, reindex`) means a 12th action added to
the union without a corresponding key is a compile error, not a silent gap.

**But exhaustiveness over _kinds_ is not the same guarantee as correctness of
_classification_.** The map catches "you forgot to mention this kind" — it
cannot catch "you mentioned it and got it wrong." That is exactly what happened
with `applyView` (Serious Issue 2). The next reader trusting "the Record makes
this unreopenable" would be trusting a narrower guarantee than the sentence
implies.

### 3. `board:reindex` honoring `busy`

**Confirmed both are checked, and confirmed by execution via the existing
tests** (not re-derived from scratch): `disables reindex while the board is
busy` (`busy: true` alone → "already running"), `says the ROOT reason rather
than a downstream one` (`canWriteSpecs: false, busy: true` → "No folder is
open"), and `leaves the busy reason in place when a folder IS open`
(`busy: true, canWriteSpecs: true` → "already running" survives). All three
ran green in the full suite. Minor Issue 1 from the first review is resolved.

### 4. The 11 entry points — spot-checked, and one is wrong

The enumeration table is thorough and every row I checked against source
(`tasks:board`, `tasks:create`, `tasks:reindex`, `tasks:generateRegistry`,
`tasks:sweepFinished`, `tasks:updateMetadata`, `tasks:bulkUpdateStatus/Label`,
`tasks:get`, `tasks:getArtifact`, `tasks:getViews`) checks out — including the
"board is empty so `context.tasks` is `[]`" premise several rows lean on: I
traced `onWorkspaceSwitch` → `resetVisibleForLoading()` → `_columns.set(emptyColumns())`
(`tasks-store.service.ts:2429-2430`) and confirmed `allTasks()` is computed off
`_columns()`, so that premise is correct for `TasksStore`'s own state.

**One row is wrong: `tasks:saveViews`.** The table says it is reached only
"[through the] Saved-views menu, which the template renders only behind
`@if (store.totalIndexed() > 0)`" and is therefore "Unreachable." That is true
of the header's saved-views dropdown, but **`TaskViewsService.applyView()`
(`task-views.service.ts:321-329`) unconditionally calls
`await this.persist(this._views(), view.id)` after applying the lens locally**,
and `persist()` (`:508-522`) calls `this.rpc.call('tasks:saveViews', { views,
activeViewId, ...this.workspaceParam() })` — a genuine write that the backend
routes through the same `resolveRoot` (`tasks-rpc.handlers.ts:378`) and refuses
with `WORKSPACE_NOT_OPEN` under the same conditions as every other `tasks:*`
write.

The palette's `applyView` action reaches exactly this path, and
`ACTION_WRITES_SPECS.applyView` is `false` — classified as a read, alongside
the comment "so do the filter, exclusions and saved-view entries, which touch
nothing but local UI state" (`palette-entries.ts:198-199`). That comment is the
tell: it states the same incorrect premise the classification encodes. See
Serious Issue 2 for the reproduction and the mechanism that makes it reachable
in the ordinary flow, not an exotic one.

Everything else in the table is accurate; this is the one row I would send
back.

### 5. Moderate Issue 1 — `_noWorkspace` doc comment

**Confirmed, and it is honest.** The new `## The trade this makes, stated
plainly` section (`tasks-store.service.ts`, on `_noWorkspace`) states outright
that release depends on an external `workspaceInfo` change or a later
successful fetch; that a refusal arriving without a matching `workspaceInfo`
change leaves recovery to "Check again" only; and closes with "Do not 'fix' it
by re-arming the reconcile — that is the defect," pre-empting exactly the wrong
fix a future reader might reach for. This resolves the finding as asked.

### 6. No regression in what was already approved

**Confirmed by source diff and by execution.** `_noWorkspace`'s own state
machine (`fetchBoard`'s three-way branch, `onWorkspaceSwitch`'s release,
`setupVisibilityReconcile`'s guard) is textually unchanged from the version
already approved — the revision only adds `canWriteSpecs` as a computed
derivation and wires it into two new places. `fetchBoard` was not touched, so
it does not block on `canWriteSpecs`, and nothing new can make the state
unrecoverable: `loadBoard()` (used by "Check again" and by `onWorkspaceSwitch`)
is not gated by `canWriteSpecs` anywhere — only the four header buttons and the
palette's write-kind entries are, and none of those is a recovery path. Full
suite is green (578/578, up from 571 — all 7 new tests are additive), lint is
clean at the same 3 pre-existing `max-lines` warnings, typecheck is clean.

### 7. Did the fix reach beyond `libs/frontend/tasks-ui/`?

**Confirmed it did not.** `git diff --stat` for this revision shows exactly the
6 files the report lists, all under `libs/frontend/tasks-ui/`, matching the
report's own numbers line for line (92/68/153/76/181/127 insertions, 691 total,
6 deletions). The working tree's other ~35 modified files are Batch 1/2 backend
work and unrelated pre-existing edits (`agent-sdk`, `memory-curator`,
`vscode-lm-tools`, `harness-sync`, `rpc-handlers`, `libs/shared`, a few
`chat*`/`core` frontend files) — none of it touched by this batch, as required.

## Re-review Summary

| Metric                                                            | Value                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| Original Serious Issue (palette bypass on `createTask`/`reindex`) | **RESOLVED** — verified structurally and by execution               |
| New issue found this pass                                         | 1 Serious (`applyView` → `tasks:saveViews` misclassified as a read) |
| Moderate Issue 1 (doc comment)                                    | RESOLVED                                                            |
| Minor Issue 1 (`busy` vs. no-workspace priority)                  | RESOLVED                                                            |
| Regression in previously-approved behavior                        | NONE FOUND                                                          |
| Scope creep outside `libs/frontend/tasks-ui/`                     | NONE FOUND                                                          |

### Serious Issue 2 (new): `applyView` reaches `tasks:saveViews` ungated

- **File**: `libs/frontend/tasks-ui/src/lib/components/palette/palette-entries.ts:201-212`
  (`ACTION_WRITES_SPECS`), `:198-199` (the comment asserting the wrong premise);
  `libs/frontend/tasks-ui/src/lib/services/task-views.service.ts:321-329` (`applyView`),
  `:508-522` (`persist` → `tasks:saveViews`)
- **Scenario**: Folder A is open; the Tasks view is mounted and
  `TaskViewsService.load()` succeeds at least once, so `_views()` holds one or
  more saved views (ordinary usage — this is not a cold-start-only bug). The
  user removes folder A (or otherwise ends up with no folder open) without the
  `TasksViewComponent` being destroyed — the same "still on the Tasks tab when
  the folder goes away" flow the whole task is about. `_views()` is never
  cleared or reloaded on a workspace change (no effect/subscription in
  `TaskViewsService` analogous to `TasksStore.onWorkspaceSwitch`), so the
  palette still lists the stale `view:<id>` entries.
- **Reproduced empirically** (scratch assertion, reverted before finishing):
  `buildPaletteEntries(context({ canWriteSpecs: false, views: [view('v1', 'Mine')] }))`
  → `byId(entries, 'view:v1').disabledReason` is `null`. The entry is fully
  enabled.
- **Impact**: Clicking "Apply view: …" dispatches `applyView` →
  `TaskViewsService.applyView()` → applies the filter/sort locally (harmless)
  → unconditionally awaits `persist()` → `tasks:saveViews` with
  `workspaceParam()` empty (no folder) → host's `resolveRoot(undefined)` throws
  `WORKSPACE_NOT_OPEN` → `TaskViewsService._error` is set to the raw
  `'No workspace folder open.'` string, rendered in the saved-views menu
  (`[error]="views.error()"`, `tasks-view.component.ts:317`). Lower visual
  impact than the original bug (it surfaces in the views menu, not the main
  board's `.alert-error`), but it is a real, reachable `tasks:*` write attempt
  against a namespace the whole batch exists to stop writing into, through an
  entry the new gate was specifically built to close off, misclassified by the
  one piece of code whose entire job was that classification.
- **Why this survived the revision's own test additions**: the new
  `palette-entries.spec.ts` describe block never adds a `views` entry to any
  `canWriteSpecs: false` context, and the new component test's mock always
  resolves `tasks:getViews` to `{ views: [], ... }`, so `_views()` is empty in
  every test that exercises the gate. The gap is invisible to both new test
  files for the same reason it was invisible to the implementation: nobody
  asked what `applyView` actually does downstream.
- **Fix**: Set `applyView: true` in `ACTION_WRITES_SPECS`. This is a one-line,
  narrowly-scoped correction — it does not require restructuring the gate, and
  it does not regress anything: applying a lens to a board that is confirmed
  empty (no workspace) has nothing to filter anyway. Add a
  `palette-entries.spec.ts` case with `views: [...]` under
  `canWriteSpecs: false` asserting `view:<id>` is disabled-with-reason, and a
  component-level case (pre-seed `TaskViewsService`'s views before the folder
  is removed, or provide a stub with a non-empty `views()`) so the fix is
  pinned at both levels the original bypass was.

## Verdict (revision)

**Recommendation**: STILL NEEDS REVISION
**Confidence**: HIGH
**Top Risk**: The exhaustive `Record` genuinely closes the "forgotten kind"
failure mode it was built for (verified by reverting it and watching the build
break), and the header/palette signal is now genuinely unified. But the gate's
correctness still depends on a human classifying each kind by hand, and one
existing kind — `applyView` — was classified wrong, with a code comment
asserting the very premise ("touches nothing but local UI state") that turns
out to be false once `persist()` is read. The structural claim in the report is
real but narrower than stated; per the coordinator's framing, a gate that looks
unified but has a wrong entry is worse than two honest ternaries, because nothing
here will make the next reader suspect `applyView` needs a second look — the
`Record` compiles, the tests pass, and the wrong classification looks exactly
like a right one.

Everything else re-checked in this pass holds: the original Serious Issue
(`createTask`/`reindex` palette bypass) is fixed and independently reproduced
fail-before/pass-after; `busy` vs. no-workspace priority is correct and tested
both ways; the `_noWorkspace` doc comment honestly states the manual-recovery
trade-off; there is no regression in the previously-approved latch/release
design; and the revision touches only the six files it claims to, all inside
`libs/frontend/tasks-ui/`.

---

## Second re-review

**Scope**: the same six `libs/frontend/tasks-ui/` files, this round's diff only
(`applyView: true`, the evidence table + warning comment on `ACTION_WRITES_SPECS`,
and three new tests: 578 → 581). Per the coordinator's framing, the
classification table was treated as guilty until independently checked — every
row was re-derived from source myself rather than read off the developer's
table, and every executable claim was re-run.

### 1. Audit of the evidence table, kind by kind (independent, from source)

Traced all ten `TaskPaletteAction['kind']` values myself, not from the report's
table:

| kind             | traced to                                                                                                                                                                                                         | verdict                                                                                                                                                                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openTask`       | `TasksStore.openTask` (`:1081`) → `rpc.call('tasks:get', …)` (`:1091`)                                                                                                                                            | read — `false` correct                                                                                                                                                                                                                                                                                            |
| `applyView`      | `TaskViewsService.applyView` (`:321`) → local `setFilter`/`setSort`, then **unconditional** `await this.persist(...)` (`:328`) → `persist` (`:508`) → `rpc.call('tasks:saveViews', …)` (`:518`)                   | write — `true` correct (was the defect; now fixed)                                                                                                                                                                                                                                                                |
| `setStatus`      | `TasksStore.updateStatus` (`:1403`) → `applyMetadata` (`:1404`) → `writeMetadata` → `rpc.call('tasks:updateMetadata', …)`                                                                                         | write — `true` correct                                                                                                                                                                                                                                                                                            |
| `setLabels`      | `TasksStore.applyMetadata` (`:1325`) → same `writeMetadata` → `tasks:updateMetadata`                                                                                                                              | write — `true` correct                                                                                                                                                                                                                                                                                            |
| `bulkSetStatus`  | `TasksStore.requestBulkStatus` (`:1633`) → `requestBulk` (`:1622`) → at/below `BULK_CONFIRM_THRESHOLD`, `runBulk` → `rpc.call('tasks:bulkUpdateStatus', …)` (`:1827`)                                             | write — `true` correct. (Selection is guaranteed empty with no workspace: `onWorkspaceSwitch` calls `clearSelection()` unconditionally, unlike `TaskViewsService._views`, which nothing clears — so this kind has no `applyView`-shaped staleness hole even though it shares the "defers past a threshold" shape) |
| `createTask`     | component's `openCreate` (`:1128`) → sets local signals, opens the modal; submit → `TasksStore.createTask` (`:1408`) → `rpc.call('tasks:create', …)` (`:1412`)                                                    | write on the opened flow — `true` correct                                                                                                                                                                                                                                                                         |
| `setFilter`      | `TasksStore.setFilter` (`:1490`) → `this._filter.set(filter)` only                                                                                                                                                | no RPC — `false` correct                                                                                                                                                                                                                                                                                          |
| `clearFilter`    | `TasksStore.clearFilter` (`:1495`) → `this._filter.set(EMPTY_TASK_FILTER)` only                                                                                                                                   | no RPC — `false` correct                                                                                                                                                                                                                                                                                          |
| `openExclusions` | component's `openExclusions` (`:1140`) → `this.exclusionsOpen.set(true)`; the drawer reads `store.excludedFolders()`, a `computed()` over data the last successful `tasks:board` already carried — no RPC on open | no RPC — `false` correct                                                                                                                                                                                                                                                                                          |
| `reindex`        | `TasksStore.reindex` (`:1429`) → `rpc.call('tasks:reindex', …)` (`:1434`)                                                                                                                                         | write — `true` correct                                                                                                                                                                                                                                                                                            |

**No new misclassification found.** All ten values in `ACTION_WRITES_SPECS`
match what their dispatch chain actually does. `bulkSetStatus` got the closest
look for the same shape of trap that caught `applyView` (a two-step dispatch
where the write is not in the arm you land on first), and it does not have the
`applyView` problem because `TasksStore` clears its own state
(`clearSelection()`) on every workspace switch, while `TaskViewsService` clears
nothing — that asymmetry between the two services, not anything about the
`Record`, is the actual root cause of the original miss, and it does not recur
elsewhere in the ten.

### 2. Ten versus eleven — reconciled

These are two different denominators over two different domains, not two counts
of the same thing, and nothing went missing between them:

- **11** (first revision) = every `tasks:*` **RPC method/entry-point reachable
  from the WHOLE Tasks surface** — header buttons, card/row clicks, the detail
  panel, the bulk bar, the saved-views menu, the palette, and `TaskViewsService`'s
  init call. `tasks:board`, `tasks:create`, `tasks:reindex`,
  `tasks:generateRegistry`, `tasks:sweepFinished`, `tasks:updateMetadata`,
  `tasks:bulkUpdateStatus`/`tasks:bulkUpdateLabel` (one row), `tasks:get`,
  `tasks:getArtifact`, `tasks:saveViews`, `tasks:getViews`.
- **10** (this revision) = every discriminated **action kind in the Command
  Palette's own `TaskPaletteAction` union** specifically — the denominator that
  actually matters for `ACTION_WRITES_SPECS`'s exhaustiveness claim, since that
  map only needs to cover what the palette itself can dispatch.

Mapping one onto the other: of the 11 RPC rows, 6 are reachable through the
palette (`tasks:get`, `tasks:saveViews`, `tasks:updateMetadata` — reached by
both `setStatus` and `setLabels`, `tasks:bulkUpdateStatus`, `tasks:create`,
`tasks:reindex`), which is why 10 kinds classify only 6 distinct RPC targets
(three local-only kinds — `setFilter`, `clearFilter`, `openExclusions` — reach
no RPC at all and correctly classify `false`). The remaining 5 RPC rows
(`tasks:board`, `tasks:generateRegistry`, `tasks:sweepFinished`,
`tasks:getArtifact`, `tasks:getViews`) have **no corresponding palette action
kind at all** — there is no `TaskPaletteAction` variant for "regenerate the
registry" or "open the exclusions... no, wait, `openExclusions` exists but
reads local data" or "read a workflow artifact" — so they cannot be
misclassified by this map because they are not dispatch targets of it; each is
governed by its own surface instead (the header buttons via `canWriteSpecs`
directly, the detail panel by being unreachable with an empty board,
`tasks:getViews` by the coordinator's explicit out-of-scope ruling). Nothing is
unaccounted for on either side of the 10/11 split.

### 3. Do the new tests actually pin it?

**Yes, verified by execution, not by reading the assertions.** Reverted
`applyView` to `false` and re-ran:

```
FAIL … buildPaletteEntries › … › disables a STALE saved view left over from a closed folder
  Received has value: null
FAIL … TasksViewComponent › no folder open › disables a stale saved view in the palette, and clicking it writes nothing
  Expected: "task-palette-option-disabled"
  Received: "task-palette-option"
Tests: 2 failed, 578 skipped, 1 passed, 581 total
```

— matching the report's own numbers exactly (the companion "leaves saved views
runnable while a folder IS open" correctly still passes, since it does not
depend on the value under test). Restored `applyView: true`; full suite green
again (581/581), lint clean (0 errors, same 3 pre-existing `max-lines`
warnings), typecheck clean.

The two catalogue-level tests construct a genuinely stale scenario
(`canWriteSpecs: false` **with** `views: [view('v1', 'Mine')]`) and assert a
**non-null, specific** `disabledReason` (`toContain('No folder is open')`), not
merely `not.toBeNull()` — so a future regression that disables the entry for
the wrong reason would also be caught. The strengthened "disables EVERY
write-capable entry" test does not import `ACTION_WRITES_SPECS` (confirmed by
reading the spec file's imports — only `EMPTY_PALETTE_CONTEXT`,
`buildPaletteEntries`, and the two types are imported), so it cannot pass by
agreeing with the map it is checking; it also asserts up front that each write
kind in its hand-authored set actually produced an entry in the fixture, so it
cannot pass by silently omitting one the way the pre-revision version omitted
`applyView`. The component-level test seeds `TaskViewsService` with a real
stale view via the `tasks:getViews` mock, opens the actual palette through the
actual trigger button, finds the actual rendered option by label, clicks it,
and asserts `tasks:saveViews` was never called — an end-to-end pin, not just a
unit assertion on the catalogue.

### 4. Regression check on everything previously approved

**None found.** `tasks-store.service.ts` and `tasks-store.service.spec.ts` are
byte-identical to the already-approved round (same 127/181-line diffs; `git
diff` shows no further changes to either file this pass). Specifically
re-confirmed: the `errorCode === 'WORKSPACE_NOT_OPEN'` exact match is untouched
(`tasks-store.service.ts:2260`); the `busy`-vs-no-workspace priority tests
(`board:reindex` reason ordering) are unchanged and still pass; the
`_noWorkspace` doc comment's "trade this makes, stated plainly" section is
unchanged; the latch/release design (`onWorkspaceSwitch`, `fetchBoard`,
`setupVisibilityReconcile`) is untouched. `git status` outside
`libs/frontend/tasks-ui/` shows only other batches' concurrent work
(`agent-sdk`, `harness-sync`, the held-back `memory-curator`/`memory-rpc.handlers.ts`
Task 2.3, and unrelated `chat*`/`core` edits) — none of it touched by this
revision, confirming zero scope creep for a third consecutive round.

## Second Re-review Summary

| Metric                                                | Value                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `applyView` misclassification (prior Serious Issue 2) | RESOLVED — fixed, tested at both levels, fail-before/pass-after independently reproduced                           |
| New defect found this pass                            | NONE — all ten kinds independently re-derived from source and confirmed correct                                    |
| 10 vs. 11 discrepancy                                 | RECONCILED — different denominators (palette action kinds vs. whole-surface RPC entry points), no gap between them |
| Regression in previously-approved work                | NONE FOUND                                                                                                         |
| Scope creep outside `libs/frontend/tasks-ui/`         | NONE FOUND                                                                                                         |

## Verdict (second re-review)

**Recommendation**: APPROVE
**Confidence**: HIGH

Three passes, two real defects found and fixed, and this pass found no third.
The gate is now: one signal (`TasksStore.canWriteSpecs`) read identically by
the header and the palette; an exhaustive `Record` over the palette's action
union verified (again, independently) to fail the build on an unlisted kind;
every one of the ten existing kinds re-traced to source and confirmed correct,
including the one (`bulkSetStatus`) that shares the two-step-dispatch shape
that caused the `applyView` miss, which turns out not to share the underlying
cause (`TasksStore` clears its own state on workspace switch; `TaskViewsService`
does not — that asymmetry, not the `Record`, was the real root cause); a
comment on the map that states its own limits honestly, with the `applyView`
incident as the worked example of exactly how a wrong value would look right;
and tests that construct the actual stale-data scenario rather than the map's
own idea of what write kinds exist. This is approved.
