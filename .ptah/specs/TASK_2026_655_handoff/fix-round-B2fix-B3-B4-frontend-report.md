# Fix round (B2 fix, B3, B4): webview findings 2 and 3

Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-session-handoff-skill`. Scope: `libs/frontend/chat-state/**` and `libs/frontend/chat/**`. Nothing was committed. No host change was needed.

Verdict: both findings are fixed. All targeted specs pass, eslint reports 0 errors, and prettier has been applied.

## Finding 2 (Serious): existing queued text swallows the banner command

### Approach

A slash command that is queued while the tab already has queued text is no longer appended to that text. It is held as its own turn behind the text. Normal messages still append to the visible queue exactly as before. When a flush has delivered the text in front of the command, the command becomes the tab's queued message. On the next turn end it flushes alone, starting with `/`, so the backend `SlashCommandInterceptor` (`/^\/[a-zA-Z]/`) routes it as a command. B4 report A2 shows this path for a lone queued command.

- `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts`
  - `:27` `SLASH_COMMAND` is the backend's test, mirrored here.
  - `:80` `heldCommands` is a map from tab to its held commands. Each tab entry also records the queued text the first command waits behind.
  - `:137` `queueOrAppendMessage` holds a slash command when the queue has text, or when a command is already held. It then returns a `Promise<boolean>`: `true` when the command becomes the queued message, `false` when it is dropped. For every other message it returns `null`, and behaviour is unchanged.
  - `:208` `releaseHeldCommand(tabId, sent?)` promotes the oldest held command into the empty queue. It clears the removed text's options first, so attachments do not travel with the command.
    - If newer text was queued while the flush was in flight, the command keeps waiting behind that text.
    - If the flushed text is not the text the command waited behind (a reset path cleared the queue in between), the held commands are dropped, not sent.
  - `:237` `dropHeldCommands(tabId)` settles each held command `false`.
  - `:326` Stop drops the tab's held commands, together with the queued text it already restores to the input.
- `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts`
  - `:200` A held command's promise is returned as `SendOutcome.heldCommand`.
  - `:270` After a successful queue flush, outside the `try`, it calls `releaseHeldCommand(tabId, queuedContent)`. A refused or failed flush restores the text as before, and the command keeps waiting behind it.
- `libs/frontend/chat/src/lib/services/message-sender.service.ts:72` adds the optional `SendOutcome.heldCommand?: Promise<boolean>`.
- `libs/frontend/chat/src/lib/services/chat.store.ts:381` `clearQueuedContent` (the queue's cancel and edit actions) now releases a held command. The command then shows in the queue instead of being lost.
- `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts:369` `dropQueue` drops held commands on `chat:error` together with the queued text. As before, nothing may auto-send after a failed turn.
- `libs/frontend/chat/src/lib/services/session-budget-actions.service.ts:200` `sendWrapUp` keeps the button disabled ("Wrap-up requested") while the command is held. If the command is dropped, it re-enables the button and calls `ActionBannerService.showError` with: "The wrap-up request was not sent: the queued messages before it were stopped or failed."

### Specs

- New `libs/frontend/chat/src/lib/services/session-budget-actions.queue.spec.ts`, 7 tests. It uses the real `SessionBudgetActionsService`, `MessageDispatchService`, `ConversationService` and `MessageValidationService`. `ChatStore` forwards to the real dispatch. Only the tab store, the sender (the `chat:continue` boundary) and the RPC are fakes. A turn end is simulated as `sendQueuedMessage(tab, queuedContent)`.
  1. Queued "Please check tests", then the banner: `Please check tests` is flushed first. Then `/session-handoff This session has used 41.2M tokens.` is flushed as its own turn and matches `/^\/[a-zA-Z]/`. The button stays pending and no error is shown.
  2. Text queued after the click is sent in front of the command.
  3. A command with nothing queued is still queued directly, as before.
  4. Stop drops the held command. The button is re-enabled with the notice, and nothing is flushed afterwards.
  5. The queue is reset and unrelated text is flushed: the command is dropped, not sent, and the button is re-enabled.
  6. Cancelling the text in front of the command promotes the command.
  7. A refused text flush keeps the command waiting behind the restored text. The order then holds on retry.
- `message-dispatch.service.spec.ts`: 3 new tests.
  - Release after a successful flush.
  - No release when the flush is refused.
  - `heldCommand` is returned from `sendOrQueueMessage`.
  - The conversation mock gained `releaseHeldCommand`.
- `chat-lifecycle.service.spec.ts`: a new test checks that `chat:error` drops held commands.

## Finding 3 (Serious): a failed launch leaves a live-looking tab

### Approach

The host reports a failed start as `chat:error` with `sessionId === tabId` (`child-chat-session-host.adapter.ts:236-252`, read only). No `turn_state` follows, so the webview now settles that tab itself and reuses the existing transcript notice channel (the assistant message that `showSendFailure` also uses). No new UI was added.

- `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1106` adds `markSessionStartFailed(tabId, reason)`.
  - It works in any workspace partition, through `findTabByIdAcrossWorkspaces` and `updateTabInternal`.
  - It acts only on a tab that has no `claudeSessionId`, has `status === 'streaming'` and has no `streamingState`. That is an announced tab that never started.
  - It sets `status: 'loaded'`, `hasLiveSession: false` and `currentMessageId: null`, appends the host's reason as an assistant message, and calls `markTabIdle`.
  - Focus is unchanged, so a focused tab shows the reason.
  - It returns `false` and changes nothing for any other tab.
- `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts`
  - `:325` `handleChatError` calls `settleFailedSessionStart` first.
  - `:383` `settleFailedSessionStart` applies only when `data.tabId` is set and `data.sessionId === data.tabId`. When it applies, it also drops that tab's queue and refreshes the sessions sidebar, then returns. A handoff tab in a background partition therefore no longer falls through to the active-tab fallback, which would have cleared an unrelated tab's queue.
  - Every other `chat:error` keeps the ordered `turn_state` ownership described in the method's doc comment. The doc comment now names this one exception.
- The same path also covers agent child tabs. `startChildSession` reports its failed start the same way (`adapter.ts:118-123`).

### Specs

- `libs/frontend/chat-state/src/lib/tab-manager.handoff-adoption.spec.ts`: 4 new tests. They use the real `TabManagerService` and the real partition service.
  - Adopt, focus, fail: the tab is `loaded`, not live, has no session and is not streaming. Its transcript is the user turn plus the reason, and it stays focused.
  - Background-partition tab.
  - A tab whose session started is left alone.
  - An ordinary idle tab and an unknown id are left alone.
- `chat-lifecycle.service.spec.ts`: 4 new tests.
  - Announce then error: the tab is settled, its queue and held commands are dropped, and the sessions are refreshed.
  - Background tab: only that tab's queue is cleared, never the active tab's.
  - A tab whose session started is unchanged.
  - An ordinary stream error (its `sessionId` differs from the tab id) is not treated as a failed start.

## Verification

All commands were run from the worktree, one at a time.

| Command | Result |
| --- | --- |
| `npx jest -c libs/frontend/chat/jest.config.ts …/session-budget-actions.queue.spec.ts …/session-budget-actions.service.spec.ts …/chat-store/conversation.service.spec.ts …/chat-store/message-dispatch.service.spec.ts …/chat-store/chat-lifecycle.service.spec.ts …/chat-message-handler.service.spec.ts --coverage=false --maxWorkers=2` | 6 suites, 173/173 passed |
| `chat-lifecycle.service.spec.ts`, re-run after the last type fix | 37/37 passed |
| `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/templates/chat-view --coverage=false --maxWorkers=2` (these specs construct the banner service) | 4 suites, 98/98 passed |
| `npx jest -c libs/frontend/chat-state/jest.config.ts …/tab-manager.handoff-adoption.spec.ts …/tab-manager.agent-adoption.spec.ts --coverage=false --maxWorkers=2` | 2 suites, 30/30 passed |
| `npx prettier --write <11 changed files>` | Applied |
| `npx eslint <11 changed files>` | 0 errors, 1 warning |

- The eslint warning is the existing `max-lines` warning on `tab-manager.service.ts`, which was 1619 lines and already far over the 700 limit; this change added 41 lines.
- `ptah_get_diagnostics` on the changed files:
  - No errors in any changed source file.
  - No errors in the new queue spec or in the handoff-adoption spec.
  - The remaining errors in `chat-lifecycle.service.spec.ts` and `message-dispatch.service.spec.ts` are older ones: string tab ids assigned to the branded `TabId`, outside the changed hunks. Two such errors in new test lines were fixed.
- Prettier also reformatted two older hunks in the files it was run on: the `images` array in `message-dispatch.service.ts` `restoreQueuedMessage`, and the `queueFlushes` expression in `chat.store.ts`. These are whitespace-only changes that lint-staged would make on commit anyway.

## Changed files

- MODIFIED `libs/frontend/chat-state/src/lib/tab-manager.service.ts`
- MODIFIED `libs/frontend/chat-state/src/lib/tab-manager.handoff-adoption.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts`
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts`
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts`
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/services/chat.store.ts`
- MODIFIED `libs/frontend/chat/src/lib/services/message-sender.service.ts`
- MODIFIED `libs/frontend/chat/src/lib/services/session-budget-actions.service.ts`
- CREATED `libs/frontend/chat/src/lib/services/session-budget-actions.queue.spec.ts`

## Decisions

1. **The command is held in `ConversationService`, not in `TabState`.** `TabState` lives in `chat-types`, which is outside this scope, and the visible queue has only one string. A per-tab side list is the smallest change, and it leaves the queue display, persistence and the streaming handler's flush untouched.
2. **The fix applies to every slash command, not only the banner's.** A typed `/compact` behind queued text had the same defect. Normal messages are unaffected.
3. **"Dispatch confirmed" means the held command has become the tab's queued message on its own.** From that point it follows the existing path that A2 verified: it is delivered when the turn ends and routed by the backend. This matches the existing contract that "a queued message counts as accepted". The banner does not wait for the command's own `chat:continue`; a refused flush there shows the existing in-transcript failure notice and keeps the command queued.
4. **Order is held against the already-queued text, and the command always runs after queued text.** Text queued after the click is also sent before the command; the wrap-up runs last. Text queued after the command has become the queued message is appended to it as arguments. That is the existing behaviour for a queued command (B4 A2).
5. **Stop, `chat:error` and an unrelated flush after a queue reset drop held commands, and the banner is re-enabled with a notice.** A dropped command is never sent later on its own. Reset paths inside `TabManagerService` (resume failure, compaction timeout, reset to fresh) are caught lazily by the "waited behind" check at the next flush, so no hook was added to each of them.
6. **Cancel and edit of the queue promote the held command** into the visible queue, where it is shown and can be cancelled, rather than leaving it invisible.
7. **A failed start is detected by `sessionId === tabId` plus a tab that never bound or streamed a session.** That is the host's own report format, so ordinary stream errors are excluded. Real SDK session ids never equal the webview tab id.
8. **The failed tab is kept, not closed,** and is shown as an idle tab with the host's reason in the transcript. This reuses the existing transcript notice and needs no new UI. The host's message text is already prompt-free by the backend's contract. The webview adds no prompt text and logs only what `handleChatError` already logged.

## Out-of-scope observations (not touched)

- A tab that is closed while it holds a command keeps a small map entry until the next flush or Stop. Its banner is gone with the tab, so nothing is visible to the user.
- `handleChatError`'s active-tab fallback can still target an unrelated tab when the error names a background-partition tab that is not a failed start. This behaviour is older than this change.
