> **SUPERSEDED, 2026-09-19.** The central premise of this plan is false.
> `experiment-slash-over-streaminput.md` in this folder ran the real SDK and
> proved that a slash command DOES execute when delivered as an `SDKUserMessage`
> through an open iterable or through `streamInput()`, and that the session
> accepts a second turn afterwards. Read that experiment first.
>
> What survives from this document: the confirmed mechanism below, the blast
> radius, and the warning that `streamInput()` resolving is not proof of
> liveness. What does not survive: the conclusion that no safe fix exists, and
> every rejected alternative that rests on the raw-string premise.

## Confirmed mechanism

- `SessionQueryExecutor` classifies an initial prompt as a slash command only when `SlashCommandInterceptor.isSlashCommand(initialContent)` matches and there are no attachments (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:128-133`). The classifier is the anchored `^/[a-zA-Z]` expression (`libs/backend/agent-sdk/src/lib/helpers/slash-command-interceptor.ts:30-41`).
- A slash command is deliberately passed to the SDK as the finite raw `initialContent` string (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:304-320`). A resumed non-slash query instead uses `SessionStreamPump.createIdlePromptStream`, which waits without yielding until abort (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:137-171`), and then connects the registry-backed user-message iterable through `sdkQuery.streamInput(...)` (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:339-348`).
- The raw-string distinction is required by the repository's SDK boundary: slash commands are parsed from raw strings passed to `query()`, not from serialized `SDKUserMessage` objects delivered by `streamInput()` (`libs/backend/agent-sdk/src/lib/helpers/slash-command-interceptor.ts:4-11`; `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:522-525`).
- The installed `@anthropic-ai/claude-agent-sdk` implements that distinction directly. Its `query({ prompt, options })` constructs the query with `typeof prompt === "string"` as the single-turn flag, and `fz(...)` writes a string as the initial raw user record but routes an iterable through `Query.streamInput` (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs:60`, functions `tj$` and `fz`). On the first `result`, `Query.readMessages` calls `transport.endInput()` whenever `isSingleUserTurn` is true (same file and line, class `RU`). `Query.streamInput` serializes every iterable item and itself calls `transport.endInput()` only after that iterable completes (same file and line, method `streamInput`).
- Slash follow-ups are routed through `ChatSlashCommandRouterService` to `IAgentAdapter.executeSlashCommand` (`libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:63-135`), which starts a resumed raw-string query through `SessionLifecycleManager.executeSlashCommandQuery` (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:527-553`). Initial chat starts also pass the prompt to the adapter (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:555-574`), so an initial slash command reaches the same executor classification.
- Turn settlement remains ordered independently of process input closure: `StreamTransformer` invokes `onTurnEnd` for every SDK `result` before stats and transformation (`libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:435-445`); the adapter callback calls `SessionLifecycleManager.markTurnEnded` (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1271-1279`), and `SessionRegistry.markTurnEnded` clears `turnInFlight`, wakes a parked pump, and conditionally restores the idle hold (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:356-386`).
- The watchdog contract is also confirmed. A slash-command string bypasses the pump, takes no idle hold, and therefore arms when stream consumption starts (`libs/backend/agent-sdk/CLAUDE.md:91`; `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:220-235`). Existing coverage pins that behavior (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts:347-398`).
- I could not confirm a supported SDK option that keeps a raw string query multi-turn. The public `Query` contract has no such setter; the runtime's `setIsSingleUserTurn` method is internal and absent from `sdk.d.ts`. The public `WarmQuery.query` still accepts the same `string | AsyncIterable<SDKUserMessage>` split (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:5811-5827`) and the installed runtime marks a warm string query single-turn as well (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs:60`).

## The fix

The proposed Ptah-only persistent-stream change is unsafe and no production change is applied.

Replacing the slash-command string with `createIdlePromptStream(...)` would make the SDK query non-single-turn, but it would never deliver the command. Sending the command through `streamInput(...)` would deliver a serialized `SDKUserMessage`, which the repository's established SDK contract says is not parsed as a slash command. The change would therefore prevent `/compact`, `/orchestrate`, `/review`, plugin commands, and every other SDK-handled slash command from executing.

The smallest safe implementation needs a supported SDK capability that separates two concerns currently coupled by `typeof prompt === "string"`:

1. deliver the first prompt as a raw string so Claude Code parses the slash command;
2. keep the query input open after the first `result` and attach Ptah's existing `userMessageStream` for later turns/background-agent tool traffic.

Once the SDK exposes that capability, `SessionQueryExecutor` should use it only for slash commands, connect `sdkQuery.streamInput(userMessageStream)` for those queries as it already does for resumed non-slash queries, and add a mechanism-level spec that asserts: the initial command remains a raw string, the query is not configured as single-turn, and the persistent stream remains attached after the result. Until that supported contract exists, the alternative is an upstream SDK fix/API addition (or adopting a released SDK version that supplies it), not a private-runtime call or a Ptah transport reimplementation.

The no-activity accounting does not move in the current tree because no prompt shape changed. For the future supported implementation, routing follow-ups through the pump would require explicit slash-query turn ownership: the initial raw-string turn must still arm the watchdog; the `result` path must settle the turn; background-subagent holds must continue protecting silent agents; and the session must take an idle hold after the last active turn so an intentionally persistent slash query is not aborted after 180 seconds of healthy idle time.

## Blast radius

- Initial `chat:start` prompts: non-native slash commands pass through to `startChatSession`, then to the executor's slash classification (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:464-488`, `:555-574`).
- Follow-up `chat:continue` prompts: slash commands deliberately skip ordinary auto-resume and are routed to a new resumed raw-string query (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:654-713`).
- SDK-handled commands: `/context`, `/cost`, `/compact`, `/review`, plugin commands, and other non-native slash commands are classified as `new-query` (`libs/backend/agent-sdk/src/lib/helpers/slash-command-interceptor.ts:4-11`, `:44-81`).
- Native `/clear` does not reach this SDK path; it is handled locally by the chat service/router.
- Prompts with attachments are deliberately excluded from slash classification and continue through the normal iterable prompt path (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:128-145`).
- All three product hosts consume `agent-sdk`; a change here would affect VS Code, Electron, and CLI-backed interactive sessions without a platform-specific escape hatch.

## Rejected alternatives

- Replace the raw string with the idle prompt iterable and send the slash command through `streamInput`: rejected because it changes the command from the raw-string parsing path to serialized `SDKUserMessage` input.
- Attach `streamInput` while retaining a raw string: rejected because the installed SDK has already set `isSingleUserTurn` from the raw prompt and unconditionally closes input on the first result; attaching another iterable does not reset that flag.
- Call the runtime-only `setIsSingleUserTurn(false)`: rejected because it is not part of the exported `Query` type or supported SDK contract. It would require an untyped/private escape hatch against minified internals.
- Patch `node_modules`: rejected by task constraint and because the change would disappear on install/update.
- Change Ptah permission handling or use `bypassPermissions`: rejected because the diagnosed cancellation occurs before `canUseTool`; it would mask neither the input closure nor the background checkpoint.
- Reimplement the SDK subprocess transport in Ptah: rejected as far larger than the smallest lifecycle fix and as a new abstraction not selected by this task.

## Residual risk

The defect remains for SDK slash-command turns that finish their parent result while background agents still need tools. The safe operational workaround remains to keep the parent turn active until those agents finish. A future SDK upgrade must be re-audited at the raw-prompt/single-turn boundary and must have a regression test against the supported API rather than the current minified implementation. The exact live Claude Code checkpoint event was not reproduced in this implementation pass; the completed diagnosis remains the evidence for that half of the lifecycle.
