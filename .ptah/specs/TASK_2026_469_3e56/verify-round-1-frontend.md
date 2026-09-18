# Verification Round 1 — Frontend (`TASK_2026_469_3e56`)

## Verdict

**REVISE**

All 10 round-1 fixes have been implemented in the source files and have corresponding passing unit tests. However, the implementations introduced multiple new defects—including premature `isLoading` resets across workspace switches, focus stealing on primary button clicks, stale drop confirmations across workspace switches in `linkedSignal`, and stuck loading signals when generation or selection checks return early.

---

## Item Verification Table

| #   | Reported Fix                                                                                                                                             | Status       | Source Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Test Evidence & Real Assertion Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Sync actions capture initiating workspace and only publish/refresh while active                                                                          | **VERIFIED** | [`git-dock-header.component.ts:250-265`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts#L250-L265): captures `workspace`, checks `activeWorkspacePath() !== workspace` before publishing status and calling `refresh()`.                                                                                                                                                                                               | **Real assertion.** [`git-dock-header.component.spec.ts:243-259`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.spec.ts#L243-L259): switches workspace to `/ws/b` while pull is in flight; verifies `gitStatus.refresh` was not called and text does not contain `'Pull completed.'`.                                                                                                                                                                               |
| 2   | `fetchGitInfo()` uses `try/catch/finally`; loading clears and `refresh()` does not reject                                                                | **VERIFIED** | [`git-status.service.ts:326-358`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-status.service.ts#L326-L358): wraps `rpcCall` in `try/catch/finally`, resetting `_isLoading.set(false)` in `finally`. Exposes `refresh(): Promise<void>`.                                                                                                                                                                                                      | **Real assertion.** [`git-status.service.spec.ts:278-287, 289-304`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-status.service.spec.ts#L278-L304): asserts `refresh()` resolves on rejection and clears `isLoading`; asserts stale refresh completion also clears loading.                                                                                                                                                                                                              |
| 3   | Successful stash mutations return Git outcome when reconciliation rejects, surfacing completed-but-refresh-failed error                                  | **VERIFIED** | [`git-stash.service.ts:287-303`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.ts#L287-L303): awaits `Promise.allSettled`, patches error message if any refresh rejects or `loadListFor` returns false, while returning original `outcome`.                                                                                                                                                                                      | **Real assertion.** [`git-stash.service.spec.ts:191-207`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.spec.ts#L191-L207): rejects `gitBranches.refreshForCauses`, verifies `mutate` resolves with `{ success: true }` and `service.error()` is `'Stash apply completed, but the view could not refresh.'`.                                                                                                                                                                |
| 4   | Stash-list responses ordered by per-workspace generation; mutations invalidate older reads; identity-mismatch reloads list                               | **VERIFIED** | [`git-stash.service.ts:116-163, 236, 283-286`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.ts#L116-L163): uses `listGenerations` map, bumps generation in `mutate`, and reloads list if `outcome.error === STASH_LIST_CHANGED_ERROR`.                                                                                                                                                                                          | **Real assertion.** [`git-stash.service.spec.ts:111-125, 209-222, 350-365`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.spec.ts#L111-L125): asserts out-of-order list responses preserve latest; asserts pre-mutation list response discarded; asserts identity error triggers list reload.                                                                                                                                                                               |
| 5   | Stash show/apply/pop/drop carry `expectedHash`; historical refs use full hash; selection/interaction generations rechecked; busy state disables controls | **VERIFIED** | [`git-stash.service.ts:200, 252, 369-370, 322, 335`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.ts#L200), [`stash-popover.component.ts:78, 104, 122, 132, 142, 162`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts#L78): passes `expectedHash: entry.hash`; resolves `${entry.hash}^1`; verifies `isSelectionCurrent`; disables controls with `[disabled]="stash.busy()"`. | **Real assertion.** [`git-stash.service.spec.ts:224-288, 290-319, 321-348`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.spec.ts#L224-L288), [`stash-popover.component.spec.ts:115-123`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/stash/stash-popover.component.spec.ts#L115-L123): checks full hash in RPCs and tab provenance; asserts diff opening aborted on selection change or mutation start; asserts entries and files disabled while busy. |
| 6   | Historical tabs use stash message plus first seven hash characters                                                                                       | **VERIFIED** | [`git-stash.service.ts:392-400`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.ts#L392-L400): constructs `label = \`${entry.message} · ${shortHash}\`` and `fileName: \`${fileName} (${label})\``.                                                                                                                                                                                                                               | **Real assertion.** [`git-stash.service.spec.ts:278`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.spec.ts#L278): explicitly asserts `tab.fileName` contains `'WIP on main: tidy · 0123456'`.                                                                                                                                                                                                                                                                              |
| 7   | Generation guard prevents late `settings:get` from replacing newer choice; `choose()` restores caret focus                                               | **VERIFIED** | [`open-in-button.component.ts:201, 204, 216, 225`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts#L201): increments `choiceGeneration` in `choose()`; checks `generation === this.choiceGeneration` before applying setting; calls `this.caret()?.nativeElement.focus()`.                                                                                                                                                | **Real assertion.** [`open-in-button.component.spec.ts:202-232`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/open-in/open-in-button.component.spec.ts#L202-L232): user choice made while `settings:get` is pending is preserved, and `document.activeElement` is `caret`.                                                                                                                                                                                                                            |
| 8   | Drop confirmation is a `linkedSignal` reset by `isOpen`; effect only loads list                                                                          | **VERIFIED** | [`stash-popover.component.ts:191-200`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts#L191-L200): declares `confirmDrop = linkedSignal({ source: this.isOpen, computation: () => null })`. Constructor `effect` only executes `void this.stash.loadList()`.                                                                                                                                                                 | **Real assertion.** [`stash-popover.component.spec.ts:125-136`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/stash/stash-popover.component.spec.ts#L125-L136): confirms inline drop button opens, and toggling `isOpen` from `false` to `true` resets confirmation to null.                                                                                                                                                                                                                           |
| 9   | Apply, Pop, Drop, and confirm Drop expose contextual stash-ref labels                                                                                    | **VERIFIED** | [`stash-popover.component.ts:105, 123, 133, 143`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts#L105): binds `'Apply ' + stashRef(entry)`, `'Pop ' + stashRef(entry)`, `'Drop ' + stashRef(entry)`, `'Confirm drop ' + stashRef(entry)`.                                                                                                                                                                                   | **Real assertion.** [`stash-popover.component.spec.ts:100-113`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/stash/stash-popover.component.spec.ts#L100-L113): checks all 4 buttons have expected `aria-label` attributes targeting `stash@{0}`.                                                                                                                                                                                                                                                      |
| 10  | Zero-count Pull/Push controls announce plain “Pull”/“Push”                                                                                               | **VERIFIED** | [`git-dock-header.component.ts:165-169, 185-189`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts#L165-L169): conditionally omits count when `behind` or `ahead` is zero.                                                                                                                                                                                                                                               | **Real assertion.** [`git-dock-header.component.spec.ts:183-213`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.spec.ts#L183-L213): asserts `git-pull-button` and `git-push-button` have `aria-label` equal to `'Pull'` and `'Push'` when counts are 0.                                                                                                                                                                                                             |

---

## New Defects Introduced by Round 1 Fixes

### 1. Stale `fetchGitInfo()` completion races with and clears `isLoading` for newer workspace fetch

- Severity: **Serious**
- File: [`libs/frontend/git-ui/src/lib/services/git-status.service.ts:338, 356`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-status.service.ts#L338-L356)
- Scenario:
  1. Workspace `/ws/a` is active. An RPC `fetchGitInfo()` begins; `_isLoading.set(true)`.
  2. The user switches to `/ws/b` (`switchWorkspace('/ws/b')`). Because `/ws/b`'s cache is not fresh, `switchWorkspace` calls `fetchGitInfo()`, launching a second RPC for `/ws/b` and keeping `_isLoading` `true`.
  3. The `/ws/a` RPC settles before `/ws/b`. At line 338, `this._activeWorkspacePath() !== workspaceAtFetchTime` detects the switch and returns early without applying the stale data.
  4. However, the `finally` block at line 356 executes unconditionally: `this._isLoading.set(false)`.
  5. As a result, `isLoading()` flips to `false` for the entire service and visible UI while `/ws/b`'s `git:info` RPC is still in flight.
- Fix:
  Only clear `_isLoading` in `finally` if the completed fetch corresponds to the active workspace and no newer fetch is pending, or increment an internal fetch generation counter and only clear `_isLoading` if the counter matches:
  ```typescript
  finally {
    if (this._activeWorkspacePath() === workspaceAtFetchTime) {
      this._isLoading.set(false);
    }
  }
  ```

---

### 2. `choose()` steals DOM focus and forces it onto caret button when primary button or mouse is clicked

- Severity: **Serious**
- File: [`libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts:179, 204`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts#L179-L204)
- Scenario:
  1. In `OpenInButtonComponent`, `onPrimaryClick()` handles clicks on the primary button ("Open in VS Code") and directly delegates to `this.choose(target)` ([line 179](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts#L179)).
  2. In `choose(target)` ([line 204](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts#L204)), `this.caret()?.nativeElement.focus()` is called unconditionally.
  3. When a user clicks the primary button (which never opened the dropdown menu), focus is immediately yanked off the primary button and forced onto the adjacent caret button (`#caret`).
  4. Furthermore, when selecting an item in the dropdown menu via mouse click, calling `.focus()` forces a visible keyboard focus outline onto the caret button after a mouse interaction.
- Fix:
  Only restore caret focus if the dropdown menu was actually open prior to choice:
  ```typescript
  protected choose(target: EditorTarget): void {
    this.choiceGeneration += 1;
    this.storedTargetId.set(target.id);
    const wasMenuOpen = this.menuOpen();
    this.menuOpen.set(false);
    if (wasMenuOpen) {
      this.caret()?.nativeElement.focus();
    }
    void this.persistTarget(target.id);
    ...
  }
  ```

---

### 3. `confirmDrop` `linkedSignal` does not track workspace or stash entries, preserving confirmation on wrong stash

- Severity: **Serious**
- File: [`libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts:70, 96, 191-194`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts#L70-L194)
- Scenario:
  1. `confirmDrop` is declared as:
     ```typescript
     protected readonly confirmDrop = linkedSignal<boolean, number | null>({
       source: this.isOpen,
       computation: () => null,
     });
     ```
  2. It stores a numeric positional index (`entry.index`).
  3. The user opens the stash popover in workspace A (`isOpen() === true`) and clicks "Drop" on `stash@{0}`. `confirmDrop` is set to `0`.
  4. The user switches workspaces (or the stash list reloads/shifts in the background) while the popover remains open. Because `this.isOpen` did not change, `confirmDrop` remains `0`.
  5. At line 70, the list renders with `@for (entry of stash.entries(); track entry.index)`. Entry index `0` of the _new_ workspace matches `confirmDrop() === 0` ([line 96](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts#L96)).
  6. The UI now shows "Drop this stash permanently?" for the new repository's `stash@{0}`. Clicking "Drop" invokes `mutate('drop', entry)` on the wrong workspace's stash.
- Fix:
  Store the stash entry commit `hash` instead of numeric index, and include `this.stash.entries` and active workspace in the `linkedSignal` source:
  ```typescript
  protected readonly confirmDrop = linkedSignal<() => unknown, string | null>({
    source: () => [this.isOpen(), this.stash.entries()],
    computation: () => null,
  });
  ```
  And check `@if (confirmDrop() === entry.hash)`.

---

### 4. Early return in `select()` and `loadListFor()` leaves `filesLoading` and `listLoading` permanently stuck `true`

- Severity: **Serious**
- File: [`libs/frontend/git-ui/src/lib/services/git-stash.service.ts:125, 155, 177, 203, 214`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.ts#L125-L214)
- Scenario:
  1. In `select(entry)` ([line 190](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.ts#L190)), `this.patch(workspace, { ..., filesLoading: true, error: null })` is called.
  2. If the user clicks the selected entry again before `git:stashShow` completes, line 177 collapses the selection:
     ```typescript
     if (this.stateFor(workspace).selectedHash === entry.hash) {
       this.patch(workspace, { selectedIndex: null, selectedHash: null, files: [], refs: null });
       return;
     }
     ```
     Notice `filesLoading: false` is not set.
  3. When `git:stashShow` finishes, line 203 checks:
     ```typescript
     if (!this.isSelectionCurrent(workspace, entry, generation)) return;
     ```
     Because `selectedIndex` is null, `isSelectionCurrent` returns false, and `select()` returns immediately without ever clearing `filesLoading: false`.
  4. Similarly, if `mutate('apply', entry)` is invoked while `select()` is in flight, `mutate` bumps `interactionGenerations`. `isSelectionCurrent` fails and `select()` returns without clearing `filesLoading`. Because `apply` preserves selection on success ([line 274](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.ts#L274)), the stash popover shows "Loading files…" indefinitely.
  5. In `loadListFor()`, line 125 and line 155 also `return true` early without setting `listLoading: false` when superseded by another generation.
- Fix:
  Ensure `filesLoading: false` and `listLoading: false` are always reset in `finally` or whenever early-returning/collapsing.

---

### 5. `mutate()` re-patches `STASH_LIST_CHANGED_ERROR` over legitimate list reload failures

- Severity: **Moderate**
- File: [`libs/frontend/git-ui/src/lib/services/git-stash.service.ts:283-286`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.ts#L283-L286)
- Scenario:
  1. When a mutation returns `STASH_LIST_CHANGED_ERROR`, `mutate` attempts to reload the list:
     ```typescript
     if (outcome.error === STASH_LIST_CHANGED_ERROR) {
       await this.loadListFor(workspace);
       this.patch(workspace, { error: STASH_LIST_CHANGED_ERROR });
     }
     ```
  2. If `loadListFor` fails (e.g. backend transport error, git index lock), `loadListFor` records the actual error in `_states` ([line 150/159](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.ts#L150)).
  3. Line 285 immediately overwrites `error` with `STASH_LIST_CHANGED_ERROR` ("The stash list changed. Refresh and try again."), masking the fact that the reload failed and hiding the underlying failure from the user.
- Fix:
  Only restore `STASH_LIST_CHANGED_ERROR` if `loadListFor` succeeded:
  ```typescript
  if (outcome.error === STASH_LIST_CHANGED_ERROR) {
    const reloaded = await this.loadListFor(workspace);
    if (reloaded) {
      this.patch(workspace, { error: STASH_LIST_CHANGED_ERROR });
    }
  }
  ```

---

### 6. Failed mutations invalidate in-flight list reads without triggering a recovery reload

- Severity: **Moderate**
- File: [`libs/frontend/git-ui/src/lib/services/git-stash.service.ts:236, 287`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.ts#L236-L287)
- Scenario:
  1. When `mutate()` starts, line 236 bumps `this.listGenerations` to invalidate older list reads.
  2. If the mutation fails (e.g. merge conflict on `git:stashPop`, permission error, etc., not `STASH_LIST_CHANGED_ERROR`):
     `outcome.success` is `false`.
  3. Line 287 gates reload on `if (outcome.success && this.gitStatus.activeWorkspacePath() === workspace)`.
  4. Because `outcome.success` is false, no reload is dispatched.
  5. Any list request that was in flight before `mutate()` is discarded by the generation check, leaving the stash list in an un-refreshed or empty state.
- Fix:
  Trigger `this.loadListFor(workspace)` when a mutation fails and `outcome.error !== STASH_LIST_CHANGED_ERROR` if a prior list read was invalidated.

---

### 7. Concurrent `openFileDiff` calls in the same stash entry share generation counter and race tab activation

- Severity: **Moderate**
- File: [`libs/frontend/git-ui/src/lib/services/git-stash.service.ts:316-320`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.ts#L316-L320)
- Scenario:
  1. In `openFileDiff(file)`, `generation` is read via `this.currentGeneration(this.interactionGenerations, workspace)` without bumping the counter.
  2. If a user quickly clicks file A and then file B within the same selected stash, both invocations receive identical `generation` numbers.
  3. If reading file A takes longer than file B:
     File B finishes and opens tab B.
     File A finishes second, passes `isSelectionCurrent(workspace, entry, generation)`, and opens tab A, stealing active focus from the user's more recent click on file B.
- Fix:
  Assign a monotonically increasing request ID to `openFileDiff` or bump a file-diff generation counter so that only the latest clicked file diff opens and activates.
