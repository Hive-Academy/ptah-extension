# Code Logic Review — `TASK_2026_678_9083`

## Summary

| Metric | Value |
| --- | --- |
| Verdict | NEEDS_REVISION |
| Overall score | 6/10 |
| Reviewer family | grok |
| Implementer family | codex |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 3 |
| Minor issues | 0 |
| Failure modes found | 4 |

Phase A threads a bounded `systemPrompt` through inactive `chat:continue`, `chat:resume` with `activate: true`, and `session:rewindFiles`, restores a validated tab marker, and holds non-owner sends in the dispatch and sender funnels. Stop, permission responses, and question answers are not gated. That is the part that holds.

It is not a 7. One shipped `chat:continue` sibling, SDK slash relaunch, builds a new query config without the persona. After that relaunch the session is active, so later turns never apply the prompt the client sent. It is not a 5 or below: the non-slash continue, activate, and rewind-backend paths match the contract, corrupt markers are dropped, and the lock does not block abort or answers.

Tests were not re-run. Orchestrator batch reports (shared + rpc-handlers, chat-state 585 tests, chat 3942 passed) are the verification evidence. They do not exercise the slash config. `ptah_*` tools were not available in this lane.

## Five logic questions

### 1. How does this fail silently?

A marked-tab slash command returns `success: true` from `chat:continue` while the relaunched query has no `systemPrompt`. The client attached the persona; the router never reads it (`libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:137-150`). `CommandCenterRecordsService` write methods return `false` on quota or validation failure, and `TabManagerService` ignores that boolean (`tab-manager.service.ts:991`, `tab-manager.service.ts:1930-1933`). A held `sendOrQueueMessage` resolves `{ success: true }` because the message was queued (`message-dispatch.service.ts:200-201`), which matches the existing streaming-queue contract.

### 2. What user action produces unexpected behaviour?

On a marked tab, any SDK slash command that takes the `new-query` path (`/compact` and the other intercepted commands) relaunches the query without the head-of-engineering persona. The next ordinary turns keep that query, and an active turn does not apply `params.systemPrompt` (`chat-session.service.ts:1489-1490`). Closing a marked tab while a lock is engaged leaves `isHeld` true for the dead root and its SDK id until reload or the next `engage` (`tab-manager.service.ts:1349-1352`). The first regular-chat send on a marked tab that has no SDK id yet calls `chat:start` with no persona (`message-sender.service.ts:457-472`).

### 3. What input data produces a wrong answer?

`systemPrompt` on continue and resume is length-bounded (`chat-rpc.schema.ts:34-39`, `78-87`, `92-104`). Rewind rejects a non-string or a string longer than `SYSTEM_PROMPT_MAX_LENGTH` before activation (`session-rpc.handlers.ts:1379-1385`). A malformed `commandCenterOrigin` is removed and the tab restores as ordinary (`tab-persistence.ts:217-231`, `256-258`). A second `engage` with a different owner token replaces the lock; the previous token can no longer `release`, and `isHeld(root, oldToken)` becomes true (`command-center-send-lock.service.ts:16-18`, `32-36`).

### 4. What happens when a dependency fails?

`localStorage` parse failure or a non-object payload yields an empty record, so the next successful write persists only what that call set (`command-center-records.ts:41-66`, `82-87`). `setItem` failure returns `false` and the tab lifecycle continues as if the last-session and active-marker writes had landed. Lock state is in-memory only; a new service instance is unlocked (`command-center-send-lock.service.spec.ts:24-27`). Question answers do not consult the lock (`chat.store.ts:500-509`). `chat:abort` is still wired from the tab abort signal (`message-sender.service.ts:219-248`).

### 5. What is missing that the requirements never mentioned?

Nothing in this phase calls `engage`. The page that owns engage, release, and the marked-tab answer is B6, B13, and B14. `ClaudeRpcService.rewindFiles` still omits `systemPrompt` (`libs/frontend/core/src/lib/services/claude-rpc.service.ts:351-362`); Task 16.3 owns that caller. The fork that rewind actually activates goes through `switchSession({ activate: true })`, which does attach the persona when the tab is marked. `ChatStore.sendOrQueueMessage` types `options` as `SendMessageOptions` only (`chat.store.ts:261-265`). A fresh object literal cannot pass `ownerToken` through the store; a wider variable still reaches the dispatcher at runtime.

## Failure modes

### Slash relaunch drops the persona

- Trigger: a marked tab sends an SDK slash command (`new-query`).
- Symptom: the continue RPC succeeds and later active turns keep a query that was started without the head-of-engineering prompt.
- Evidence: `chat-session.service.ts:981-991` skips `autoResumeIfInactive` for slash commands, so the spread at `chat-session.service.ts:1599` never runs. `chat-slash-command-router.service.ts:137-150` copies `mcpToolProfile` and `ptahUiFence` into `sessionConfig` and does not copy `systemPrompt`. The client still sends it (`message-sender.service.ts:711-719`).
- Current handling: success result, no log of the missing prompt.
- Recommendation: spread `params.systemPrompt` into that `sessionConfig` the same way `resumeSession` does, and spec an inactive and an already-active slash continue.

### First regular-chat start omits the persona

- Trigger: `createCommandCenterTab` has run, the tab has no `claudeSessionId`, and the user sends from regular chat before the coordinator's `chat:start`.
- Symptom: `chat:start` carries no `options.systemPrompt`. The session is then active, so continue-time prompts are ignored.
- Evidence: `message-sender.service.ts:457-472` versus the continue spread at `711-719`. No product caller invokes `createCommandCenterTab` yet. Task 6.1 owns the coordinator start and does not edit this sender.
- Current handling: the start succeeds.
- Recommendation: when B6 adds the coordinator start, also attach `commandCenterPersonaFor` on `startNewConversation` for a marked tab so a racing regular-chat send cannot pin a persona-less query.

### Close leaves the send lock engaged

- Trigger: lock is engaged, user confirms close of the marked tab.
- Symptom: `isHeld(closedTabId)` and `isHeld(sdkSessionId)` stay true until reload or another `engage`. A later resume of that SDK id onto a new tab id is not held, because send paths pass tab ids.
- Evidence: `tab-manager.service.ts:1349-1352` clears the active-tab record and does not call `release`. Plan line 29 assigns mute, stop, page teardown, and reload to later page work. No later batch names `release` inside `closeTab`.
- Current handling: the tab is aborted and removed; the lock object remains.
- Recommendation: `release` is token-gated, so close cannot release a foreign token. Clear the lock when `rootTabId` is the tab being removed, or have the page subscribe to tab close. Do not treat the next `engage` overwrite as the release path.

### Record write failure looks like success

- Trigger: `localStorage.setItem` throws, or `writeLastSession` / `setActiveTabId` rejects its payload.
- Symptom: the tab still closes or binds an SDK id; after close, AC16 has no last-session record.
- Evidence: `command-center-records.ts:69-75` returns `false`. Callers at `tab-manager.service.ts:991` and `1930-1933` ignore it.
- Current handling: none.
- Recommendation: surface a failed last-session write on the bind and close paths. Do not report the marker as durable when the separate record did not land.

## Findings

| ID | Severity | File:line | Defect | Failure scenario | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| L1 | Serious | `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:137-150` | Slash `new-query` builds `sessionConfig` without `systemPrompt`. `continueSession` skips inactive resume for every slash command (`chat-session.service.ts:981-991`), so the continue spread at `chat-session.service.ts:1599` does not run. The relaunched query stays active, and active turns ignore a later persona. | Marked tab, user sends `/compact` or another intercepted SDK slash from regular chat (lock is not restored after reload). RPC succeeds. Every following turn in that query has no head-of-engineering persona. | Copy `params.systemPrompt` into `sessionConfig` when it is a non-empty string. Spec inactive and live slash continues. |
| L2 | Moderate | `libs/frontend/chat/src/lib/services/message-sender.service.ts:457-472` | `startNewConversation` never calls `commandCenterPersonaFor`. Persona is attached only on continue (`711-719`) and on activating resume (`session-loader.service.ts:995-1000`). | Marked tab with no SDK id yet. First regular-chat send starts the session with no persona. Later active continues do not repair it. No UI calls `createCommandCenterTab` in this phase; Task 6.1 owns coordinator `chat:start` and does not own this branch. | Attach the resolver on start for a marked tab when B6 lands, so a user send cannot win the race. |
| L3 | Moderate | `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1349-1352` | Confirmed close of a marked tab clears `activeTabId` and does not release `CommandCenterSendLockService`. | Voice lock is engaged (no production caller until B6/B14). User closes the tab from regular chat. `isHeld` stays true for the closed root and its SDK id. A new tab id for the same SDK is not held. | Drop the lock when the closed id is `rootTabId`. Page teardown alone does not cover regular-chat close. |

## Open observations

| ID | Result | Severity | Evidence |
| --- | --- | --- | --- |
| B2 | Refuted as in-process loss. Latent across two renderers. | Moderate if a second webview ever shares the origin. Not counted above. | `writeLastSession`, `setActiveTabId`, and `writeRunManifest` read the whole blob and `setItem` it back (`command-center-records.ts:82-87`, `95-100`, `107-112`) with no await, so one renderer cannot interleave them. Electron chat UI is a single main `BrowserWindow` (`apps/ptah-electron/src/windows/main-window.ts:115`). Two renderers on the same origin can drop the other writer's `runs` or `lastSession`. The JSON is replaced whole; a failed parse becomes an empty record rather than a merged corrupt object (`41-49`). A record is not lost or corrupted in the current single-window process. |
| a | Confirmed | Moderate | `engage` always `set`s when `rootTabId` and `ownerToken` are non-empty (`command-center-send-lock.service.ts:16-18`). No production caller. The spec covers a wrong `release`, not a second `engage`. The new token becomes the owner; the old token cannot release and is treated as a non-owner by `isHeld` (`32-36`). Later page code can paper over this by releasing first. The service as written will not. |
| b | Confirmed | Moderate | See L3. The close spec checks the active-marker clear and the surviving last-session record (`tab-manager.command-center.spec.ts:57-70`) and never asserts `isHeld` after close. |
| d | Refuted as stranding | None | `sendQueuedMessage` returns before `clearQueuedContentAndOptions` (`message-dispatch.service.ts:225-226`, clear at `250`). The text stays on the tab. `processStreamEvent` flushes without an owner token (`chat.store.ts:440-443`), so a flush while the lock is held returns again and still does not clear. Nothing listens for `release`. Plan line 29 says not to flush on unlock and to send later with user intent. After unlock the text remains queued until the next turn-end flush. It is not deleted. |
| e | Refuted on current callers | None | `isHeld` uses `options.tabId ?? activeTabId()` (`message-sender.service.ts:99-102`). `send`, `continueConversation`, and `runContinueConversation` use that same fallback for the destination (`347-356`, `536`, `608`). A missing `tabId` checks the tab the send actually uses. `sendQueuedMessage` always passes `tabId` (`252-255`). A direct `continueExistingSessionForQueueFlush(sessionId)` without `tabId` could continue a locked SDK session while consulting the active tab. Nothing in the tree calls it that way. |
| f | Confirmed | The gap that matters is L1, which these specs do not touch. | Six tests: dispatch lock (2), sender (2), resume persona (1), deciding tab (1). Untested paths with real risk: slash `sessionConfig`; `chat:start` on a marked tab; `engage` while another token holds the lock; `closeTab` while `isHeld`; history-only `chat:resume` must omit `systemPrompt` (the loader spec only passes `activate: true`); `send`/`continueExistingSessionForQueueFlush` with no `tabId`; flush after `release`; `rewindFiles` from `ClaudeRpcService` still has no persona argument. `ownerToken` is an intersection on the dispatch and sender methods, not a field of `SendMessageOptions`, and `ChatStore.sendOrQueueMessage` (`chat.store.ts:261-265`) does not widen the type. Runtime forwarding still works for a non-literal options object. |

## AC and risk coverage

| Item | Result |
| --- | --- |
| AC2 | Partial. Resolver and persona text match the discovery rules (`command-center-persona.ts:5-14`). Non-slash continue and activating resume attach it only for a valid marker, and unmarked tabs omit the key (`message-sender.service.ts:711-719`, `session-loader.service.ts:995-1000`). L1 breaks slash continues. L2 breaks a first `chat:start` from regular chat. Coordinator start is B6. |
| AC16 | Partial, as far as this phase goes. Marker round-trips through `projectTabForPersist` (`tab-persistence.ts:111-125`). Malformed markers become ordinary tabs. Last-session is written on SDK bind and kept on close; the active marker is cleared (`tab-manager.service.ts:1926-1933`, `1349-1352`). Resume UI is B6. A failed record write is silent (failure mode above). The in-memory lock is not restored, which matches plan line 27. |
| AC22 | Not implemented here, and not broken. `handleQuestionResponse` still delivers the answer and uses an explicit deciding tab when the caller passes a parseable id (`chat.store.ts:500-509`). Existing callers omit it, so today's behavior stays `activeTabId()`. The lock does not wrap question or permission responses. Decline and the fixed non-actionable Confirm text belong to Tasks 8.3 and 13.1. Amendment A1 is not on a path this phase can reach. |
| AC25 | Partial. One lock record, `isHeld` is false for other tab ids and for the owner token (`command-center-send-lock.service.ts:32-36`). Dispatch queues non-owner sends, including slash text, and does not flush or clear an existing queue (`message-dispatch.service.ts:186-201`, `225-226`). Direct sender entry points return a failure instead of sending (`message-sender.service.ts:329`). Nothing in the product calls `engage` yet. L3 leaves a closed root held. Other tabs stay writable. |
| R1 | Backend done. `SessionRewindParams.systemPrompt` is bounded in the handler and passed into `ensureSessionActiveForRewind` (`session-rpc.handlers.ts:1379-1418`, `chat-session.service.ts:1412-1430`). An already-active stream does not resume. The rewind UI still calls `rewindFiles` without a persona (`claude-rpc.service.ts:351-362`); Task 16.3 owns that edit. The fork the user continues on is activated with `switchSession({ activate: true })` (`chat-view.component.ts:1831`), and `rebindTabSession` clears `hasLiveSession` (`tab-manager.service.ts:2619`), so that activation does send the persona for a marked tab. |
| R3 | API done, callers not done. Explicit `decidingTabId` wins over `activeTabId()` (`chat.store.ts:500-504`). Tasks 6.1 and 13.1 still have to pass the marked tab. A non-UUID explicit id parses to `null`, and `cancelPendingQuestionOnOtherTabs` then treats every target as a non-deciding tab (`stream-router.service.ts:764-771`). |
| R9 | Held. Tab-manager edits are the create, close-confirm, close-record, and SDK-bind hooks. New behavior is in new files and new specs. This review did not re-run the old tab-manager suites; batch 3 reports 585 tests in that project. |
| R10 | Held for the new fields, missed on the slash sibling. Continue and resume schemas reject a non-string and a string over 16 KiB. Rewind uses the same constant. The persona module is under that cap (`command-center-persona.spec.ts:18`). `commandCenterPersonaFor` returns undefined for a missing or invalid marker. `chat:start`'s nested `options.systemPrompt` is still inside `.passthrough()` with no length cap (`chat-rpc.schema.ts:64-71`). Task 1.2 only required a start bound if one already existed. It did not. |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| L1 is Serious, not Blocking | Blocking under AC2; Serious as a sibling of the continue contract | The prompt's Blocking bar for this phase is data loss, a security hole, or A1/AC22/AC25 broken on a reachable path. AC2 is not in that set. Non-slash continue still applies the persona. Slash is a `chat:continue` the lock task itself treats as a send. | Yes |
| B2 is not an in-process data-loss finding | Count a lost-update bug; treat it as latent | Read and write are synchronous and the only chat `BrowserWindow` is the main window. | Yes |
| (d) and (e) are not defects | File them as Serious stranding and lock bypass | Plan line 29 requires the queue to stay put. Current send destinations use the same tab id the lock checks, and the flush caller passes `tabId`. | Yes |

## Scope and residual uncertainty

Read in full: `command-center-persona.ts`, `command-center-records.ts`, `command-center-send-lock.service.ts`, the four new chat specs, the persona and lock specs, the records spec, the tab-manager command-center spec, the restore spec, both backend persona specs, and the rpc-chat types spec. Traced, not every line of the pre-existing files: `continueSession`, `autoResumeIfInactive`, `resumeSession` activate, `registerRewindFiles`, `send` / `startNewConversation` / `runContinueConversation`, `sendOrQueueMessage` / `sendQueuedMessage`, `handleQuestionResponse`, `closeTab`, `attachSession` / `resolveSession`, `sanitizeRestoredTab`, `switchSession` activate, `attemptRewindV2`, and `executeSlashCommand` through the sessionConfig handoff.

Not checked: a live Electron slash continue, localStorage quota, or a second webview. No source file was edited.
