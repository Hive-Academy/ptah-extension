# Batch R1 report

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-lane.types.ts` — request IDs, rail state/density and shared height pair.
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-rail-card.component.ts` — standalone OnPush rail card with signal inputs/outputs.
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-rail-card.component.spec.ts` — 15 component tests.
- `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat-ui\src\index.ts` — rail exports.

## Check results

- `npx nx test @ptah-extension/chat-ui --testFile=libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: `Test Suites: 1 passed, 1 total`; `Tests:       15 passed, 15 total`.
- `npx nx test @ptah-extension/chat-ui --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: `Test Suites: 71 passed, 71 total`; `Tests:       1130 passed, 1130 total`.
- `npx nx typecheck @ptah-extension/chat-ui --parallel=1 --skip-nx-cache`: passed (`NX Successfully ran target typecheck`).
- `npx nx lint @ptah-extension/chat-ui --parallel=1 --skip-nx-cache`: passed with 12 warnings, including five non-null assertions in the new spec. Those five assertions were then replaced with explicit casts; lint was not rerun. The other seven warnings were in existing files.
- Scoped diagnostics after edits: no errors in the four requested files. Diagnostics also showed errors in existing test/support files, including two existing compact-session-activity spec fixtures without the newly required request IDs; the project typecheck target and full Jest suite passed.

## Edge cases

- The callout is keyed by `requestId`; replacing a request rebuilds its buttons and schedules focus on the select button when focus was in the removed callout. All action buttons carry the shown ID; `answer` and `showOutput` emit it, and permission actions emit the shown object.
- Inner buttons bind `tabIndex` to `innerTabbable` on every render; the select button uses roving `tabIndex` from `focused`.
- `holdText` latches title, Now and metrics while the live callout and state remain current.
- Unknown or absent todos display an em dash; the tooltip uses `todoTitle`.
- Dense totals 0, 1 and 4 show respectively `Lanes none yet`, `+1` and `+4`; only positive totals create an action. The accessible name includes the total and title; the action emits `moreLanes`.
- Question callouts have an Answer button in both densities. It emits the shown request ID; native button activation supplies Enter and Space. The test checks button semantics and click output, while jsdom does not synthesize a click from a dispatched Enter event.
- A same-text question with a new ID rebuilds the Answer button, moves focus to selection and emits the new ID.
- The host height reads `COMPACT_RAIL_CARD_HEIGHT` and stays fixed through summary, callout and text-hold changes in both densities. No Retry or hover-close action is rendered.
- Every `--state-ink-*` reference includes a DaisyUI fallback. The component has no chat, chat-state or canvas imports, timers or observers.

## Decisions

| Decision | Options | Evidence | Reversible |
|---|---|---|---|
| Keep the select button focusable but pointer-inert | Full-surface pointer target; pointer-inert overlay | The plan requires selectable card text and a roving select button with no pointer events. | Yes |
| Use native buttons for callout and lane actions | Key handlers; native activation | The plan specifies Enter/Space through button semantics. | Yes |
| Keep legacy activity fixtures outside R1 | Edit those fixtures; respect R1 file scope | R1 explicitly limits edits to four chat-ui files; full Jest and project typecheck pass. | Yes |

## Not done

- Browser-level keyboard activation, contrast and pixel geometry remain for the planned Electron validation. The local Jest environment cannot exercise native Enter-to-click activation.
- The lint target was not repeated after the five new spec warnings were removed. The required lint run passed before that cleanup.
