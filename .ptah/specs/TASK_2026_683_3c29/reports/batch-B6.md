# Batch B6 — canvas motion

## Changes

- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:54,60-66,183-190,282`: changed the existing lane entrance to `var(--ptah-ease-soft)`; removed the focus fade styles, template class binding, `fade` signal, and the tab-change effect that requested a frame. Lane headers, transcripts, and subagent output were untouched.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:83-88,168,302`: added a reduced-motion-gated, compositor-only 180 ms pane entrance and the exact `[animate.enter]="splitDisplayed() ? 'rail-pane-enter' : ''"` binding on the pane section. Initial single-pane creation evaluates to `''`; a newly created second pane receives the class. `focusSwaps` and `railShifts` host bindings remain at lines 78-79.
- The plan's pre-rebase pane line 160 is now 168, and `splitDisplayed` line 296 is now 302 after this edit. The merged deferred inspector remains in the current board template at lines 192-198.

## Verification

- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts:688-706`: added a tab-change regression. A `requestAnimationFrame` spy records caller stacks and asserts no frame originates from the lane view; a descendant may request one. It also asserts the tab panel keeps its plain class list.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts:453-462`: added a source binding assertion and checks `splitDisplayed()` false on initial mount and true after opening beside. This verifies the binding, not rendered animation; jsdom does not run Angular's entrance animation.
- Focused Jest command run three times, one at a time: first run had 110 pass / 1 fail because the new spy initially counted a descendant's frame; after narrowing the assertion, runs two and three each passed **2 suites, 111 tests**. Final command: `npx jest -c libs/frontend/canvas/jest.config.ts libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts --coverage=false --maxWorkers=2`.
- Scoped `ptah_get_diagnostics` after edits: zero diagnostics in the four changed files. It reported seven errors in sibling files outside B6 ownership (`orchestra-canvas.rail.spec.ts`, `mock-rpc-service.ts`, `capability-id-codec.ts`).
- Removal search: `rg -n "rail-fade-start|rail-focus-fade|fade\\(" libs/frontend/canvas/src` → **no matches** (`rg` exit 1).
- M1 S8 frame-strip evidence, including reduced motion, remains for the orchestrator's visual run. No visual check was run in this batch.

## Decisions

- **Pane animation timing:** used 180 ms with `var(--ptah-ease-soft)`. The plan's motion table specifies 180 ms for this pane, while the available global entrance duration token is 200 ms. Options were the exact 180 ms contract or the 200 ms global token. This is reversible by changing one CSS declaration.
- **Binding test:** asserted the exact template binding from source and checked the computed split state. Options were a source assertion or attempting a jsdom animation assertion; the plan states that `animate.enter` is disabled in jsdom when `getAnimations` is absent. This is reversible if an animation-capable harness is added.
- **Frame test:** filtered spy calls by lane-view call stack after the initial broad assertion failed on a descendant's frame. The contract concerns frames requested by this component. This is reversible if the descendant's scheduling is later removed.
