# Fix 2 report — `TASK_2026_865_2a1d`, code-logic-review Findings 2 and 4

## Files changed

- MODIFIED `libs/frontend/chat/src/lib/services/provider-carry-over.service.ts` — bounded recovery for a launch whose result is unknown; a definite host failure releases the tab at once; an expired launch's late resolution is skipped and aborted.
- MODIFIED `libs/frontend/chat/src/lib/services/provider-carry-over.service.spec.ts` — new `launch recovery (Finding 2)` block, 9 cases.
- MODIFIED `libs/frontend/chat/src/lib/services/message-sender.service.ts` — new `SendOutcome.errorIsFullText`, set on the P4 check-failure outcome.
- MODIFIED `libs/frontend/chat/src/lib/services/message-sender.service.spec.ts` — the P4 expectation now includes `errorIsFullText: true`.
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts` — `showSendFailure` shows full-text outcomes as written, without the prefix, in both the direct-send and queue-flush paths.
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.spec.ts` — 2 cases: P4 text shown exactly; any other failure keeps the prefix.

No backend or onboarding file was touched. The `/compact` fallback to `chat:continue` did not change.

## Finding 2: fix

`launch()` now sorts every non-success RPC result into one of two cases:

- **Definite failure.** The envelope has `success: false` and the error does not come from the renderer giving up. This means the host answered with an error: a schema rejection or a handler throw before the start. The pending entry is deleted at once. The failure goes through the existing `START_FAILED` mapping with the fixed text `CARRY_OVER_START_FAILED_TEXT` ("Couldn't start the new chat. Try again."); the envelope's `errorCode` is passed along. Button trigger with its banner: the banner is re-flagged with that text. `/compact` trigger: the outcome carries that text as its error.
- **Indeterminate result.** This covers a thrown `rpc.call`, an `RPC timeout:` or `RPC aborted:` result from `ClaudeRpcService`, and a success envelope with no data. The launch returns the busy text as before, and the entry keeps the tab for `CARRY_OVER_RECOVERY_MS` (30 s). At the deadline the tab is released (`isPending` and `isBusy` become false). The tab shows the info notice `CARRY_OVER_EXPIRED_TEXT` ("The new chat didn't start. Try again.") only while it is still bound to the old session. The offer stays on screen, so the button works again; `/compact` can also be re-run.
- **Timer lifetime.** One timer per tab, stored in `recoveryTimers`. `deletePending` clears it, so a resolution, binding, chat error, closed-tab prune or skip cancels the deadline. The callback checks entry identity, so it never releases a newer entry.
- **Late resolution.** On expiry an `expired` marker `{ sessionId, until }` is kept for `CARRY_OVER_LATE_RESOLUTION_MS` (= `CHAT_ADMISSION_RPC_TIMEOUT_MS`). If `claimSessionResolution` finds no pending entry for the tab but finds a live marker, a new session id that the tab is not already bound to returns `'skip'` and the session is aborted with `chat:abort`. The marker is then used up. If the id is the old session or the tab's current session, the result is `'none'`. A pending retry takes priority over the marker. So between the expired launch and a retry, the first resolution binds the retry entry and the second one is skipped and aborted. The tab gets exactly one binding, and the late result cannot clobber the retry. `pruneClosedTabs` also drops lapsed markers and markers of closed tabs.

## Finding 4: fix

`tryCompactCarryOver` returns `{ success: false, error: CARRY_OVER_CHECK_FAILED_TEXT, errorIsFullText: true }`, and nothing is sent, as before. `MessageDispatchService.showSendFailure(tabId, error, fullText)` writes `error` exactly as given when `fullText` is set and an error is present. Every other send failure still gets `Message delivery failed. ` in front.

## Tests

Added in `provider-carry-over.service.spec.ts` (fake timers):
1. A host error envelope on the button path releases the tab at once; the banner shows `CARRY_OVER_START_FAILED_TEXT` with the original origin.
2. A host error envelope on `/compact` releases the tab at once and returns the failure text.
3. A renderer timeout holds the tab until `CARRY_OVER_RECOVERY_MS`, not 1 ms less. Then the tab is released and the expiry notice is shown. The offer remains and a retry sends a second `chat:carry-over`.
4. A thrown RPC is indeterminate and is released at the deadline with the notice.
5. A resolution inside the window binds as usual and cancels the deadline (no expiry notice).
6. A late resolution after expiry returns `'skip'`, aborts the late session and binds nothing. The marker is single-use.
7. A late resolution after a retry already bound returns `'skip'` and aborts. A repeat of the retry's own id returns `'none'`.
8. The marker lapses after `CARRY_OVER_LATE_RESOLUTION_MS`.
9. A chat error before the deadline releases the tab with no expiry notice and leaves no marker.

Added in `message-dispatch.service.spec.ts`: the P4 text is shown exactly, with no prefix; any other failure keeps `Message delivery failed. `.

## Verification

- `node scripts/verify.mjs --exec --task fix2-jest -- npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/provider-carry-over.service.spec.ts libs/frontend/chat/src/lib/services/message-sender.service.spec.ts libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.spec.ts`
  Result: `Test Suites: 3 passed, 3 total`, `Tests: 189 passed, 189 total`, lock exit code 0.
- `ptah_get_diagnostics` (errors only) on the 6 changed files, run twice: both times it returned **unavailable**, with "TypeScript check still running after 45s" and all 6 files unchecked. No typecheck claim is made; CI's typecheck target covers it.
- `npm run verify`, lint, build and other workspace-wide checks were not run, per instruction.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Treat a failure envelope as definite unless its error starts with `RPC timeout` / `RPC aborted`. | (a) prefix check; (b) treat any `errorCode` as definite; (c) treat every failure envelope as indeterminate | `ClaudeRpcService.call` produces only those two give-up results itself (`claude-rpc.service.ts` timer and abort branches). Host errors come from `chat-rpc.handlers.ts` `chat:carry-over` (an `INVALID_PARAMS` throw before `carryOver()`). The same prefix check is already used in `git-ui/git-status.service.ts` `isRpcTimeout` (not importable across libs, so a local constant was added). | Yes |
| A success envelope with no data counts as indeterminate. | indeterminate / definite | The host answered "success", so a session may exist. | Yes |
| `CARRY_OVER_RECOVERY_MS = 30_000`, counted from the indeterminate result. | 30 s / match the admission margin / longer | The RPC has already waited `CHAT_ADMISSION_RPC_TIMEOUT_MS` (90 s host budget + 30 s margin). 30 s matches `CHAT_ADMISSION_RPC_MARGIN_MS`, giving a live host's `SESSION_ID_RESOLVED` or `CHAT_ERROR` one more margin. | Yes, one constant |
| A late resolution of an expired launch is skipped and aborted, not adopted. | (a) skip + abort; (b) adopt and bind when no retry is pending | The task requires that a late resolution after expiry does not bind. The user has already been told the chat did not start, and adopting the session would contradict that notice and race a retry. | Yes |
| The late marker lasts `CARRY_OVER_LATE_RESOLUTION_MS = CHAT_ADMISSION_RPC_TIMEOUT_MS`, is checked lazily with `Date.now()`, and is used once. | lazy TTL / timer / no expiry | It needs no timer. One admission window bounds how late a stuck host can still resolve. Being single-use limits the cost of a wrong match to one skipped resolution. | Yes |
| A resolution cannot be tied to a specific launch request. While a retry is pending, the first new resolution binds the retry and a second one in the marker window is skipped and aborted. | accept / add a request id to the RPC | `SESSION_ID_RESOLVED` carries only `tabId` and `realSessionId`, and `ChatCarryOverParams` has no request id. Adding one would mean backend changes, which are out of scope. The tab still gets exactly one binding. | Yes; a host request id would make the match exact |
| A definite failure uses the fixed `CARRY_OVER_START_FAILED_TEXT`, not the host's envelope error string. | fixed text / host text | Envelope errors can be internal messages. All other carry-over failure copy is fixed text. | Yes |
| The expiry notice uses `ActionBannerService.showInfo` for `CARRY_OVER_NOTICE_MS`. | info / warning | It matches the binding notice in `completeBinding`, which also auto-clears. | Yes |
| P4: a new optional `SendOutcome.errorIsFullText` flag, not a check on the text in the dispatcher. | flag / compare against `CARRY_OVER_CHECK_FAILED_TEXT` | Matching on text would make the dispatcher depend on sender copy. The flag is explicit and covers both dispatch paths. | Yes |

## Out-of-scope observations

- An entry whose RPC succeeded (`rpcSettled: true`) still has no deadline. The host accepted the start, so a resolution or chat error should follow. This was not part of Finding 2's fix request.
- The new spec timers rely on Jest modern fake timers also faking `Date.now()`, which the passing run confirms.
