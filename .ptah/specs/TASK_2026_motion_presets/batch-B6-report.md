# Batch B6 — Thoth shell motion

## Changes

- `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:44,95`: import the B2 `MotionStageDirective` from the UI public API and register it with the standalone component.
- `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:223-250`: make the existing non-scrolling inner div the motion stage; wrap all four `@switch` bodies in B1 panels with Angular enter and leave classes. The scroller and tab rail stay mounted while panels overlap.
- `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:408`: compute the stage index from `THOTH_TAB_IDS` so rail order determines direction.
- `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.spec.ts:348`: cover the initial Memory panel and routed Memory→Cron (`forward`), Cron→Skills (`back`), and Skills→Gateway (`forward`) switches; assert each body has a panel wrapper.

## Surfaces covered

- All Thoth child routes and tab bodies: Memory, Skills, Schedules (Cron), and Messaging (Gateway).
- The stage uses B1's positioned overlap and leave classes, keeping the scrolling section in place during a switch. B1 CSS applies the selected preset and the glass-safe exception; the component adds no opacity animation.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Place the stage inside the existing scroll section and wrap each `@case` body. | Stage the scroller or use a route outlet. | Approved plan component 7 identifies the inner div; the shell uses a signal `@switch` and has no child outlet. | Yes. |
| Use `THOTH_TAB_IDS.indexOf(activeTab())` for direction. | Derive order from visible tiles or route events. | Approved plan component 7 and the B2 `motionIndex` API; tab IDs are the stable rail order. | Yes. |
| Leave opacity and glass handling to B1 preset CSS. | Add component animation styles. | B1's preset CSS contract provides overlap, timing, and glass rules; the task forbids editing global CSS and opacity on glass-bearing panels. | Yes. |

## Verification

- `npm run verify -- -t test -p @ptah-extension/thoth-shell -- --testPathPatterns=thoth-shell`: **NX 1 task: 1 succeeded**; duration **46.0s**; cache **0/1 hit (0%)**.
- `npm run verify -- -p @ptah-extension/thoth-shell`: **NX 3 tasks: 3 succeeded**; duration **1m 22s**; cache **0/3 hit (0%)**. Lint, test, and typecheck passed.
- Scoped `ptah_get_diagnostics` was called twice after edits. Its TypeScript service exceeded 45 seconds both times and marked the two files unchecked; the completed Nx typecheck above passed.

## Not done / Clarifications Needed

- No rendered Electron inspection: the task forbids build, serve, Electron launch, and e2e, and the Thoth component is not a standalone HTML artifact. The focused test checks structure and direction; a live frame-by-frame check of overlap, scroll position, and glass blur remains with the approved visual matrix.
- The named `angular-frontend-patterns` skill could not be loaded: this host exposed no skill-loading tool or skills catalogue, and the optional skill search found no match. Repository guidance and the approved plan governed the edit.
- No clarification is needed for B6.

## Revise round 1

- **Leave overlay alignment:** `thoth-shell.component.ts:225,231-248` removes padding from the positioned stage and puts the same responsive padding on each panel. The absolute leaving panel and in-flow incoming panel now share the same origin and width; the visible content keeps its former spacing. `thoth-shell.component.spec.ts:367` checks the stage and panel classes.
- **Enter/leave wiring and cleanup:** `thoth-shell.component.spec.ts:231-245` checks all four owning-template cases for the guarded `ptah-motion-enter` binding and `ptah-motion-leave` binding. `:367-411` checks that the selected body is a direct child panel and only one remains after each switch. Angular's `animate.*` runner is unavailable in jsdom because `document.documentElement.getAnimations` is absent, so these bindings cannot be observed as live classes in this Jest environment.
- **Direction and rapid switching:** `thoth-shell.component.spec.ts:414-453` checks a lower-index switch writes `back` and a higher-index switch writes `forward` before the old panel's removal mutation. `:455-473` checks a rapid Memory→Gateway→Skills sequence ends with one Skills panel and `back` direction. Reduced-motion CSS cannot be exercised in jsdom; the B1 CSS contract handles reduced motion, and live visual inspection is still needed for actual motion timing.
- **Initial enter:** `thoth-shell.component.ts:231-248,276,339` supplies an empty enter class until the first settled tab change; later switches use `ptah-motion-enter`. `thoth-shell.component.spec.ts:231-245,396,409` checks the guard expression and first-render/switch state. This prevents a second panel entrance during the top-level Thoth crossfade.
- **Verification:** Focused `npm run verify -- -t test -p @ptah-extension/thoth-shell -- --testPathPatterns=thoth-shell`: **NX 1 task: 1 succeeded**; duration **20.8s**; cache **0/1 hit (0%)**. Full `npm run verify -- -p @ptah-extension/thoth-shell`: **NX 3 tasks: 3 succeeded**; duration **44.6s**; cache **0/3 hit (0%)**. Scoped `ptah_get_diagnostics` found no diagnostics in the two requested Thoth files; it reported nine errors in other projects.
