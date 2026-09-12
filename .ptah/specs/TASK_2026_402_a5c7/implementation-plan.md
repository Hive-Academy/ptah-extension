# Implementation Plan - TASK_2026_402_a5c7

## Inputs and constraints

- Requirements used:
  - `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\.ptah\specs\TASK_2026_402_a5c7\task.md`
  - `...\context.md`
  - `...\task-description.md` (Requirements 1-8, NFRs, Risks, Open questions)
  - `...\research-report.md` §3, §6, §7, Appendix A
  - `...\steering-research.md` Q1, Q2, Q3 (capability matrix — treated as ground truth, not re-derived)
- Corrections applied: none.
- Design handoff used: none (no `visual-design-specification.md` / `design-handoff.md` in the
  folder; the one UI surface is a variant of an existing bubble, specified against the
  existing component in C9).
- Missing decision-critical input: none. Both open questions in `task-description.md` are
  answered here from source rather than deferred — `ptah_agent_steer` is **retired**, see
  Decision D6; the sender-side hold/refuse notice question does not block any track and is
  left as Assumption A4.

---

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `Options.settings?: string \| Settings` | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1726` | A **string** is type-legal. The untyped `crossSessionInbound` key needs no cast and no `@ts-ignore` (Req 1.5). |
| SDK serialises settings itself: `settings: typeof W === "object" ? B$(W) : W` where `B$ = JSON.stringify` | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` (minified; search the literal `settings:typeof W==="object"?B$(W):W`) | Today's object form is ALREADY sent as a JSON string. Switching to a pre-stringified string changes the wire form by **zero bytes**. |
| `function Fx($){let Q=$.trim();return Q.startsWith("{")&&Q.endsWith("}")}` — the SDK's own "is this inline JSON rather than a file path" test on `settings` | same bundle, immediately before `function U2($,Q)` | The SDK explicitly models a `{...}` string as inline settings JSON. The string form is a supported shape, not a trick. |
| `extraArgs` entries are emitted verbatim as `--key value` with **no allow-list filter** (`U2` only merges sandbox; the loop is `for(let[m$,s$]of Object.entries(UX))if(s$===null)i.push(\`--${m$}\`);else i.push(\`--${m$}\`,s$)`) | same bundle | `extraArgs: { name }` reaches the CLI as `--name <value>`. Confirms research §3.4 / Appendix A7 resolution. |
| `SDKMessageOrigin` peer arm is `{ kind:'peer'; from: string; name?: string }` — no `fromMode`, no `verifiedPeerPid` | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:3244-3258` (quoted in research §3.1) | Only `origin.name` is renderable. No verified identity exists on Windows (Req 3.2). |
| `buildFlagSettings(sessionConfig?): Settings` — returns the FROZEN shared constant when no style is active | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:358-366` | The one flag-tier object builder. Must keep its identity-return contract: `sdk-query-options-builder.output-style.spec.ts:106-108` asserts `buildFlagSettings(undefined) === PTAH_DISABLE_SDK_AUTO_MEMORY`. |
| Chat consumes it at `settings: buildFlagSettings(sessionConfig)` | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:795` | One of two consumption sites. |
| Ptah CLI spawn consumes it at `settings: buildFlagSettings({ outputStyleName: assembly.outputStyleName })` | `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:730-732` | The second. Both must gain the key or Req 1.1/1.2 covers only half the fleet. |
| Wiring guard asserts the literal source text `settings: buildFlagSettings(sessionConfig)` and `not.toContain('settings: PTAH_DISABLE_SDK_AUTO_MEMORY')` | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.output-style.spec.ts:156-163` | Changing the call shape breaks a passing spec by design. It is updated, not deleted (Risk row 2 in `task-description.md`). |
| `extraArgs` is emitted ONLY inside the checkpointing spread: `...((enableFileCheckpointing ?? true) ? { extraArgs: { 'replay-user-messages': null } } : {})` | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:890-892` | `--name` cannot be bolted on beside it; the two must merge into ONE `extraArgs` object or a user who disables checkpointing loses their session name. |
| `PTAH_DISABLE_SDK_AUTO_MEMORY` is `Object.freeze`d | `libs/backend/agent-sdk/src/lib/constants.ts:29-32` | Any added key must go through a fresh spread. |
| `sdk-message-transformer.ts:206` — `if (isReplayMessage(sdkMessage))` logs and returns `[]` | `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts:206` | **This line is the Req 3.1 defect.** A peer-injected turn reaches the stream as a replay (research §3.1, quoting the SDK docs), and Ptah drops every replay unconditionally. |
| The drop exists because Ptah sets `--replay-user-messages` AND the frontend adds the user bubble optimistically | `sdk-query-options-builder.ts:891`; `libs/frontend/chat/src/lib/services/message-sender.service.ts:386-397` and `:622-634` | The replay drop must stay for `origin.kind !== 'peer'`. Removing it wholesale double-renders every typed prompt. |
| `isUserMessage` = `msg.type === 'user' && !isReplay`; `isReplayMessage` is its complement | `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts:376,380` | A peer turn can surface on either arm, so the origin check must sit ahead of BOTH (`sdk-message-transformer.ts:159` and `:206`). |
| `SdkMessageFactory.createUserMessage` already accepts `origin?: SDKMessageOrigin` and defaults `{ kind: 'human' }` | `libs/backend/agent-sdk/src/lib/helpers/sdk-message-factory.ts:49,92,148` | The producer half of the peer path already exists and is unused by the chat pump. |
| `SessionStreamPump.sendMessage(sessionId, content, files?, images?)` pushes onto `session.messageQueue` and wakes `resolveNext` — **no `origin` passthrough** | `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:180-215` | The one place a backend caller injects a turn into a live chat session. One optional parameter turns it into the report ingress. |
| `IAIProvider.sendMessageToSession(sessionId, content, options?)` and `IAgentAdapter.isSessionActive(sessionId)` | `libs/shared/src/lib/types/ai-provider.types.ts:281-285`; `libs/shared/src/lib/types/agent-adapter.types.ts:221` | The shared port already carries both operations `ptah_agent_report` needs. **No new port.** `gateway-chat-bridge.ts:200` is the precedent for a backend lib driving a chat session through this port. |
| `AgentProcessManager.steer()` throws for every adapter whose `supportsSteer()` is false | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:983-1031` (checks at `:985`, `:989`, `:998`, `:1005`) | Five of six vendors are refused. The three distinct error states at `:985/:989/:998` are the ones Req 4.6 requires be preserved. |
| `continueConversation()` throws `AgentContinueError('busy')` when `tracked.info.status === 'running'` | `agent-process-manager.service.ts:1076-1081` | **`queue-next-turn` cannot be `continueConversation` alone.** A message sent to a mid-turn agent is exactly the case the tool exists for, and the existing primitive rejects it. A pending-message queue is required (Component 5). |
| Both the first turn and every continued turn settle through one `handleExit` call | `agent-process-manager.service.ts:644-647` and `:1120-1133` | One flush seam for the pending queue. |
| `doSpawnSdk` mints `const agentId = AgentId.create()` at `:435`, **before** `runSdk(...)` at `:468` | `agent-process-manager.service.ts:435,468` | A rival-CLI child's own agent id is available in time to be encoded in its MCP URL. |
| `spawnFromSdkHandle` mints the id at `:524`, AFTER `PtahCliRegistry` built the handle and its MCP URL | `agent-process-manager.service.ts:524`; `ptah-cli-registry.ts:643,700` | For the Ptah CLI path the id must be **reserved by the caller** and passed in, or `ptah_agent_report` has no identity for that vendor. |
| `ptahMcpServerUrl(port, workingDirectory)` is the SINGLE builder of the spawn-side MCP URL, used by all six spawn paths | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/ptah-mcp-url.ts:28-35`; callers at `codex-cli.adapter.ts:597`, `copilot-sdk.adapter.ts:329`, `cursor-cli.adapter.ts:323`, `opencode-cli.adapter.ts:378`, `antigravity-cli.adapter.ts:367`, `ptah-cli-spawn-options.service.ts:177` | One function to change to carry an agent identity into every child. |
| URL grammar is CLOSED and the workspace segment must be TERMINAL: `^(?:\/session\/[^/?]+)?\/workspace\/([^/?]+)\/?(?:\?.*)?$` | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.ts:267-275`, caller-session extractor at `:245-249`, assignment at `:337-344` | A spawned CLI connects on `/workspace/{root}` and therefore carries **no** `_callerSessionId` — confirming Req 6.2. The extension point is a new leading `/agent/{id}` alternative, keeping `/workspace` terminal. |
| `PtahAPI.agent.list()` synthesises `supportsSteer: false` for every Ptah CLI row | `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts:264` | The list capability is produced here, not read from an adapter — it must move onto the same declaration the router reads (Req 5.2). |
| `formatAgentList` renders `Capabilities: agent.supportsSteer ? 'steer: yes' : 'steer: no'` | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:499` | The exact cell Req 5.1 replaces. |
| `CliDetectionResult.supportsSteer: boolean` | `libs/shared/src/lib/types/agent-process.types.ts:179` | The shared field the four-value mode replaces. Consumers are contained: 6 adapters, `cli-adapter.interface.ts:105`, `agent-process-manager.service.ts:1005`, `agent-namespace.builder.ts:264`, `agent-rpc.handlers.ts:840`. No frontend consumer. |
| Pi is the only shipped mid-turn steer: `writeRequest(activeChild, { type: 'steer', message })` | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts:498-503`, `supportsSteer(): true` at `:191`, `supportsMcp = false` at `:150` | Reference `steer` implementation; also the vendor excluded from `ptah_agent_report` (Req 6.6). |
| Cursor keeps `agent` and `activeRun` as closure locals and already calls `run.cancel()` on the whole-agent abort path; `continue()` re-enters `runTurn` on the same `agent` | `cursor-cli.adapter.ts:283-296`, `:341-342`, `:386-388` | `interrupt` is additive wiring on an existing closure, exactly as steering-research Q2 predicted. No new dependency. |
| Codex `supportsContinuation: () => true`; Copilot `() => capturedSessionId != null`; Cursor `() => true`; Pi `() => capturedSessionId != null` | `codex-cli.adapter.ts:737`, `copilot-sdk.adapter.ts:453`, `cursor-cli.adapter.ts:386`, `pi-cli.adapter.ts:505` | `queue-next-turn` is already reachable for four vendors — it only lacked a caller. |
| Antigravity and opencode handles carry **no** `continue` / `supportsContinuation` | `antigravity-cli.adapter.ts:593-601`; `opencode-cli.adapter.ts:547-554` | Confirms the steering-research Q4 item: both are genuinely `unsupported` (Req 4.5). Verified at implementation time, not assumed. |
| Ptah CLI handle: `supportsContinuation: () => true`, `continue` pushes onto the prompt mailbox | `ptah-cli-registry.ts:817-826`; mailbox at `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-prompt-mailbox.ts` | Ptah CLI agents reach `queue-next-turn` through the same path. |
| `WebSearchArgsSchema` is `.strict()` and an invalid value is an MCP tool ERROR, never a fallback | `mcp-core/protocol-dispatcher.ts:849-866` | The precedent the two new tools' Zod schemas follow (Req 7.3, NFR). |
| The stdio surface renames the same canonical builders (`rename(buildAgentSteerTool(), 'agent_steer')`) and advertises a fixed `MCP_MVP_TOOL_NAMES` tuple | `mcp-stdio/tool-builders.ts:32-40,63-65,137-147`; dispatcher switch at `mcp-stdio/agent-tool.dispatcher.ts:188-204`, `TOOL_NAMES` at `:170-177` | Both surfaces are fed by one description builder, so Req 7.1/7.2 is a matter of adding to three lists, not writing two schemas. |
| `AgentOutputDelta` already carries `segments?: readonly CliOutputSegment[]`, and `CliOutputSegmentType` includes `'info'` | `libs/shared/src/lib/types/agent-process.types.ts:207-216,239-248`; emitted at `agent-process-manager.service.ts:1544`, broadcast at `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:184-186` | Req 6.4 (report visible on the tile) needs **no new frontend plumbing** — one synthetic segment on the existing delta. |
| Frontend stream write path is one switch: `switch (event.eventType)` | `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:244` | Single extension point for the inbound-peer render. |
| `MessageStartEvent.role: 'user' \| 'assistant'`; `MessageRole = 'user' \| 'assistant' \| 'system'` with a Zod mirror | `libs/shared/src/lib/types/execution/stream.ts:96-102`; `.../execution/node.ts` + `.../execution/schemas.ts:27` | The role union and its Zod mirror must move together. |
| User bubble is selected by `@if (message().role === 'assistant') { … } @else { … }`, header literal `You` at `:199`, body through `<markdown>` at `:230`/`:236` | `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html:1,199,205,230,236` | One template, one markdown chokepoint (NFR: no second sanitizer). |
| `ptah_agent_steer` is named in a shipped preset allow-list, four skill/reference files and three docs pages | `libs/backend/rpc-handlers/src/lib/harness/config/builtin-presets.ts:41`; `.claude/skills/ptah-cli-usage/references/{agent-cli.md:67,internal-mcp.md:88,mcp-serve.md:71}`; `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-cli-usage/references/*` (same three); `apps/ptah-docs/src/content/docs/{agents/cli-agents.md:57,mcp-and-skills/ptah-tools.md:60,mcp-and-skills/driving-ptah-via-mcp.md:70}` | **Decides the open question.** The preset allow-list must be edited to admit `ptah_agent_message` whether or not the old name survives, so keeping an alias buys nothing and costs a second implementation. Retire it. |
| `ALLOWED_METHOD_PREFIXES` | `libs/backend/vscode-core/src/messaging/rpc-handler.ts:44-70` | Checked: **no new RPC namespace is introduced by this plan** (see Decision D5), so this file is untouched. Stated explicitly because the NFR demands the dual registration when one IS added. |
| `vendor-roster-drift.spec.ts` asserts no Ptah-CLI provider brand appears in agent-facing strings, and that SYSTEM CLI enumerations are interpolated from `SYSTEM_CLI_TYPES` | `libs/backend/vscode-lm-tools/src/lib/code-execution/vendor-roster-drift.spec.ts:1-40` | New tool descriptions must name **no vendor**. Mode names are vendor-free by construction. |

---

## Architecture decision

### Chosen approach

Five independent seams, one per track, each landing on machinery that already exists:

1. **Track A — settings and name.** One new serializer, `buildFlagSettingsArg`, that
   **delegates to** `buildFlagSettings` and returns the JSON **string** form of
   `Options.settings`. `buildFlagSettings` is untouched and remains the one object builder.
   Both consumption sites (`sdk-query-options-builder.ts:795`,
   `ptah-cli-registry.ts:730`) switch to it. `--name` rides the same `extraArgs` mechanism
   already in use, after the conditional spread at `:890-892` is refactored into one merged
   object.
2. **Track B — capability contract.** `CliAdapter.capabilities(): AgentMessagingCapabilities`
   replaces `supportsSteer()`; `SdkHandle` gains run-scoped `interrupt?` /
   `supportsInterrupt?`. One router, `AgentProcessManager.sendToAgent()`, replaces
   `steer()` and picks a mode from flags only. `continueConversation()` stays exactly as it
   is and gains a bounded pending queue in front of it so a mid-turn `queue-next-turn` is a
   real queue rather than a `busy` refusal.
3. **Track C — child→parent identity.** The child is identified by the **URL it connects
   on**, not by an argument it supplies: `ptahMcpServerUrl` grows an optional agent id and
   the HTTP handler parses `/agent/{id}` beside `/session/{id}`. Attribution then reads
   `tracked.info.parentSessionId` — the value `resolveParentSessionId` already set at spawn.
4. **Track D — one inbound render path for two producers.** A peer turn and an agent report
   become the **same thing on the wire**: an `SDKUserMessage` whose `origin.kind === 'peer'`.
   The transformer's replay branch (`sdk-message-transformer.ts:206`) stops dropping those
   and emits a `message_start` carrying an `inboundPeer` label; the frontend renders a third
   bubble variant. The report path reaches that shape by passing `origin` through
   `sendMessageToSession` → `SessionStreamPump.sendMessage` → `SdkMessageFactory`, which
   **already accepts it** (`sdk-message-factory.ts:49`).
5. **Track E — text.** `ptah_agent_steer` is deleted, every reference is rewritten, and the
   harness guidance gains the discovery rules and version floors.

### Rationale

- **The string form of `Options.settings` is the only escape route that is both type-legal
  and byte-identical to today's wire form.** `sdk.d.ts:1726` types it; the SDK's own
  `JSON.stringify` of an object settings means the CLI already receives a string; `Fx`
  proves the CLI-side contract accepts inline JSON; Appendix A8 measured it end to end. No
  cast, no `@ts-ignore`, no temp file (Req 1.5, NFR).
- **Delegation preserves the single-builder rule.** `output-styles/CLAUDE.md` and
  `cli-agent-runtime/CLAUDE.md` both state `buildFlagSettings` is the ONE builder of the
  flag-tier object. `buildFlagSettingsArg` builds no object — it serialises the one the
  builder returned. The G4b key-absent rule survives untouched because `JSON.stringify` of
  an object without `outputStyle` emits no `outputStyle` (Req 1.4).
- **Capability flags on the adapter, run-scoped predicates on the handle.** `supportsSteer()`
  at `cli-adapter.interface.ts:105` is already exactly this pattern for one capability
  (steering-research Q3); widening it to three is additive. The split matters: `ptah_agent_list`
  needs a **static per-vendor** answer before anything is spawned (Req 5), while the router
  needs the **per-run** answer (a Copilot handle reports `supportsContinuation()` false until
  a session id is captured, `copilot-sdk.adapter.ts:255` vs `:453`). One declaration
  (`capabilities()`) feeds the list and is the router's fallback; the handle wins when
  present. Req 5.2 holds because both read the same declaration.
- **URL-borne child identity rather than an argument.** `_callerSessionId` is already derived
  from the URL and never from the payload (`http-server.handler.ts:245-249,337-340`), and
  `agent-sdk/CLAUDE.md` records what happened the last time attribution fell back to
  "whichever session resolved first" (TASK_2026_295). An `agentId` argument would be
  sender-authored — the same class of value the research tells us not to trust
  (`origin.from`, research §3.1). The URL segment is written by Ptah and cannot be chosen by
  the child.
- **One inbound shape for both producers.** The alternative — a bespoke delivery for reports
  — is precisely what steering-research Q3 warns against ("rather than inventing a second
  delivery mechanism"). Reusing `origin.kind === 'peer'` means one transformer branch, one
  frontend variant, one bubble, one markdown chokepoint, and the report is a real user turn
  the model actually reads rather than a UI-only notice.

### Rejected alternatives

| Alternative | Why it loses here |
| --- | --- |
| Write a per-child `settings.json` file and pass its path (research §7.2's first choice) | Adds a temp-file lifecycle, a cleanup owner and one disk write per session, for a single key. The string form was measured accepted (Appendix A8) and needs none of it. Keep it in reserve only if Assumption A0 fails. |
| `settings: { ...flags, crossSessionInbound } as unknown as Settings` | A cast asserting something false about the installed typings when a legal alternative exists one line away. `task-description.md` Req 1.5 and the repo's no-`@ts-ignore` rule both point away from it. |
| Change `buildFlagSettings`'s return type to `string` | Breaks eleven assertions in `sdk-query-options-builder.output-style.spec.ts` that check object shape and the frozen-constant identity — including the G4/G4b rules the spec exists to protect. Delegation keeps every one of them green. |
| Keep `ptah_agent_steer` as a thin alias of `ptah_agent_message` | Two tools that both claim to instruct an agent (forbidden by Req 4.8), and it saves no work: `builtin-presets.ts:41` has to be edited regardless to admit the new name, and the same nine text files list the old one. |
| Make `queue-next-turn` a direct `continueConversation()` call | It throws `busy` for a running agent (`:1076-1081`), which is the main case the tool serves. The tool would report `queue-next-turn` for exactly the agents it cannot queue for. |
| `interrupt-resume` implemented as `abort` + respawn | `SdkHandle.abort` ends the whole handle/process (`cli-adapter.interface.ts:50-51`); a respawn is a new agent id and a new session, breaking Req 4.3's "same agent id and session". Cursor's `run.cancel()` leaves the `agent` alive, which is why it is the mechanism. |
| Emit the agent report as a webview-only notice (no model turn) | The parent would see it and the model would not, so "redirect a child that is going the wrong way" cannot close its loop. It also needs a second delivery mechanism. |
| A new `agentMessage:` RPC namespace | Nothing here is webview-initiated. Both new capabilities are MCP tools, and the two UI surfaces reuse existing channels (`AGENT_MONITOR_OUTPUT`, the chunk stream). Adding a namespace would mean a dual registration for no consumer. |

### Assumptions

| # | Assumption | Check that resolves it |
| --- | --- | --- |
| A0 | The SDK forwards a **string** `Options.settings` to `--settings` unmodified, so the CLI receives the same JSON it receives today plus one key. | Verified against `sdk.mjs` (`settings: typeof W === "object" ? B$(W) : W` — the non-object arm is a passthrough) and against `Fx`. Confirm at runtime: start one session and grep the spawn log line `Spawning Claude Code:` for `--settings {"autoMemoryEnabled"...`. |
| A1 | The CLI preserves a **caller-supplied** `origin` on the user message it replays back on the stream, so an injected agent report renders through the same branch as a real peer message. | Inject one report into a live chat session and log `sdkMessage.origin` at `sdk-message-transformer.ts:206`. **If false**, the contingency is named in Component 8: the report publishes through a `SessionInboundCallbackRegistry` fan-out (shape copied verbatim from `SessionMcpStatusCallbackRegistry`, see `agent-sdk/CLAUDE.md`) and the transformer branch stays peer-only. The tool's contract and the UI do not change either way. |
| A2 | A peer turn injected by another Claude session reaches the stream as a replay **regardless of** the `--replay-user-messages` flag (research §3.1 describes it as unconditional). | Disable file checkpointing, send one `SendMessage` from a second session, and confirm the message still renders. If it does not, the flag becomes unconditional in `sdk-query-options-builder.ts:890-892` — a one-line change already in that batch's blast radius. |
| A3 | Antigravity's and opencode's handles still carry no `continue` (steering-research Q4's last bullet asks for this to be re-read at implementation time). | Read `antigravity-cli.adapter.ts:593-601` and `opencode-cli.adapter.ts:547-554` before writing their `capabilities()`. Verified as absent on 2026-09-09 during this design. |
| A4 | An SDK host does not observe hold/refuse/expiry notices for messages **it** sent (research §2.9, open question 6). | Out of scope; nothing in this plan depends on it. If it turns out notices ARE observable, the sender-side tile can show a failed delivery — a later enhancement, not a requirement. |

### Effect on existing code

**Replaced (the old thing does not survive beside the new):**

- `CliAdapter.supportsSteer()` → `CliAdapter.capabilities()`. Removed from the interface and
  from all six adapters.
- `CliDetectionResult.supportsSteer: boolean` → `messagingMode: AgentMessagingMode`. Removed
  from the shared type and from every construction site.
- `AgentProcessManager.steer()` → `AgentProcessManager.sendToAgent()`. The method is deleted,
  not deprecated. Its three distinct failure states are carried into the replacement.
- `PtahAPI.agent.steer()` → `PtahAPI.agent.message()`; `formatAgentSteer` →
  `formatAgentMessage`.
- MCP tool `ptah_agent_steer` / stdio `agent_steer` → `ptah_agent_message` / `agent_message`.
  `buildAgentSteerTool` is deleted.

**Left alone:**

- `buildFlagSettings` and every assertion in `sdk-query-options-builder.output-style.spec.ts`
  except the one wiring guard at `:159`.
- `SdkHandle.steer` and Pi's implementation — that is the mechanism, not the router.
- `continueConversation()` and its `AgentContinueError` codes. The queue sits in front of it.
- `PTAH_DISABLE_SDK_AUTO_MEMORY`, the G4/G4b rules, `settingSources`, `permissionMode`
  resolution (`resolvePermissionOptions`, `ptah-cli-registry.ts:1058`). No session's
  permission class changes — `accept` is the documented fix (Scope, `task-description.md`).
- `ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:44`). No new namespace.

---

## Component specifications

### 1. `buildFlagSettingsArg` — the one serializer of the flag tier

- **Purpose:** produce the `Options.settings` value for one session, carrying keys the
  installed `Settings` interface does not model, without a cast.
- **Responsibilities:** call `buildFlagSettings`; merge a validated `crossSessionInbound`;
  `JSON.stringify`. Nothing else. It builds no settings object of its own.
- **Verified contracts and entry points:**
  - `buildFlagSettings(sessionConfig?): Settings` — `sdk-query-options-builder.ts:358-366`.
  - `Options.settings?: string | Settings` — `sdk.d.ts:1726`.
  - The SDK's own passthrough of a string settings value and the `Fx` inline-JSON test —
    `sdk.mjs`, cited in the evidence table.
- **Shape:**
  - `export const CROSS_SESSION_INBOUND_VALUES = ['accept', 'hold', 'refuse'] as const;`
  - `export type CrossSessionInbound = (typeof CROSS_SESSION_INBOUND_VALUES)[number];`
  - `export function buildFlagSettingsArg(sessionConfig?: OutputStyleActivationFields, crossSessionInbound?: string): string`
  - The second argument is typed `string` deliberately: it is validated against
    `CROSS_SESSION_INBOUND_VALUES` and **omitted** if it does not match. Req 1.3 makes an
    unrecognised value worse than no value — the CLI holds every inbound message even when a
    higher-precedence source says `accept` (research §7.2). A closed TS union alone would not
    protect a value arriving from a settings file later.
  - The function carries a comment stating why the string form is used: the `Settings`
    interface (`sdk.d.ts:3967-5435`) has no `crossSessionInbound` key and no index signature
    (Req 1.5).
- **Dependencies:** `buildFlagSettings` (same file), `PTAH_DISABLE_SDK_AUTO_MEMORY`
  transitively. Direction unchanged.
- **Integration points:** `sdk-query-options-builder.ts:795` (chat),
  `ptah-cli-registry.ts:730` (Ptah CLI spawns). Both pass `'accept'`.
- **Failure behaviour:** total. An unrecognised inbound value is dropped with a `logger.warn`;
  the session still starts with today's exact settings string.
- **Quality requirements:** the emitted string for a session with no style and no inbound
  value must equal `JSON.stringify(PTAH_DISABLE_SDK_AUTO_MEMORY)` byte for byte — that is the
  no-regression contract for the flag tier.
- **Verification seam:** unit tests on the function (string parses back to the expected
  object; `outputStyle` absent when no style; unrecognised inbound omitted; `accept`
  present). Plus the updated wiring guard in
  `sdk-query-options-builder.output-style.spec.ts`.
- **Files:** MODIFY `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts`; MODIFY `...\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.output-style.spec.ts`; MODIFY `...\libs\backend\agent-sdk\src\index.ts` (export both new symbols — `cli-agent-runtime` consumes them through the public barrel only).

### 2. Deliberate session naming via `extraArgs`

- **Purpose:** give every Ptah SDK session a name that reads usefully in another agent's
  `ListAgents` output and cannot collide inside one workspace.
- **Responsibilities:** compose the name; sanitise it; merge `extraArgs` into ONE object.
- **Verified contracts and entry points:**
  - `extraArgs` reaches the CLI as `--key value` with no filtering — `sdk.mjs`, evidence table.
  - The existing conditional spread — `sdk-query-options-builder.ts:890-892`. This is the line
    that must be restructured; `--name` cannot be appended beside it.
  - `claude --name X -p` registers `nameSource: 'user'` — Appendix A7, measured.
- **Shape:** `buildSessionName(input: { role: string; taskId?: string; workspaceLabel?: string; uniqueSuffix: string }): string | undefined`, in a new file so both call sites share one
  definition. Composition: `ptah-<workspaceLabel>-<role>[-<taskId>]-<uniqueSuffix>`, lower-cased,
  non-`[a-z0-9-]` collapsed to `-`, length-capped. `uniqueSuffix` is the first 6 chars of the
  session's routing id / agent id — the value is already unique per session, so uniqueness is
  guaranteed rather than hoped for (Req 2.2; the CLI performs no duplicate check for a `-p`
  or SDK session, research §1.3). Roles: `chat` for the main session; the Ptah CLI agent's
  configured name for a spawn.
- **Dependencies:** none beyond the two builders.
- **Integration points:** the merged `extraArgs` object at `sdk-query-options-builder.ts:890`
  and a new `extraArgs` entry in the spawn options at `ptah-cli-registry.ts:700-753`.
- **Failure behaviour:** the builder returns `undefined` rather than throwing when the inputs
  sanitise to nothing; the caller omits the `name` key and logs at `warn`. A naming problem
  never costs a session (Req 2.3). `--name` reaching an older CLI that does not know the flag
  would be a spawn failure, which is why the version floor is documented in Component 11 and
  why the value is behind one function that can be made conditional in one place.
- **Quality requirements:** the name is agent-facing text — it must name no vendor
  (`vendor-roster-drift.spec.ts`). A Ptah CLI agent's user-chosen name is user data and is
  slugified, never enumerated in any description string.
- **Verification seam:** unit tests on `buildSessionName` (sanitisation, cap, uniqueness
  suffix, empty-input → `undefined`). Manual acceptance: read
  `~/.claude/sessions/<pid>.json` and assert `nameSource !== 'derived'` (Req 2.1).
- **Files:** CREATE `...\libs\backend\agent-sdk\src\lib\helpers\session-name.builder.ts` (+ `.spec.ts`); MODIFY `...\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts`; MODIFY `...\libs\backend\agent-sdk\src\index.ts`; MODIFY `...\libs\backend\cli-agent-runtime\src\lib\ptah-cli\ptah-cli-registry.ts`.

### 3. `AgentMessagingCapabilities` — the capability contract

- **Purpose:** let the router pick a delivery mode and let `ptah_agent_list` report one,
  from a single declaration, with no vendor name in either.
- **Responsibilities:** declare, per adapter, which of the three mechanisms that vendor
  supports; expose the run-scoped equivalents on the handle.
- **Verified contracts and entry points:**
  - `CliAdapter.supportsSteer(): boolean` — `cli-adapter.interface.ts:105` (the pattern being
    widened).
  - `SdkHandle` — `cli-adapter.interface.ts:49-84`; existing `steer?` at `:80`,
    `supportsContinuation?` at `:73`, `continue?` at `:74`.
  - `AgentProcessManager.steer()`'s adapter check — `agent-process-manager.service.ts:1005`.
- **Shape (shared, `libs/shared`):**
  - `export type AgentMessagingMode = 'steer' | 'interrupt-resume' | 'queue-next-turn' | 'unsupported';`
  - `export type AgentMessagingCapability = 'steer' | 'interrupt' | 'queue' | 'none';` — the
    four values Req 5.1 requires in the list cell.
  - `CliDetectionResult.messagingMode: AgentMessagingCapability` replaces `supportsSteer`.
- **Shape (`cli-adapter.interface.ts`):**
  - `CliAdapter.capabilities(): { readonly steer: boolean; readonly interrupt: boolean; readonly continuation: boolean }` — replaces `supportsSteer()`.
  - `SdkHandle.interrupt?: () => Promise<void>` — "abort the CURRENT run/turn without ending
    the session/agent, then resolve once torn down. Distinct from `abort`, which ends the
    whole handle."
  - `SdkHandle.supportsInterrupt?: () => boolean`.
- **Per-adapter values (from steering-research Q1/Q3, re-verified against the handles above):**

  | Adapter | `steer` | `interrupt` | `continuation` | Handle changes |
  | --- | --- | --- | --- | --- |
  | pi | true | false | true | none |
  | cursor | false | **true** | true | add `interrupt` (`activeRun?.cancel()`) + `supportsInterrupt` |
  | codex | false | false | true | none |
  | copilot | false | false | true | none |
  | ptah-cli | false | false | true | none |
  | antigravity | false | false | false | none |
  | opencode | false | false | false | none |

- **Dependencies:** adapters → `cli-adapter.interface.ts` → `libs/shared`. Direction unchanged.
- **Integration points:** the router (Component 5), `agent-namespace.builder.ts:264` (which
  must stop synthesising a capability and read the declaration for Ptah CLI too),
  `agent-rpc.handlers.ts:840`, `mcp-response-formatter.ts:499`.
- **Failure behaviour:** an adapter that does not implement `capabilities()` is a compile
  error — that is the point. A reviewer adding a seventh adapter is forced to answer the
  question and reaches every mode without touching the router (Req 4.7).
- **Quality requirements:** the declaration and the handle predicates must agree; the
  contract test in Component 5's seam asserts every registered adapter's `capabilities()`
  against the handle its `runSdk` returns for a stub run.
- **Verification seam:** one table-driven spec over `CliDetectionService`'s registered
  adapters asserting `capabilities()` matches the matrix, plus a drift test that fails when a
  new adapter is registered without a row.
- **Files:** MODIFY `...\libs\shared\src\lib\types\agent-process.types.ts`; MODIFY `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.interface.ts`; MODIFY all six of `...\cli-adapters\{pi,codex,copilot-sdk,cursor,antigravity,opencode}-cli.adapter.ts` (note: the Copilot file is `copilot-sdk.adapter.ts`).

### 4. Cursor `interrupt` — the one new mechanism

- **Purpose:** end the current Cursor run without ending the agent, so a follow-up `send()`
  lands on the same `agentId` and session (Req 4.3).
- **Responsibilities:** cancel `activeRun`; resolve once the stream consumer has unwound.
- **Verified contracts and entry points:** `activeRun = run` (`cursor-cli.adapter.ts:342`);
  the existing whole-agent abort that already calls `run.cancel()`
  (`cursor-cli.adapter.ts:283-296`); `continue: (message) => Promise.resolve({ done: runTurn(message) })` re-entering the same closure with `agent` non-null (`:386-388`);
  `@cursor/sdk` 1.0.13 `Run.cancel()` / `SDKAgent.send()` / `AgentBusyError`
  (`node_modules/@cursor/sdk/dist/esm/{run,agent,errors}.d.ts`, read in steering-research
  Q1.3).
- **Dependencies:** none new. `@cursor/sdk` is already a dependency and the handle already
  holds the run.
- **Integration points:** `SdkHandle.interrupt` consumed only by the router.
- **Failure behaviour:** no active run → resolve immediately (the router then falls through to
  `queue-next-turn`, which is the honest outcome). `cancel()` rejecting → the error is logged
  and surfaced in the tool's `detail`; the mode reported is `unsupported` with the reason,
  never a false `interrupt-resume`. **`interrupt-resume` discards the partial work of the
  aborted turn** — that cost is why the mode is always named back to the caller (Req 4.1, and
  the matching risk row in `task-description.md`).
- **Quality requirements:** must not race the whole-agent abort path — `interrupt` sets no
  abort signal and touches only `activeRun`.
- **Verification seam:** an adapter spec with a fake `Agent`/`Run` asserting that
  `interrupt()` cancels the active run, that the stream consumer unwinds, and that a
  subsequent `continue()` calls `agent.send` on the SAME agent object.
- **Files:** MODIFY `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cursor-cli.adapter.ts` (+ its spec).

### 5. `AgentProcessManager.sendToAgent` — the mode router and pending queue

- **Purpose:** deliver one message to any spawned agent by the best mechanism that agent
  supports, and report which one fired.
- **Responsibilities:** resolve the tracked record; reject the three unroutable states;
  select a mode from capability flags; execute it; return the outcome. Owns the per-agent
  pending-message queue.
- **Verified contracts and entry points:**
  - The three state checks to preserve: `!tracked` (`:985`), `tracked.restored` with the
    `restoredRecordMessage` recovery pointing at `resume_session_id` (`:989-996`), and the
    status check (`:998-1002`).
  - `continueConversation()` and its `AgentContinueError` codes `not_found` / `released` /
    `unsupported` / `busy` / `unknown` — `:1033-1134`.
  - The single settle point `handleExit` — reached from `:646` (first turn) and `:1122`
    (continued turn).
  - `TrackedAgent` fields already used for lifecycle: `restored`, `subprocessReleased`,
    `hasExited`, `info.status`.
- **Shape:**
  - `sendToAgent(agentId: string, message: string): Promise<AgentMessageOutcome>` where
    `AgentMessageOutcome = { mode: AgentMessagingMode; detail?: string }` (shared type).
  - Selection, in order, from `caps = handleCaps ?? adapterCaps`:
    1. turn in flight **and** `caps.steer` and `handle.steer` present → call it → `'steer'`.
    2. turn in flight **and** `caps.interrupt` and `handle.interrupt` present → `interrupt()`,
       await the current turn's settle, then `continueConversation` → `'interrupt-resume'`.
    3. `caps.continuation` → if a turn is in flight, park on the pending queue and return
       `'queue-next-turn'`; otherwise call `continueConversation` directly and return
       `'queue-next-turn'`.
    4. otherwise `'unsupported'`, with `detail` naming the CLI and the reason.
  - **Pending queue:** `TrackedAgent.pendingMessages: string[]`, capped at 8. `handleExit`
    shifts and dispatches one entry through `continueConversation` after the status settles.
    Over-cap is **refused at the caller** with `mode: 'unsupported'` and a reason — never
    silently dropped.
  - **Current-turn tracking:** `TrackedAgent.currentTurnDone: Promise<number>`, written in
    `trackSdkHandle` (from `sdkHandle.done`) and re-written in `continueConversation` (from
    `outcome.done`). `interrupt-resume` awaits it. Without it the router has no way to know
    when the aborted turn has torn down and would race `continueConversation`'s `busy` check.
- **Dependencies:** `CliDetectionService.getAdapter` (already injected), the tracked record.
  No new dependency. **No branch anywhere on a CLI name** (Req 4.7).
- **Integration points:** `PtahAPI.agent.message()`; the two MCP dispatchers.
- **Failure behaviour:**
  - unknown id → `AgentMessageError('not_found')`.
  - restored record → `AgentMessageError('restored')` carrying `restoredRecordMessage`.
  - terminal status with no live handle → `AgentMessageError('not_running')` naming the status.
  - a completed-but-alive continuation-capable agent is **not** an error — it queues, and the
    `detail` says the agent has finished its turn and the message starts a new one. This is
    the risk row about completed Ptah CLI agents staying listed: it is answered by saying so,
    not by hiding it.
  - Every branch returns or throws a named state. Nothing returns a success the caller would
    act on when nothing was delivered (Req 4.5).
- **Quality requirements:** `agent-process-manager.service.ts` is already large. If
  `sendToAgent` + the queue pushes it past the soft ceiling, apply the facade rule: extract
  `AgentMessageRouter` as an injected collaborator; `AgentProcessManager.sendToAgent` keeps
  its name and signature and delegates. Do **not** split the lifecycle methods out.
- **Verification seam:** unit tests per mode against fake handles — one per row of the
  Component 3 matrix, plus the three unroutable states, plus the queue (park while running,
  flush on exit, refuse over cap, refuse over size).
- **Files:** MODIFY `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts` (delete `steer()`; add `sendToAgent()`); possibly CREATE `...\cli-agents\agent-message-router.service.ts` under the facade rule; MODIFY `...\libs\shared\src\lib\types\agent-process.types.ts`.

### 6. Child identity on the MCP URL

- **Purpose:** let the MCP server know which spawned agent is calling, without the child
  naming itself.
- **Responsibilities:** encode the agent id at spawn; parse it on the server; expose it as
  `MCPRequest._callerAgentId`.
- **Verified contracts and entry points:**
  - `ptahMcpServerUrl(port, workingDirectory)` — `ptah-mcp-url.ts:28-35`, the single builder,
    with its own header comment naming the `/session/{id}` twin and the file-writer twin
    `ptahMcpUrl` in `ptah-mcp-slots.ts`. Both twins must keep producing the same grammar; the
    file-writer twin gains no agent segment (a persistent config entry belongs to no agent).
  - The closed URL grammar and its terminal-workspace rule —
    `http-server.handler.ts:267-275`, pinned by `http-server.handler.spec.ts`.
  - `extractCallerSessionId` / `_callerSessionId` assignment — `:245-249`, `:337-340`.
  - `AgentId.create()` before `runSdk` — `agent-process-manager.service.ts:435,468`.
  - `spawnFromSdkHandle` minting after the handle exists — `:524`; `setAgentId` backfill at
    `ptah-cli-registry.ts:840-842`.
- **Shape:**
  - `ptahMcpServerUrl(port, workingDirectory, agentId?)` →
    `http://localhost:PORT/agent/{encodeURIComponent(agentId)}/workspace/{encodeURIComponent(root)}`.
    Agent segment leads, workspace stays terminal — the same ordering rule
    `/session/{id}/workspace/{root}` already follows.
  - Grammar: `^(?:\/session\/[^/?]+|\/agent\/[^/?]+)?\/workspace\/([^/?]+)\/?(?:\?.*)?$` for
    the workspace extractor, plus `extractCallerAgentId(url)` matching `^\/agent\/([^/?]+)`.
  - `MCPRequest._callerAgentId?: string`.
  - `CliCommandOptions.agentId?: string` — passed by `doSpawnSdk` at the `runSdk` call
    (`:468-481`); each adapter forwards it to `ptahMcpServerUrl`.
  - `AgentProcessManager.reserveAgentId(): string` — a thin wrapper over `AgentId.create()`.
    `spawnFromSdkHandle`'s `meta` gains `agentId?: string` and uses `meta.agentId ?? AgentId.create()`.
    `buildAgentNamespace.spawn` reserves the id before `registry.spawnAgent(...)` and passes
    it to both, so the Ptah CLI path has ONE id, minted once, available to its MCP URL.
    `PtahCliSpawnOptions`/`assembleSpawnOptions` gains `agentId?` and threads it to
    `ptah-cli-spawn-options.service.ts:177`.
- **Dependencies:** direction unchanged; `vscode-lm-tools` already consumes
  `cli-agent-runtime`'s barrel.
- **Integration points:** all six spawn paths listed in the evidence table.
- **Failure behaviour:** an absent agent id yields today's exact URL. The server treats a
  missing `_callerAgentId` as "unattributed caller" — `ptah_agent_report` then returns
  `delivered: false` with that reason rather than guessing (Req 6.3). Pi is unaffected
  (`supportsMcp = false`, `pi-cli.adapter.ts:150`), so nothing regresses there (Req 6.6).
- **Quality requirements:** `encodeURIComponent` only, never hand-rolled escaping — the
  `ptah-mcp-url.ts` header explains that a literal `/sse` in a URL changes how
  `harness-sync`'s `inferTransportType` classifies a written entry on read-back.
- **Verification seam:** `http-server.handler.spec.ts` gains the new grammar rows including
  the rejections (`/workspace/{root}/agent/{id}` must be rejected, not half-parsed);
  `ptah-mcp-url` unit tests; one spec per adapter asserting the URL it hands its vendor.
- **Files:** MODIFY `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\ptah-mcp-url.ts`; MODIFY the six adapter/spawn-option call sites; MODIFY `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.interface.ts` (`CliCommandOptions.agentId`); MODIFY `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts`; MODIFY `...\libs\backend\cli-agent-runtime\src\lib\ptah-cli\ptah-cli-registry.ts` and `...\ptah-cli\helpers\ptah-cli-spawn-options.service.ts`; MODIFY `...\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-http\http-server.handler.ts`; MODIFY `...\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\types\mcp-protocol.types.ts`; MODIFY `...\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts`.

### 7. `AgentReportRouter` — child→parent delivery with limits

- **Purpose:** turn a child's report into a turn in the session that spawned it, and a line on
  that child's tile, or an honest refusal.
- **Responsibilities:** resolve the parent from the tracked record; enforce size, rate and
  repeat limits; deliver; write the tile segment; report `delivered`.
- **Verified contracts and entry points:**
  - `AgentProcessInfo.parentSessionId`, set at spawn (`agent-process-manager.service.ts:447`
    and `:535`) from the resolved value in `agent-namespace.builder.ts:135-141`.
  - `IAgentAdapter.isSessionActive(sessionId)` — `agent-adapter.types.ts:221`.
  - `IAIProvider.sendMessageToSession(sessionId, content, options?)` —
    `ai-provider.types.ts:281-285`. The precedent for a backend lib driving a chat session
    through this port is `gateway-chat-bridge.ts:200`.
  - `AgentOutputDelta.segments` and `CliOutputSegmentType` including `'info'` —
    `agent-process.types.ts:207-216,239-248`; the delta is already broadcast to the tile at
    `wiring/agent-events.ts:184-186`.
- **Shape:**
  - `deliver(input: { agentId: string; message: string; summary?: string }): Promise<AgentReportDelivery>`
    where `AgentReportDelivery = { delivered: boolean; reason?: string; parentSessionId?: string }`.
  - Envelope handed to the model, mirroring the CLI's own inbound wrapper measured in
    Appendix A8 (`<cross-session-message from=… from-name=… from-mode=…>`):
    `<agent-report agent-id="…" agent="…" cli="…">…</agent-report>`. One mental model across
    vendors.
  - `origin: { kind: 'peer', from: 'ptah-agent:<agentId>', name: '<cli> · <agent label>' }`
    passed through `sendMessageToSession`.
  - Limits copied from the Claude channel rather than invented (Req 6.5, research §2.8/§7.4):
    body cap 1,048,576 characters; a per-sender burst limit; a bounded queue with
    identical-repeat suppression. Over-limit is refused **at the caller** with a reason.
- **Dependencies:** `AgentProcessManager` (record lookup, tile segment) and the shared
  `IAgentAdapter` port, injected. It lives in `cli-agent-runtime`, which already depends on
  `agent-sdk`'s public barrel and on `shared`. No new lib, no new port, no dependency
  inversion.
- **Integration points:** `PtahAPI.agent.report()` via a structural dependency on
  `AgentNamespaceDependencies` (Component 10), matching the `getPtahCliRegistry` lazy-resolver
  precedent already in that file.
- **Failure behaviour:**
  - unknown agent id, or `_callerAgentId` absent → `delivered: false`, reason
    `unattributed-caller`.
  - `parentSessionId` absent (the spawn recorded no parent) → `delivered: false`, reason
    `no-parent-recorded`.
  - `isSessionActive(parentSessionId) === false` → `delivered: false`, reason
    `parent-session-not-active`. Req 6.3: it never reports a delivery it did not make.
  - The tile segment is written **only** on a successful delivery, so the tile cannot show a
    report the parent never received.
- **Quality requirements:** the report body is AI-authored text rendered as markdown — it
  goes through `libs/frontend/markdown` and nothing else (NFR). No HTML is constructed
  anywhere on this path.
- **Verification seam:** unit tests for each refusal reason, the size cap, the burst limit,
  the repeat suppression, and the happy path asserting exactly one
  `sendMessageToSession` call with the peer origin and exactly one tile segment.
- **Files:** CREATE `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-report-router.service.ts` (+ `.spec.ts`); MODIFY `...\libs\backend\cli-agent-runtime\src\lib\di\{tokens.ts,register.ts}`; MODIFY `...\libs\backend\cli-agent-runtime\src\index.ts`; MODIFY `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts` (public `recordAgentNote(agentId, segment)`); MODIFY the host wiring that constructs `PtahAPIBuilder` in each app.

### 8. Inbound peer message on the SDK stream

- **Purpose:** make a turn injected from outside the session visible as a message from a named
  sender rather than as the user's own words.
- **Responsibilities:** detect `origin.kind === 'peer'` ahead of both existing drop paths;
  emit the existing event triple with a sender label attached.
- **Verified contracts and entry points:**
  - The unconditional replay drop — `sdk-message-transformer.ts:206`. **This is the line to
    change.** Research §3.1 documents that an injected turn "reaches the stream as a replay".
  - The live-user branch — `sdk-message-transformer.ts:159`, and its three existing filters at
    `:160`, `:167`, `:178`.
  - `UserMessageTransformer.transform` emitting `message_start` with `role: 'user'` hardcoded
    — `user-message.transformer.ts:117-151`.
  - `SDKUserMessage.origin?: SDKMessageOrigin` — `sdk.d.ts:3679`; `SDKUserMessageReplay` —
    `sdk.d.ts:3708`.
  - `SdkMessageFactory` already accepts and stamps `origin` —
    `sdk-message-factory.ts:49,92,148`.
  - `SessionStreamPump.sendMessage` — `session-stream-pump.service.ts:180-215`, which does not
    forward one today.
- **Shape:**
  - `MessageStartEvent` gains `inboundPeer?: { readonly label: string }` (`stream.ts:96-102`).
    Optional and additive; every existing producer and consumer is unaffected.
  - `label = origin.name ?? 'peer session'`. **Never `origin.from`** — sender-authored and
    forgeable by any same-user process (research §3.1), and `verifiedPeerPid` is absent on
    Windows. An absent name renders a neutral label and the message is still shown (Req 3.3).
  - `SessionStreamPump.sendMessage(..., options?: { origin?: SDKMessageOrigin })` and the
    matching optional on `AIMessageOptions`, forwarded to `createUserMessage`.
  - The replay branch keeps dropping everything whose origin is not `peer`. That drop is
    load-bearing: `--replay-user-messages` is on (`sdk-query-options-builder.ts:891`) and the
    frontend adds the user bubble optimistically (`message-sender.service.ts:386-397`), so a
    blanket un-drop double-renders every typed prompt.
- **Dependencies:** none new.
- **Integration points:** both producers converge here — a real peer's `SendMessage`, and the
  `AgentReportRouter`'s injected turn (Component 7).
- **Failure behaviour:** an origin with an unexpected `kind` falls through to today's
  behaviour. A peer message with empty text is dropped by the existing empty-text guard
  (`user-message.transformer.ts:96-104`) — acceptable, and stated so the reviewer does not
  read it as a bug.
- **Quality requirements:** governed by Assumption A1. If the CLI does not preserve a
  caller-supplied origin on the replay, the contingency is a
  `SessionInboundCallbackRegistry` DI fan-out modelled verbatim on
  `SessionMcpStatusCallbackRegistry` (its file header and the `agent-sdk/CLAUDE.md` bullet
  explain when a direct channel is legitimate). **The tool contract, the shared type and the
  frontend do not change under the contingency** — only the producer does.
- **Verification seam:** transformer unit tests — a replay with `origin.kind === 'peer'`
  produces the triple with the label; a replay without an origin still produces `[]`; a live
  user message with a peer origin produces the labelled triple; a peer origin with no `name`
  produces the neutral label.
- **Files:** MODIFY `...\libs\backend\agent-sdk\src\lib\sdk-message-transformer.ts`; MODIFY `...\libs\backend\agent-sdk\src\lib\message-transform\user-message.transformer.ts` (+ spec); MODIFY `...\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-stream-pump.service.ts`; MODIFY `...\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts` (options passthrough); MODIFY `...\libs\shared\src\lib\types\execution\stream.ts`; MODIFY `...\libs\shared\src\lib\types\ai-provider.types.ts`.

### 9. Peer-message render in chat

- **Purpose:** a person watching the tab sees who sent it and that it came from outside.
- **Responsibilities:** carry the label from the stream event into the finalized message, and
  render a third bubble variant.
- **Verified contracts and entry points:**
  - The single frontend write path — `accumulator-core.service.ts:244`, `message_start` case
    at `:245`.
  - Finalization's `role === 'user'` branch — `message-finalization.service.ts:266-280`,
    which already copies `messageStartEvent.imageCount` onto the message and is the pattern
    to follow for `inboundPeer`.
  - `createExecutionChatMessage` — `libs/shared/src/lib/types/execution/factories.ts:26`.
  - `ExecutionChatMessage.role: MessageRole` — `libs/shared/src/lib/types/execution/agent.ts:90`;
    Zod mirror `.../execution/schemas.ts:27,96-103`.
  - The bubble's role branch and its markdown binding —
    `message-bubble.component.html:1,199,205,230,236`; `userDisplayContent()` at
    `message-bubble.component.ts:229-234`.
- **Shape:** `ExecutionChatMessage` gains `inboundPeer?: { readonly label: string }`
  **alongside** `role: 'user'` — the role union is NOT widened. Widening `MessageRole` would
  force every consumer of the three-value union and its Zod mirror to handle a fourth case
  for a variation that is presentational; an optional field on the message is the smaller,
  reversible change. The bubble branches on `message().inboundPeer` inside the existing
  user arm: same layout, distinct accent and icon, header shows the label instead of `You`,
  with a caption stating the sender is unverified (Req 3.2).
- **Dependencies:** `libs/frontend/markdown` for the body — the existing `<markdown>` binding
  at `:230`/`:236` is reused unchanged. No second sanitizer (NFR).
- **Integration points:** `agent-monitor-tree-builder.service.ts:406` and
  `streaming-indexes.ts:179` switch on the same union — confirm the new optional field needs
  no case there (it does not; `message_start` is already handled).
- **Failure behaviour:** an `inboundPeer` with an empty label renders the neutral peer label.
  A message with `inboundPeer` and no body is not produced (the backend guard drops it).
- **Quality requirements:** OnPush, signals, `inject()` — repository defaults. The peer accent
  must meet contrast in both themes. Add a `data-testid` for the peer bubble, following the
  `data-testid="chat-user-message"` precedent at `message-bubble.component.html:205` (the
  e2e rule from commit `2b07ce2fe`: select by test id, never by a styling class).
- **Verification seam:** accumulator unit test (the field survives the write path);
  finalization unit test (the field reaches `ExecutionChatMessage`); a component test
  asserting the peer bubble renders the label and routes the body through `<markdown>`.
- **Files:** MODIFY `...\libs\shared\src\lib\types\execution\agent.ts`; MODIFY `...\libs\shared\src\lib\types\execution\schemas.ts`; MODIFY `...\libs\shared\src\lib\types\execution\factories.ts`; MODIFY `...\libs\frontend\chat-streaming\src\lib\accumulator-core.service.ts`; MODIFY `...\libs\frontend\chat-streaming\src\lib\message-finalization.service.ts`; MODIFY `...\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.{html,ts}`.

### 10. `ptah_agent_message` and `ptah_agent_report` on both MCP surfaces

- **Purpose:** expose the two capabilities everywhere Ptah serves MCP, with strict argument
  validation.
- **Responsibilities:** tool descriptions, Zod schemas, dispatch, response formatting, and the
  `PtahAPI.agent` methods behind them.
- **Verified contracts and entry points:**
  - `buildAgentSteerTool()` — `tool-description.builder.ts:653-675` (deleted).
  - HTTP dispatch `case 'ptah_agent_steer'` — `protocol-dispatcher.ts:809-820` (replaced).
  - `WebSearchArgsSchema` `.strict()` + `describeZodIssues` + `toolErrorResponse` —
    `protocol-dispatcher.ts:849-866` (the precedent to copy).
  - stdio: `rename(buildAgentSteerTool(), 'agent_steer')` —
    `mcp-stdio/tool-builders.ts:63-65`; `MCP_MVP_TOOL_NAMES` at `:32-40`; `buildMcpMvpTools`
    at `:137-147`; `AgentToolDispatcher.TOOL_NAMES` at `agent-tool.dispatcher.ts:170-177`;
    switch at `:188-204`; `AgentSteerSchema` at `:75-80`; `parseArgs`/`describeIssues`/
    `toolError` at `:126-156,94-109`.
  - `formatAgentList` capability cell — `mcp-response-formatter.ts:499`.
  - `AgentNamespace` — `code-execution/types.ts:234-…`; builder at
    `agent-namespace.builder.ts:112-345`, `steer` at `:231-233`.
- **Schemas (both surfaces, `.strict()`):**
  ```
  AgentMessageSchema = z.object({
    agentId: z.string().min(1),
    message: z.string().min(1).max(MAX_AGENT_MESSAGE_LENGTH),
  }).strict()

  AgentReportSchema = z.object({
    message: z.string().min(1).max(MAX_AGENT_REPORT_LENGTH),
    summary: z.string().min(1).max(200).optional(),
  }).strict()
  ```
  `MAX_AGENT_REPORT_LENGTH = 1_048_576`, matching the Claude channel's body cap (research
  §2.8/§7.4) rather than a new number. `ptah_agent_report` takes **no** `agentId` — the
  caller is identified by `_callerAgentId` (Component 6), which is the whole point of Req 6.2.
- **Response shapes:**
  - `ptah_agent_message` → `{ agentId, mode: 'steer' | 'interrupt-resume' | 'queue-next-turn' | 'unsupported', detail?: string }`, rendered by `formatAgentMessage` as a
    short block naming the mode and, for `interrupt-resume`, stating that the interrupted
    turn's partial work was discarded (Req 4.1 and its risk row).
  - `ptah_agent_report` → `{ delivered: boolean, reason?: string, parentSessionId?: string }`.
- **`ptah_agent_list` capability cell:** `Capabilities: messaging: <steer|interrupt|queue|none>`
  for a system CLI, and the Ptah CLI row appends the same field to its existing
  `provider: …, ptahCliId: …` cell. Ptah CLI rows read `messagingMode` from the same
  declaration the router uses, not the hardcoded `false` at `agent-namespace.builder.ts:264`
  (Req 5.2). No vendor is named as available that is not installed — the row set is still
  `cliDetectionService.detectAll()` (Req 5.3).
- **`AgentNamespace` changes:** `steer` → `message(agentId, message): Promise<AgentMessageOutcome>`;
  new `report(input): Promise<AgentReportDelivery>` backed by a new optional structural
  dependency `deliverAgentReport?: (input) => Promise<AgentReportDelivery>` on
  `AgentNamespaceDependencies`, wired in each host to Component 7. Absent wiring degrades to
  a clear error, following the `HarnessMcpInstaller` rule in `vscode-lm-tools/CLAUDE.md`.
- **Dependencies:** unchanged direction. `vscode-lm-tools` → `cli-agent-runtime` barrel.
- **Failure behaviour:** a schema miss returns an MCP tool error naming the offending field
  and never falls back to a default (Req 7.3, NFR). An `AgentMessageError` maps to
  `isError: true` with its state in the text — the three states from Component 5 stay
  distinguishable to the calling agent (Req 4.6).
- **Quality requirements:** descriptions name no vendor (`vendor-roster-drift.spec.ts`) and
  direct the reader to `ptah_agent_list` for capability (Req 8.2). Both tools must appear in
  BOTH surfaces' tool lists — the repo already treats single-surface exposure as a bug.
- **Verification seam:** `tool-description.builder.spec.ts` (both tools present, no vendor
  name); `protocol-dispatcher.spec.ts` (dispatch + schema rejection); `mcp-stdio/agent-tool.dispatcher.spec.ts` and the stdio tool-list specs (name tuple grew to 9);
  `mcp-response-formatter.spec.ts` (the capability cell and the two new formatters);
  `vendor-roster-drift.spec.ts` runs unchanged and must still pass;
  `apps/ptah-cli/src/cli/commands/mcp-serve.spec.ts` and
  `apps/ptah-cli/tests/e2e/mcp-serve.e2e.spec.ts` carry the tool-name list and must be
  updated with the rename.
- **Files:** MODIFY `...\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tool-description.builder.ts`; MODIFY `...\mcp-core\protocol-dispatcher.ts`; MODIFY `...\mcp-core\mcp-response-formatter.ts`; MODIFY `...\mcp-stdio\tool-builders.ts`; MODIFY `...\mcp-stdio\agent-tool.dispatcher.ts`; MODIFY `...\code-execution\types.ts`; MODIFY `...\namespace-builders\agent-namespace.builder.ts`; MODIFY `...\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts`; MODIFY `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\apps\ptah-cli\src\cli\commands\mcp-serve.spec.ts`, `...\apps\ptah-cli\src\cli\session\session-describe.builder.spec.ts`, `...\apps\ptah-cli\tests\e2e\mcp-serve.e2e.spec.ts`.

### 11. Harness text, preset and docs

- **Purpose:** make both directions usable without trial and error, and stop the retired tool
  name from surviving in text.
- **Responsibilities:** rewrite every `ptah_agent_steer` / `agent_steer` reference; document
  peer discovery, child messaging, child reporting, `notify_when_idle`'s two limits, and the
  version floors.
- **Verified contracts and entry points:** every site listed in the evidence table's last-but-two
  row. `builtin-presets.ts:41` is the load-bearing one — it is an allow-list, so
  `ptah_agent_message` and `ptah_agent_report` must be added there or the preset silently
  blocks the new tools.
- **Content requirements:**
  - Peer discovery: `ListAgents` / `SendMessage` are available to Ptah SDK sessions; they
    reach Claude sessions only. Rival CLIs are not Claude sessions, bind no inbox socket and
    never appear in `ListAgents` (research §7.4).
  - Per-CLI capability: **direct the reader to `ptah_agent_list`**, never a fixed roster
    (Req 8.2).
  - Waiting: `notify_when_idle`, with both limits stated — only the main conversation may
    subscribe (a subagent that subscribes gets the whole call refused, message included) and
    it reaches sessions on this machine only (research §7.7, Req 8.3). For rival CLI children
    the equivalent is `ptah_agent_status` with a matched interval, never a tight loop.
  - Version floors (Req 8.4, research §7.9): CLI **2.1.234** on native Windows and 2.1.224
    elsewhere for cross-session messaging; 2.1.224 for `crossSessionInbound`; 2.1.236 for
    `notify_when_idle`; SDK 0.3.150 pinned, with `origin.fromMode` (SDK 0.3.234) explicitly
    out of reach and nothing depending on it.
  - Modes: state that `interrupt-resume` discards the interrupted turn's partial work, and
    that `steer` and `queue-next-turn` do not.
  - A completed continuation-capable agent keeps its process alive by design and is still
    messageable — documented as intended, not a leak.
- **Dependencies:** none.
- **Failure behaviour:** not applicable.
- **Quality requirements:** **VS Code Marketplace rule.** The skill/reference files under
  `apps/ptah-extension-vscode/assets/plugins/**` are non-JS files inside the extension. They
  must not gain a trademarked AI product name (`copilot`, `codex`, `claude`, `openai`,
  `anthropic`). Writing "for codex children, use queue-next-turn" into one of them is exactly
  the class of change that burns the extension id. Capability is expressed by MODE and looked
  up at runtime — which is what Req 8.2 asks for anyway, so the two constraints agree.
- **Verification seam:** a repo-wide grep for `ptah_agent_steer` and `agent_steer` returns
  only intentional history; `vendor-roster-drift.spec.ts` passes; the preset spec (if any)
  covering `builtin-presets.ts` passes.
- **Files:** MODIFY `...\libs\backend\rpc-handlers\src\lib\harness\config\builtin-presets.ts`; MODIFY `...\\.claude\skills\ptah-cli-usage\references\{agent-cli.md,internal-mcp.md,mcp-serve.md}`; MODIFY `...\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-cli-usage\references\{agent-cli.md,internal-mcp.md,mcp-serve.md}`; MODIFY `...\apps\ptah-docs\src\content\docs\agents\cli-agents.md`, `...\apps\ptah-docs\src\content\docs\mcp-and-skills\ptah-tools.md`, `...\apps\ptah-docs\src\content\docs\mcp-and-skills\driving-ptah-via-mcp.md`; MODIFY `...\apps\ptah-cli\docs\jsonrpc-schema.md`; MODIFY `...\libs\backend\cli-agent-runtime\CLAUDE.md`, `...\libs\backend\agent-sdk\CLAUDE.md`, `...\libs\backend\vscode-lm-tools\CLAUDE.md`.

---

## Integration architecture

### Data flow — parent to child (`ptah_agent_message`)

1. Parent agent calls the tool on either MCP surface.
2. Dispatcher parses with the strict Zod schema; a miss is an MCP tool error naming the field.
3. `PtahAPI.agent.message(agentId, message)` → `AgentProcessManager.sendToAgent`.
4. Router resolves the tracked record, rejects the three unroutable states, reads
   `handle` capabilities with the adapter declaration as fallback.
5. Mode fires: `handle.steer` | `handle.interrupt` + settle + `continueConversation` |
   pending queue or `continueConversation` | none.
6. Outcome returns to the formatter, which names the mode.

### Data flow — child to parent (`ptah_agent_report`)

1. Child CLI calls `ptah_agent_report({ message })` on `http://localhost:PORT/agent/{id}/workspace/{root}`.
2. `http-server.handler.ts` parses `/agent/{id}` → `request._callerAgentId`.
3. Dispatcher parses the strict schema; `PtahAPI.agent.report({ agentId: _callerAgentId, … })`.
4. `AgentReportRouter` looks up `tracked.info.parentSessionId`, applies size / burst / repeat
   limits, checks `isSessionActive`.
5. `sendMessageToSession(parentSessionId, <agent-report …>…</agent-report>, { origin: { kind: 'peer', from, name } })` →
   `SessionStreamPump.sendMessage` → `SdkMessageFactory.createUserMessage` → `session.messageQueue`.
6. The pump yields it as the next turn (one message per turn, TASK_2026_294 — the report
   waits for the current turn to end rather than being lost as a `queued_command`).
7. The CLI replays it; `sdk-message-transformer.ts:206` sees `origin.kind === 'peer'` and emits
   the labelled `message_start` triple.
8. In parallel, the router writes one `'info'` segment onto the child's `AgentOutputDelta`,
   which the existing `AGENT_MONITOR_OUTPUT` broadcast puts on the tile.

### Data flow — external peer to a Ptah session

1. Another Claude session calls `SendMessage`.
2. The receiving Ptah session was started with `crossSessionInbound: 'accept'` in its
   flag-tier settings, so the class-mismatch hold that dropped both directions in Appendix
   A5/A6 does not apply.
3. The turn arrives as a replay with `origin.kind === 'peer'` and takes step 8's render path.

### State and persistence

- `TrackedAgent.pendingMessages` — in-memory, bounded at 8, cleared on record teardown. Owned
  by `AgentProcessManager` for the life of the record. Never persisted: a queued instruction
  is only meaningful to a live turn.
- `TrackedAgent.currentTurnDone` — in-memory, replaced on every turn.
- `AgentReportRouter`'s rate-limit and repeat-suppression window — in-memory, keyed by
  `agentId`, bounded and evicted with the agent record.
- No schema change, no migration, nothing new on disk. `crossSessionInbound` is per session
  in the flag tier and is **never** written to `~/.claude/settings.json` (NFR; research §7.2).

### External boundaries

| Boundary | Control |
| --- | --- |
| MCP tool arguments (both tools, both surfaces) | Strict Zod, error on unknown field, no fallback (Req 7.3). |
| The MCP URL's agent segment | Written by Ptah, `encodeURIComponent`-encoded, parsed against a closed grammar. Never read from the payload. |
| `crossSessionInbound` value | Validated against a closed three-value set before emission; an unrecognised value is omitted, never sent (Req 1.3). |
| Peer sender identity | `origin.name` only, presented as unverified. Never `origin.from`; `verifiedPeerPid` is absent on Windows (Req 3.2). |
| Report body / peer body | Rendered as markdown through `libs/frontend/markdown` only (NFR). |
| Report volume | Body cap, per-sender burst limit, bounded queue, identical-repeat suppression, all matching the Claude channel's limits (Req 6.5). |

**Stated plainly, per the risk row:** `crossSessionInbound: 'accept'` means any same-user
process that reaches a Ptah session's socket can inject a user turn into a session running
with permission checks off. Ptah covers **only the sessions it starts** — the main chat and
Ptah CLI spawns. A developer's own `claude` terminal, or any Claude session Ptah did not
start, keeps the default hold-then-expire behaviour and will still silently lose messages
across a class mismatch. That is documented in Component 11, not designed around: the failure
is silent by construction and the only honest mitigation is telling the user that a session
Ptah did not start needs its own `--settings`.

### Failure and rollback

- Naming fails → session starts unnamed, warn logged.
- Settings serialisation is total → cannot fail.
- `steer` write fails → surfaced as `unsupported` with the reason; nothing is reported
  delivered.
- `interrupt` fails → mode is `unsupported` with the reason; the current turn continues
  untouched.
- Continuation fails to start → the existing path already calls `handleExit(agentId, 1, null)`
  and throws `AgentContinueError('unknown')` (`:1109-1118`); the router maps it to a named
  tool error.
- Parent session gone → `delivered: false` with the reason; no tile segment written.
- Every one of these is observable from the tool result. There is no branch that returns
  success for work that did not happen.

### Observability

- `--settings` and `--name` land in the SDK's own `Spawning Claude Code:` log line, which is
  the evidence path for a settings or naming regression.
- The router logs the selected mode with the agent id and CLI at `info`.
- The report router logs every refusal with its reason at `warn` — a refused report is
  otherwise invisible on the parent side.
- The transformer logs at `debug` when it renders a peer message and when it drops a replay,
  so Assumption A1 is answerable from the log alone.

---

## Architecture-level quality requirements

- **Functional:** the eight requirement blocks in `task-description.md`, each with its
  acceptance criteria. The two reproducible measurements are Appendix A5/A6 (both directions
  silently lost) and A8 (delivered with `accept`) — a reviewer must be able to re-run both.
- **Performance:** no new spawn, no new process, no new file write on any hot path. The one
  added per-session cost is a `JSON.stringify` of a two-to-three key object. The report path
  adds one in-memory queue push per report. Nothing here goes near the synchronous
  `CreateProcessW` cost that `OffThreadProcessSpawner` exists to keep off the main thread.
- **Security:** the boundary table above. Three rules are absolute — no new HTML sanitizer;
  `crossSessionInbound` never in user settings; no vendor-name-bearing text in a non-JS file
  under `apps/ptah-extension-vscode/assets/**`.
- **Maintainability:**
  - `buildFlagSettings` stays the ONE flag-tier object builder; the serializer delegates.
  - `ptahMcpServerUrl` stays the ONE spawn-side URL builder, and its file-writer twin
    `ptahMcpUrl` keeps producing the same grammar.
  - The router branches on capability flags only. A seventh adapter reaches every mode by
    declaring `capabilities()` and implementing the handle methods (Req 4.7).
  - Any file pushed past the 700-line soft ceiling is split by the facade rule — public class
    keeps its name, DI token and signatures; the extracted concern is an injected collaborator
    with a real name. `agent-process-manager.service.ts` is the likely candidate; the
    extraction is named in Component 5 and is `AgentMessageRouter`, not `helpers`.
  - No new RPC namespace, so `ALLOWED_METHOD_PREFIXES` is untouched — stated so a reviewer can
    confirm the dual-registration rule was considered rather than forgotten.
- **Testability:** each mode of `sendToAgent` is provable against a fake handle without
  spawning a CLI; each report refusal reason is provable without a live session; the
  transformer's peer branch is provable from a synthetic `SDKUserMessage`. The one behaviour
  that cannot be unit-tested — that the CLI actually delivers with `accept` — is the manual
  acceptance case from Appendix A5/A8 and must be recorded in `test-report.md`.

---

## Team-leader handoff

### Recommended executors

| Component | Executor | Reason |
| --- | --- | --- |
| 1, 2, 8 (agent-sdk) | backend-developer | SDK options, transformer and pump; no UI, no pipeline. |
| 3, 4, 5 (adapters + router) | backend-developer | Adapter contract and lifecycle logic in one lib. |
| 6, 7 (identity + report router) | backend-developer | Crosses `cli-agent-runtime` and `vscode-lm-tools`' HTTP handler; one author avoids two halves of one grammar. |
| 9 (chat render) | frontend-developer | Angular signals, OnPush, template variant, markdown chokepoint. |
| 10 (MCP tools) | backend-developer | Two dispatchers, two formatters, Zod at the boundary. |
| 11 (text) | technical-content-writer, with backend-developer for `builtin-presets.ts` | The preset is an allow-list, not prose. |
| verification | senior-tester | The empirical acceptance cases (A5/A6/A8 re-run, `nameSource`, mode-per-vendor) are not unit tests. |

### Complexity

**HIGH** — not because any component is hard, but because of breadth and one hard ordering
constraint. Five libs plus two apps; a shared-type change (`CliDetectionResult.messagingMode`)
that ripples through six adapters and two consumers; two MCP surfaces that must move together;
a URL grammar shared by six spawn paths and pinned by a spec that rejects malformed forms.
Individual components are LOW-to-MEDIUM.

### Dependencies and ordering

- Component 3 (capability types + `messagingMode`) is a **shared-type change** and must land
  before 5 and before 10's list cell.
- Component 4 depends on 3 (`SdkHandle.interrupt` must exist).
- Component 5 depends on 3 and 4.
- Component 6's `reserveAgentId` threading touches `agent-namespace.builder.ts`, which
  Component 10 also edits — **these two contend on one file**.
- Component 7 depends on 6 (`_callerAgentId`) and on 8's `origin` passthrough.
- Component 9 depends on 8's `MessageStartEvent.inboundPeer`.
- Component 10 depends on 5 and 7 for the methods it exposes.
- Component 11 depends on 10's final tool names.

### Parallel-safe work

File-disjoint and runnable together:

- **Group α** — Components 1 + 2 + 8 (`libs/backend/agent-sdk/**` + two `libs/shared` type
  files: `execution/stream.ts`, `ai-provider.types.ts`).
- **Group β** — Components 3 + 4 (`cli-adapters/**` + `libs/shared/types/agent-process.types.ts`).

α and β are disjoint. Everything after depends on one of them; 5, 6, 7, 9, 10, 11 are
**sequential** with respect to those dependencies. In particular 6 and 10 must not run in
parallel — both edit `agent-namespace.builder.ts`.

Note: `libs/shared` is touched by α (`execution/stream.ts`, `ai-provider.types.ts`,
`execution/agent.ts`, `execution/schemas.ts`, `execution/factories.ts`) and by β
(`agent-process.types.ts`). Disjoint files in one lib — safe to run in parallel, but the
batch descriptions must name the files so an executor does not widen its edit.

### Files affected

**CREATE**

- `libs\backend\agent-sdk\src\lib\helpers\session-name.builder.ts` (+ `.spec.ts`)
- `libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-report-router.service.ts` (+ `.spec.ts`)
- `libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-message-router.service.ts` — only if Component 5 crosses the size ceiling

**MODIFY — `libs/shared`**

- `src\lib\types\agent-process.types.ts` · `src\lib\types\ai-provider.types.ts`
- `src\lib\types\execution\stream.ts` · `...\execution\agent.ts` · `...\execution\schemas.ts` · `...\execution\factories.ts`

**MODIFY — `libs/backend/agent-sdk`**

- `src\lib\helpers\sdk-query-options-builder.ts` · `src\lib\helpers\sdk-query-options-builder.output-style.spec.ts`
- `src\lib\sdk-message-transformer.ts` · `src\lib\message-transform\user-message.transformer.ts` (+ spec)
- `src\lib\helpers\session-lifecycle\session-stream-pump.service.ts` · `src\lib\sdk-agent-adapter.ts` · `src\index.ts` · `CLAUDE.md`

**MODIFY — `libs/backend/cli-agent-runtime`**

- `src\lib\cli-agents\cli-adapters\cli-adapter.interface.ts` · `...\ptah-mcp-url.ts`
- `...\cli-adapters\{pi,codex,copilot-sdk,cursor,antigravity,opencode}-cli.adapter.ts` (+ affected specs)
- `src\lib\cli-agents\agent-process-manager.service.ts`
- `src\lib\ptah-cli\ptah-cli-registry.ts` · `src\lib\ptah-cli\helpers\ptah-cli-spawn-options.service.ts`
- `src\lib\di\tokens.ts` · `src\lib\di\register.ts` · `src\index.ts` · `CLAUDE.md`

**MODIFY — `libs/backend/vscode-lm-tools`**

- `src\lib\code-execution\mcp-core\tool-description.builder.ts` · `...\protocol-dispatcher.ts` · `...\mcp-response-formatter.ts` · `...\types\mcp-protocol.types.ts`
- `src\lib\code-execution\mcp-http\http-server.handler.ts` (+ spec)
- `src\lib\code-execution\mcp-stdio\tool-builders.ts` · `...\agent-tool.dispatcher.ts` (+ specs)
- `src\lib\code-execution\types.ts` · `src\lib\code-execution\namespace-builders\agent-namespace.builder.ts` (+ spec) · `CLAUDE.md`

**MODIFY — other libs**

- `libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts`
- `libs\backend\rpc-handlers\src\lib\harness\config\builtin-presets.ts`
- `libs\frontend\chat-streaming\src\lib\accumulator-core.service.ts` · `...\message-finalization.service.ts`
- `libs\frontend\chat\src\lib\components\organisms\message-bubble.component.{html,ts}`

**MODIFY — apps and docs**

- Host wiring that constructs `PtahAPIBuilder` in each of the VS Code, Electron and CLI hosts
  (add `deliverAgentReport`) — the team-leader must locate all three; the plan does not name
  them because the construction site count is a fact to verify, not to assume.
- `apps\ptah-cli\src\cli\commands\mcp-serve.spec.ts` · `apps\ptah-cli\src\cli\session\session-describe.builder.spec.ts` · `apps\ptah-cli\tests\e2e\mcp-serve.e2e.spec.ts` · `apps\ptah-cli\docs\jsonrpc-schema.md`
- `.claude\skills\ptah-cli-usage\references\{agent-cli,internal-mcp,mcp-serve}.md`
- `apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-cli-usage\references\{agent-cli,internal-mcp,mcp-serve}.md`
- `apps\ptah-docs\src\content\docs\agents\cli-agents.md` · `apps\ptah-docs\src\content\docs\mcp-and-skills\{ptah-tools,driving-ptah-via-mcp}.md`

### Verification points

**Contracts to honour**

- `buildFlagSettings` remains the one flag-tier object builder and keeps returning the frozen
  constant identity for a style-less session.
- `ptahMcpServerUrl` remains the one spawn-side URL builder and keeps grammar parity with
  `ptahMcpUrl` in `ptah-mcp-slots.ts`.
- The `/workspace/{root}` segment stays terminal; `/workspace/{root}/agent/{id}` is rejected,
  not half-parsed.
- The router names no CLI.
- Peer/report bodies render only through `libs/frontend/markdown`.
- No trademarked AI product name enters a non-JS file under `apps/ptah-extension-vscode/assets/**`.

**References to confirm before writing code**

- Assumption A3: re-read `antigravity-cli.adapter.ts:593-601` and
  `opencode-cli.adapter.ts:547-554` to confirm both still lack `continue`.
- Locate every `PtahAPIBuilder` construction site (VS Code, Electron, CLI) before adding
  `deliverAgentReport`; a host left unwired makes `ptah_agent_report` work in one product and
  not another — the exact failure Req 7 exists to prevent.

**Data changes to apply:** none. No migration, no persisted schema.

**Commands that must pass**

```bash
npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools @ptah-extension/shared @ptah-extension/rpc-handlers
npx nx run-many -t test -p @ptah-extension/chat-streaming @ptah-extension/chat
npx nx run-many -t test -p ptah-cli
npm run typecheck:all
npm run lint:all
```

Read the `Running target test for N projects` header and confirm N matches the count asked
for — a misspelled project name is silently dropped from a `run-many` set. Never
`nx test projA projB`. No `project.json` is edited by this plan, so no `nx reset` is required;
if one becomes necessary, reset before the first command of that batch and never while
another executor is working in this worktree.

**Manual acceptance (senior-tester, recorded in `test-report.md`)**

1. Spawn a Ptah CLI agent under full auto; from a prompting-class peer, `SendMessage` to it;
   the agent's transcript shows the message within one turn boundary (Req 1.1 — the A5/A6 case).
2. The reverse: a `bypassPermissions` child messages the main chat; the chat receives it
   (Req 1.2).
3. `~/.claude/sessions/<pid>.json` shows `nameSource !== 'derived'` and a role-plus-task name;
   two concurrent sessions in one workspace have different names (Req 2.1, 2.2).
4. One `ptah_agent_message` per installed vendor; the reported mode matches that vendor's
   `ptah_agent_list` capability cell (Req 5.2).
5. A codex child calls `ptah_agent_report`; the message appears in the spawning session's chat
   labelled with the agent, and on that agent's tile (Req 6.1, 6.4).
6. Both tools appear on `tools/list` for the HTTP surface and the stdio surface (Req 7.1, 7.2).
