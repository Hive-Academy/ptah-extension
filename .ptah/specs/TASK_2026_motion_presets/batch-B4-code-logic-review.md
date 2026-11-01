# Batch B4 (Marketplace) — Code Logic Review

Review family: claude (implementer: codex)

Verdict: REVISE. Score: 6/10.

Scope read: all 20 modified files plus the 2 new files under `libs/frontend/marketplace`, the route-stage and stage directives, `motion-route-keys.ts`, the core `marketplace-route.ts`, `NativeDrawerComponent`, the plan (components 3, 3b, 5, R1, R2, R5) and the B4 report. I did not run verify: the report's own runs passed, and the issues below are not type or test failures. B1's CSS in this worktree is still the old file (no `.ptah-motion-stage` or `.ptah-motion-leave` rules yet), so the CSS-dependent findings were checked against the plan's specified rules (plan lines 252-267), not against shipped CSS.

## What holds up

- Route key and direction: `marketplacePageKey` parses `target.url` (the pending URL) through `marketplaceRouteOfUrl`, so it does not read the settled shell signal.
  - Index is `page*10 + source+1`. Bare `servers` and `skills` (the installed lists) map to 20 and 30, and sources map to 21-23 and 31-33. This matches the core route order.
  - A detail URL maps to the same key as its list, because the core parser drops the ref. Opening a detail is therefore a reuse, not a page switch (`marketplace-motion-key.ts:15-26`).
  - Direction is set in the directive's `GuardsCheckEnd` handler, before activation (`motion-route-stage.directive.ts:104-122`).
- One-shot and rapid navigation are handled in the directive: a second `GuardsCheckEnd` restores the prior state and disposes the clone, and Cancel, Error and Skipped events restore. B4 adds no state of its own, so nothing here breaks it.
- Every nested outlet's direct parent is a stage. All seven sites are wrapped:
  - shell
  - provider-list docked and drawer
  - connectors full-page and drawer
  - skills docked and drawer
  - Stages carry no padding. Padding stays on the panel hosts (`p-4` on the source hosts, `p-6` on the connector full-page div), so B6's absolute-leave lesson is respected.
  - Stages sit inside the scrollers (R2): the shell `main`, `native-drawer-body` and `docked-inspector-body`. The drawer and inspector headings stay outside the stages.
- Flag `MARKETPLACE_LEAVE_CLONE` is one constant passed to all seven stages.
  - With it true, `createClone` clones `:scope > .ptah-motion-panel`, which is the routed host for every Marketplace outlet.
  - The panel carries its own padding and `h-full`, so the absolute clone keeps its box. I found no Marketplace-side blocker for flipping it.
- The `@if (placement()==='drawer' && detailOpen())` rewrite in connectors lets the drawer `animate.leave` run. `NativeDrawerComponent.ngOnDestroy` restores focus, so focus return still works.

## Defects

1. **Serious. Global `.ptah-motion-leave` on docked-inspector hosts.**
   - Sites:
     - `pages/servers/provider-list-view.component.html:132-133`
     - `pages/skills/installed-skills-page.component.ts:397-398`
   - The inspector hosts are normal-flow elements: `sticky top-0 h-[calc(100vh-8rem)] w-[400px]` in provider-list, and `w-[400px] shrink-0` in skills. The plan's `.ptah-motion-leave` is global and sets `position:absolute; inset:0; z-index:1; overflow:hidden` (plan:264-267).
   - The inspector is not inside any stage. Once the glass cut is scoped correctly (the B1 request in the batch report), the leaving inspector in non-glass scenes will resolve against the shell stage. For 180 ms it is blown up to full page size and sits over the list with z-index 1.
   - The report says the cut applies in every theme today, which hides this. It is a latent defect, not an absent one. `sticky` and `absolute` also conflict on one element, so the result depends on CSS order.
   - Fix: do not reuse the stage leave class on a non-stage panel. Use a dedicated inline exit class, such as opacity and translate with no `position`, or have B1 scope the absolute rule to `.ptah-motion-stage > .ptah-motion-leave`. Record the dependency in B1's contract.

2. **Serious. `h-full` on the installed-skills host inside the shell stage.**
   - Sites: `pages/skills/installed-skills-page.component.ts:120` and `shell/marketplace-shell.component.html:105`.
   - The host is `flex h-full min-h-0` and its list column is `overflow-y-auto`. Before B4 it was a direct child of `main`, which has a definite height.
   - The new stage is `min-h-full` with auto height, so the percentage height resolves to auto. The page grows to its content, the inner list never scrolls, `main` scrolls the whole page instead, and the docked inspector scrolls away.
   - The plan prescribes `min-h-full`, but no one checked the one `h-full` page. The padding audit covered padding, not height.
   - Fix: give the stage `h-full min-h-full`, or `flex flex-col` with a `flex-1 min-h-0` panel. Add a layout assertion in the shell spec for this page.

3. **Moderate. Nested panels double-animate on first render.**
   - Sites:
     - `connectors-page.component.html:4-6` and `:23` (the host panel plus the inner branch panel)
     - `server-detail.component.html:251, 310, 399` (the host panel plus the default or active tab panel)
   - On a page or detail entry, both the routed host and the first branch or tab panel run `animate.enter`. The result is compounded translate and opacity, about 2x the rise. This is unverified here, because it depends on whether Angular runs enter for children created in the same pass.
   - The plan wanted the branch and tab panels for switching only.
   - Fix: suppress the first-render enter on inner panels, or check this in the Electron matrix before accepting.

4. **Moderate. The connectors list and full-page branch swap (M9a) has no local stage.**
   - Site: `connectors-page.component.html:1-6` and `:23`.
   - The leaving branch panel is absolute and anchors to the nearest positioned ancestor, which is the shell stage. It covers the whole page area. That is tolerable for a whole-page panel, but the leave overlay can paint over the incoming list, unlike the tab panels, which have a stage.
   - The report does not mention this.

5. **Moderate. Tests do not cover the plan's verification seam.** The B4 specs are structural only: parent is a stage, a panel exists.
   - Missing against plan lines 593-598:
     - an A→B param test inside `GuardsCheckEnd` (key is B while `detailRef`/`openRef` still show A) with exactly one replay
     - list→detail→list leaving no pending replay and no clone
     - any rapid-navigation case
     - any `MARKETPLACE_LEAVE_CLONE === true` case
   - The flag is a module constant with no injection seam, so the clone path cannot be tested without editing source. If G1 fails and the flag is flipped, the first execution of the clone path in Marketplace will be in production.
   - The shell spec's `expect(directions).toContain('back')` can be satisfied by any single `ActivationEnd` reading, and it does not assert the first reading.
   - The key spec does not cover `/marketplace/skills/<source>` other than `community`, skills sources in general, or query strings.
   - Fix: make the flag overridable, for example through an injection token with a false default, and add the cases above.

6. **Minor. Duplicated source lists.** `marketplace-motion-key.ts:7-8` copies `SERVER_SOURCES` and `SKILL_SOURCES` from the unexported core lists. A new source added in core gets index 0 for the page (`findIndex` returns -1) and silently loses its direction ordering. Export the lists from core, or add a drift test.

## Status of the open items

- The native-drawer exit (visible `.ptah-drawer-panel`) and the glass-selector scoping are open B1 items, as the report says. The hooks on the Marketplace side are in place. Defect 1 is the Marketplace-side half of the same B1 contract.
- G1 is not decided, so I cannot confirm that routed-host `animate.leave` works. With the flag at false, if G1 fails, detail→list and page switches degrade silently to enter-only. The plan says that is not an accepted end state, so the flag flip must be tracked.
- R1 (popovers in entering panels): the native drawers sit in the top layer, so an ancestor transform does not affect them. I found no other fixed-position popover inside a Marketplace panel. This is untested and belongs to the Electron matrix.

## Verdict

REVISE, 6/10. The key, direction, stage placement and flag wiring are correct. The two Serious defects (inspector leave class, and `h-full` under the min-height stage) would cause visible regressions once B1's CSS lands. The tests cover structure but not the behaviour the plan listed.

## Re-review round 1

Review family: reviewer claude, implementer codex. Score: 8/10. Verdict: APPROVED (G1 stays open for Electron; the cross-batch drawer item is owned by the Settings lane). I did not re-run `npm run verify`. I rely on the implementer's reported green run (6/6 tasks) and read the code and specs.

### Per-defect status

| # | r0 defect | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Global `.ptah-motion-leave` absolute on docked inspectors | FIXED | `apps/ptah-extension-webview/src/styles.css:954-964`: the global rule keeps overflow, pointer-events and animation. `position:absolute; inset:0; z-index:1` moved to `.ptah-motion-stage > .ptah-motion-leave`. Inspectors (`provider-list-view.component.html:132-133`, `installed-skills-page.component.ts:397-398`) are not stage children, so they leave in flow. `motion-presets.spec.ts:23-24` pins both selectors. |
| 2 | `h-full` skills host under `min-h-full` stage | FIXED | `marketplace-shell.component.html:105` stage is `flex h-full min-h-0 flex-col`. Skills host `installed-skills-page.component.ts:120` is `flex h-full min-h-0`. The other hosts are `block` flex items (min-height auto), so they do not shrink. No layout assertion was added (N3). |
| 3 | Nested panels double-animate on first render | PARTIAL | First render is gated: `connectors-page.component.html:6,23` (`hasRendered()`, set in `afterNextRender` at `.ts:397`) and `server-detail.component.html:251,310,399` (`hasSwitchedTab`, set only in `selectTab`, `.ts:449`). The click-opened full-page detail is not gated (N1). |
| 4 | Connectors branch swap has no local stage | FIXED | `connectors-page.component.html:1` has a local `ptahMotionStage`, with both branches as direct children. The nested route stage div is a direct child of the branch panel. |
| 5 | Tests miss the verification seam; flag not injectable | FIXED (small gaps) | `marketplace-motion-key.ts:7-11` token, default false. Shell spec: replay once on param switch and list-return cleanup (`marketplace-shell.component.spec.ts:285-299`), supersede (`:301`), clone path with true (`:317`). The supersede test does not assert the restored direction. |
| 6 | Duplicated source lists | FIXED | `marketplace-motion-key.spec.ts` parses core `SERVER_SOURCES` and `SKILL_SOURCES` from `marketplace-route.ts` and asserts each index. It parses source text, so it breaks loudly on a constant refactor, which is acceptable. |
| 7 | Glass drawer exit not cut | FIXED | `styles.css:966-975` animates the panel exit in all themes and cuts it under `:root[data-glass='on']`. The backdrop is untouched. Spec `motion-presets.spec.ts:48-53`. |

### New defects

1. Moderate, unverified: `connectors-page.component.html:4-6,15-17` plus `connector-detail.component.ts:94`. Opening a connector card at wide width creates the full-detail branch panel (`hasRendered()` is already true, so it enters) and the routed `connector-detail` host (host `animate.enter`) inside it. Both rise at once and compound. The r0 fix covered first render only. Gate one of them for this swap, or confirm in the Electron matrix.
2. Moderate (cross-batch, not a B4 file): `connection-detail-drawer.component.ts:82-86` and `voice-details-drawer.component.ts:61` still wrap the tab panels in `div[data-tab-body]` inside `NativeTabGroupComponent`'s stage (`native-tab-group.component.ts:117`). The leaving panel is not absolutely positioned, so for 180 ms the leaving and entering panels are both in flow. The incoming panel is pushed down, then jumps up.
3. Minor: no layout assertion for the installed-skills page inside the `h-full` stage. A later change to the stage classes would regress defect 2 silently.
4. Minor: the stage is now fixed height. A long leaving page (`inset:0`, `overflow:hidden`) is clipped to the viewport height and anchored at the stage top, not at the scroll offset, so a scrolled page can show a blank area during the exit. This follows the plan's R2 design; check in Electron.
5. Minor: `MARKETPLACE_LEAVE_CLONE` is provided twice with the same default (root factory at `marketplace-motion-key.ts:7-10`, shell providers at `marketplace-shell.component.ts:120`). Harmless. Flipping the one `_DEFAULT` constant is enough, as documented.

### Clone fallback if G1 forces the flag to true

`libs/frontend/ui/src/lib/motion/motion-route-stage.directive.ts:createClone` deep-copies `:scope > .ptah-motion-panel`. It appends the copy as a direct stage child with `ptah-motion-leave`, so the new scoped rule positions it. The copy is inert and aria-hidden. It is removed on animationend, on a cap timer, on cancel or error, and on destroy. The clone is out of flow, so the `flex-col` stage layout is unaffected. Correct.

Caveats:
- If G1 passes and the flag is also true, the host leaves twice (clone plus Angular's host leave). Flip the flag only when G1 fails.
- The clone duplicates DOM ids and `data-testid`s for about 230 ms, which can make e2e selectors match two nodes.
- The reduced-motion rule hides clones and the glass cut hides glass-surface clones, so no clone gets stuck.

### Cross-batch stage audit (scoped rule `.ptah-motion-stage > .ptah-motion-leave`)

Leaving element is a direct stage child (correct):
- B4 Marketplace: shell route stage, the routed detail and page stages, the connectors local stage, and server-detail tab panels (the `<ng-container>` projects them directly into the tab-group stage).
- B5 Settings main tabs: `settings.component.html:105-110,221,236,251`. The outer leave div is the direct child; the inner enter div is nested, which is fine for leave.
- B5 provider wizard: step stage `provider-setup-wizard.component.ts:440` and credential-mode stage `:650`. The manual `leaveSensitivePanel` is also on a direct child.
- B5 output-style preview/editor: `output-style-instructions-field.component.ts:83-141`.
- B6 Thoth: `thoth-shell.component.ts:226-246`, stage div with four direct `@switch` panels.

NOT a direct child (leaving element sits inside a wrapper, still wrapped in this worktree):
- Connection detail drawer tab panels: `libs/frontend/chat/src/lib/settings/providers/connection-detail-drawer.component.ts:82-86` (panels at `:86,91,101,114,122`), inside `div[data-tab-body]`.
- Voice details drawer tab panels: `libs/frontend/chat/src/lib/settings/ptah-ai/voice-details-drawer.component.ts:61-62,74`, inside `div[data-tab-body]`.

Outside any stage by design (leave in flow): the Marketplace docked inspectors (`provider-list-view.component.html:132`, `installed-skills-page.component.ts:397`) and the native drawer hosts (`display: contents`; only `.ptah-drawer-panel` animates).

B7 chat session tabs are unaffected. They use their own `:host(.ptah-pane-switch-leave)` absolute rule (`chat-transcript.component.css:17-22`) and use no `ptah-motion-leave` or stage. The `motion-style-picker` preview frame uses the stage class for positioning only, with no leave element.

### Verdict

Defects 1, 2, 4, 5, 6 and 7 are fixed. Defect 3 is mostly fixed; the click-open detail stack remains (N1, unverified). Nothing blocks the batch. Before acceptance, the Settings lane must make the two drawers' panels direct stage children or remove the wrapper. The Electron matrix must cover N1 and G1.

## Re-review round 2

Review family: reviewer claude, implementer codex

Score: 8/10. Verdict: APPROVED.

### D3 (double entrance at wide width): fixed
- `connector-detail.component.ts:93-98`: the routed host no longer declares enter/leave, only `ptah-motion-panel`.
- `connectors-page.component.html`: wide branch owns the single `ptahMotionEnter` (line ~5); the drawer path puts it only on the route-stage body (~304) and the drawer keeps only its leave. Each open path has exactly one enter target. `hasRendered()` gating keeps deep links static. Detail to list: the wide branch leaves and the list branch re-enters, which matches the user decision (detail to list exit). Leave-clone default stays false.
- Connector A to B in the wide branch replays via the inner `ptahMotionRouteStage` keyed on `detailMotionKey`: OK.

### D8 (scroll offset kept): fixed for page and source changes
- `marketplace-shell.component.ts:201-230`: the reset runs in the NavigationEnd subscriber only when `page` changes, or `source` changes on servers/skills. Detail-only and query-only navigations keep the offset. There is no scroll-restoration code in the Marketplace or webview (grep), so back-navigation restore is not broken.
- The old route is deactivated before NavigationEnd, so the leaving host should already carry `ptah-motion-leave` and get `top: -offset`.

### Defects (all non-blocking)
1. Minor, `marketplace-shell.component.spec.ts:256-275`: the leaving panel is a synthetic div appended by the test. It proves the reposition logic but not that Angular has applied `ptah-motion-leave` by NavigationEnd. A real leave may jump if the class is applied after NavigationEnd. Needs a fresh Electron check, which the lane could not do.
2. Minor, `connectors-page.component.spec.ts:515-537`: the spec asserts template-level targets, not rendered animation. Acceptable given Jest, but not behavioral proof of the visual fix.
3. Minor, `connectors-page.component.html:5,10,292`: resizing across the breakpoint with a detail open swaps branches. The list and detail then replay enter and leave, because `hasRendered` is already true. Cosmetic, one-off.
4. Minor, formatting only (route union, long single-line attributes in the html and shell subscriber). Not a logic finding.

No regression of the round-1 fixes found. Glass theme: no theme-specific code on these paths, no finding.

### Verify
- `npm run verify -- -p @ptah-extension/marketplace`: 3 tasks succeeded (lint, test, typecheck), 3 cached, exit 0.
- `npm run verify -- -t typecheck -p ptah-extension-webview`: 1 task succeeded, 0 cached, exit 0. The earlier TS2339 `MarketplaceRoute.source` is gone. The shell now narrows the route union by `page` before reading `source`.
