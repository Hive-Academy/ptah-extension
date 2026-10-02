# Visual Review - TASK_2026_584 Batch 7 (agent-session adoption: badge, tooltip, banner, late adoption)

## Summary

| Metric            | Value                                                                               |
| ----------------- | ----------------------------------------------------------------------------------- |
| Verdict           | REVISE                                                                              |
| Overall score     | 6/10                                                                                |
| Visual breaking   | 0                                                                                   |
| Major (behaviour) | 1 (defect 1, late-tab history load; reproduced in a VS Code-style host)             |
| Serious           | 1 (defect 2)                                                                        |
| Moderate          | 4 (defects 3-6)                                                                     |
| Viewports tested  | 360, 800, 1000, 1400 (width) x dark (`anubis`) and light (`anubis-light`)           |
| Screenshots taken | 50 PNG (visual-b7/)                                                                 |
| Components tested | agent badge (tab bar), agent-origin banner, chat view, late adoption, live adoption |

Score reasoning: the badge and banner render, are keyboard reachable, and live adoption does not steal focus
or shift the user's content. They fall to 6 because the late-adopted tab shows an empty welcome screen under a
VS Code-style host (defect 1), and the light theme badge fails contrast (defect 2). 7-8 would need both fixed.

## Environment

- After: `D:\projects\ptah-extension\.claude-worktrees\task-584` (uncommitted B7), built with
  `NX_DAEMON=false NX_ISOLATE_PLUGINS=false npx nx build ptah-extension-webview --configuration=development --output-path=D:/tmp/vr584/after --skip-nx-cache`.
  Confirmed it is the B7 bundle: the string `agent-origin-banner` is present in the after bundle and absent from the before bundle.
- Before: throwaway detached worktree at `a90c086d7`, same build command to `D:/tmp/vr584/before`. The worktree
  and its `node_modules` junction were removed afterwards (junction unlinked first; main `node_modules` untouched).
- Rendering: Playwright (repo's `@playwright/test` 1.x chromium) against the real webview bundle, served by a small
  static server. The repo harness (`libs/frontend/webview-e2e-harness`) was the pattern, but its fixtures only
  wire a `tabs`-less bundle and cannot seed tabs, so I used a standalone driver with the same technique
  (`acquireVsCodeApi` shim plus an in-page RPC auto-responder). Scripts are in `visual-b7/harness/`
  (`lib.mjs`, `run.mjs`, `s4b.mjs`). Nothing under the worktree's source was modified.
- Host: VS Code-style `ptahConfig` (`isVSCode: true`, no `isElectron`), `ptah-layout-mode=single` (the tab bar only
  exists in single mode). Electron's shell is canvas-based and has no `ptah-tab-bar` (checked, no screenshot
  kept), so the badge does not exist there; only the banner (inside canvas tiles) applies.
- State driving: tabs seeded through the persisted store `ptah.tabs.vr` (this exercises the persistence
  round trip of `agentOrigin`), the live path through an injected `agentSession:opened` message, and the late path
  through a mocked `chat:agent-sessions` RPC at bootstrap (plus `session:load` and `chat:resume` mocks with two
  history turns). Themes: `ptah-theme` localStorage = `anubis` (dark) / `anubis-light` (light).
- Support policy: none documented for the webview; widths are an audit selection (360 narrow handheld/side-panel,
  800 intermediate, 1000, 1400 wide), not a support contract. Chromium only.
- Accessibility standard: none declared; WCAG 2.2 AA applied (4.5:1 text, 3:1 UI components and focus indicator,
  24x24 target with spacing exception). 44px and 16px figures are guidance only.

## Shots

Shot-to-requirement map: (1) tab bar badge = `s1-*`, (2) tooltip incl. parent gone = `s2-*`, (3) banner = `s3-*`,
(4) late-adopted tab after first activation = `s4-*` and `s4b-*`. Extras: keyboard focus `s5-*`, narrow widths `s6-*`.
All paths are relative to `visual-b7/`.

Caveats on specific shots:

- `s2-tooltip-*`: the badge uses the native `title` attribute. Headless Chromium does not paint native tooltips into
  screenshots, so the tooltip bubble itself cannot be captured. The shots show the badge in hovered state; the
  tooltip text is recorded below. This shot is NOT a rendering of the tooltip.
- `s4-late-*-after-first-activation`: shows the actual outcome under the VS Code-style host: the history did NOT load
  (defect 1). `s4b-*` are a diagnostic: same flow after forcing an active workspace path in the page
  (`tabManager.workspacePartition._activeWorkspacePath.set('C:\\ws')`, dev build only), which is what Electron-style
  workspace coordination does. They are not a faithful VS Code render.
- `s6-tabbar-*-360` and `*-800`: `ptah-tab-bar` has no visible area at these widths (see defect 6), so the harness
  fell back to full-page captures; the file name says tabbar but it is the full window.
- `s1-*-before`: the base build has no badge; a plain tab with the same title is seeded in the same position.

| File                                                                           | Theme | Before/After   | What                                                                        |
| ------------------------------------------------------------------------------ | ----- | -------------- | --------------------------------------------------------------------------- |
| s1-tabbar-dark-before-1400.png                                                 | dark  | before         | tab bar, child tab without badge (base a90c086d7)                           |
| s1-page-dark-before-1400.png                                                   | dark  | before         | full window, same state                                                     |
| s1-tabbar-dark-after-1400.png                                                  | dark  | after          | tab bar after live `agentSession:opened` push (badge)                       |
| s1-page-dark-after-1400.png                                                    | dark  | after          | full window after live push; active tab unchanged (parent)                  |
| s2-tooltip-parent-dark-after-1400.png                                          | dark  | after          | badge hovered, parent present (native tooltip not captured)                 |
| s2-tooltip-gone-dark-after-1400.png                                            | dark  | after          | badge hovered, parent gone (native tooltip not captured)                    |
| s3-banner-dark-parent-after-1400.png                                           | dark  | after          | banner with "Open parent"                                                   |
| s3-page-dark-parent-after-1400.png                                             | dark  | after          | chat view with banner                                                       |
| s3-banner-dark-gone-after-1400.png                                             | dark  | after          | banner, parent gone (no "Open parent")                                      |
| s3-page-dark-gone-after-1400.png                                               | dark  | after          | chat view, parent gone                                                      |
| s3-page-dark-after-open-parent-clicked-1400.png                                | dark  | after          | after clicking "Open parent" (parent active, banner gone)                   |
| s4-late-dark-after-adopted-not-activated-1400.png                              | dark  | after          | late-adopted tab after bootstrap, parent still active                       |
| s4-late-dark-after-first-activation-1400.png                                   | dark  | after          | late tab after first activation, VS Code-style host: transcript still empty |
| s4b-late-dark-after-first-activation-workspace-active-1400.png                 | dark  | after          | same with emulated active workspace: history loaded (diagnostic)            |
| s5-focus-badge-dark-after-1400.png                                             | dark  | after          | keyboard focus on badge                                                     |
| s5-focus-openparent-dark-after-1400.png                                        | dark  | after          | keyboard focus on "Open parent"                                             |
| s6-tabbar-dark-before-360.png / -after-360.png / s6-page-dark-after-360.png    | dark  | before / after | 360px (full-window fallback)                                                |
| s6-tabbar-dark-before-800.png / -after-800.png / s6-page-dark-after-800.png    | dark  | before / after | 800px (full-window fallback)                                                |
| s6-tabbar-dark-before-1000.png / -after-1000.png / s6-page-dark-after-1000.png | dark  | before / after | 1000px                                                                      |
| s1-tabbar-light-before-1400.png                                                | light | before         | tab bar, child tab without badge                                            |
| s1-page-light-before-1400.png                                                  | light | before         | full window                                                                 |
| s1-tabbar-light-after-1400.png                                                 | light | after          | tab bar, badge                                                              |
| s1-page-light-after-1400.png                                                   | light | after          | full window after live push                                                 |
| s2-tooltip-parent-light-after-1400.png                                         | light | after          | badge hovered, parent present (native tooltip not captured)                 |
| s2-tooltip-gone-light-after-1400.png                                           | light | after          | badge hovered, parent gone (native tooltip not captured)                    |
| s3-banner-light-parent-after-1400.png                                          | light | after          | banner with "Open parent"                                                   |
| s3-page-light-parent-after-1400.png                                            | light | after          | chat view with banner                                                       |
| s3-banner-light-gone-after-1400.png                                            | light | after          | banner, parent gone                                                         |
| s3-page-light-gone-after-1400.png                                              | light | after          | chat view, parent gone                                                      |
| s3-page-light-after-open-parent-clicked-1400.png                               | light | after          | after "Open parent"                                                         |
| s4-late-light-after-adopted-not-activated-1400.png                             | light | after          | late-adopted tab, not activated                                             |
| s4-late-light-after-first-activation-1400.png                                  | light | after          | late tab after first activation, transcript still empty                     |
| s4b-late-light-after-first-activation-workspace-active-1400.png                | light | after          | same with emulated active workspace: history loaded                         |
| s5-focus-badge-light-after-1400.png                                            | light | after          | keyboard focus on badge                                                     |
| s5-focus-openparent-light-after-1400.png                                       | light | after          | keyboard focus on "Open parent"                                             |
| s6-*-light-{before,after}-{360,800,1000}.png                                   | light | before / after | same set as dark                                                            |

## Findings by severity

### Major (behaviour, visible in the late-adoption shot)

#### 1. A late-adopted tab shows an empty welcome screen on first activation when no workspace path is active

- File: `libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts:318-330` (cause),
  `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:822-835` (`requireTargetTab`, throws),
  `libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts:175-193` (`loadAgentHistory`, swallows with `console.warn`).
- Viewports: all (1400 shown). Themes: both.
- Screenshots: `s4-late-dark-after-first-activation-1400.png`, `s4-late-light-after-first-activation-1400.png` (failure);
  `s4b-late-*-workspace-active-1400.png` (works once a workspace path is active).
- Problem: with a VS Code-style host the partition's `activeWorkspacePath` is null (only `ElectronLayoutService`
  coordinates a workspace switch). `findTabByIdAcrossWorkspaces(tabId)` returns null when `activePath` is null even
  though the tab is in the active `_tabs()` set; I confirmed `tabs()` contains the tab and the lookup returns `null`.
  `requireTargetTab` then throws "Compaction reload target ... no longer owns session ...", `loadAgentHistory`
  catches it, and the tab keeps `messages: []`, so the user sees the "Ptah / Get started" welcome screen under the
  "Started by ..." banner. Console shows `[AgentSessionAdoption] history load for agent tab failed`. On re-activation
  I observed no new `chat:resume` (only `setup-status:get-status`), so the "retry once on next activation" in
  `code-logic-review-b7-r1.md` was not seen in this host.
- Impact: in a VS Code panel the user opens a recovered agent tab and sees a blank welcome screen instead of its
  transcript; the only cue that it is a session at all is the banner. The code review's A2 fix does not work here.
- Fix: make the lookup resolve tabs in the active set when no workspace is active (pass `this._tabs()` into the
  partition lookup and fall back to it when `activePath` is null: `tab-workspace-partition.service.ts:322-330`), or have
  `requireTargetTab` search `tabManager.tabs()` first. Add a spec with `activeWorkspacePath === null`.
- Confidence: MEDIUM. The cause is shown in the rendered bundle and in a one-line probe, but a real VS Code host was
  not run. Batch 9 smoke S1b under VS Code must confirm. The same lookup also affects the existing compaction reload
  on a null-workspace host (pre-existing, outside B7).

### Serious

#### 2. Light theme: badge text, border and focus ring fail contrast

- File: `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts:75` (`badge badge-xs badge-outline badge-info ... focus-visible:outline-info`).
- Viewports: all with a visible tab bar. Theme: light (`anubis-light`).
- Screenshots: `s1-tabbar-light-after-1400.png`, `s5-focus-badge-light-after-1400.png`.
- Problem: measured (canvas-composited, alpha-aware):
  badge text `oklch(0.68 0.169 237)` on the tab-strip background = 2.59:1 at 9px/400 (AA needs 4.5:1);
  the 2px focus outline is the same info colour = 2.59:1 (AA focus indicator needs 3:1);
  the outline border measured against its surround was 1.24:1 in the resting state (the daisyUI `badge-outline`
  border resolved to base-content/10 in this theme, not the info colour).
  Dark theme for the same elements: 5.04:1 text, 5.04:1 border, 2px info ring: passes.
- Impact: low-vision users in light themes cannot read "agent" and cannot see which control has focus.
- Fix: do not use `text-info` on light backgrounds; use `text-base-content` (or `text-info-content` on a filled
  `badge-info`) with the info colour only on the icon, and a focus ring from a token that meets 3:1 in both modes
  (the "Open parent" gold ring already does).

### Moderate

#### 3. The badge reads as belonging to the parent tab, and is a 14px-high target

- File: `tab-bar.component.ts:69-90` (badge emitted as a sibling BEFORE `ptah-tab-item`, with `-mr-1`).
- Screenshots: `s1-tabbar-dark-after-1400.png`, `s1-tabbar-light-after-1400.png`.
- Problem: the badge sits in the gap between the parent tab and the child tab and overlaps the gap by 4px on the
  side of the child, so it visually trails the previous tab ("Parent: refactor auth [agent] Agent: add auth tests").
  Measured size 46 x 14 px. Under WCAG 2.2 2.5.8 this passes only through the spacing exception (its 24px circle
  reaches no neighbouring target); it is below the 44px platform guidance.
- Fix: render the badge inside the child's tab item (before the title), or make it part of the tab's own button so
  association and hit area follow the tab.

#### 4. "Parent gone" badge looks identical to the live one; tooltip is native only

- File: `tab-bar.component.ts:75-80` (`cursor-pointer`, `[attr.aria-disabled]`, `[title]`).
- Screenshots: `s2-tooltip-gone-dark-after-1400.png`, `s2-tooltip-gone-light-after-1400.png` against the `parent` variants.
- Problem: with the parent gone the badge keeps the pointer cursor and full-strength styling; only `aria-disabled="true"`
  differs, and a click does nothing (verified: it neither switches tab nor shows feedback). Tooltip text is a native
  `title`: parent present = `Started by Parent: refactor auth · feat/agent-auth-tests · C:\ws\.worktrees\feat-agent-auth-tests`;
  gone = `Started by an agent session (parent tab closed) · feat/agent-auth-tests · C:\ws\.worktrees\feat-agent-auth-tests`.
  Native titles are not reachable for keyboard-only or touch users (the focus-visible state shows only the ring), and
  the long worktree path is unbounded.
- Fix: drop `cursor-pointer` and dim the badge when the parent is gone; show the same text via the project's tooltip
  component (the one already used for other badges) so it appears on focus, with the path truncated.

#### 5. Banner: duplicated sentence, tall at narrow width, and a layout shift on first display

- File: `libs/frontend/chat/src/lib/components/molecules/agent-origin-banner/agent-origin-banner.component.ts:40` and `:61`
  (the same "Started by X" appears in the heading and again at the start of the paragraph).
- Viewports: 360, 800. Screenshots: `s6-page-light-after-360.png`, `s6-page-dark-after-360.png`, `s3-banner-light-parent-after-1400.png`.
- Problem: the paragraph repeats the heading; at 360px the banner is 165px tall (26% of a 640px viewport) before the
  transcript. Layout shift measured when the child tab is first shown: CLS 0.117 + 0.044 at 360 and 0.117 at 800,
  against 0.00005 and about 0.002 at the base commit for the same tab bar (above the 0.1 "good" threshold). At 1000
  and 1400 it is 0.004 or less. Contrast of the paragraph passes: 5.07:1 dark, 4.56:1 light (light is close to the limit).
- Fix: drop the repeated clause from the paragraph, collapse the policy sentences behind a disclosure at narrow widths,
  and reserve the banner's height (or render it in the first paint) so the transcript does not jump.

#### 6. At 800px and below the tab bar has no usable width, so the badge is invisible (pre-existing layout, not a regression)

- File: `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:473-476` (`<ptah-tab-bar>` in a `flex-1 min-w-0` cell shared with the header labels).
- Screenshots: `s6-*-800.png`, `s6-*-360.png`, `s6-*-1000.png`.
- Problem: the tab strip's scroll container is 8px wide at 360 and 800 and 125-127px at 1000, in both before and after
  builds (measured `clientWidth`). The new badge therefore cannot be seen at those widths, so the banner is the only
  cue. No horizontal page scroll (`scrollWidth` equals viewport at every width) and the banner itself does not overflow
  (`scrollWidth` equals `clientWidth`). Related: a live push moves the existing tabs 63px left (the strip is centred;
  `live-parent-box` 570.6 to 507.6), an unprompted move while a user may be about to click a tab.
- Fix (separate task if preferred): collapse header labels earlier so the strip keeps a minimum width; anchor the
  strip start-aligned so an adopted tab appends instead of re-centring.

### Minor and observations

- Banner Bot icon: 4.81:1 dark but 2.36:1 light (`agent-origin-banner.component.ts:35-37`, `text-info`); decorative
  (`aria-hidden`), so not a failure, but it shares defect 2's cause. Banner border (`border-info/40`) is 1.78:1 / 1.49:1;
  informational container only.
- On first activation of a late tab with the workspace active I saw two `chat:resume` calls to the same session and tab
  (about 70ms and 150ms after the click): one from the existing `refreshResumableSubagentsForSession` path and one from
  the new `loadAgentHistory`. Not visible, but the backend loads that session twice. Logic review should decide.
- Two banners exist in the DOM when a tab is shown: the visible one and a 0x0 copy inside the hidden Orchestra Canvas
  tile (`ptah-canvas-tile`). Not a visual issue; it only breaks locators that assume one.
- The Thoth hint toast overlays the left of the page in every harness shot until dismissed; I dismissed it with its
  "Dismiss Thoth hint" button before capture. Unrelated to B7.

## Prototype fidelity

- Approved prototype: None (rendered UI added without a prototype, F10; batches.md B7 Review line).
- Fidelity assessment: NOT APPLICABLE.
- Before/after comparison (no prototype), dark and light:
  - `s1-tabbar-dark-before-1400.png` vs `s1-tabbar-dark-after-1400.png`: badge added, no other regression; tab sizes and order unchanged.
  - `s1-tabbar-light-before-1400.png` vs `s1-tabbar-light-after-1400.png`: same, but the badge is low contrast (defect 2).
  - `s1-page-*-before` vs `s1-page-*-after`: chat area identical (the active tab is still the parent, no banner).
  - `s6-*-before` vs `s6-*-after` at 360, 800 and 1000, dark and light: tab strip width unchanged; the after build adds the banner when the child is active (defect 5).
  - No document-level horizontal overflow at any width in either build.

## Viewport results

| Width | Screen                    | Checked                                                              | Status       | Screenshots |
| ----- | ------------------------- | -------------------------------------------------------------------- | ------------ | ----------- |
| 1400  | tab bar, banner, late tab | badge, banner, focus, adoption                                       | issues 1-5   | `s1`..`s5`  |
| 1000  | tab bar 125px wide        | badge visible only partly, banner fits (933px, no overflow)          | defect 6     | `s6-*-1000` |
| 800   | tab bar 8px wide          | badge not visible; banner 89px tall, no overflow; CLS 0.117          | defects 5, 6 | `s6-*-800`  |
| 360   | tab bar 8px wide          | badge not visible; banner 165px tall, no overflow; CLS 0.117 + 0.044 | defects 5, 6 | `s6-*-360`  |

## Component and interaction results

| Component                       | States tested                                                                           | Status                                                                             | Evidence                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Agent badge, parent present     | default, hover, Tab focus, click (switches to parent)                                   | works; contrast fails in light                                                     | `s1`, `s2-parent`, `s5-focus-badge`                                   |
| Agent badge, parent gone        | default, hover, click (no-op, no feedback)                                              | works functionally; weak affordance                                                | `s2-gone`                                                             |
| Badge tooltip                   | native `title` text read from DOM                                                       | text correct for both variants; bubble not capturable                              | DOM values above                                                      |
| Banner, parent present          | default, Tab focus on "Open parent", click (parent becomes active, banner removed)      | works                                                                              | `s3-*-parent`, `s5-focus-openparent`, `s3-page-*-open-parent-clicked` |
| Banner, parent gone             | default                                                                                 | no "Open parent", heading says "an agent session whose tab is closed"              | `s3-*-gone`                                                           |
| Live adoption push              | tab added after parent, focus unchanged (parent stays active), no banner for the parent | works; layout-shift values 0.0013 and 0.0012                                       | `s1-*-after`                                                          |
| Late adoption, bootstrap        | tab appears with badge, parent stays active                                             | works                                                                              | `s4-*-not-activated`                                                  |
| Late adoption, first activation | history load                                                                            | FAILS under a VS Code-style host (defect 1); loads when a workspace path is active | `s4-*-first-activation`, `s4b-*`                                      |

Tab order (dark and light identical): header controls, then the tab items, with the badge directly before the child's
tab item, then the header actions, and later "Open parent" in the chat view. The badge and "Open parent" are both
reachable with no keyboard trap.

## Design system compliance

| Token expected      | Observed                                                                                                                  | Where                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Text 4.5:1          | badge light 2.59:1                                                                                                        | `tab-bar.component.ts:75`             |
| Focus indicator 3:1 | badge ring light 2.59:1; "Open parent" ring gold passes (dark ~7:1 on `oklch(0.77 0.14 91)`, light `oklch(0.58 0.13 75)`) | `tab-bar.component.ts:75`             |
| Body size           | badge 9px, banner 11px (the repo uses 11px for secondary text elsewhere); guidance only, not an AA minimum                | both components                       |
| Muted text token    | banner paragraph uses `text-base-content-muted`: 5.07:1 dark, 4.56:1 light                                                | `agent-origin-banner.component.ts:60` |

## Accessibility audit

- Contrast (canvas-composited), dark/light: badge text 5.04 / 2.59; banner title 5.07 / 14.46; banner paragraph and mono
  branch 5.07 / 4.56; "Open parent" 14.17 / 14.46; Bot icon 4.81 / 2.36 (decorative); badge border 5.04 / 1.24; banner border 1.78 / 1.49.
- Semantics: badge is a `<button>` with `aria-label` ("Started by agent session ..." / "... whose tab is closed") and
  `aria-disabled="true"` when the parent is gone; banner is `role="note"` with `aria-label`; "Open parent" has an
  `aria-label` naming the parent. Good.
- Targets: badge 46 x 14 px (spacing exception applies; 44px guidance not met); "Open parent" is a `btn-xs` of about 24px height.
- Focus: visible on both controls in both themes; the badge ring fails 3:1 in light (defect 2).

## Visual performance

- Live push: layout-shift entries 0.0013 and 0.0012 (negligible); existing tabs shift 63px (defect 6 note).
- Banner first display: CLS 0.117 at 360 and 800 (defect 5); not reproduced at 1000 or 1400.
- No animation was added; no spinner or skeleton appears while the late tab loads (the welcome screen shows instead; defect 1).

## Verdict

- Recommendation: REVISE (the repo has no APPROVE/REVISE/REJECT mismatch here: no visual-breaking defect, one major and one serious).
- Confidence: MEDIUM (rendered bundle, mocked RPC, VS Code-style host only; no real host run).
- Key concern: a late-adopted agent tab opens as an empty welcome screen when the host has no active workspace path
  (defect 1); fix the null-workspace tab lookup before B7 is committed, then fix the light-theme badge contrast (defect 2).

## Re-check for the next round

After the fixes, re-run `visual-b7/harness/run.mjs` against a fresh build (set the `after` and `before` paths in the
script) and capture `s2` with a project tooltip component instead of the native `title`, so the tooltip can be shown.
