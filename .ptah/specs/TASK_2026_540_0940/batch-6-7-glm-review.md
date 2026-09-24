# Batches 6 and 7 - Glm review

Reviewer: Glm (outside code-logic-reviewer lane). Scope: the uncommitted showcase diff
(`git diff -- apps/ptah-electron-e2e/src/showcase`), both batch reports, the Batch 6 and
Batch 7 contracts in `batches.md`, and the committed surfaces the scenes target
(`_harness/config-menu.ts`, `global-config-menu.component.ts`,
`electron-shell.component.ts`). No code was edited. All eight scene files were read in
full; every claim below carries file:line evidence.

## Batch 6

Verdict: ACCEPT ; Score: 9/10

The five scenes replace the removed top-nav candidate loops with
`openConfigSurface(page, director, <id>)`. Every id is correct and matches a real menu
item: `gateway-tour.scene.ts:87` and `cron-tour.scene.ts:64` pass `'thoth'`;
`setup-wizard-tour.scene.ts:49` passes `'setup-hub'`; `settings-tour.scene.ts:85`
passes `'settings'`; `marketplace-tour.scene.ts:79` passes `'marketplace'`. The ids
resolve against the committed menu component: `data-test="'config-menu-item-' +
item.id"` (global-config-menu.component.ts:67) over the item list `thoth`, `setup-hub`,
`marketplace`, `settings` (global-config-menu.component.ts:100-110). Every call passes
the scene's own `director`, so the menu clicks stay camera-recorded.

The following behaviour is preserved: the `#thoth-tab-gateway` click and
`#thoth-panel-gateway` wait (gateway-tour.scene.ts:90-93); the `#thoth-tab-cron` click,
`#thoth-panel-cron` wait and returned panel (cron-tour.scene.ts:65-70); the
`wizard-step` wait (setup-wizard-tour.scene.ts:51-56); the `ptah-settings` wait
(settings-tour.scene.ts:86); the hub-root wait (marketplace-tour.scene.ts:80-82). No
`say()`, spotlight, hover or scroll beat was touched by the diff. The marketplace hub's
own section tabs are untouched and remain scoped to the hub, not the shell
(marketplace-tour.scene.ts:93 and :114). The now-unused `clickFirstVisible` helper was
removed from marketplace-tour with no dangling reference; the same helper in
settings-tour is still called (settings-tour.scene.ts:241, :260) and was correctly kept,
as was setup-wizard's `firstVisible` (setup-wizard-tour.scene.ts:83) and cron's
`firstVisible` (cron-tour.scene.ts:91, :136, :147). No import became unused. No `as
any`, `@ts-ignore` or `@ts-expect-error` in any of the five files.

Findings:

1. Minor, gateway-tour.scene.ts:81-83 — The `goToGateway` doc comment still ends with
   "Best-effort selectors so the scene survives minor chrome changes". This no longer
   describes the code: `openConfigSurface` is strict — a missing trigger makes
   `director.click` fail, and a menu that does not open makes `item.waitFor` fail
   (config-menu.ts:17-21). Failure scenario: a maintainer reads the comment, assumes
   `goToGateway` degrades gracefully on a changed shell, and ships a capture run that
   in fact aborts. Fix: reword the sentence to describe the menu entry and its strict
   failure.

2. Minor (recorded improvement, no fix required) — The replacement changes the failure
   mode of two scenes from silent to loud. Old marketplace-tour skipped a missing tab
   (`clickFirstVisible` returned false) and its hub wait is catch-guarded
   (marketplace-tour.scene.ts:80-82), so a navigation failure produced a video narrated
   over the wrong surface; old setup-wizard-tour had the same shape
   (`if (tab) await director.click(tab)` plus catch-guarded waits). The new helper
   fails the capture instead. This is the correct direction for a marketing capture
   and satisfies the contract, but the behaviour change was not written down anywhere
   before this review.

## Batch 7

Verdict: ACCEPT ; Score: 9/10

The three renames are correct against the committed shell. The shell's Chat tab
carries `role="tab"`, `title="Chat"` and visible text "Chat"
(electron-shell.component.ts:125-135), and the Analytics tab carries `title="Analytics"`
and text "Analytics" (electron-shell.component.ts:159-169). So
`canvas-orchestra.scene.ts:44-45` and `chat-code-edit.scene.ts:179-181` (tab/button
`name: 'Chat'`, `[title="Chat"]`) and `dashboard-tour.scene.ts:53-56` (tab/button
`name: 'Analytics'`, `[aria-label="Analytics"]`, `[title="Analytics"]`) all resolve.
The critical behavioural risk was checked and does not hold: clicking the Chat tab is
not a no-op navigation, because `onCanvasTab()` calls `setLayoutMode('grid')` before
`setCurrentView('chat')` (electron-shell.component.ts:386-389), so the unguarded
`[data-testid="canvas-grid"]` waits that follow in both canvas scenes
(canvas-orchestra.scene.ts:61-63, chat-code-edit.scene.ts:191-193) still pass even
when the canvas restored a non-grid layout. Substring-name collisions were checked:
among the shell tabs (Chat, Tasks, Tribunal, Analytics) neither `'Chat'` nor
`'Analytics'` matches any other tab, and the tab candidates run before the button
candidates in every list.

The narration, script indices, JSON-script references and on-screen headings are
unchanged in all three files; the diff touches only selectors and the one allowed doc
comment (chat-code-edit.scene.ts:15-16, which now correctly states the global Chat tab
hosts the Orchestra Canvas). The `[title="Canvas"]` / `[aria-label="Canvas"]` /
`[data-testid="layout-toggle-grid"]` fallbacks were outside the rename contract and
staying is correct. My own sweep over `apps/ptah-electron-e2e/src` for the removed
tab names and old titles finds no leftover top-nav selector; the single hit
(`marketplace.spec.ts:28`, `getByRole('heading', { name: 'Marketplace' })`) is the
surface's own heading in a spec, not a top-nav tab, and is outside the sweep pattern's
role. The two expected canvas headings named by the contract were not touched. No
`as any`, `@ts-ignore` or `@ts-expect-error` in any of the three files. The reports
are accurate: batch-7-report's sweep table lists Batch 6's five files as "parallel
lane" hits and states at line 46 that this is a pre-merge snapshot; the merged tree is
clean, which I verified independently.

Findings:

1. Minor, canvas-orchestra.scene.ts:41-42 — The comment above the candidates says "The
   Canvas (grid) layout is reached from the chat surface's layout toggle", but the
   first two candidates now click the global Chat tab, which forces the grid layout
   itself; the toggle selectors at :46-48 are late fallbacks that are unreachable
   whenever the shell's tablist renders — and the tablist always renders under this
   scene's precondition of a restored workspace (electron-shell.component.ts:123).
   Failure scenario: a maintainer debugging a canvas-layout issue follows the comment
   to the layout toggle and misses the actual entry path. Fix: reword the comment to
   name the Chat tab as the primary entry and the toggle selectors as fallbacks.

2. Minor, chat-code-edit.scene.ts:182-183 — Same practical note for the retained
   `[title="Canvas"]` / `[aria-label="Canvas"]` fallbacks: they cannot be reached in
   the Electron shell while the Chat tab exists. Harmless as a resilience belt; no
   fix required. Relatedly, dashboard-tour.scene.ts:50 still says "Navigate to the
   Dashboard via the global Electron navbar tab" — the tab is now labelled Analytics,
   but "Dashboard" remains the surface's internal name (`openDashboard()`, view
   `'analytics'`), so the sentence stays defensible; rewording is optional.

3. Minor (report-accuracy note, no code change) — batch-7-report.md's sweep table
   cites old pre-merge line numbers for the "parallel lane" hits (for example
   `cron-tour.scene.ts:64` as a Thoth tab selector); in the merged tree that line is
   the `openConfigSurface` call. The report discloses the snapshot nature of these
   rows, and the team-leader re-runs the sweep, so this is a documentation footnote,
   not a defect.

## Shared verdict rationale

Both batches are mechanical, complete and verified against the committed surfaces
they consume. No blocking or serious issue was found: no silent-failure path was
introduced (Batch 6 in fact removes two), no wait, spotlight or narration beat was
lost, no removed helper or import is still referenced, and the renames preserve the
unguarded canvas-grid waits because the Chat tab sets the grid layout itself. What
separates the 9 from a lower band is evidence, not tone: every selector was matched
against the shell template, every id against the menu component, and the full file
reads confirmed the surrounding beats are intact. What keeps it from a 10 is the
comment drift in finding B6-1 and B7-1, where the code now contradicts its own
description.