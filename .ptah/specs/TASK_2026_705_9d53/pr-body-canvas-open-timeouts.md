## Summary

Follow-up to #777. CodeRabbit left two comments open on that PR, and both are fixed here. They covered the timeout paths of the canvas openers that #777 made report their result.

- **Task launch (Major)**: the task prompt bridge raced the canvas for 5 s and reported success with a prefill on timeout, even if the canvas refused the tab later. `AppStateManager.requestCanvasTab` now takes an optional `{ timeoutMs }`. A request that is still queued at the timeout leaves the queue and settles `false`. The canvas drain settles a drained request synchronously, so a late result cannot occur. The bridge waits for that promise without a race of its own:
  - On success, it links the task and fills in the prompt.
  - On a refusal or timeout, it closes the empty tab and reports that the session did not open.
  - On a workspace change, it keeps the tab and reports the change.
  - Other callers keep their wait-until-mount behavior.
- **Canvas drain**: each drained tab request now has its own `try/catch`. Before, a throw from `adoptTab` or `focusTile` left its promise unsettled and blocked later task launches.
- **Branch (Minor)**: a 10 s timeout now shows "Branch created. It is still opening." and no longer shows success. A late failure or rejection shows the not-opened error on the originating tab only. The error is suppressed when a newer action banner has replaced it.

## Test plan

- [x] `nx run-many -t typecheck -p core chat canvas harness-builder ptah-extension-webview`: pass
- [x] `nx run-many -t test,lint -p core chat`, then `-p canvas chat` after the fix round: pass
- [x] degradation-audit: `libs/frontend/chat` 9 ok (baseline 11), TOTAL 291
- New specs:
  - app-state: the queue timeout removes and settles a request, a drained request is untouched, and a request with no timeout waits.
  - bridge: a timeout or refusal gives a failure with no prefill and closes the tab.
  - canvas: an adoption throw settles `false`, and the next request still adopts.
  - chat-view: a timeout, then a late false, true or rejection, and an overlap with a newer action.

## Reviews

Code-logic review by codex (implementer: Claude). The first review was REVISE 6/10, with 2 Serious and 1 Moderate findings. One fix round followed, and the re-review is APPROVED 8/10. Open item: no spec covers a second mounted tile, so the shared-banner check is covered only by the single-tile specs.

## Follow-ups (unchanged from #777)

- workflow-tab-launcher, harness-builder and keyboard tab openers still ignore the canvas result.
- A workspace change during the bridge wait leaves an empty tab in the previous workspace. `TabManagerService` has no close method for a workspace that is not active.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
