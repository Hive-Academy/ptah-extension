# Batch D3 and E report

## D3

- Changed `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts`: removed the unused `canvasUnavailable` signal. Kept `hoveredNodeId` and the rest of the controller.
- `components/command-center-page.controller.spec.ts` needed no edit: it contained no canvas-failure expectation.
- Typecheck: `Successfully ran target typecheck for project @ptah-extension/command-center` (exit 0).
- Lint: `Successfully ran target lint for project @ptah-extension/command-center` (exit 0).
- Test: `Test Suites: 47 passed, 47 total`; `Tests: 426 passed, 426 total` (exit 0).

## E

- Before deletion, an `rg` search over `libs/` and `apps/` found imports of `command-scene-renderer`, `sprite-cache`, and `scene-layout` only within the six obsolete files and `model/work-projection.spec.ts`. No other file imported them.
- Deleted `scene/command-scene-renderer.ts`, `scene/command-scene-renderer.spec.ts`, `scene/sprite-cache.ts`, `scene/sprite-cache.spec.ts`, `scene/scene-layout.ts`, and `scene/scene-layout.spec.ts`.
- Changed `model/work-projection.spec.ts`: removed the layout import and its rendered-label assertion; the pure projection assertion now checks the child name, provider ID, and parent relationship alongside the existing root provider check. A second search over `libs/` and `apps/` found no references to the deleted module names.
- Typecheck: `Successfully ran target typecheck for project @ptah-extension/command-center` (exit 0).
- Lint: `Successfully ran target lint for project @ptah-extension/command-center` (exit 0).
- Test: `Test Suites: 44 passed, 44 total`; `Tests: 403 passed, 403 total` (exit 0).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the controller spec unchanged. | Edit it / leave it unchanged. | It had no `canvasUnavailable` expectation or reference. | Yes |
| Assert the child relationship in the pure projection spec. | Assert projection data / retain a layout dependency. | The projection already owns `parentId`, child label, and provider ID; the old layout formatted these into a display label. | Yes |

## Not done

- No work outside the assigned source files and this required report. The remaining `canvasUnavailable` test fixture in `components/command-center-page.component.spec.ts` is outside D3/E ownership and is not a controller dependency.
