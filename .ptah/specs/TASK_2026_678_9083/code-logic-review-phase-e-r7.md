# Code Logic Review, Phase E round 7 (delta) - TASK_2026_678_9083

## Summary

Delta review of two bounded fix commits: 4051af50c (command-center S-1, M-1, Minor-2) and
ee719b838 (Electron workspace arg B1, broadcaster start-failure text B2, duplicate renderer log B3).
All six targeted problems are closed. No blocking or serious defects found. Three small residual gaps
(one silent-swallow with an inaccurate "reported" audit comment, one untested path, one UX feedback
gap) are Moderate/Minor and do not block. Orchestrator test runs were accepted as given; I read the
code and traced callers, I did not re-run tests.

## Review family

Reviewer: Anthropic (Claude). Implementer: codex CLI lanes (plus orchestrator edits: `submitting` guard
in `CommandCenterPageComponent.submitCommand` and its spec; eslint require-yield exception in the
broadcaster spec). Cross-family review: yes.

## Status of the targeted problems

| Item | Status | Evidence |
| --- | --- | --- |
| S-1 stale write after rebind | CLOSED | `session-coordinator.ts:262-265` (`bindingIsCurrent` = marked tab and workspace unchanged), `:271-275` (failure toast only if current), `:276` (`return true` without touching store if stale), `:283-287` (catch toast only if current). Spec `session-coordinator.spec.ts` "leaves a newer binding untouched" (success, failure) and "does not show a send exception on a newer binding" assert tab, workspace, sessionId, status and toast all stay on the new binding. |
| M-1 typed text lost | CLOSED | `command-center-page.component.ts:406-417` (`submitCommand`): clears only on `true`; `command-session-controls.component.ts:97-99` (`clearDraft(sent)` clears only if the draft still equals what was sent, so text typed during the flight survives). `submitting` is set before the await and reset in `finally`, so every path (true, false, throw) releases it. Voice sends go through `sendTranscript -> sendCommand(..., 'voice')` (`command-center-page.controller.ts:265`), never through `submitCommand`, so they are unaffected. Specs pin keep-on-false, clear-on-true, and no double send. |
| Minor-2 open-then-workspace-changed | CLOSED | `session-coordinator.ts:250-260`: workspace captured before `openOrResume`, refusal with toast if it differs after, only when the tab was opened by this call. Spec "refuses a send if the workspace changes while opening a tab" asserts `sender.send` not called and the toast text. |
| B1 bootstrap workspace arg | CLOSED | `initial-workspace-arg.ts:3-16`; `bootstrap.ts:206-219` with `statSync(..., { throwIfNoEntry: false })?.isDirectory() === true` inside try/catch. |
| B2 start vs resume text | CLOSED | `chat-stream-broadcaster.service.ts:346-376`. Caller audit below. |
| B3 duplicate log | CLOSED | Removed `console.error` in `chat-message-handler.service.ts` (old `handleChatError`, now line ~696); the single remaining log is `chat-lifecycle.service.ts:324`. Workflow path `chat-message-handler.service.ts:683` is unchanged. |

### S-1 trace: can a stale `true` arm something on the new binding?

`CommandCenterPageController.sendCommand` (`command-center-page.controller.ts:537-587`) uses the `true`
for only two things:

- `voice.armTypedTurn()` (`:556`, `:585`). The marked-tab effect (`:317-330`) calls `teardownSessionState`
  and `voice.exit()` on rebind. `release()` sets `active = false` synchronously
  (`command-voice-loop.ts:596-601`), and `armTypedTurn` returns early when `!this.active` (`:445`). So a
  stale `true` is a no-op unless the user restarts voice on the new binding inside the in-flight window
  (see Minor-1).
- The Tribunal path sets `expectedRequest` before the await (`:575`). The rebind teardown nulls it
  (`:630`), and nothing re-sets it on `true`, so a stale `true` does not resurrect it. Only `!sent` clears it.

Turn status comes from `trackTurnStatus` on the marked tab, not from the `send` return value, and the
coordinator no longer writes status for a stale binding. Draft clear on a stale `true` is correct (the
message really was delivered to the old tab).

### B2 caller audit (`sessionId === tabId` as the start discriminator)

| Caller | sessionId vs tabId | Result |
| --- | --- | --- |
| `chat-session.service.ts:541` (ptahCli start) | both `dispatch.tabId` | start (correct) |
| `chat-session.service.ts:910` (`startChatSession`) | both `tabId` | start (correct) |
| `chat-session.service.ts:1607` (resume) | real session id; resolved through `historyRead.resolveSessionFolder(sessionId)` at `:932`, which rejects ids that are not a stored session | resume (correct) |
| `chat-slash-command-router.service.ts:160` | real session id | resume text (correct, unchanged) |

The frontend already uses the same discriminator (`settleFailedSessionStart`,
`chat-lifecycle.service.ts:383-395`: `data.sessionId !== data.tabId`), so backend and frontend agree.
`markSessionStartFailed(tabId, error)` takes the text as an opaque reason, so the new "The session
could not start: ..." text still settles the tab. Keeping `endSession(sessionId)` for a never-started
session is harmless and matches the old zero-event behaviour: it is wrapped in try/catch, and the
`finally` block tears the record down anyway.

The raw `errorMessage` is the same string the non-zero-event branch (`:373`) already sent to the
renderer. The new exposure is that zero-event start failures, previously hidden behind the fixed
"corrupted" text, now show it. It is the local user's own process error, so I rate it Minor.

### B1 regression check

Skip rules are unchanged (leading `-`, equal to argv[0] or argv[1]), now scanned over `argv.slice(2)`,
which is equivalent because indices 0 and 1 were already excluded. Compared with the old `find`:

- `electron .` and the packaged `app.exe <folder>` (argv[1]): no workspace before, none now. Unchanged.
- `app.exe --flag <folder>`, macOS `-psn_*` (starts with `-`), and paths with spaces (one argv entry,
  `path.resolve`, `statSync`): work as before.
- `--remote-debugging-port 9334` in the space form used to be taken as a workspace named "9334"; now it
  is skipped because it is not a directory. Improvement.
- `statSync` with `throwIfNoEntry: false` plus catch cannot throw out of bootstrap. Symlinks to
  directories are followed.
- Behaviour change: a deliberate non-existent folder argument is now silently ignored (see Minor-3).

## AC22 / Amendment A1

Holds. The only `tribunal.confirm` call is `confirmProposal` (`command-center-page.controller.ts:588-595`),
bound to the card `(confirm)` output (`command-center-page.component.ts:313`). Neither commit touches
the Tribunal, roster or voice-confirm code. `submitCommand` forwards only typed draft text, and
`sendLaunchTurn` and `sendStatusTurn` send fixed non-Confirm content.

## Findings

### Blocking

None.

### Serious

None.

### Moderate

**M-A. A rejected `sendCommand` is swallowed silently, and the audit comment is inaccurate.**
`command-center-page.component.ts:412-414`. The comment says "the controller shows the send failure",
but `CommandCenterPageController.sendCommand` has no try/catch, and a throw from `coordinator.send`
(for example `openOrResume`, `records.readLastSession`, or `tabs.switchTab` throwing) reaches nothing
that toasts. Scenario: an unexpected throw while opening the session on the first send. Impact: the
draft is kept (good) but the user sees no message and no status change, so the failure looks like
nothing happened. The `degradation-audit: reported` marker also tells the next reader (and the audit
tool) that it is reported when it is not. Fix: in the `catch`, call
`this.page.store.setToast({ message: 'Could not send the Command Center message.', tone: 'error' })`
(and `setSessionStatus('error')` if wanted). Add a spec: reject `sendCommand` and assert the draft is
kept and the toast is set. The current specs cover only resolve true and false.

### Minor

1. **Stale `true` could arm a typed turn if voice was restarted on the new binding mid-flight.**
   `command-center-page.controller.ts:556,585`. Needs `startVoice()` on the new binding while the old
   send is still pending; then `armTypedTurn()` registers a turn for a message that went elsewhere.
   Narrow. Fix if wanted: have `send` return a richer result (`'sent-here' | 'sent-stale' | false`), or
   compare `store.markedTabId()` before and after the await in `sendCommand` before arming. Not
   required for approval.
2. **No feedback when a send landed on the old binding.** `session-coordinator.ts:276` returns `true`
   silently and the draft clears. The user typed in workspace A, switched to B, and the command ran in
   A's session with no trace in B's view. Consider a neutral toast ("Sent to the previous workspace's
   session"). Also, repeated Enter while `submitting` is ignored with no cue
   (`command-center-page.component.ts:408`); the in-flight window can include the open/resume retries
   (up to about 15 s).
3. **Non-existent workspace argument is dropped without a log.**
   `initial-workspace-arg.ts:12` / `bootstrap.ts:213-216`. The `degradation-audit: reported` comment
   there is also inaccurate (nothing is reported). Fix: log one line when an argument is rejected, or
   reword the marker. Also note the space-form Chromium switch value (`--user-data-dir C:\x`) would
   still be taken as a workspace if that directory exists, as before.
4. **Test gaps.** No spec pins B3 (single renderer log); `bootstrap.ts` `statSync` adapter is untested
   (only the pure resolver is); the B1 spec "ignores the entry file when a flag occupies argv[1]"
   passes because `isDirectory` returns `false` for everything, so it does not exercise the
   argv[0]/argv[1] equality skip. No controller-level spec for a stale `true` (voice not armed,
   `expectedRequest` stays null). None of these hide a defect I found.
5. **Zero-event start text can end with an empty reason** ("The session could not start: ") if
   `errorMessage` is empty. `chat-stream-broadcaster.service.ts:371`. Use a fallback such as
   "unknown error".
6. **Commit noise.** `chat-message-handler.service.ts` in ee719b838 includes about 40 lines of
   prettier-only reformatting around the `liveSeed` handling beside the one-line B3 change. Behaviour is
   identical (the rewritten conditionals are logically equivalent: I compared the `liveSeed` and
   `liveSeedBlocks` checks), but it enlarges the review surface. Style only.

## Tests: do they pin the behaviour?

Mostly yes. The coordinator specs hold the binding stable, resolve the in-flight promise only after
`setSession` to a new tab, and then assert the whole store state, so they fail if the old
write-back returns. The page specs use the real controls component and a real submit event, and the
double-send spec asserts one call. The broadcaster specs assert the exact CHAT_ERROR payloads for
start, resume and user abort, the warn text, and `endSession`. Gaps are listed in Minor-4.

## Verdict

APPROVED. Score 8/10. Confidence: high for the coordinator and broadcaster changes (traced through
every caller), medium-high for the Electron launch matrix (read the code, did not launch the app).
Residual risk: a send failure that throws is now silent (M-A). Fix that and add the rejection spec in
the next touch of the file; it does not block this phase.
