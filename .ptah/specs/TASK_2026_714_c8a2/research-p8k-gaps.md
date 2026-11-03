# P8K Codex parity gap research

Research only. Code locations are workspace-relative and one-based. Evidence: `live-test-p8k.md`, targeted run-1/run-2 log searches, source at `a2445ce9a`, and the diffs of `7fb4ad120` and `99a49b4e8`. No implementation or verification was run. Preserve Electron-first behavior, Claude behavior, MCP, and the single App Server proxy.

## G2

**Cause — confirmed.** `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1282-1288` now passes `clientMessageId` on every continue (`7fb4ad120`). `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:533-553` accepts only files/images/admission, so even an undefined extra key rejects every in-place follow-up. The throw at `:536-542` bypasses `failure()` at `:768-783`, losing adapter failure logging. `codex-chat-turn-stream.ts:75-127` has no prompt ID and `codex-chat-events.ts` emits no user echo.

**Claude path.** `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:100-114,232,278` retains the ID; `message-transform/user-message.transformer.ts:134-144` puts it on echoed user `message_start`; `sdk-message-transformer.ts:181-195` and `helpers/stream-transformer.ts:1115-1149` put `consumedClientMessageId` on interrupted, failed and prompt-only retirement. `helpers/session-lifecycle/echo-identity.ts:8-27` matches by identity. The renderer sends the optimistic ID at `libs/frontend/chat/src/lib/services/message-sender.service.ts:796`, reconciles echo in `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:167-175` and `libs/frontend/chat-state/src/lib/tab-manager.service.ts:2340-2351`, and retires it in `libs/frontend/chat-streaming/src/lib/turn-state-applier.service.ts:98-104,127-134`.

**Fix.** In `codex-chat-adapter.ts`, accept/validate `clientMessageId` as an adapter-only option, carry it through `codex-chat-turn-stream.ts`, and never forward it to App Server. Emit one user `message_start` with that ID on admission and a terminal `turn_state.consumedClientMessageId` on success, interruption, failure, and accepted prompt-only turns. Route pre-admission rejection through the logged failure path. Avoid text matching.

**Specs.** Adapter/turn-stream: follow-up with key, one identity echo, exact consumed ID for each terminal outcome, and logged invalid options. RPC chat-session: exact options object from `7fb4ad120`. **Verify projects.** `@ptah-extension/agent-sdk`, `@ptah-extension/rpc-handlers`, `ptah-electron`; typecheck `ptah-extension-vscode`, `ptah-cli`, `ptah-tui` if shared agent-sdk types change. **Size:** M. **Frontend touched?** no.

## G3

**Cause — confirmed.** `codex-chat-events.ts:281-310` reports a terminal failure through a callback but marks its exception `webviewReported:true`. `codex-chat-turn-stream.ts:115-127` creates that callback only after `startTurn`; before a receipt, it cannot have rendered anything. After a receipt, `projection.settled()` at `:251` throws before `:252-261` yields the terminal event; catch `:266-272` rethrows, while `finally` settles only the registry. `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:315-381` suppresses `CHAT_ERROR` for the marker added by `99a49b4e8`. Run 1 records failure with zero content events and renderer `Chat error: [object Object]`, not a card. Broadcaster cleanup at `:352-362` uses a provisional session ID that may miss the real Codex binding.

**Claude path.** `libs/backend/agent-sdk/src/lib/helpers/stop-failure-hook-handler.ts:78-100` records failure and emits `turnFailed`; `helpers/session-turn-state.registry.ts:344-390` yields failed terminal state. `libs/frontend/chat-streaming/src/lib/turn-end-handler.service.ts:237-270` and `turn-state-applier.service.ts:127-157` settle the tab. `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts:202-251` treats `CHAT_ERROR` as start failure only for an announced, unbound tab; a bound turn needs terminal state. The marker assumed a callback `CHAT_ERROR` had already rendered a card. It had not for zero events, and `CHAT_ERROR` alone does not settle a bound tab.

**Fix.** In `codex-chat-turn-stream.ts`/`codex-chat-events.ts`, record failure and yield Claude-equivalent failed `turn_state`/turn-failed notification, with active real session ID and consumed prompt ID, before stream termination. In `chat-stream-broadcaster.service.ts` and `codex-chat-event-callbacks.ts`, choose one error publisher, remove the incorrect marker for this path, and prevent a duplicate card. Retire the dead real Codex session even with no content events. Use the existing failed-turn presentation contract; a bare unsuppressed `CHAT_ERROR` is insufficient.

**Specs.** Zero-event start failure, process death after receipt/before text, failed turn state plus exactly one error presentation trigger, correct session cleanup, and Stop after failure; test a bound tab, not only the callback. **Verify projects.** `@ptah-extension/agent-sdk`, `@ptah-extension/rpc-handlers`, `ptah-electron`; host typechecks if shared event types change. **Size:** L. **Frontend touched?** no.

## G4

**Cause — confirmed.** `codex-chat-approval-sink.ts:109-167` requires `environmentId == null` at `:135-137`, while live command approvals carry an ID. `libs/backend/codex-runtime/src/lib/codex-protocol-methods.ts:175-196` declares a nullable string; `protocol/codex-app-server-protocol.schema.json:2887-2893` calls it the environment *in which the command will run*. Non-null is not proof of local execution. `thread/environment/connected` and remote-control notifications identify environments but do not attest locality.

**Claude path.** Claude's Ask/read auto-accept relies on the same read-only command and workspace safety intent; its requests have no Codex environment field. The native sink already applies read grammar and containment (`codex-chat-approval-sink.ts:109-167,181-202`; `codex-read-only-command.ts`).

**Fix.** Accept null or an ID independently attested by the runtime as the current **local** environment. Unknown, stale, merely connected, or remote IDs fail closed. Require all of: autoAcceptReadOnly; effective Ask level; command kind; no network approval context or proposed network amendment; no exec-policy amendment or escalation reason; exact read-only grammar; current thread/workspace cwd; realpath inside root, including symlinks; and no duplicate/aborted approval. Otherwise show normal approval. Do not weaken the grammar.

**Specs.** Attested local ID + safe read; null legacy case; unknown/remote/stale ID, network, amendment, escalation, write grammar, outside-root and symlink rejection. **Verify projects.** `@ptah-extension/agent-sdk`, `@ptah-extension/codex-runtime` if provenance API changes, `ptah-electron`, dependent host typechecks. **Size:** M. **Frontend touched?** no.

## G5

**Cause — policy mismatch refuted.** `libs/backend/codex-runtime/src/lib/codex-execution-profile.ts:142-188` maps both Ask and Auto-edit chat to `approval_policy: untrusted` plus `sandbox: workspace-write`; T10's `turn_context` is correct under D14. `codex-chat-adapter.ts:701-714` calls `context.updateNextTurn`, and `codex-context.ts:785-847` updates settings/policy and persists identity; `:506-525` builds `turn/start` from them. On resume, `codex-context.ts:115-124` initializes from saved profile. Since both levels share the wire policy, the trace is consistent with persistence but cannot prove the restored level.

**Claude path.** Claude saves a native session control setting and restores it via `session-control.service.ts:509-548` and `config-rpc.handlers.ts:349-398`; the chip should reflect saved permission even when wire policies coincide.

**Fix.** Keep D14 mapping. Add a resume spec that saves Auto-edit, closes, resumes, and asserts restored permission level and approval behavior, not merely `turn_context`; change production code only if that fails. **Specs.** `codex-context`/native-session-controls distinct Ask vs Auto-edit resume. **Verify projects.** `@ptah-extension/codex-runtime`, `@ptah-extension/agent-sdk`, `@ptah-extension/rpc-handlers`, `ptah-electron` if defect found. **Size:** S. **Frontend touched?** no.

## G6

**Cause — confirmed.** `libs/backend/rpc-handlers/src/lib/config/config-rpc.handlers.ts:349-398` saves fallback level only after live toggle succeeds. `native-session-controls.ts:175-208` sees a stale adapter token and calls live `updateNextTurn`; the dead context throws “Codex context is not ready” (`codex-chat-adapter.ts:701-714`, `codex-context.ts:463-465`). The token lookup at adapter `:565-566` does not prove liveness. Renderer `libs/frontend/chat/src/lib/services/autopilot-state.service.ts:260-312` optimistically updates, then logs/rolls back; the exception supplies no useful visible result.

**Claude path.** `session-control.service.ts:509-548` reports unavailable session; `config-runtime-controls.ts:17-27` maps `SessionUnavailableError` to a non-live result, letting `config-rpc.handlers.ts:360-379` save for next session. Its generic toggle response then succeeds.

**Fix.** With G3, retire dead Codex session promptly. In `native-session-controls.ts`, map only typed closed/unavailable context to Claude's no-live-session result, then persist the level for next open; preserve genuine failures. **Specs.** Dead context with stale token, next-open saved level, successful live toggle, and a distinct real error. **Verify projects.** `@ptah-extension/agent-sdk`, `@ptah-extension/rpc-handlers`, `ptah-electron`; dependent host typechecks if controls change. **Size:** M. **Frontend touched?** no.

## G7

**Cause — confirmed.** `chat-session.service.ts:617-661` catches `CodexResumeProfileChangedError` and sets the specific D14a refusal text, then labels it `CODEX_RUNTIME_FAILED` at `:634-636`. `libs/frontend/chat/src/lib/services/message-sender.service.ts:155-167` replaces that code with generic “Codex chat could not start.”

**Claude path.** A specific safe Claude start refusal travels through the generic failed result's `error` text; the sender's generic fallback at `message-sender.service.ts:163-167` displays it. Classified runtime failures use their generic code translation.

**Fix.** In `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`, return this narrow refusal with its fixed safe `error` text and **without** `CODEX_RUNTIME_FAILED` (`errorCode` omitted). Retain the code for real runtime failures. **Specs.** Start/resume specific text and absent runtime code; genuine runtime failure still coded. **Verify projects.** `@ptah-extension/rpc-handlers`, `ptah-electron`; dependent host typechecks if response type changes. **Size:** S. **Frontend touched?** no.

## G1

**Cause — mixed.** Run 1 has two concurrent `config:models-list` responses: `savedModel` first `gpt-6-sol`, then global `gpt-6-astra`. `libs/backend/rpc-handlers/src/lib/config/config-rpc.handlers.ts:481-500,572-601` takes no request workspace, reads ambient selected model, and awaits catalog work. `libs/frontend/core/src/lib/services/model-state.service.ts:63-92,290-315` tracks local workspace generations but RPC responses lack the requested scope. A later global response can win and display “Default (recommended)” while main-agent setting remains `gpt-6-sol`. T1's `gpt-6.1-sol` is consistent with that mismatch, though trace alone does not isolate every model-choice step. The same generic handler/store pair serves Claude: the race is shared. The Codex base picker comes from legacy SDK/Anthropic catalog through `routing-agent-adapter.ts:78-85` and config handler `:473-479`; direct Codex adapter `getSupportedModels()` is unsupported at `codex-chat-adapter.ts:174-181`. `config-saved-model-option.ts:21-58` plus handler `:572-573` append a saved model, so missing `gpt-6-sol` in base SDK values does not mean the saved setting vanished.

**Claude path.** Claude uses this same `config:models-list` and `ModelStateService` pairing, and routed model lookup delegates to the legacy catalog (`routing-agent-adapter.ts:78-85`). Thus the scope race needs a generic fix. Codex catalog completeness is a separate backend matter.

**Fix.** Carry the workspace scope in generic models-list request/response; capture provider, saved model and catalog for that one scope in `config-rpc.handlers.ts`, and discard response for a stale scope/generation in `ModelStateService`. This is the sole proposed frontend change and also fixes Claude. For Codex, preserve the existing saved-model option and merge a native catalog only if the existing runtime exposes one; no second proxy or fabricated SDK model. **Specs.** Reverse-resolution concurrent workspace/global requests; saved main-agent model selected; saved Codex model absent from base list still offered; Claude same scope semantics. **Verify projects.** `@ptah-extension/rpc-handlers`, `@ptah-extension/core`, `ptah-extension-webview`, `ptah-electron`; typecheck `ptah-extension-vscode`, `ptah-cli`, `ptah-tui` if shared RPC type changes. **Size:** M. **Frontend touched?** yes, generic model-state only, because Claude has the same defect.

## G9

**Cause — provisional.** The live note reports stale “needs you” attention after a Codex approval. Approval presentation and attention resolution are separate; the Codex callback resolves host attention for its unroutable prompt path, leaving a routed prompt cue dependent on generic permission-card cleanup. The exact route needs a focused trace through `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-event-callbacks.ts` and the shared permission store before implementation.

**Claude path.** Claude permission prompts use the same native card/attention contract; compare generic permission resolution before a UI edit. **Fix.** Add a backend resolution event for routed Codex approval only if the existing contract supports it; otherwise defer a generic cleanup until Claude parity is shown. **Specs.** Resolved, rejected and expired prompt each clear cue exactly once. **Verify projects.** `@ptah-extension/agent-sdk`, `@ptah-extension/rpc-handlers`, `ptah-electron` if pursued. **Size:** S–M. **Frontend touched?** no proposed edit.

## G10

**Cause — likely.** `codex-chat-approval-sink.ts:318-320` maps denied command approval to App Server `decline`; `codex-chat-events.ts:284-310` classifies the resulting interrupted terminal as cancellation. Broadcaster user-abort heuristic at `chat-stream-broadcaster.service.ts:323-327` may then label denial as user Stop and lose useful reason.

**Claude path.** Claude distinguishes permission denial and explicit Stop in failure/turn-state handling (`helpers/stop-failure-hook-handler.ts:78-100`, `helpers/session-turn-state.registry.ts:344-390`). **Fix.** Carry local decline reason in Codex projection and map its terminal to existing permission-denied/failed contract; reserve user-abort for actual Stop. **Specs.** Deny vs Stop reason and one settled turn each. **Verify projects.** `@ptah-extension/agent-sdk`, `@ptah-extension/rpc-handlers`, `ptah-electron` if pursued. **Size:** S–M. **Frontend touched?** no.

## Proposed batches

File ownership below is disjoint. In **each** batch: no `any`, `as unknown as`, `@ts-ignore`, or `eslint-disable`; put `import 'reflect-metadata';` first in specs loading tsyringe; use `Object.defineProperty` for readonly mocks; leave no pending real timers; avoid excess properties in typed object literals; resolve test promises with `new Promise<void>((resolve) => ...)`. Use only scoped Nx test/typecheck/lint targets, one heavy check at a time. Include `ptah-electron` and dependent host typechecks when shared code changes. No build, serve, e2e, or MCP changes.

1. **Codex executor — G2/G3/G6 core, then G10.** Own agent-sdk Codex adapter, turn stream/events/callbacks, rpc-handlers broadcaster and native-session-controls, and their specs. Establish identity and failed terminal delivery before dead-context save fallback. One lane owns these overlapping terminal paths. Apply all implementer rules above.
2. **Grok executor — G4.** Own Codex approval sink, any local-environment provenance adapter, and sink specs. Start after local provenance is established; fail closed meantime. Apply all implementer rules above.
3. **Codex executor — G7.** Own rpc-handlers chat-session refusal mapping and specs. File-disjoint from batch 1. Apply all implementer rules above.
4. **Grok executor — G1.** Own generic config models-list contract/handler, generic frontend model-state scope, and specs. The frontend exception is justified because Claude shares the race. File-disjoint from other batches. Apply all implementer rules above.
5. **Codex executor — G5.** Own codex-runtime context/profile resume specs; production edit only if saved-level assertion fails. File-disjoint from other batches. Apply all implementer rules above.

G9 is a small follow-up after tracing approval attention end to end; do not add a Codex-only frontend path.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Retain D14 mapping | Change mapping / retain | Ask and Auto-edit both map to untrusted plus workspace-write at `codex-execution-profile.ts:142-188` | Yes |
| Restore G2 identity in backend | Frontend special case / adapter echo and consumed ID | Claude emits these fields; generic renderer already consumes them | Yes |
| Fail G4 closed without locality proof | Accept all non-null IDs / accept attested local only | Protocol describes execution environment, not a local flag | Yes |
| Show D14a text through safe generic error | New frontend code / omit runtime code for fixed message | Generic sender displays uncoded error and masks `CODEX_RUNTIME_FAILED` | Yes |
| Repair G1 scope generically | Codex-only picker / scoped generic RPC | Claude shares config/model-state race | Yes |

## Clarifications Needed

- **G4 blocker:** identify a trustworthy source and lifetime for the *local* App Server `environmentId`. The protocol's non-null ID and `thread/environment/connected` alone do not establish locality. Until known, keep non-null IDs on manual approval and retain read-only grammar.
