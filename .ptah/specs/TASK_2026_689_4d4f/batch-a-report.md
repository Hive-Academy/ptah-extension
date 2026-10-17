# Batch A report — placement and streams

## Files created

- `libs/frontend/command-center/src/lib/scene/scene-placement.ts`
- `libs/frontend/command-center/src/lib/scene/scene-placement.spec.ts`
- `libs/frontend/command-center/src/lib/scene/command-streams.component.ts`
- `libs/frontend/command-center/src/lib/scene/command-streams.component.css`
- `libs/frontend/command-center/src/lib/scene/command-streams.component.spec.ts`

## Acceptance evidence

| Item | Evidence |
| --- | --- |
| Fixed model contracts and 23-node cap | `scene-placement.ts:4-25,42-107` exports `PlacedNode`, `OverflowCounts`, `StatusCounts`, and `placeScene`; priority/ancestor inclusion and projection-order output are at `:61-99`. Numeric tests are at `scene-placement.spec.ts:23-44`. |
| Counts, overflow, and phase exclusion | `scene-placement.ts:50-59,89-106` excludes root and phases from delegated counts, splits completed/other overflow, and attaches phases to their tribunal; `scene-placement.spec.ts:45-63` covers two tribunals with different phase sets. |
| Stable stream rows and pinned slot | `command-streams.component.ts:31-82` tracks `node.id`, keeps all placed rows mounted, exposes required DOM hooks, reserves the inline slot immediately after its pinned row, and leaves the full-list link outside the viewport. `command-streams.component.css:3-20,56-60` sets 44px rows, 5px gaps, 7px padding, and 10/6/4/3 row viewport heights. |
| Keyboard, hover, selection, and ARIA | `command-streams.component.ts:36-49,95-111,159-184` provides native buttons, roving focus, click activation including repeat activation, hover, Escape, and measurement outputs; `command-streams.component.spec.ts:37-64,87-103` covers these. |
| Provider, state, and tribunal cues | `command-streams.component.ts:51-72,114-156` renders provider monogram/text, visible state words, Lucide icons, age when timestamp exists, and separate tribunal progress arcs. `command-streams.component.spec.ts:19-35,65-85,105-118` covers every explicit state plus unknown, two tribunal values, zero-phase progress, and age. |
| Theme and reduced motion | `command-streams.component.css:29-60` uses the webview's semantic surface and state ink variables. The only repeating animation rotates the loader by `transform` over 3.7s; both the input class and media query freeze it. `command-streams.component.spec.ts:87-103` checks the static class. |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Make `PlacedNode` a `CommandWorkNode` subtype with `phases` attached by placement. | Add an extra projection input to streams / attach phases to placed nodes. | The fixed stream input is only `placed`, while plan §1 requires each tribunal's own phase cue (`implementation-plan.md:61-64,100-104`). | Yes. |
| Count all projected non-root, non-phase delegates, including nodes skipped from visual placement due to broken ancestry. | Count only placed nodes / count all delegates. | Design specification says the four cards count the same non-root, non-phase set, while malformed chains must be skipped from placement (`design-spec.md:9`; `implementation-plan.md:62-63`). | Yes. |
| Use native button click for Enter and Space activation; handle arrows, Home, End, and Escape on keydown. | Emit on both keydown and click / rely on native activation. | Native button activation avoids duplicate output for one keyboard action; fixed contract requires click, Enter, and Space (`implementation-plan.md:62,104`). | Yes. |

## Verification and remaining work

- The requested `ptah_get_diagnostics` scoped to the four TypeScript files returned `Unavailable`: its TypeScript check was still running after 45 seconds on both attempts. No clean diagnostic result is claimed.
- `ptah_ast_analyze` parsed all four TypeScript files with zero syntax errors.
- Nx, Jest, TypeScript CLI, build, and e2e were not run, as required for this parallel batch. The orchestrator owns scoped checks and page integration.
- Batch D2 must wire `placeScene` and `CommandStreamsComponent` into the page and position the actual plate in the slot. No other source files were changed in this batch.
