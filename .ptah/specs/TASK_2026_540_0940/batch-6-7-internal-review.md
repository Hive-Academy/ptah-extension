# Batch 6/7 Internal Code-Logic Review — `TASK_2026_540_0940`

Scope: uncommitted diff under `apps/ptah-electron-e2e/src/showcase` (`git diff -- apps/ptah-electron-e2e/src/showcase`,
280 diff lines across 8 scene files), `batch-6-report.md`, `batch-7-report.md`, cross-checked against `batches.md`
"Batch 6" / "Batch 7" contracts and the already-committed `_harness/config-menu.ts` and
`libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`. Both lanes were run by `codex` in
parallel per the team-leader decision at Batch 5. Independently reproduced
`npx nx run-many -t typecheck,lint -p ptah-electron-e2e --skip-nx-cache` (PASS) and re-ran the residual-sweep greps
myself; results match both reports.

## Batch 6 — remaining configuration-surface scenes

### Verdict: ACCEPT — 9/10

### Findings

1. **MINOR — stale JSDoc still describes "best-effort selectors" after the fallback loop was removed.**
   `apps/ptah-electron-e2e/src/showcase/gateway-tour.scene.ts:80-84`. The function-level JSDoc above `goToGateway`
   ("Best-effort selectors so the scene survives minor chrome changes") was written for the old multi-candidate
   `navCandidates` loop that this batch deleted; only the inline comment at line 86 was updated to mention the
   global configuration menu. The doc is not wrong (the inner `#thoth-tab-gateway` step is still best-effort), but
   it now reads as if `goToGateway`'s Thoth entry is also resilient/optional, when it is a single deterministic
   `openConfigSurface` call. No functional impact; a future reader could be misled about why the entry step no
   longer degrades gracefully when the trigger is absent. Fix: reword the JSDoc's first sentence to say entry is
   via the global configuration menu.

Everything else the contract requires was verified and holds, with no further findings:

- **Correct surface ids**: `gateway-tour.scene.ts:87` and `cron-tour.scene.ts:64` use `'thoth'`;
  `setup-wizard-tour.scene.ts:49` uses `'setup-hub'`; `settings-tour.scene.ts:85` uses `'settings'`;
  `marketplace-tour.scene.ts:79` uses `'marketplace'` — matching `ConfigSurfaceId` in
  `apps/ptah-electron-e2e/src/showcase/_harness/config-menu.ts:4` exactly.
- **Director already in scope**: all five files call `openConfigSurface(page, director, id)` inside a function that
  already receives `director: Director` as a parameter; no new injection or global lookup was introduced.
- **Following beats preserved**: in every file, every wait/spotlight/narration statement after the old navigation
  block is byte-identical to what it replaced (verified by reading each file end to end, not just the diff hunk) —
  e.g. `cron-tour.scene.ts:65-71` still waits for `#thoth-tab-cron`, clicks it, and waits for `#thoth-panel-cron`;
  `gateway-tour.scene.ts:90-93` still opens the Gateway inner tab; `marketplace-tour.scene.ts:80-82` still waits for
  `ptah-marketplace-hub`.
  `settings-tour.scene.ts:86` still waits for `ptah-settings`.
- **Unused helper removal is real, not just claimed**: `marketplace-tour.scene.ts` no longer defines
  `clickFirstVisible` (previously at old lines 68-84) — confirmed absent from the file and unreferenced.
  `setup-wizard-tour.scene.ts:40-46`'s `firstVisible` and `settings-tour.scene.ts:66-78`'s `clickFirstVisible` were
  correctly **kept**, because both are still called for in-surface navigation unrelated to the top-nav entry
  (`setup-wizard-tour.scene.ts:83-86` progress-rail lookup; `settings-tour.scene.ts:100-103` tab clicks inside
  `tourTab`, and again at `:241-243`, `:260-262` for "Search & Voice" / "Advanced"). `cron-tour.scene.ts:48-57`'s
  scoped `firstVisible(root, selectors)` is likewise still used at `:91`, `:136`, `:147` for in-panel lookups —
  correctly left alone since it was never part of the removed top-nav block.
- **Marketplace hub's own section tabs untouched**: `marketplace-tour.scene.ts:93` (`tourSections`) and `:114`
  (`tourSource`) still use `hub(page).getByRole('tab', { name: section })`, unaffected by the entry-point change, as
  the batch's validation note required.
- **Doc comments otherwise accurate**: `cron-tour.scene.ts:40-41`, `settings-tour.scene.ts:32-33`,
  `marketplace-tour.scene.ts:31-32`, and `marketplace-tour.scene.ts:75-76` (function JSDoc) were all correctly
  reworded away from "top nav" language to "global configuration menu" language.
- **No `as any`/`@ts-ignore`/dead code** in any of the five files (grepped directly).
- **No menu-already-open hazard**: each `goTo*` function calls `openConfigSurface` as its first action from a fresh
  test entry point; nothing in these five scenes opens the menu twice or needs an explicit close afterward, because
  `GlobalConfigMenuComponent.selectItem` (`libs/frontend/chat/src/lib/components/molecules/global-config-menu.component.ts`)
  already closes the menu on item selection — confirmed by reading the component's template
  (`(closed)="closeMenu(menuTrigger)"`, item click path).
- **Tab-row camera framing**: none of the five scenes reference the deleted top-nav tab buttons or tablist for
  entry; the only tablist references left in scope (Marketplace's hub strip) are the hub's own, unaffected tabs.
- Independent verification: `npx nx run-many -t typecheck,lint -p ptah-electron-e2e --skip-nx-cache` → PASS (matches
  `batch-6-report.md`). Grep sweep for `name: 'Thoth'|'Setup'|'Settings'|'Marketplace'` and
  `title="Thoth"|"Setup..."|"Settings"|"Marketplace"` across the five files → no hits, matching the batch's own
  verification bullet.

## Batch 7 — renamed-tab scenes, residual sweep, branch guard greps

### Verdict: ACCEPT — 9/10

### Findings

None rise to Blocking, Serious, or Moderate. No Minor finding either — the batch is mechanical and every change
checked out against the committed shell.

### Verification performed

- **Selectors match the committed shell exactly.** Read
  `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:126-168`: the four tab buttons carry
  `title="Chat"` / text `Chat`, `title="Tasks"` / text `Tasks`, `title="Tribunal"` / text `Tribunal`, and
  `title="Analytics"` / text `Analytics` — no `aria-label` on any of them. Batch 7's new selectors:
  - `canvas-orchestra.scene.ts:44-45`: `getByRole('tab'|'button', { name: 'Chat' })` — matches.
  - `chat-code-edit.scene.ts:179-181`: `getByRole('tab'|'button', { name: 'Chat' })` and `[title="Chat"]` — matches;
    the pre-existing `[title="Canvas"]` / `[aria-label="Canvas"]` fallback candidates at `:182-183` were correctly
    left alone (they refer to a distinct internal grid-layout toggle concept per the file's own comments, not the
    renamed top-nav tab, and were out of this task's specified line range).
  - `dashboard-tour.scene.ts:53-56`: `getByRole('tab'|'button', { name: 'Analytics' })`,
    `[aria-label="Analytics"]`, `[title="Analytics"]` — the `title` and role selectors match; `aria-label` was never
    present on this control before or after (same as the pre-existing `[aria-label="Dashboard"]` it replaced), so
    it remains an inert fallback candidate in the resilience chain rather than a new defect.
- **Narration/scripts/headings unchanged.** No `scripts/*.json` files appear in the diff; `git status` confirms only
  the eight `.scene.ts` files changed. The only doc-comment edit outside the three selector lines is
  `chat-code-edit.scene.ts:15-16`, and it is accurate: "hosted by the global 'Chat' tab" correctly describes the new
  entry point without overclaiming that Chat and Canvas are now separate surfaces.
- **Residual sweep re-run independently**: `grep -rn "name: 'Canvas'|name: 'Dashboard'|title=\"Orchestra Canvas\"|title=\"Session Analytics\"" apps/ptah-electron-e2e/src libs/frontend/webview-e2e-harness/src`
  → zero hits, matching `batch-7-report.md`'s table (only the two expected canvas-heading hits in
  `landing-page-tour.scene.ts:242` and `specs/git/hunk-revert-top-layer.spec.ts:199`, both explicitly out of scope
  per the task, plus the five Batch-6-in-progress top-nav hits that are expected under parallel execution and are
  now resolved by Batch 6's own diff).
- **No git commands run by either lane** (per their own reports; confirmed no stray commits exist for these files —
  `git status --short` still shows them as modified, not committed).
- **No `as any`/`@ts-ignore`/dead code** in the three files (grepped directly).
- Independent verification: `npx nx run-many -t typecheck,lint -p ptah-electron-e2e --skip-nx-cache` → PASS.
- Branch guard greps (`class.hidden|retain: *true` on added lines; `webview-surface.types.ts`/`app.routes.ts`/
  `app-shell.component.*` in the changed file list) are team-leader-owned per `batches.md:613-616` and were not
  re-run here since they require a diff against `origin/main` across the whole branch, not just this showcase
  scope; nothing in the reviewed diff touches those paths.

## Cross-batch note

Both lanes' "no top-nav selector remains" claims were independently verified together (Batch 6's five files plus
Batch 7's three files plus the two directories the plan named for the sweep). No conflicting edits, no file
touched by both lanes, and the parallel-execution risk the team-leader accepted at Batch 5 (each lane seeing the
other's half-edited files) did not materialize into any cross-attribution error in either report.
