# Phase C fix report

| Defect | Result | File:line | Verification |
| --- | --- | --- | --- |
| 1 | Fixed: root task preview renders through escaped interpolation. | `libs/frontend/command-center/src/lib/components/command-node-detail.component.ts:209` | `command-node-detail.component.spec.ts:87` checks `Task: <b>x</b>` as text and no `b` element. |
| 2 | Fixed: work list implements both lifecycle interfaces. | `libs/frontend/command-center/src/lib/components/command-work-list.component.ts:3,141` | Scoped typecheck and lint pass. |
| 3 | Fixed: ResizeObserver test double members are explicitly public. | `libs/frontend/command-center/src/lib/components/command-work-list.component.spec.ts:405` | Scoped lint passes with zero ESLint errors or warnings; observer test passes. |
| 4 | Fixed: assertive pending announcement remains mounted when pending is null. | `libs/frontend/command-center/src/lib/components/command-pending-input.component.ts:26` | `command-pending-input.component.spec.ts:43` checks the same region before, during and after pending input. |
| 5 | Fixed: clipping measurements run when rows change or ResizeObserver fires; scroll updates only the end position. Removed the duplicate initial measurement. | `libs/frontend/command-center/src/lib/components/command-work-list.component.ts:44,206,217,224,231` | `command-work-list.component.spec.ts:378` checks measurements on row changes and no measurements on clock-only renders; observer test checks one observed container and disconnect. |
| 6 | Fixed: active row is stored by node id and its index is derived from rendered rows, with index zero fallback. Projection-index focus restoration remains. | `libs/frontend/command-center/src/lib/components/command-work-list.component.ts:185,187,198,267,290` | `command-work-list.component.spec.ts:134,154` checks removal fallback and reorder; existing projection-index focus tests pass. |
| 7 | Fixed: detail hides provider id `unknown`, matching the work list guard. | `libs/frontend/command-center/src/lib/components/command-node-detail.component.ts:88,183` | `command-node-detail.component.spec.ts:155` checks no provider line for `unknown` while retaining the custom-provider fallback. |
| 9 | Fixed: nesting edge cases have coverage. | `libs/frontend/command-center/src/lib/components/command-work-list.component.spec.ts:307,319,338` | Tests check orphan top-level placement, each row in a mutual cycle exactly once, and the 56px three-level indent cap. |
| 10 | Fixed: disabled invalid-proposal Confirm references its explanation. | `libs/frontend/command-center/src/lib/components/command-pending-input.component.ts:94,106` | `command-pending-input.component.spec.ts:232` checks the status id and `aria-describedby`. |

Defect 8 was left unchanged as instructed; “Delegated engineering work” remains approved copy. Existing asserted text, the `#pending-title` and `#pending-answer` selectors, and display-only child sessions remain intact.

## Checks

| Command | Result |
| --- | --- |
| `npx nx typecheck command-center --parallel=1 --output-style=static` | Passed, exit 0. |
| `npx nx lint command-center --parallel=1 --output-style=static` | Passed, exit 0; zero ESLint errors or warnings. |
| `npx nx test command-center --parallel=1 --output-style=static --maxWorkers=2` | Passed, 45 suites and 509 tests. Jest printed a worker teardown notice after the tests. |
| `npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2` | Passed, 11 tests. |

The changed work-list spec also passed alone: 21 tests. Scoped `ptah_get_diagnostics` reported no diagnostics in that requested file; its broader compiler check reported 29 errors in sibling specs outside this batch. The scoped Nx typecheck above passed.

## Decisions

- For disappeared active nodes, the row at index zero becomes the tab stop. This follows the review's requested fallback and is reversible.
- Clipping measurement is gated by the `rows()` array identity inside the existing render callback. It keeps the current Angular API and prevents layout reads on clock-only renders; the focused regression test verifies the behavior.
