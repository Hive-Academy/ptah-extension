# Lane 3 DOM report

## Changes

- `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.ts:192-197,304-320` adds OnPush signal state for pointer/focus visibility and guards focus-out with `relatedTarget` containment.
- `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html:3-9,185-191` registers only pointer-enter/leave and focus-in/out on each bubble root. `:148-156` removes the assistant footer wrapper; `:309-345` leaves Branch as the existing keyboard entry point and mounts Rewind only while hover/focus is present.
- `libs/frontend/chat/src/lib/components/molecules/tool-execution/tool-call-item.component.ts:103-105` replaces the four-node separator with one node using a pseudo-element dot.
- `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-call-header.component.ts:97-111` folds nested non-streaming conditionals into one `@if`/`@else if`, removing a generated control-flow anchor without changing the rendered branch.
- Added focused coverage in `message-bubble.component.spec.ts` and `tool-call-item.component.spec.ts`.

## Static element census

| Surface | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Assistant footer action wrapper | wrapper + copy host = 2 | copy host = 1 | -1 |
| User footer, inactive | footer + Branch button/icon + Rewind button/icon = 5 | footer + Branch button/icon = 3 | -2 |
| User footer, hover/focus | 5 | 5 | 0 |
| Collapsed tool-row separator | 4 `div`s | 2 `div`s | -2 |

The tool-header control-flow consolidation also removes one Angular conditional anchor. The requested 6-8 collapsed-row target is not fully reached by this safely pixel-preserving change; no icon usage was changed, per scope.

## Focus order and accessibility

Before and after, User Branch is the first footer tab stop and Rewind follows it. Branch remains mounted, visually follows the same opacity transition, and receives focus before Rewind is created; its bubbling `focusin` mounts Rewind in time for the next Tab. Assistant Copy remains mounted for the same reason. `focusout` only hides the deferred action when focus leaves the bubble, not while moving between its controls. Pointer events are enter/leave only; there is no pointer-move listener.

Risk for review: the retained entry buttons use `opacity-0` before keyboard focus, as they did before hover. Verify keyboard focus-ring visibility in both themes and touch behaviour in the webview. The separator’s pseudo-element must be visually diffed in light/dark themes; it retains the prior line thickness, margins, and dot colour, but the old 8px gaps around the dot are now continuous border.

## Verification

- `npx jest -c libs/frontend/chat/jest.config.ts message-bubble --silent 2>&1 | tail -6` (PowerShell equivalent): **pass**, 1 suite / 18 tests.
- `npx jest -c libs/frontend/chat/jest.config.ts tool-call-item --silent 2>&1 | tail -6`: first run exposed missing `FILE_LINK_OPENER` in the new integration test; after adding the standard stub, the rerun produced no completion output before the command window ended. **Inconclusive; rerun required.**
- `npx tsc -p libs/frontend/chat/tsconfig.lib.json --noEmit 2>&1 | grep -c "error TS"` (PowerShell equivalent): command did not complete before the command window ended. **Inconclusive.**
- `chat-ui` TypeScript check was not started because the preceding direct check did not complete. **Open item.**
- Scoped editor diagnostics were unavailable after 45 seconds (compiler still running), so they did not establish a result.

## Open items

1. Rerun the tool-row Jest target and both `chat`/`chat-ui` TypeScript counts on a less-contended worker.
2. Pixel-diff the separator in both themes and decide whether accepting its continuous line is sufficient; preserving the old gaps needs an additional CSS drawing technique.
3. If the full 6-8 element tool-row reduction remains mandatory, it requires a separately reviewed header/icon reduction beyond this no-lucide-change batch.

## Revision 1

The separator now uses flex pseudo-elements for the two lines and retains the dot as its only child: two DOM elements instead of four. This restores the original 8px gaps and vertically centres the dot on the line. Tailwind 3's `before:` and `after:` variants provide the required pseudo-element content in this project, so no explicit content utility was added.

## Revision 2

Reverted lazy user Rewind mounting after accessibility review found that removing it from the DOM broke reverse tab navigation and screen-reader browse discovery. Branch and Rewind now remain mounted in their original footer order and use the original hover opacity wrapper. The assistant footer wrapper removal remains because it is layout-identical. Tool-row changes from Revision 1 are unchanged.
