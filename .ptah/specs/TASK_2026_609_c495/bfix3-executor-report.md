## Frontend implementation — `TASK_2026_609_c495`, batch B-FIX-3

**Tasks completed**: partb-review-frontend.md findings 1, 2, 3, 4, 5; visual-b7-report.md Serious 1 (light-theme warning contrast). Finding 6 (wizard destroy during confirmation preview) is a recorded follow-up and was NOT touched. No git run; batches.md not edited.

**Files** (all under `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\frontend\`):

- MODIFIED `skill-synthesis-ui\src\lib\components\clones\reconcile-guard.ts`: `confirm(): Promise<boolean>` replaced by `check(): Promise<ReconcileGuardOutcome>`. Tracks destruction and re-checks it after the awaited read. Outcome is fixed per call. The overwrite note now meets contrast.
- MODIFIED `skill-synthesis-ui\src\lib\components\clones\agent-model-editor.component.ts`: save and Sync chain uses the guard outcome, an op number, DestroyRef and a workspace ticket. Adds the skipped-reconcile and writeFailed notices. A workspace switch drops the draft.
- CREATED `skill-synthesis-ui\src\lib\components\clones\agent-models.store.ts`: `AgentModelsStore` moved out of the editor file with no behaviour change, plus the new `AgentModelsTicket`, `workspaceEpoch` and revision logic. This keeps the editor under the repo's `max-lines` rule: the lint count is 713, down from 765 at HEAD; without the move it would be 859.
- MODIFIED `skill-synthesis-ui\src\lib\components\clones\agent-sync-chips.ts`: adds the pure helpers `reconcileWriteFailures(health)` and `describeWriteFailures(failures)`. This is the single place `writeFailed` is read for the Agents tab.
- MODIFIED `skill-synthesis-ui\src\lib\components\clones\quarantined-agents-panel.component.ts`: calls `check()`. Restore and Finish restore treat a report with writeFailed entries as a partial failure. New `QUARANTINE_SYNC_RETRY_COPY`.
- MODIFIED `skill-synthesis-ui\src\lib\components\clones\skill-clones-view.component.ts`: Sync calls `check()` and counts failures with `reconcileWriteFailures`; the toast text is unchanged. It now imports the store from `agent-models.store`.
- MODIFIED `setup-wizard\src\lib\components\agent-selection.component.ts`: preview-modal warning copy now meets contrast. Template classes only.
- MODIFIED specs: `reconcile-guard.spec.ts`, `agent-model-editor.component.spec.ts`, `quarantined-agents-panel.component.spec.ts`, `setup-wizard\...\agent-selection.component.spec.ts`.
- NOT touched: `marketplace/.../harness-health.store.ts`. The skipped reconcile is detected locally (see finding 3).

**Stack observed**:
- Angular 22.1.7 (`node_modules/@angular/core/package.json`): standalone, OnPush, `signal`/`computed`/`effect`, `inject()`, `DestroyRef.destroyed` (present in `@angular/core/types`).
- Tailwind 3.4 + daisyUI 4.12 (`package.json`). Themes `anubis` / `anubis-light` are defined in `apps/ptah-extension-webview/tailwind.config.js`. Lib templates are scanned through `createGlobPatternsForDependencies`.

### Guard outcome API (findings 1 + 5)

```ts
export type ReconcileGuardOutcome = 'approved' | 'cancelled' | 'unverified';
public async check(options?: ReconcileGuardOptions): Promise<ReconcileGuardOutcome>
```

- **`approved`**: the user clicked Confirm, or `onlyWhenEdits` found no edited path.
- **`cancelled`**: Cancel, Escape or backdrop on the confirm view, or the guard was destroyed (before the call, during the read, or while the modal was open).
- **`unverified`**:
  - the store was busy;
  - the read errored;
  - the read returned no report;
  - or a second call came in while one was in flight.
  - Closing the unverified modal stays `unverified`.
- **How the outcome is fixed**: `dismiss()` takes it from the view this call showed, not from `HarnessHealthStore`. A `HARNESS_HEALTH_CHANGED` push while the modal is open cannot change it.
- **Destroy handling**:
  - `ngOnDestroy` sets `destroyed` and resolves any pending ask as `cancelled`.
  - `check()` returns `cancelled` straight after the awaited `refresh` if destroyed, before either auto-approval or `ask`.
  - `ask()` refuses to open on a destroyed guard.
- **Why the rename**: from `confirm` to `check` on purpose, so any caller still testing a boolean fails to compile. With the old name, `!(await …)` on a string would silently always pass.

Every caller was updated. Only the editor's behaviour changes, and only by using the outcome:

| Caller | Change |
| --- | --- |
| `skill-clones-view.component.ts` `onSync` | `(await guard.check({confirmLabel:'Sync'})) !== 'approved'` → return |
| `quarantined-agents-panel.component.ts` `onConfirmRestore` | `!syncOff && (await guard().check({confirmLabel:'Restore'})) !== 'approved'` → return |
| `quarantined-agents-panel.component.ts` `onFinishRestore` | `outcome !== 'approved'` → return |
| `agent-model-editor.component.ts` `save` | `unverified` → `guard-failed` phase: GUARD_FAILED_COPY "Could not check for hand-edited files; nothing was saved." + Retry, typed value kept. `cancelled` → silent close. The old `runGuard` inference from store state is deleted. |
| `agent-model-editor.component.ts` `syncAgain` | only `approved` reconciles |

### Per-finding change

1. **Destroy during the health read.**
   - The guard side is described above.
   - Editor: injects `DestroyRef`, and each chain takes `op = ++this.op`.
   - `live(op, ticket)` = `op === this.op && !destroyRef.destroyed && store.isCurrent(ticket)`. It is checked after the guard, after `setAgentModel` (including the catch path) and after `reconcile`.
   - So no `setAgentModel`, `applySaved`, reconcile or notice happens after destroy.

2. **Stale workspace or revision.**
   - `AgentModelsStore` has:
     - `workspaceEpoch`, bumped by the WORKSPACE_CHANGED effect;
     - `ticket()` = `{ epoch, hostRoot (vscode.config().workspaceRoot), workspaceRoot (snapshot) }`;
     - `isCurrent(ticket)`, which compares the epoch and also reads the host root directly, so a reply that arrives before the effect has run is already stale.
   - **Loads**: `load()` uses `revision` (it replaces `loadSeq`) and a ticket. A reply is dropped if a newer load or an adopted save happened, or if the workspace changed.
   - **Saves**: `applySaved(ticket, …)` returns `false` for another workspace, or when the snapshot's `workspaceRoot` differs from the one the save sent. On adoption it bumps `revision`, so loads that started before the write are dropped, and clears `loading`.
   - **Drafts**: the editor has an effect on `workspaceEpoch` that bumps `op` and clears the edit, draft and notice, so a draft does not survive a switch.

3. **Skipped reconcile.**
   - `HarnessHealthStore.reconcile()` checks `_reconciling()` synchronously on entry. The editor checks `harness.reconciling()` synchronously right before calling it, which is an exact local equivalent, so the store is untouched.
   - When a pass is already active, the row shows `SYNC_SKIPPED_COPY` = "Saved; provider copies not updated: a sync was already running." with the Sync retry button (`kind: 'sync-failed'`). The same path is used by `syncAgain`.

4. **writeFailed treated as success.**
   - Counting is now in `agent-sync-chips.ts`: `reconcileWriteFailures` and `describeWriteFailures` ("N file(s) could not be written: path (reason); …").
   - **View Sync** reuses it, with the same toast.
   - **Editor**: shows "Saved; provider copies not fully updated: 1 file could not be written: .codex/agents/reviewer.toml (EACCES)" with Sync. Only a clean report clears the notice.
   - **Quarantine panel**: one `reconcileNotice(slug, dest)` serves both Restore and Finish restore. A report with failures gives a `warning` toast naming each path and reason, plus "Use Sync provider copies to retry." There is no "Updated provider copies" or plain "Restored …" success wording.
   - **Retry limitation**: the panel reports through the host toast, which cannot carry a button. The retry is the view's always-present "Sync provider copies" button, and the toast names it.

5. **Misclassification.** Fixed by the per-call outcome (see the API section).

### Contrast (visual Serious 1)

- **Measured problem**: the light theme `warning` = `oklch(72% 0.18 55)` = #f77f00 on base-100 #faf7f5 gives **2.46:1**, which matches the reviewer's pixel sample.
- **Token chosen**: daisyUI's own pair, a solid `bg-warning` fill with `text-warning-content`. In the light theme `warning-content` is `oklch(28% 0.066 53.8)` = #411e03.
  - Light: **5.67:1**.
  - Dark: `#131317` on `#f97316` is **6.61:1**.
  - Ratios were computed from the theme sources (OKLCH → sRGB → WCAG relative luminance).
- **Why not `text-warning-content` on a /10 tint**: it would fail in dark, because the dark `warning-content` (#131317) would sit on a near-black tint.
- **Global tokens**: unchanged.
- **Where it applies, these messages only**:
  - The reconcile guard overwrite note: `rounded bg-warning px-2 py-1 text-warning-content`.
  - In the wizard preview modal, the three `role="alert"` lines: targets changed, preview unavailable, and the `preview.warning` banner. Same classes.
  - The "will overwrite" and "will overwrite if written" markers are now `badge badge-warning badge-sm`, which uses the same pair.
- **Wording**: the leading "— " and the parentheses were dropped inside the badges. The wizard spec was updated, and it now also asserts there is no `.text-warning` in the modal.
- **Not re-measured in a browser**: the ratios are computed, not taken from rendered pixels.

### Spec cases added or changed (deferred promises)

`reconcile-guard.spec.ts`:
- All existing cases now assert outcomes (`approved` / `cancelled` / `unverified`). A second call resolves `unverified`.
- New: the unverified modal, then a HEALTH_CHANGED push, then Close still resolves `unverified` with no reconcile.
- New: destroyed while the read is pending, with no edits (`onlyWhenEdits`): resolves `cancelled`, only `harness:health` was called.
- New: destroyed while the read is pending, with edits: resolves `cancelled` and no modal view is set.

`agent-model-editor.component.spec.ts`:
- Destroy during the guard health read, run with both an unedited and an edited report: no `setAgentModel` and no reconcile.
- A late save reply after a workspace switch is discarded. The snapshot stays the new workspace's (`/other/resolved`, codex `gpt-5`), there is no reconcile and no notice, and the draft was dropped at the switch.
- A workspace switch drops an open draft.
- A load started before a successful save cannot restore the older value, and `loading` ends `false`.
- Guard unverified (no-report read), then a HEALTH_CHANGED push, then Close: the guard-failed copy and Retry are shown, the input keeps `o3`, and nothing is saved.
- Skipped reconcile (another pass started during `setAgentModel`): `SYNC_SKIPPED_COPY` is shown with Sync, only one `harness:reconcile` call was made, and Sync is enabled once the other pass ends.
- A writeFailed report gives the partial-failure notice with path, reason and the Sync button.

`quarantined-agents-panel.component.spec.ts`:
- Restore whose reconcile returns writeFailed: `warning` naming the path and reason plus the Sync retry copy.
- Finish restore whose reconcile returns writeFailed: `warning`, never "Updated provider copies".

`agent-selection.component.spec.ts`:
- The overwrite markers are asserted through `.badge-warning`, and there is no `.text-warning` in the preview modal.

### Verification

Project names were confirmed from `project.json`: `@ptah-extension/skill-synthesis-ui` and `@ptah-extension/setup-wizard`. Marketplace was not touched, so it was not run.

- `npx nx run-many -t typecheck,lint -p @ptah-extension/skill-synthesis-ui,@ptah-extension/setup-wizard` reported "Successfully ran targets typecheck, lint for 2 projects", with **0 errors**.
  - Warnings in skill-synthesis-ui:
    - `max-lines` on `agent-model-editor.component.ts` at 713. It was 765 at HEAD, so this is an improvement.
    - `max-lines` on `skill-clones-view.component.ts` (740) and on a 1162-line spec.
    - Two `no-empty-function` warnings in `diagnostics/event-feed.component.spec.ts`.
  - Warning in setup-wizard: `max-lines` on `agent-selection.component.ts` (961).
- `npx nx run-many -t test -p @ptah-extension/skill-synthesis-ui,@ptah-extension/setup-wizard --maxWorkers=2 --skip-nx-cache` ran 2 projects: Test Suites 12/12 with 332 tests passed, and 35/35 with 610 passed. "Successfully ran target test for 2 projects."
- Browser or visual re-measurement: not run.

**Plan deviations**:
- The guard method was renamed `confirm` → `check` so that a missed boolean caller fails to compile.
- `AgentModelsStore` was extracted to `agent-models.store.ts` because of the repo's `max-lines` rule. Its only importers, the view and the editor spec, were updated. No re-export shim.

**Out-of-scope observations**:
- The editor's own warning text (`agent-model-guard-failed`, and the `sync-failed` notice via `text-warning` on `bg-base-300/30`) uses the same light-theme `text-warning` (~2.4:1). The visual report did not list it and the instruction limited the fix to the named messages. The same `bg-warning text-warning-content` treatment would fix it.
- Finding 6 (wizard preview not invalidated on destroy) is still open, as instructed.
- The working tree also has uncommitted backend changes from parallel agents (agent-generation, harness-sync). I did not touch them.
