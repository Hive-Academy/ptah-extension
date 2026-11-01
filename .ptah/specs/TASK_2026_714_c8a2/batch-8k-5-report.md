# Batch 8k-5 report — end-to-end native contract specs

Written 2026-10-28 by the team-leader. W = `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration`.

## Result

COMPLETE, commit `c1b2a1364` (`test(rpc-handlers): pin native Codex chat contracts end to end`).
The team-leader wrote the spec itself (Claude, in-process). No CLI lane ran. No production file changed.

## Files

- NEW `W/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-native-contract.spec.ts` (the only
  file in the commit; no fixture helper files).

## Path under test (all real code)

Scripted App Server notifications and server requests -> `CodexEventTranslator` and
`CodexApprovalBridge` (codex-runtime) -> `CodexChatAdapter`, `CodexChatEvents` projection and
`streamCodexChatTurn` (agent-sdk) -> `createCodexChatHostPorts` -> `ChatStreamBroadcaster` -> the
webview messages (BATCH envelopes unwrapped). The `SessionApprovalRouter` and
`SessionTurnStateRegistry` are real, and the turn-state registry is shared by the adapter and the
broadcaster. The router cancellation is wired to the host presentation, as `register.ts:1065-1077`
wires it.

Two things are faked. The process boundary is a scripted server that feeds the real translator.
The `profile` port is replaced the same way `apps/ptah-electron/src/di/codex-runtime-composition.ts`
replaces it. The translator, bridge, rule store and router are not exported from their barrels, so
the spec loads them with `jest.requireActual` from source. That follows the existing
`codex-chat-host-ports.spec.ts` precedent.

The Claude reference turn uses recorded-shape SDK messages: stream events, the completed
`assistant` message and `result`. They run through the real `SdkMessageTransformer` and the same
broadcaster.

## Specs

1. A completed native turn delivers this root lifecycle: `turn_state` generating, `message_start`,
   `text_delta`, `message_delta`, `message_complete`, `chat:complete`, `turn_state` idle
   `completed`. The Claude reference turn delivers the same lifecycle. The per-event shape also
   matches: base keys and wire types, turn_state key set, phase and terminalReason, role, delta
   and token usage. All content chunks share one messageId. The spec also checks that no
   chat:error is sent, no error callback fires and no stream error is logged.
2. An approval sent through the real bridge (`item/commandExecution/requestApproval`, itemId
   `call-1`) is broadcast as PERMISSION_REQUEST. The payload passes the real
   `parsePermissionRequest`, and its `toolUseId` equals the delivered `tool_start.toolCallId`
   (`call-1`). sessionId, tabId and toolName (the same Ptah name as tool_start) are checked, along
   with toolInput and description. The renderer reply `{ decision: 'allow' }` resolves the bridge
   with `accept`, and the turn then completes with tool_result and turn_state idle `completed`.
3. Stop during approval (`interruptSession`) behaves like this:
   - The stream ends with `CodexChatAdapterError` code `cancelled`.
   - The broadcaster treats it as a user abort: it logs "aborted by user", sends no chat:error and
     no Sentry report, and the last chunk is turn_state idle `aborted_streaming`.
   - PERMISSION_PROMPT_CANCELLED is sent exactly once, with `requestId` set to the renderer wire
     id and reason `turn-ended`.
   - The host notice is released under `attentionRequestKey('permission', wireId)` with the
     payload timestamp.
   - The bridge replies `cancel`, and the context is closed once.

## Verify

- Run under the FIFO lock, scoped to rpc-handlers only.
- `npm run verify -- -t test -p @ptah-extension/rpc-handlers`: PASS (1 task).
- `npm run verify -- -p @ptah-extension/rpc-handlers`: PASS (3 tasks).
  - lint: 0 errors, 52 pre-existing warnings, none in the new file.
  - typecheck: PASS.
  - test: 188 suites, 4852 passed, 7 skipped.
- New file: 3 of 3 tests pass. ts-jest type-checks the spec. Its first run caught one spec-only
  type error, which was fixed.
- One iteration fixed a `prefer-const` lint error in the new file.
- No `any`, `as unknown as`, `@ts-ignore` or `eslint-disable` was added.
  - Wide host types use a small `double<T>(members: Partial<T>)` helper built on
    `Object.create(null)`. Any member the path calls that the test did not provide throws.
  - The Claude fixture is parsed from JSON, like a recorded stream.
  - Both are named here because they are typed holes, even though they carry no cast token.

## Findings (no production change; recorded for the coordinator)

The specs found no defect in the three required contracts. The findings below come from reading
the same path. None of them is pinned by a spec.

1. **The renderer parser drops `allowedDecisions`.**
   - `libs/shared/src/lib/types/permission.parsers.ts:47-107` copies only the schema fields.
     `chat-message-handler.service.ts:734` then passes the parsed request on.
   - Result: every wire-received native prompt arrives in the frontend without `allowedDecisions`.
     The frontend paths that read it are dead for wire requests:
     - `permission-handler.service.ts:452,510`
     - `chat-attention-action-dispatcher.service.ts:82`
     - `chat-attention-source.service.ts:206`
   - The host maps the Claude decision vocabulary, so prompts still work, and spec 2 shows this.
   - Decide whether the field belongs in the shared contract. Otherwise remove the dead readers.
2. **Answering a native prompt also broadcasts PERMISSION_AUTO_RESOLVED for the same id.**
   - The chain:
     1. `handlePermissionResponse` calls the router.
     2. The router calls `sink.respond` (`session-approval-router.ts:82`).
     3. The sink calls `pending.settle` (`codex-chat-approval-sink.ts:211`), which calls
        `presentation.dismiss`.
     4. The host `dismiss` (`codex-chat-host-ports.ts:332-341`) still finds the wire id, because
        `settle(response.id)` in `handlePermissionResponse` runs only after `respond` returns.
        So it sends PERMISSION_AUTO_RESOLVED.
   - The renderer removes the prompt by id, so this is likely harmless. The Claude path does not
     send this message.
3. **Follow-up native turns may be torn down after each turn.**
   - `ports.publish` streams under the session id (`codex-chat-host-ports.ts:429`).
   - The broadcaster captures `getSessionToken(sessionId)`
     (`chat-stream-broadcaster.service.ts:155`). At stream exit it calls
     `endSessionIfTokenMatches` (`:412-416`). For a native session that token is the adapter's
     own, so the Codex session closes after every follow-up turn published through
     `sendMessageToSession`. The next message then has to resume.
   - The start stream is not affected, because it runs under the tab id.
   - Confirm this in the P8 live re-test, or with a spec in round 8l.
4. **Parity gaps that are not defects.**
   - The native turn has no `source: 'complete'` mirror of the finished message, so it sends one
     chat:complete where Claude sends two.
   - The native `message_complete` has no `model` field, which the Claude stream one has.

## Not done (by instruction)

No push and no PR action. No phase gate: the coordinator runs it after round 8l. No change to
`~/.ptah/settings.json`.
