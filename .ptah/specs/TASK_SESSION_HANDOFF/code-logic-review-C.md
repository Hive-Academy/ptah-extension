Verdict: REVISE
Score: 4/10

1. **Blocking** `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts:248`: Stale read and data corruption race in `sendQueuedMessage`. Because the streaming handler synchronously sets the tab status to `loaded` before dispatching the flush, the composer is active during the `await`. If the user types during this time, `tab.queuedContent` changes. If the RPC succeeds, `unchanged` evaluates to false, leaving the successfully sent prompt in the composer and inviting a double-send. If it fails, `restoreQueuedMessage` prepends the original prompt to the newly typed text, corrupting the composer draft. **Fix**: Restore `this.tabManager.clearQueuedContentAndOptions(tabId);` immediately before `await this.messageSender.continueExistingSessionForQueueFlush`. Remove the `unchanged` check and the conditional clear entirely, so `restoreQueuedMessage` can correctly append to any new input without duplicating the original.

## Dropped tests

The following capabilities still exist in `session-budget-banner.component.ts` but their unit tests were dropped from the spec file, violating the preservation requirement:
- `names the compactions when they count`
- `shows the write failure line and no "saved" claim`
- `warns when the transcript was not read`
- `no transcript warning when the read succeeded`
- `says sends are not paused when blocking is off`
- `lower-bound cost wording`
- `Allow 20% more emits extend; busy disables every button`
- `opening emits previewRequested once and shows a loading line`
- `a failed load shows the error and Try again re-requests`

## Five logic questions

1. **How does this fail silently?** If a user types during an in-flight queue flush that succeeds, the newly typed text keeps the composer from clearing, leaving the already-sent prompt visible and misleading the user into sending it again.
2. **What user action produces unexpected behaviour?** Typing in the composer immediately after a turn ends, before the automatic queue flush completes.
3. **What input data makes this produce a wrong answer?** `tab.queuedContent` mutating during the async `continueExistingSessionForQueueFlush` call breaks the `unchanged` assumption.
4. **What happens when a dependency fails?** If the queue flush RPC fails, `restoreQueuedMessage` prepends the original message to whatever the user typed in the meantime, corrupting the draft instead of cleanly restoring it.
5. **What is missing that the requirements never mentioned?** A lock on the composer specifically for the duration of the queue flush. Since the tab is 'loaded', the composer is active. Clearing the queue *before* the await relies on the empty state to safely capture new input.
