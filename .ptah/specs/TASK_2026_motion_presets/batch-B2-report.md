# Batch B2 report

## Changes

- `libs/frontend/ui/src/lib/motion/motion-stage.directive.ts:22`: added the standalone stage directive, immediate direction attribute, state capture/restore, and filtered entrance replay with listener and rAF cleanup.
- `libs/frontend/ui/src/lib/motion/motion-route-stage.directive.ts:55`: added the standalone router stage, pre-activation target handling, reuse replay, navigation rollback, and a single bounded optional leave clone.
- `libs/frontend/ui/src/lib/motion/motion-route-keys.ts:3`: added target-snapshot key types and `detailParamKey`, including decoded parameter handling.
- `libs/frontend/ui/src/lib/motion/index.ts:1` and `libs/frontend/ui/src/index.ts:40`: exported the motion API through the UI public barrel.
- `libs/frontend/ui/src/lib/native/tab-group/native-tab-group.component.ts:116`: made the existing tabpanel a motion stage; `activeIndex` follows the selected tab's position (`:172`).
- `libs/frontend/ui/src/lib/motion/motion-stage.directive.spec.ts:25`, `motion-route-stage.directive.spec.ts:50`, `motion-route-keys.spec.ts:11`, and `native-tab-group.component.spec.ts:210`: added focused direction, replay, event-filtering, route-reuse, clone-replacement, rejected-guard, no-animation cleanup, stage-destruction, decoded-key, and tab-order tests.

## Public API

- `[ptahMotionStage]` (`exportAs: 'ptahMotionStage'`): `motionIndex = input<number | null>(null)`, `motionReplayKey = input<unknown>(undefined)`; `setIndex(index)`, `captureState()`, `restoreState(state)`, and `replay()`. Exports `MotionStageDirective`, `MotionDirection = 'forward' | 'back'`, and `MotionStageState`.
- `[ptahMotionRouteStage]`: `motionRouteKey = input.required<MotionRouteKeyFn>()`, `motionLeaveClone = input(false)`; composes `MotionStageDirective` as a host directive. Exports `MotionRouteStageDirective`.
- Route keys: exports `MotionRouteKey { readonly key: string; readonly index: number | null }`, `MotionRouteKeyFn = (target: RouterStateSnapshot) => MotionRouteKey | null`, and `detailParamKey(listRoute: ActivatedRoute, param: string): MotionRouteKeyFn`.
- All exports pass through `libs/frontend/ui/src/lib/motion/index.ts` and `libs/frontend/ui/src/index.ts` for `@ptah-extension/ui` consumers. `ptah-native-tab-group` keeps its existing selector and inputs; its tabpanel now owns `[ptahMotionStage]` and `[motionIndex]`.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use `GuardsCheckEnd` with `shouldActivate` and the target snapshot for route state. | Pre-activation event or `NavigationEnd` page signals. | Approved plan component 3b and review round 1; the latter updates too late for entrance direction. | Yes. |
| Read clone timing from `--ptah-motion-out` and running animations, with a margin; retain the plan's 1500 ms minimum hard cap. | Token/animation timing or a fixed mirrored duration. | The user requires JS windows to exceed the CSS token duration plus margin; the plan requires bounded clone cleanup. | Yes. |
| Keep glass behavior in CSS and never set panel opacity from either directive. | JS opacity or CSS preset rules. | User decision 3 and plan glass contract; the directives only apply classes and direction attributes. | Yes. |

## Verification

- `npm run verify -- -t test -p @ptah-extension/ui -- --testPathPatterns="motion-|native-tab-group"`: initial run failed in two new test fixtures (jsdom lacks `AnimationEvent`; a test route lacked a component); corrected both. Final expanded run: **NX 1 task: 1 succeeded**, duration **12.4s**, cache **0/1 hit**.
- `npm run verify -- -p @ptah-extension/ui`: **NX 3 tasks: 2 succeeded, 1 failed**; failed target `@ptah-extension/ui:lint`; duration **1m 12s**, cache **0/2 hit**. The lint error is `@nx/dependency-checks`: `@angular/router` is missing from `libs/frontend/ui/package.json` `peerDependencies`. Its only other reported findings are five pre-existing non-null assertion warnings in `native-popover.component.spec.ts`.
- Scoped `ptah_get_diagnostics` after edits: **0 diagnostics in requested B2 files**. It reports eight pre-existing errors in other UI/shared files. The full verify preceded the final test-only addition; the focused suite and scoped diagnostics ran after it.
- No rendered screenshot: the task forbids serving or launching Electron, and the directive has no standalone HTML artifact within the B2 file scope.

## Not done / Clarifications Needed

1. **Required package metadata outside B2 scope:** add `"@angular/router": "~22.2.0"` to `libs/frontend/ui/package.json` `peerDependencies`, then rerun the full UI verify. The user explicitly limits edits to B2's file list, so this lane did not change that file. Recommended: authorize the package metadata change in the owning batch.
2. `libs/frontend/marketplace/src/lib/shell/marketplace-motion-key.ts` (+ spec) is mentioned under plan component 3b but is outside the B2 batch table's edit set. It remains for the Marketplace batch.
3. The Electron visual gate and Marketplace owner-level detail exit are later-batch work and were not run or edited here.

## Revise round 1

### Changes

- `libs/frontend/ui/src/lib/motion/motion-stage.directive.ts:72`: replay selects only a live panel, excluding `[data-motion-clone]`.
- `libs/frontend/ui/src/lib/motion/motion-route-stage.directive.ts:104`: a superseded pending navigation disposes its clone; the key comparison at `:110` preserves a running leave clone across a same-key navigation. Clone creation at `:131` excludes existing clones, and `:137` removes inherited entrance and leave classes before applying the leave class.
- `libs/frontend/ui/src/lib/native/tab-group/native-tab-group.component.ts:118`: passes `null` for no active tab. Selection motion at `:173` follows tab IDs in the current visual order, retaining the same motion index when tabs are inserted or removed around the selected tab.
- `libs/frontend/ui/src/lib/motion/motion-route-stage.directive.spec.ts:108`: covers a same-key query navigation while a leave clone is running. Tests at `:179`, `:210`, `:229`, and `:271` cover the paused interval before `NavigationEnd`, inherited class cleanup, UrlTree guard redirect, completion fallback, 1500 ms cap, and listener/timer/rAF cleanup after destroy. The destroy test checks clone cleanup directly, then drains unrelated Angular harness timers before asserting `jest.getTimerCount() === 0`.
- `libs/frontend/ui/src/lib/native/tab-group/native-tab-group.component.spec.ts:224`: covers insertion and removal before the selection and the no-active-tab state.

### Decisions

- Kept the existing public selectors, inputs, and exports. The tab group retains its `activeIndex` computed signal; its value now represents motion position across tab-list edits, and the template passes `null` to the stage when it is `-1`.
- Preserved a completed navigation's running clone when a later navigation resolves to the same motion key. A superseded *pending* navigation still disposes its clone.
- The prior report's `@angular/router` peer-dependency lint blocker is resolved by the coordinator's package metadata change; it was outside this lane's B2 edit scope.

### Verification

- `npm run verify -- -t test -p @ptah-extension/ui -- --testPathPatterns="motion-|native-tab-group"`: **NX 1 task: 1 succeeded**; run duration **8.0s**; cache **0/1 hit (0%)**. Earlier revision attempts failed in the new fake-timer fixture; the final run passed.
- `npm run verify -- -p @ptah-extension/ui`: **NX 3 tasks: 3 succeeded**; run duration **1m 52s**; cache **0/3 hit (0%)**.
- No rendered UI screenshot was taken: this revision changes directives and a tab-group template, while the task prohibits build, serve, Electron launch, and edits to the other lane's styles and page files.

### Not done / Clarifications Needed

- No B2 review finding remains open. Marketplace integration and the Electron visual gate remain with their later batches, as recorded above.
