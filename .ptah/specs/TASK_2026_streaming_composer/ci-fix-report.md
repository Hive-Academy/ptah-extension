# CI fix report: electron-e2e shard 4/4, task-374 Stop click

## Failure

`apps/ptah-electron-e2e/src/specs/task-374-abort-then-next-turn.spec.ts:127`:
`stop.click()` on `[data-testid="chat-stop-btn"]` timed out. Playwright saw the button as
visible, enabled and stable, but `div[data-testid="chat-composer"]` received the pointer
events.

## Root cause

- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:546`
  (before the fix): the full-card Stop was rendered whenever `isActiveTabStreaming()` was
  true, folded or not. While streaming with an idle composer, the full card is the folded
  layer. Its clip is `inert` (`:221`), its grid row is `0fr`
  (`chat-input.component.css`, `.ptah-composer-stage[data-compact] .ptah-composer-fold--full`)
  and it is clipped (`overflow: clip`), with its content pushed out of the box by
  `justify-content: flex-end`.
- The button still had a layout box, so `toBeVisible()` passed. But an inert, clipped
  element is never a hit-test target, so every click at its position landed on the composer
  root. The real Stop in that state is on the compact bar
  (`libs/frontend/chat-ui/src/lib/molecules/composer-compact-bar.component.ts`), under a
  different id (`composer-compact-stop`). So the canonical `chat-stop-btn` that the e2e
  specs (task-360, task-374, task-382) and the showcase director use pointed at a phantom
  control. A user could still click the bar's Stop. The defect was two Stop buttons for
  one action, and the canonical one was unreachable whenever the composer was folded.

## Fix

The composer now renders exactly one Stop at a time, and that Stop always carries
`data-testid="chat-stop-btn"`:

- Full card: `@if (isActiveTabStreaming() && !isCompact())`. Folded, the card has no Stop.
- Compact bar: `[showStop]="isActiveTabStreaming() && isCompact()"`, and the bar's Stop
  test id is now `chat-stop-btn` (it was `composer-compact-stop`).

The fold design does not change: the same grid fold, the same bar layout and the same Stop
position on the bar. During the fold-out (about 200 ms) the card's toolbar loses its Stop
at the moment the bar's Stop starts to fade in. The e2e specs are unchanged.

## Changed files

- MODIFIED `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts`: gates both Stops on the fold state.
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/composer-compact-bar.component.ts`: the bar's Stop uses the test id `chat-stop-btn`, and the `showStop` doc is updated.
- MODIFIED `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.streaming-fold.spec.ts`: renames the test id, and adds a regression test: exactly one Stop, outside every `[inert]` ancestor, on the bar when folded and on the card when expanded.
- MODIFIED `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.command-center-lock.spec.ts`: the held-streaming Stop test now types a draft so the card stays open. In that spec the compact bar is stubbed through `CUSTOM_ELEMENTS_SCHEMA`.

## Verify

`npm run verify -- -p @ptah-extension/chat-ui,@ptah-extension/chat` passed:
`NX 6 tasks: 6 succeeded` (lint, test and typecheck for both projects, 0/6 cache hits),
exit code 0, run time 12m 15s. I did not run e2e, build or serve, as instructed, so the
e2e spec has not been re-run against the fix.

## Known limits

- During the fold transition (about 200 ms), no Stop is fully clickable: the card's Stop is
  removed and the bar's Stop is still fading in. The coordinator accepts this as part of the
  approved fold design (review defect 1). The product code is unchanged for it.

## Revise round 1

Review: `ci-fix-code-logic-review.md` (REVISE 7/10) asked for stronger spec coverage. Only
`libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.streaming-fold.spec.ts`
changed. The product code is unchanged.

- Moved `stops()` into a shared helper and added a `compactBar()` helper. The one-Stop
  regression test now also asserts that the folded Stop is inside the compact bar.
- New test `runs the abort path from the folded bar Stop`: while folded, a click on the bar
  Stop calls `handleStop` once (`stopFromCompact` calls `handleStop`) and
  `abortWithConfirmation` once.
- New test `keeps the card open with a draft and runs the abort path from its Stop`: while
  streaming with a draft, the card stays open. There is exactly one `chat-stop-btn`, on the
  card, outside the bar and with no `[inert]` ancestor. A click on it calls `handleStop`
  once and `abortWithConfirmation` once.
- Verify: `npm run verify -- -p @ptah-extension/chat` passed: `NX 3 tasks: 3 succeeded`
  (lint, test and typecheck, 0/3 cache hits), exit code 0, 5m 45s.
