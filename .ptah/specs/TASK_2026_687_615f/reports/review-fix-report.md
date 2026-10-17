# Review fix round

| Finding | Change (file:line) | Spec | Jest result |
| --- | --- | --- | --- |
| S-1 Stop treated as failure | `components/command-center-turn-status.ts:93-103,128-132` excludes abort reasons and `stopped` from failure promotion. | `components/command-center-turn-status.spec.ts:93` checks both abort reasons leave Stop and toast intact; existing fast real failure spec remains. `components/command-center-page.controller.spec.ts:578` now uses `api_error` for its real failure assertion. | Status suite passed; controller suite 66/66 passed. |
| S-2 Decline retry toast lost | `components/command-center-page.controller.ts:426-432` adds the retry action; `voice/command-voice-loop.ts:445-454` retains a toast supplied by the sender and still sets `voiceError`. | Controller spec `:1355`; voice loop spec `:10`. | Controller 66/66; voice loop 37/37 passed. |
| M-1 Voice flag survives mute | `components/command-center-page.controller.ts:363-369` deactivates on mute; `startVoice()` at `:351-361` reactivates. | Controller spec `:1841` covers mute and unmute. | Controller 66/66 passed. |
| M-2 Stale synthesis failure | `voice/command-voice-loop.ts:93-113` checks the playback epoch before reporting; `:292,320,534,656` clears the marker on start, barge-in, interrupt, and turn reset. | Voice loop spec `:40` checks stale synthesis suppression and a later playback error. | Voice loop 37/37 passed. |
| M-3 Overflow chip collision | `scene/command-scene.component.ts:86` moves the chip below the caption. | Scene spec `:88` checks the new position. | Scene suite passed. |
| M-4 Grace before activity | `components/command-center-page.controller.ts:109,181,264-313` requires a non-idle root status observed after arming before the 12-second idle grace can begin. Pending requests still cancel the timer. | Controller spec `:1741` uses fake timers to check no early expiry, activity then idle expiry, and no second feedback from a late pulse. | Controller 66/66 passed. |

`git diff --check` passed. The controller has 487 lines, below the 700-line limit. Scoped diagnostics reported no errors in the requested source files; the tool also reported 30 diagnostics in sibling files. No build or broad test run was performed.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the existing synthesis reporting path and clear stale markers at playback epoch changes. | Make the queue own synthesis failure reporting; retain the loop callback with epoch guard. | The queue suppresses failure callbacks for obsolete generations; the epoch guard prevents stale user feedback and the reset lets the next playback failure surface. | Yes. |
| Start voice idle grace only after a non-idle root status is observed. | Timer from arming; timer after activity. | A send can remain idle while waiting for the host or send lock. The fake-timer spec covers this transition. | Yes. |
| Record the four minor review items without changes. | Fix in this round; defer as directed. | Review m-1 through m-4 were explicitly excluded from this fix round. | Yes. |

The untracked `code-logic-review.md` was present before this round and was not modified. No other changes were reverted. All six requested findings are addressed. The diagnostics tool's sibling-file errors remain outside this round.
