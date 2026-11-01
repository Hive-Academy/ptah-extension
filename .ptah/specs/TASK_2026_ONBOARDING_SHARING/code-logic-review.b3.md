# Code Logic Review B3 (+R1) — TASK_2026_ONBOARDING_SHARING

Review family: claude (reviewer) vs codex (implementer)

Score: 6/10. Verdict: REVISE. No checks run (user decision); static read only. Not every line of every B3 spec was read; the logic files were.

## Defects

1. SERIOUS — stale analysis card after folder switch (race with backend switch).
   `analysis-found-card.component.ts:66-71,76`. The effect fires as soon as `activePath()` changes. That signal flips immediately in `ElectronLayoutService.switchWorkspace` (`electron-layout.service.ts:528`). The backend `workspace:switch` RPC is debounced by 100 ms (`SWITCH_DEBOUNCE_MS`, line 69) and is async. `getAnalysisStatus()` sends `{}` (`wizard-rpc.service.ts:646-651`), so the backend resolves the folder from its own active workspace. The request can therefore report the previous folder's analysis while the new folder's path is shown. The request counter does not help: the response is current but for the wrong folder. The same applies to `OnboardingHomeComponent`'s `resume.refresh()` effect and to `useAnalysis(slug)`.
   Fix: either pass the workspace root in the status and load RPCs, or wait for the layout switch to complete (a settled signal or promise from `ElectronLayoutService`) before fetching. At minimum, re-check after a delay and add a spec that makes `switchWorkspace` lag.

2. SERIOUS — status RPC failure is invisible.
   `analysis-found-card.component.ts:78-81`. The failure is only `console.warn`. The card is hidden, so the user cannot tell "no analysis" from "status unavailable". A failure during a re-fetch for the new folder also leaves the card empty without explanation. The brief asks for an error state. Fix: add an `unavailable` signal that shows a small alert with a retry, and keep the degradation-audit marker.

3. MODERATE — `error` and `busy` are not reset on a folder switch.
   `analysis-found-card.component.ts:66-71`. A "Could not load" message from folder A stays visible on folder B's card. `busy` stays true if `useAnalysis` is in flight. After a switch the revision guard makes `useAnalysis` return `'not-found'`, but `useIt` returns early at line 92 and `busy` is cleared only because the code at line 91 runs first. Clear `error` in the effect.

4. MODERATE — folder picker failures are swallowed (known to the lane).
   `ElectronLayoutService.addFolder` (`electron-layout.service.ts:357-396`) returns void on RPC failure or `data.error`. `OnboardingWorkspaceStore.openFolder` (`onboarding-workspace.store.ts:40-48`) and `SetupStatusStore.openFolder` (`setup-status.store.ts:208-217`) therefore look like a cancel to the user, and the Home `folderError` is never set on Electron. The new `degradation-audit: reported` marker at `setup-status.store.ts:218` is misleading for the Electron branch. Fix: have `addFolder` return `{ status: 'added' | 'cancelled' | 'failed' }`, or at least a boolean, and surface the error. The change is small and keeps the other callers compatible.

5. MODERATE — `createFolder` is identical to `openFolder` (`onboarding-workspace.store.ts:50-53`). "New folder…" and "Open folder…" show the same dialog. This is acceptable only if the B1 picker really enables `createDirectory` (the report says it does). Label it "Choose or create folder…" to avoid a misleading duplicate.

6. MINOR — age buckets use elapsed 24 h blocks, not calendar days (`analysis-found-card.component.ts:19`). A future timestamp clamps to "today", which is acceptable. Boundaries 7 → success, 8 → warning, 30 → warning, 31 → error are correct. Age is carried by text plus an sr-only hint, but the visible text does not say "consider re-running" for warning or error, only the colour does. Add a visible suffix such as "(old)".

7. MINOR — `Re-run` navigates to `/onboarding/analyze` without any intent flag (`analysis-found-card.component.ts:100-102`). It works only if the analyze page does not auto-reuse the saved analysis. Not verified.

## Checks that passed

- Items 1 (age rules, `'ignored-by-gitignore'` hint, hidden on `missing`), 2 (isElectron guard, cancel no-op, `canSwitch` only on Home and the entry pages via `onEntryPage` and the shell header), and the new-project non-empty warning with retry all behave as specified.
- Item 3: the Electron branch uses `addFolder` and the VS Code command path is unchanged.
- Item 4: `AnalysisStepStore.resetForWorkspace` bumps a revision that guards `listAnalyses`, `loadAnalysis` and `useAnalysis`. The store effect calls `wizard.reset()`, which clears `multiPhaseResult` through the analysis state. The first-run flag is untouched. `OnboardingResumeStore.refresh` clears items before the query; its sequence guard handles ordering.
- Item 5 (R1): `composer-attachments.service.ts:47-52` calls `preventDefault` and `stopPropagation` for any file drop, text drops pass, and the spec asserts `defaultPrevented` (`composer-attachments.service.spec.ts:80`). Fixed.
- Item 6: new catches carry degradation-audit markers; `OnboardingWorkspaceStore` effects are root-scoped and need no cleanup. Specs assert behaviour.

## Residual risk

The workspace-store reset effect only runs once the store is instantiated. It is injected by the header and card on every shell page, so this holds today.

## Re-review round 1

Review family: reviewer Claude (in-process); implementer Codex. Static read of the diff against HEAD plus the new files; no tests run.

### Per-defect status

| # | Defect | Status | Evidence |
|---|--------|--------|----------|
| 1 | Stale card after folder switch | FIXED (with caveat, see new defect 1) | `electron-layout.service.ts:537,596-597` pending flag set on switch and cleared after the RPC and coordinate step; `onboarding-workspace.store.ts:26-27` `readyForActivePath`; `analysis-found-card.component.ts` effect fetches only when ready; `onboarding-home.component.ts` effect gates `resume.refresh()` on ready |
| 2 | Status RPC failure invisible | FIXED | `analysis-found-card.component.ts` `unavailable` signal, alert plus Retry, logger.warn kept |
| 3 | error/busy not reset on switch | FIXED | card effect resets `statusValue`, `error`, `unavailable`, `busy`; `useIt` re-checks `currentRequest` |
| 4 | Picker failures swallowed | FIXED | `electron-layout.service.ts` `addFolder` returns `added/cancelled/failed`; `onboarding-workspace.store.ts` `pickFolder` and `setup-status.store.ts:208-216` set `folderError` on `failed` |
| 5 | createFolder identical to openFolder | FIXED | `mode` threaded: `onboarding-workspace.store.ts` `pickFolder('create')`, `workspace-rpc.handlers.ts:209-230` create gets `createDirectory` and its own title; open omits it |
| 6 | Age bucket text only by colour | FIXED | card shows "consider re-running" when bucket is not success |
| 7 | Re-run has no intent flag | FIXED | card `rerun()` navigates with `rerun=1`; `analyze-workspace.page.ts:273,324-333` runs `startFresh()` then strips the param |

### addFolder mode contract

- Shared type `rpc.types.ts:1764` `{ mode?: 'open' | 'create' }`, optional, so `{}` compiles for old callers.
- Backend `workspace-rpc.handlers.ts:209-230`: absent or `undefined` params gives the old create-enabled dialog and the old title (backwards compatible). Only `mode === 'open'` drops `createDirectory`.
- `ElectronLayoutService.addFolder(mode?)` sends `{}` when absent. Existing callers that ignore the return value are unaffected. The VS Code host never calls this RPC (its path is `command:execute`).
- `setup-status.store.ts` Electron branch calls `addFolder()` with no mode (keeps the old behaviour). The onboarding store passes `open` or `create`.
- Boundary validation: there is none. An unknown `mode` (for example `'bogus'`) is silently treated as the create default. It is harmless (no path or injection use) but does not meet "validate RPC params".

### New defects (blocking)

1. `libs/frontend/core/src/lib/services/electron-layout.service.ts:537,596-597` (superseded switch leaves `workspaceSwitchPending` stuck true). `switchWorkspace` sets pending, but only the debounced switch's own `finally` clears it, and only when `_switchId === currentSwitchId`. `syncFromBackend` (line ~883 `++this._switchId`, triggered by `handleMessage` backend sync or `restoreLayout`) and the fallback switch (line ~979 `++this._switchId`) also bump `_switchId` without clearing pending. Scenario: the user picks a folder, and a backend `workspace` sync message arrives during the 100 ms debounce or the in-flight `workspace:switch`. The user switch's `finally` is skipped, `_workspaceSwitchPending` stays true, `readyForActivePath` stays false forever, `canSwitch` is false (header buttons disabled), the analysis card never loads, Home resume stays cleared, and `onboarding-workspace.store.ts` `pickFolder` awaits `firstValueFrom(... filter(Boolean))` forever, so `switching` never resets. Fix: clear pending wherever a newer `_switchId` supersedes a user switch (the sync and restore paths, `removeFolder`), or derive pending from `_switchDebounceTimer`/an in-flight counter instead of the id guard; add a timeout to the `firstValueFrom` wait in `pickFolder`.

### Non-blocking notes

- `workspace-rpc.handlers.ts:209`: no runtime validation of `mode`; reject or ignore unknown values explicitly and add a spec.
- `onboarding-resume.store.ts` `refresh()` reads `tabs.activeWorkspacePath` and `getWorkspaceTabs` synchronously inside the Home `effect` (`onboarding-home.component.ts`), so those signals become effect dependencies and trigger extra refreshes; wrap the call in `untracked`.
- `pickFolder` re-picking an already-active folder returns `added` with no switch; fine, but Home `analyzeAnotherProject` then does not navigate (acceptable).

Score: 7/10. Verdict: REVISE (one blocking defect: stuck pending state can wedge the whole onboarding workspace UI).

## Re-review round 2

Review family: reviewer Claude (in-process); implementer Codex. Static read of the round 2 diff and the new store file; no tests run.

### Per-item status

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | `workspaceSwitchPending` settles on every path | FIXED | `electron-layout.service.ts:603-613` `supersedeWorkspaceSwitch` clears the timer, origin and pending flag; called from `removeFolder` (486), `syncFromBackend` (895) and the fallback switch (992); normal success, failure and throw still clear it in the `finally` (596-598) |
| 2 | `pickFolder` wait bounded, `switching` resets | FIXED | `onboarding-workspace.store.ts:62-76` waits on ready OR a changed path with `timeout({ first: 35_000 })`; the timeout error is caught and `finally` resets `switching` |
| 3 | Mode validation | FIXED | `workspace-rpc.handlers.ts:212-214` rejects any defined mode other than `open` or `create` before the dialog; absent or undefined params keep the old create-enabled dialog and title |
| 4 | New defects | 1 blocking, below | |

### New blocking defect

1. `libs/frontend/core/src/lib/services/electron-layout.service.ts:895-897` (with `electron-shell.component.ts:380`) - `syncFromBackend` now calls `this._workspaceResolved.set(false)` on every run, not only the first. `handleMessage` (line 182) runs it for every external `WORKSPACE_CHANGED` message. The shell renders `@if (!layout.workspaceResolved())` as the loading state, which unmounts the whole content area. Scenario: the backend reports a workspace change from another origin (for example a second window or a backend-initiated switch) while the user is on a running analysis page or has a chat composer draft. The content is destroyed and rebuilt after `workspace:getInfo` returns, losing component state, and the loading view flashes. Before this round, resolved was only false during initial load. Fix: do not reset `_workspaceResolved` in `syncFromBackend`; add a separate "sync in flight" signal and fold that into `workspaceSwitchPending` (or `readyForActivePath`) so only onboarding gating sees it.

### Non-blocking notes

- `supersedeWorkspaceSwitch` in `removeFolder` runs after the backend accepted the removal; if later steps throw, pending is already cleared, which is the safe direction.

Score: 7/10. Verdict: REVISE (one blocking regression introduced by the fix).

## Post-cap correction review

Review family: reviewer Claude in-process subagent, author Claude coordinator. Same family (reason: Codex near weekly limit, user asked for speed). Label: weaker evidence. Static read only; coordinator's test and typecheck run not re-run.

| Check | Status | Evidence |
|-------|--------|----------|
| External WORKSPACE_CHANGED no longer unmounts shell | CONFIRMED | `electron-layout.service.ts:904` sets `_syncInFlight`, not `_workspaceResolved`; the only `_workspaceResolved.set` in the sync is `true` at 972; shell gate `electron-shell.component.ts:380` reads `workspaceResolved` only |
| `_syncInFlight` always clears | CONFIRMED | cleared in the `finally` (972-973) when `_latestSyncId === syncId`; a superseded sync (newer sync) leaves clearing to the newer one, which owns `_latestSyncId`; user switch or restore supersede bump only `_switchId`, so the sync's own `finally` still clears; early returns and the catch path run inside `try`, so `finally` runs; RPCs are time-bounded |
| Initial Electron load shows loading | CONFIRMED | `_workspaceResolved` initial value `!isElectron` (line 100) unchanged and set true only in the `finally` |
| Consumers of `workspaceSwitchPending` | OK | now a read-only `computed` (152); only consumers are `onboarding-workspace.store.ts` (reads) and specs; no external `.set` |

New blocking defects: none.

Non-blocking: `workspaceSwitchPending` now also reflects background syncs, so onboarding controls disable briefly during an external sync; intended.

Score: 8/10. Verdict: APPROVE.

## CodeRabbit follow-up review

Review family: reviewer Claude in-process subagent, author Claude coordinator. Same family (reason: speed requested, Codex near weekly limit). Label: weaker evidence. Static read of `git diff -- libs/frontend/onboarding`; tests not re-run.

| # | Fix | Status | Evidence |
|---|-----|--------|----------|
| 1 | Clear `rerun` before `startFresh()` | OK | `analyze-workspace.page.ts:322-335`. `router.navigate([], { queryParams: { rerun: null }, queryParamsHandling: 'merge', replaceUrl: true })` changes only the query string on the same route, so the router reuses the component: it is not recreated and `ngOnInit` does not run again (the `rerun` input just becomes undefined). The `destroyed` check after the await is correct. Reload or Back now lands on a URL without `rerun`, so no second fresh run. Residual: if the navigation is cancelled, `startFresh` still runs (it is called regardless of the navigate result) |
| 2 | .gitignore advice | OK | `analysis-found-card.component.ts:42`. Git cannot re-include a file whose parent directory is excluded, so `.ptah/` plus `!.ptah/analysis/` fails. `.ptah/*` ignores direct children only, and `!.ptah/analysis/` then re-includes that directory with its contents. Correct. The text assumes the rule is written `.ptah/`; a bare `.ptah` rule needs the same change (non-blocking) |
| 3 | `untracked` around `resume.refresh()` | OK | `onboarding-home.component.ts:~420-430`. `activePath()` and `readyForActivePath()` are read in the effect body before the `untracked` call, so the effect still re-runs when either changes; the signals `refresh()` reads synchronously are no longer dependencies |
| 4 | `[selected]` on options | OK | `workspace-header.component.ts:15-19`. Each option binds `selected` to `index === store.activeIndex()`, so remount renders the right option, and a switch or an optimistic revert re-evaluates both affected options. Non-blocking: if `switchTo` ignores a change (store not `canSwitch`), `activeIndex` is unchanged, no binding re-evaluates and the DOM select shows the user's pick; the same held with `[value]` |

New blocking defects: none.

Score: 9/10. Verdict: APPROVE.
