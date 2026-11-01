# D4 and D5 fix report

## Root causes

- **D4:** `SurfaceTransitionTracker.track()` in `libs/frontend/core/src/lib/routing/surface-view-transitions.ts:68` adds `html.ptah-vt-active` for a top-level view transition. The root snapshot crossfades with `ptahPageIn`, but the newly rendered surface's `ptah-motion-enter` panel (and chat pane entrance classes) still has its own preset animation. `MotionStageDirective.replay()` could also queue a class based entrance during the transition.
- **D5:** `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts` capped the popover at 28rem/448px in CSS and in `place()`, below the height needed for theme choices plus the Electron Motion and Animation style controls. The controls follow the theme and glass sections in DOM order, so they were below the scroll fold.

## Changes

- `apps/ptah-extension-webview/src/styles.css:840`: while `html.ptah-vt-active` is present, suppress the panel, chat pane and inspector preset entrance animations. The root `ptahPageIn` crossfade and reduced-motion rules still govern the surface transition. The selector is inactive on child route and tab changes.
- `libs/frontend/ui/src/lib/motion/motion-stage.directive.ts:71`: skip both immediate and queued stage replay while the root surface transition class is present.
- `libs/frontend/ui/src/lib/motion/motion-stage.directive.spec.ts:48`: pin that a child stage skips its entrance during a surface switch, replays on an in-surface change, and skips a replay queued just before the switch.
- `apps/ptah-extension-webview/src/app/motion-presets.spec.ts:9`: pin the root-class CSS suppression and continued in-surface preset rule.
- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts:62,586`: let the popover use the viewport height, with the existing 8px edge margin and anchor-aware placement, instead of the 448px cap. DOM and keyboard focus order remain unchanged.
- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.spec.ts:415`: pin placement of a 620px Electron menu within a 1186x738 viewport and the adjacent Motion then Animation style control order.

## Decisions

- Reused the existing `ptah-vt-active` class as the single surface-switch signal. CSS covers Angular's native enter classes; the stage directive avoids adding its replay class while that signal is active.
- Kept the original order of theme choices, Motion, and Animation style. The larger popover exposes the controls at the reviewed normal window height; smaller windows retain scrolling.
- Did not change `libs/frontend/marketplace/**`, which belongs to another writer.

## Verification

Command: `npm run verify -- -p @ptah-extension/ui,@ptah-extension/chat-ui,ptah-extension-webview`.

Exact Nx summary line: `NX   9 tasks: 8 succeeded, 1 failed`.

The failed target was `ptah-extension-webview:typecheck`. Its terminal output reports two `TS2339` errors at `libs/frontend/marketplace/src/lib/shell/marketplace-shell.component.ts:208`: `source` is not present on every `MarketplaceRoute` variant. That file is outside this lane's edit scope. The other eight tasks, including tests for the changed projects, succeeded. The verify command exited 1.

A static 1186x738 browser layout preview showed both motion groups visible within the viewport. The temporary preview file was removed after inspection. Scoped Ptah diagnostics twice returned unavailable after the 45s TypeScript check timeout.

## Could not check

The real Electron app could not be run in this lane. Therefore the actual popover's measured content height, live animations, keyboard focus behavior in Chromium, and visual behavior of the root crossfade still require an Electron app review. The static preview is not a substitute for that review.

## Revise round 1

### Defects and changes

- D4 restart on class removal: `apps/ptah-extension-webview/src/styles.css:840-844` now preserves the preset animation name and forces a 0.01ms duration, zero delay, and one iteration during the root crossfade. The reduced-motion rules were unchanged.
- D4 source-only test: `apps/ptah-extension-webview/src/app/motion-presets.spec.ts:9` now mounts a `.ptah-motion-enter` element, injects the real suppression rule from `styles.css`, toggles `ptah-vt-active`, and checks computed animation values when jsdom resolves them. It always checks parsed CSSOM declarations and confirms the rule does not reset `animation-name`.
- D5 controls below glass options: `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts:271-275` moves Electron Motion and Animation style controls ahead of Primary accent and Backdrop. DOM and focus order match the visual order. `theme-toggle.component.spec.ts:415` checks that order on a glass theme at 1186x738.
- D5 non-Electron regression: `theme-toggle.component.ts:62-67,216,590` applies the viewport-height cap only to Electron and restores the 28rem cap elsewhere, both in CSS and placement. `theme-toggle.component.spec.ts:415,442` checks the Electron and non-Electron branches.

### Verification

`npm run verify -- -p ptah-extension-webview,@ptah-extension/chat-ui,@ptah-extension/ui,@ptah-extension/core` exited 0: **12 tasks succeeded, 6 cached**. Relevant test names: "finishes a panel entrance during the root crossfade without resetting its animation name", "fits the Electron motion controls at the reviewed 1186 by 738 viewport", and "keeps the 28rem cap for non-Electron hosts".

In Chromium with the real `styles.css`, `getComputedStyle` reported `ptahMotionEnter` at 0.32s before, `ptahMotionEnter` at 0.01ms during, and `ptahMotionEnter` at 0.32s after the class toggle. A representative 1186x738 browser preview showed both motion groups before the glass options and the style group ending at about 549px, within the viewport. The preview used representative markup, so it does not measure the live Electron component's exact content height.

## Decisions

- Kept the original animation name during suppression so clearing `ptah-vt-active` cannot create a `none` to named-animation transition. The root crossfade remains responsible for the top-level surface change.
- jsdom may not resolve `:is()` and `!important` consistently in computed animation styles. The test checks computed values when available and otherwise checks the parsed CSSOM declarations; the Chromium check above verifies the actual cascade.
- `motion-stage.directive.ts:71-73` intentionally drops an in-surface `replay()` requested during the roughly 380ms root crossfade; a tab switch immediately after navigation can therefore omit that child entrance.

### Not done

- No live Electron run or exact Angular popover height measurement; the permitted verify command excludes build, serve, and e2e. The controls were moved above glass options so their reachability does not depend on those options fitting below them.
- Scoped Ptah diagnostics returned a transport error. The requested verify command passed.
