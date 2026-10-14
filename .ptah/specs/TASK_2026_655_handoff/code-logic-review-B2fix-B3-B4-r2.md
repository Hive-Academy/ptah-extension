# Code logic re-review — B2fix, B3, B4 round 2

## Verdict

**NEEDS_REVISION — 6/10.** The main prompt-safety, delivery-boolean and queued-command paths are corrected, but failed-start cleanup still depends on an unacknowledged broadcast. A new held-command map also retains closed tabs. This is in the 5–6 band rather than 7–8 because the original failed-start symptom remains possible on a probable delivery failure (`child-chat-session-host.adapter.ts:173-179,237-252`; `webview-manager.ts:297-316`); it is above 3–4 because the ordinary handoff error and queue paths now have concrete handling (`chat-lifecycle.service.ts:383-394`; `conversation.service.ts:155-159,208-230`).

## Five requested fix statuses

| Item | Status | Evidence and impact |
| --- | --- | --- |
| Earlier B2 Blocking: unsafe `safeErrorKind` code | **FIXED** | `safe-error-kind.ts:26-56` accepts only literal codes in `KNOWN_ERROR_CODES`; a prompt-derived `ESECRET` cannot pass the former shape test. The handoff callers therefore receive a fixed error kind (`child-chat-session-host.adapter.ts:164-176`). The separate shared raw-error logging paths remain deferred by `decisions.md`. |
| Earlier B2 Serious: VS Code `postMessage` false reported true | **FIXED** | `webview-manager.ts:217-223` returns the actual boolean. `child-chat-session-host.adapter.ts:200-221` counts only `true`, so an undelivered announcement yields `uiAnnounced:false`. The other direct consumers are the dashboard sender (`dashboard-namespace.builder.ts:167`), which now sees false, and the approval sender (`approval-prompt.handler.ts:71`), which ignores the result. Permission and ask-user prompt paths already branch on delivery; a false result activates their existing fallback rather than waiting on a prompt that was not posted. `broadcastMessage` ignores individual booleans (`webview-manager.ts:297-316`), which matters for the failed-start item below. |
| New Blocking 1: B3 thrown error leaks prompt | **FIXED** | For `ptah_session_handoff`, `failureText` uses only the exact fixed unavailable message or `safeErrorKind` (`session-tool-handlers.ts:451-460`). The main catch uses that value for both the warn and tool reply (`session-tool-handlers.ts:492-504`); the held-completion catch also uses `safeErrorKind` (`session-tool-handlers.ts:469-481`). |
| New Serious 2: held `/session-handoff` merged into queued text | **FIXED** | `conversation.service.ts:155-159,179-194` holds a slash command separately when text is queued. After a successful flush, `message-dispatch.service.ts:248-270` calls `releaseHeldCommand`, which promotes the command as a separate queued turn (`conversation.service.ts:208-230`). Stop and `chat:error` settle held promises false (`conversation.service.ts:319-326`; `chat-lifecycle.service.ts:368-371`), and the banner re-enables itself with a notice (`session-budget-actions.service.ts:192-205`). The new queue integration spec covers normal text, the banner, a separate command flush, Stop and a refused first flush (`session-budget-actions.queue.spec.ts:1-336`). |
| New Serious 3: failed launch leaves live tab | **PARTIAL** | A delivered failed-start `chat:error` now matches `sessionId === tabId` (`chat-lifecycle.service.ts:383-394`) and sets the unbound, unstreamed tab to `loaded` and `hasLiveSession:false`, with a visible reason (`tab-manager.service.ts:1106-1129`). The host sends that error only after a successful announcement (`child-chat-session-host.adapter.ts:173-179`), but `reportStartFailure` awaits `broadcastMessage` without an acknowledgement (`child-chat-session-host.adapter.ts:237-252`). `broadcastMessage` discards the boolean from each panel send and catches view failures (`webview-manager.ts:297-316`). If the announced surface is disposed or hidden between announcement and error, no webview receives the error, yet the host completes the failure path and the previously adopted tab can remain live-looking when that surface returns. Persist a failed-start state for reconciliation, or add an acknowledged/retried terminal event; test delivery loss after announcement. |

## New findings introduced by these commits

### 1. Serious — closing a tab retains its held commands and unresolved banner request

**Evidence:** `conversation.service.ts:80,179-194,237-242`; `session-budget-actions.service.ts:192-205`; `tab-manager.service.ts:1295-1356`. `dropHeldCommands` is called on Stop and `chat:error` (`conversation.service.ts:326`; `chat-lifecycle.service.ts:368-371`), but not on the tab close path, which removes the tab and emits a close event (`tab-manager.service.ts:1349-1356`).

**Failure scenario:** While a turn is streaming, queue text, click **Wrap up & hand off**, then confirm **Close Tab**. The held command's promise never settles because there is no subsequent flush, Stop, or error for the removed tab. The root-provided `ConversationService` keeps the removed tab id, command text and resolver in `heldCommands` for the webview's lifetime. Repeating this common action grows the map and leaves each `sendWrapUp` invocation pending. The command cannot run, but the banner never receives its dropped result.

**Suggested fix:** Subscribe the conversation owner to tab close events and call `dropHeldCommands(tabId)` after a confirmed close. Cover confirmed close and cancelled close with a focused test.

## Five logic questions

1. **Silent failure:** A failed-start `chat:error` sent after an announcement can be dropped by `broadcastMessage`, which ignores false delivery results; the host still returns its failure outcome (`webview-manager.ts:297-316`; `child-chat-session-host.adapter.ts:173-179,237-252`).
2. **Unexpected user action:** Confirming tab close with a held banner command leaves its promise pending and map entry retained (`tab-manager.service.ts:1295-1356`; `conversation.service.ts:80,179-194`).
3. **Wrong answer from input:** The prior `ESECRET` error-code input is rejected by a literal allowlist, so this review found no new wrong-answer input in the two commits (`safe-error-kind.ts:26-56`).
4. **Dependency failure:** A webview that stops accepting messages between announce and failed-start error never applies the new tab settlement (`webview-manager.ts:217-223,297-316`; `chat-lifecycle.service.ts:383-394`).
5. **Missing requirement detail:** Held commands need a terminal outcome when their tab is removed, and failed-start state needs delivery-independent reconciliation (`conversation.service.ts:80,237-242`; `tab-manager.service.ts:1349-1356`; `child-chat-session-host.adapter.ts:237-252`).

## Scope and verification

Reviewed `git diff fe119079d..HEAD`, the prior review, fix reports, scope decision, implementation plan, root `CLAUDE.md`, changed implementation and focused specs, and neighboring send/queue/close paths. The task folder has no `context.md`, `task-description.md`, or `code-style-review.md`. The fix reports record passing targeted Jest runs; I did not rerun them. Scoped `ptah_get_diagnostics` returned unavailable after its 45-second compiler window, so it supplies no type-check result. The deferred namespace bounds and shared raw-error logging items are excluded from this verdict.
