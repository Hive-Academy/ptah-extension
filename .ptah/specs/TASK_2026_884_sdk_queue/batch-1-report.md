# TASK_2026_884 — batch 1 report (RPC contract, follow-up coordinator, push event, DI guards)

No commit, push or PR (as instructed). Frozen provider-contract files untouched.

## Files

Shared
- MODIFIED `libs/shared/src/lib/types/rpc/rpc-chat.types.ts` — `ChatContinueParams.queueIntent`, `ChatContinueResult.queueState/queuedMessageId`, `ChatAbortResult.withdrawn`, `ChatQueued{List,Withdraw,Steer}{Params,Result}`, `ChatQueuedMessageStateEvent`.
- MODIFIED `libs/shared/src/lib/types/rpc.types.ts` — `RpcMethodRegistry` + `RPC_METHOD_ENTRIES` for `chat:queued-list|withdraw|steer`.
- MODIFIED `libs/shared/src/lib/types/messages/message-constants.ts` — `CHAT_QUEUED_MESSAGE_STATE: 'chat:queued-message-state'`.

rpc-handlers
- CREATED `libs/backend/rpc-handlers/src/lib/chat/follow-up/chat-follow-up-queue.service.ts` — `ChatFollowUpQueueService` (coordinator).
- CREATED `libs/backend/rpc-handlers/src/lib/chat/follow-up/chat-follow-up-queue.service.spec.ts`
- CREATED `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.follow-up-queue.spec.ts`
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/tokens.ts` — `CHAT_TOKENS.FOLLOW_UP_QUEUE = Symbol.for('ChatFollowUpQueueService')`.
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/di.ts` (+ `di.spec.ts`) — singleton registration before `SESSION`.
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` — `chat:continue` queue path, `chat:abort` withdraw-before-interrupt; optional last ctor param `followUpQueue`.
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts` (+ spec key list) — `queueIntent` + UUID refine, `ChatQueuedListParamsSchema`, `ChatQueuedItemParamsSchema` (strict).
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts` (+ spec) — 3 new METHODS, optional `followUpQueue` injection, `registerFollowUpQueue()`.

Electron DI guards
- MODIFIED `apps/ptah-electron/src/di/expected-resolvable.ts` — `['FOLLOW_UP_QUEUE', CHAT_TOKENS.FOLLOW_UP_QUEUE]`.
- MODIFIED `apps/ptah-electron/src/di/container.smoke.spec.ts` — phase-4 registration + singleton + single subscription.
- MODIFIED `apps/ptah-electron/src/di/rpc-surface.spec.ts` — the three methods are served, none excluded.
- `surface-composition.spec.ts`: no change needed (it pins runtime bindings, not chat methods). VS Code/CLI composition roots: no change — all hosts call `registerChatServices`, which registers the coordinator. `ALLOWED_METHOD_PREFIXES` unchanged (`chat:` already allowed).

## Contract as implemented

- `chat:continue` `{..., queueIntent?: 'next-turn'}` — Zod: `queueIntent` literal; when set, `clientMessageId` must match `UUID_REGEX` (v4).
  - Refused before any drive/send: slash command → `{success:false, errorCode:'INVALID_PARAMS'}`; session owned by another tab → `{success:false, errorCode:'SESSION_NOT_FOUND'}`.
  - Never refused as busy; stop-intent autopilot interrupt is skipped for a queued send; the running stream is untouched.
  - Binding `(sessionId, clientMessageId) → tabId` is recorded BEFORE `sendMessageToSession(…, {files, images, clientMessageId, queueIntent:'next-turn'})`; unbound if the send throws.
  - Result: held → `{success:true, sessionId, queueState:'queued', queuedMessageId}` (no `enqueued`); not held (idle, admitted) → existing reply (`enqueued:true` or `settled:true`) + `queueState:'admitted'`; Codex resume that delivered the prompt → `queueState:'admitted'`.
- `chat:queued-list {sessionId, tabId}` → `{items}`: adapter `listQueuedFollowUps` filtered to items bound to this tab, FIFO.
- `chat:queued-withdraw {sessionId, tabId, clientMessageId}` → `{withdrawn}`: false when not this tab's item or adapter lacks the method.
- `chat:queued-steer {…}` → `SteerQueuedFollowUpResult`: `NOT_QUEUED` when not this tab's item, `UNSUPPORTED` when adapter lacks it.
- All three: strict Zod (UUID ids, unknown keys rejected); without the coordinator → `[]` / `false` / `UNSUPPORTED`; ownership refusal → `RpcUserError('…not open in this tab.', 'SESSION_NOT_FOUND')` (no Sentry).
- `chat:abort`: after the Ptah-CLI branch, `withdrawAllForStop(sessionId)` (adapter list FIFO, one `withdrawQueuedFollowUp` each; a `false` = raced claim, skipped; a throw is logged and skipped) runs BEFORE `interruptSession`. Reply adds `withdrawn` when non-empty — also on the `success:false` reply if the interrupt throws after withdrawal.
- Ownership rule: owner tab = live Claude registration (`SessionLifecycleManager.find(sessionId)` with `realSessionId === sessionId`) else the tab of held bindings; no owner = accepted. Never the active tab.
- Push: the coordinator subscribes in its constructor to `sdkAdapter.onQueuedFollowUpState?.(…)` (feature-checked; `dispose()` releases it). Each change → `webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_QUEUED_MESSAGE_STATE, {sessionId, tabId, clientMessageId, state, reason?})`, direct, bypassing `ChatStreamDeliveryCoordinator` viewport suppression. Tab = binding, else Claude registration; no tab → debug log, dropped. Any non-`queued` state unbinds. No message text is logged.

## Tests added

- Coordinator spec (13): push to queuing tab; HIDDEN-tab regression (real `ChatStreamDeliveryCoordinator`, tab hidden, terminal `turn_state` → only statusOnly copy; `queued` + `delivered` events still reach the tab; no `CHAT_STREAM_SNAPSHOT`/reveal); unbound change routed via registration; no-tab drop; queued vs admitted; ownership refusal (registration and held items); unowned accepted; withdraw own item only; steer delegate incl. `TURN_CHANGED`/`NOT_QUEUED`; unsupported adapter → empty/false/UNSUPPORTED; FIFO stop withdrawal skipping a raced claim; a throwing withdrawal; no text in logs + dispose.
- Session spec (11): queued while a turn runs (`queueIntent` pass-through, bind before send, `queued` push, no interrupt); stop-like text with autopilot yolo not interrupting; idle → admitted; non-queue send unchanged; other-tab refusal before drive/send; slash refusal; failed send unbinds; abort FIFO withdraw before interrupt; raced claim excluded; failed interrupt still returns withdrawn; empty abort reply unchanged.
- Handler spec: METHODS list; Zod rejection (missing/non-UUID id, bad literal, malformed list/withdraw/steer params); valid queued continue delegated; delegation; no coordinator fallbacks; ownership refusal as user error, no Sentry.
- `chat/di.spec.ts`: one singleton, one subscription. Electron smoke + rpc-surface as above.

## Verification

- `npm run verify -- -t lint,typecheck -p @ptah-extension/rpc-handlers,@ptah-extension/shared` → `4 tasks: 4 succeeded`, exit 0.
- `npm run verify -- -t test -p @ptah-extension/rpc-handlers -- --testPathPatterns="src/lib/chat/|chat-rpc"` → 66 suites, 17 failed / 1283 passed. One failure was mine (`chat-rpc.schema.spec` key list, fixed). The other 16 are in `session-folder.spec`, `chat-session-policy-roots.spec`, `chat-session-agent-child.spec`, `chat-session-resume-activate.spec`, `chat-session-session-folder.spec`: `EPERM` on `symlink` and `\` vs `/` path-separator diffs on Windows — environment, not this diff (none exercise the queue path).
- `npm run verify -- -t test -p @ptah-extension/rpc-handlers -- --testPathPatterns="chat-rpc|follow-up-queue|chat/di.spec"` (after the fix) → 5 suites, 236 tests passed, exit 0.
- `npm run verify -- -t test -p @ptah-extension/shared -- --testPathPatterns="types/rpc|types/messages"` → exit 0 (incl. host-source registry contract: new names do not match its pattern).
- `npm run verify -- -t lint,typecheck -p ptah-electron` → exit 0 (one earlier attempt hit a transient Nx plugin-worker crash under memory pressure; retried).
- `npm run verify -- -p ptah-electron -- --testPathPatterns="src/di/"` → tests 12 suites, 1 failed / 161 passed: `phase-2-libraries.config-home.spec.ts` (harness root resolved to `%TEMP%` instead of the temp repo — environment, untouched area). New smoke and rpc-surface tests pass. (That run's lint/typecheck failed only because the Jest flag was forwarded to tsc/eslint; rerun above without it.)
- `npm run verify -- -t test -p @ptah-extension/cli-engine -- --testPathPatterns="surface"` → exit 0.
- `npm run verify -- -t lint -p @ptah-extension/rpc-handlers,ptah-electron` → `2 tasks: 2 succeeded` (warnings only, pre-existing; `chat-session.service.ts` was already over `max-lines`).
- `ptah_get_diagnostics` timed out (TS check still running after 45 s); verify typecheck used instead.

## Decisions

- Ownership source: item bindings + live Claude registration (`SDK_SESSION_LIFECYCLE_MANAGER.find`, optional injection). Codex has no tab registration reachable from rpc-handlers, so for Codex only bindings decide. Reversible.
- Refusal code `SESSION_NOT_FOUND` (existing code; no probe distinction) rather than adding a new code to `rpc-error-codes.types.ts` (not in my ownership). Reversible.
- Slash commands with `queueIntent` are refused (`INVALID_PARAMS`): executing them would end/replace the running session. Renderer informed.
- `queueState` detection: after `sendMessageToSession` resolves, the item is `queued` iff the adapter still lists it; otherwise `admitted` and unbound.
- Coordinator injected as an optional last ctor param into `ChatSessionService` / `ChatRpcHandlers` (matches existing optional-collaborator pattern; keeps positional specs working).

## Open issues / out of scope

- Ptah-CLI sessions: `ptahCli.handleContinue` runs before the queue path; a `queueIntent` send there gets no `queueState`.
- An adapter without `onQueuedFollowUpState`/`listQueuedFollowUps` makes a queued send behave as today (sent at once) and reports `admitted`.
- `chat:abort` has no `tabId`, so Stop withdraws every held item of the session (all were queued from the owning tab).
- Not touched (outside ownership): `messages/payload-map.ts` entry for the new push type; Electron replay `DEFAULT_ALLOWED_PUSH_TYPES` in `apps/ptah-electron/src/replay/scenario-sanitizer.ts`.
- Integration depends on batches 2/3 emitting `queued` synchronously inside `sendMessageToSession` (or before it resolves) and keeping the item listed until claimed; and on `routing-agent-adapter.ts` fanning in `onQueuedFollowUpState` and delegating list/withdraw/steer.
- Pre-existing Windows test failures listed under Verification.
