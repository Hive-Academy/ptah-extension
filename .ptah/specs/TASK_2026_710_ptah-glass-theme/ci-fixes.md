# PR #805 CI fixes — TASK_2026_710 ptah-glass-theme

Head at start: f5a388d52. Evidence: `ci-failure-inventory.md` (same folder) + CI runs
39534276007 (unit), 39534276029 (Electron), 39534276014 (webview); follow-up shard
evidence: Electron shard 4 = `theme.spec.ts:48/:121/:210` (stale anubis-era
expectations), shard 2 = `git-rail-collapse.spec.ts:101` (dock 695 vs requested 700).
No local checks were run (not authorized; peer PR #803 holds the heavy-check slot);
every fix below is root-caused from source and CI evidence.

## Root causes and edits

### 1. Unit — stale gold exclusion in the ACCENT boot-list guard (inventory #2)

- Root cause: `apps/ptah-extension-webview/src/app/theme-boot-lists.spec.ts:79-83` still
  filtered `gold` out of the expected ACCENT list. The stored-gold fix in c89ca28b9
  changed `apps/ptah-extension-webview/src/index.html:58` to
  `var ACCENT = 'gold rose moonstone'` (a stored 'gold' must be recognised as valid so a
  stale non-default `localStorage['ptah-accent']` mirror cannot override it). The spec
  was not updated with it.
- Edit: assertion now compares the pre-paint ACCENT list to the full `ACCENTS` export
  (`['gold','rose','moonstone']`) with a comment explaining why gold belongs. The script
  still applies `data-accent` only for rose/moonstone; gold IS the default.

### 2. Unit + Electron — accent initialization wrote the whole state record on a fresh profile (inventory #1, #3)

- Root cause: `libs/frontend/core/src/lib/services/theme.service.ts:296-298`
  (after c89ca28b9) treated an ABSENT stored accent (`undefined`) as "invalid" and
  repair-wrote `ptah-accent: gold` at boot. Two failures from one line:
  - `theme.service.spec.ts:181` — "prefers the authoritative vscode state over a stale
    localStorage mirror" asserts zero `setState` calls; the accent boot write broke it.
  - `auto-updater.spec.ts:211-231` — the marker the harness writes between
    `domcontentloaded` and Angular boot gets REPLACED, not merged, at the main-process
    boundary.
- Write-path trace (storage writes → runtime readers):
  - Writers: `ThemeService.initializeAccent/setAccent` → `VSCodeService.setState`
    (`vscode.service.ts:254-276`, merge of `pendingElectronState` or a sync
    `vscode.getState()`) → preload `window.vscode.setState` → `ipcRenderer.send('set-state')`
    → `IpcBridge` handler (`apps/ptah-electron/src/ipc/ipc-bridge.ts:576-592`) which
    REPLACES the whole `webview-state` record per workspace (VS Code webview `setState`
    contract: whole-object replace). Other writers: `SurfaceRoutePersistence`
    (`ptahRoute`, merged through the same path) and the e2e `rpcBridge.setState`
    (main-process-side emit, bypasses the renderer).
  - Readers: preload `getState` → `ipcRenderer.sendSync('get-state')` → `IpcBridge`
    `get-state` (`ipc-bridge.ts:556-575`: `pendingWebviewStates` first, then the
    storage cache) → `VSCodeService.getState` (`vscode.service.ts:225-242`, the
    renderer's `pendingElectronState` shadows it after any renderer write) →
    `ThemeService.initializeTheme/initializeAccent` and the `index.html` pre-paint
    script (`state['ptah-accent']` first, then the localStorage hint).
  - Failure mechanism: on a fresh profile the accent write fired at Angular bootstrap
    with a merge base read BEFORE the harness marker landed; its whole-record
    `set-state` then replaced the marker, and the later route write merged onto the
    renderer's `pendingElectronState` (which never saw the marker) → final state
    `{ ptahRoute, 'ptah-accent': 'gold' }`, exactly what CI observed.
- Edit (`theme.service.ts` `initializeAccent`): repair-write only when there is
  something to repair — a stored value that is defined but not a valid accent, or a
  valid mirror value the state lost. A fresh profile (no state, no hint) writes
  nothing: an absent accent already means the default everywhere (pre-paint falls back
  to the hint, then the default; `setAccent` persists on user action). The pre-c89ca28b9
  mirror-repair semantics are preserved and now covered independently.
- Spec edit (`theme.service.spec.ts`): the :181 assertion is kept VERBATIM (precise
  theme-repair semantics, no weakening); a new `describe('accent initialization')`
  verifies accent behavior independently: valid stored accent adopted without a
  rewrite; fresh profile left unwritten (with the localStorage hint still re-armed);
  absent state accent repaired from the mirror.

### 3. Electron + Webview e2e — glass isolation traps native popovers below later siblings (inventory #4, #5, #6, #11, #12)

- Root cause: `apps/ptah-extension-webview/src/styles.css:2791`
  `:where([data-glass-surface]) { position: relative; isolation: isolate; }` makes
  every glass surface a stacking context, while `NativePopoverComponent`
  (`libs/frontend/ui/src/lib/native/popover/native-popover.component.ts:93,105`)
  keeps its `z-40` fixed backdrop and `z-50` panel in the component DOM (no portal).
  The trapped z-index cannot lift the panel above LATER siblings of the hosting
  surface:
  - canvas rail (host `data-glass-surface="chrome"`, `canvas-rail.component.ts:85`):
    the ⋮ menu ("Open beside", "Move down") painted below the board tile sections
    (`canvas-rail-board.component.ts:218`, `relative`) → canvas.spec.ts:138,166,199,227,241,
    compaction-duplicate-session.spec.ts:52, task-370-concurrent-session-isolation.spec.ts:109.
  - marketplace provider cards (`provider-card-list.component.ts:171`,
    `data-glass-surface="content"` per `<li>`): the lock-badge popover painted below
    the following cards → lock-popover-stacking.e2e.spec.ts:271 (cards tier; the table
    tier has no isolating row surface, which is why it kept passing).
  - settings license card (`license-status-card.component.ts:70`,
    `data-glass-surface="content"`): the membership-key popover painted below the
    following Advanced cards → settings-reachability ADV-4's activate-click timeout;
    the popover left open then kept its fixed backdrop over the page, cascading into
    the Search & Voice tab click timeouts (both hosts).
- Edit (`styles.css`, one rule added right after the existing `bar` lift at :2881):
  `:root[data-glass='on'] [data-glass-surface]:has(.popover-panel) { z-index: 30; }`
  — a glass surface hosting an OPEN native popover (`.popover-panel` exists in the
  DOM only while open) floats above its siblings for exactly that time, at the same
  lift level the `bar` role already uses. Non-glass themes are untouched (no
  isolation → the panel already escapes). CDK popovers portal to a body-level overlay
  container, so they never match. No component markup changed for this.
- Preserved: all overlay clicks, menus, pane geometry, non-glass themes, the compact
  backdrop-covers-viewport assertion (the `has-[[aria-expanded=true]]:transform-none`
  rule on the provider card keeps the fixed backdrop viewport-sized).

### 4. Electron — git dock silently shrank below its requested width (inventory #7)

- Root cause: `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:395`
  `.electron-git-dock` kept default `flex-shrink: 1`. The glass shell chrome
  (`electron-shell.component.ts:106-125`: 8px root padding, 8px pane gutters, handle
  margins) makes the body row ~5px wider than the 1200px window with the chat column
  already at its 400px floor, so flex-shrink silently took those 5px out of the dock's
  service-managed `[style.width.px]` (DEFAULT_EDITOR_WIDTH 700): CI measured 695,
  the spec expects 699-701 (git-rail-collapse.spec.ts:101).
- Edit: added `shrink-0` to the `.electron-git-dock` class list. The dock's width is
  owned by `ElectronLayoutService` (clamped 300..innerWidth*0.5 on drag at
  `electron-layout.service.ts:181-183`, re-clamped on window resize at :143-156), so
  flex must never override it.
- Residual risk (needs an Electron visual check before merge): at the tightest
  configuration (1200px window, workspace sidebar hidden, 700px dock) the row is still
  ~5px over; instead of the dock shrinking, the trailing git vertical tab
  (`flex-shrink: 0`, `sidebar-tab.component.ts:35`) may now be clipped ~5px at the
  body's `overflow-hidden` right edge. If that clip is visible, the follow-up is to let
  the chat column's 400px floor yield by the shell's own gutter chrome rather than
  reintroducing dock shrink. Chosen because the test (product contract) requires the
  requested dock width to render; a wider tolerance was explicitly rejected.

### 5. Electron — theme spec assertions still on the pre-glass defaults (inventory #8, #9, #10)

- Root cause: `apps/ptah-electron-e2e/src/specs/theme/theme.spec.ts` predates 882cbe756
  (ptah-glass default) and c89ca28b9 (theme count 34 → 36).
- Edits (assertions only, semantics preserved):
  - :48/:65 — fresh-launch default is `ptah-glass` (still EAGER, so the
    never-fetch-the-deferred-sheet property is unchanged).
  - :121/:128 — theme picker lists 36 themes (DAISYUI_THEMES gained the glass pair).
  - :210 — the deferred-repaint test now baselines the actual default tokens and
    switches back to `ptah-glass` (EAGER, same restore direction the old anubis check
    guarded: the deferred sheet must not win over eager themes once loaded).
  - :150 comment updated to the new default.

## Decisions

1. Accent repair condition narrowed to "defined-but-invalid OR recovered from a valid
   mirror" instead of "not valid" (covers `undefined`).
   - Options: (a) keep the boot write and change the specs; (b) remove only the
     fresh-profile write; (c) revert to the pre-c89ca28b9 condition entirely.
   - Evidence: commit c89ca28b9's stated intent is "an invalid stored accent is
     rewritten" (its spec covers the defined-invalid case); an absent accent already
     reads as gold in the pre-paint script, the service and `setAccent`; the CI marker
     loss shows the boot write replacing the whole state record. (c) would also lose
     nothing functionally but drops the defined-invalid rewrite the review asked for.
   - Reversible: single condition; revert restores c89ca28b9 behavior.

2. One shared glass-layer rule (`:has(.popover-panel)`) instead of per-component
   `has-[[aria-expanded=true]]:z-30` lifts.
   - Options: (a) global glass rule; (b) per-component utilities (the pattern
     `provider-card-list` already uses for `transform-none`).
   - Evidence: the license-card trigger sets no `aria-expanded`
     (`license-status-card.component.ts:106-119`), so (b) needs a fourth edit and an
     a11y change per future host; `styles.css:2881` already lifts `bar` with
     `z-index: 30` for the same class of problem (approved in 882cbe756); the failing
     surfaces span three libs (marketplace, chat settings, canvas). `.popover-panel`
   exists only while a popover is open, so the lift is transient; `:has` is already
   used in this codebase (Tailwind `has-[[...]]` variants, `[&>.popover-panel]`).
   - Reversible: delete one rule; each affected surface returns to today's stacking.

3. Git dock `shrink-0` (see root cause 4 for the alternatives and the residual clip
   risk). Reversible: remove the class.

4. theme.spec.ts updated to the intended post-glass expectations rather than pinning
   old defaults — the default-theme change is the PR's purpose (882cbe756).

## Remaining blockers and checks not run

- No local test/typecheck/lint/build/e2e/package runs (per instructions; memory-safe
  rules would apply if authorized). CI must re-run: unit `core` + `ptah-extension-webview`,
  Electron e2e (auto-updater, canvas, compaction-duplicate-session,
  task-370-concurrent-session-isolation, git-rail-collapse, theme), webview e2e
  (marketplace lock-popover-stacking, settings-reachability).
- ADV-4's "Search & Voice tab timeouts" are root-caused as the cascade of the failed
  activate click leaving the popover backdrop over the page; they should disappear with
  root cause 3, but only the scoped CI rerun can confirm (both host modes failed
  identically, which matches one shared stacking cause).
- Root cause 4's residual: possible ~5px clip of the git vertical tab at the tightest
  layout — needs an Electron visual check before merge.
- Untouched on purpose: `.gitignore` (unrelated local edit, left as-is) and
  `ci-failure-inventory.md` (pre-existing untracked inventory in this task folder).
- No other CI failures from runs 39534276007/6029/6014 are known to me beyond the
  inventory; if further failures appear in the rerun, they were not in the evidence.
