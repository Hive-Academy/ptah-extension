# @ptah-extension/agent-sdk

[Back to Main](../../../CLAUDE.md)

## Purpose

Wraps the official `@anthropic-ai/claude-agent-sdk` (plus `@openai/codex-sdk`) into Ptah's `IAIProvider`-style adapter. Owns session lifecycle, message transformation, permission handling, provider registry, and SDK-managed JSONL session persistence.

## Boundaries

**Belongs here**:

- SDK adapter (`SdkAgentAdapter`) — interactive chat path
- Internal one-shot queries (`InternalQueryService`) — used by skill-synthesis, memory-curator agents
- SDK message transformation, permission handling, session metadata, history reading
- Provider registry (Anthropic-compatible providers), CLI detector, system prompt assembly
- Compaction hook fanout (`CompactionCallbackRegistry`) and subagent dispatcher

**Does NOT belong**:

- Platform-specific code (must go through `platform-core` ports)
- RPC handlers (those live in `rpc-handlers`)
- Persistence beyond what SDK writes to `~/.claude/projects/`
- Propagating skills/commands/agents into `.claude/` or any rival CLI's harness
  dir — that fan-out is `@ptah-extension/harness-sync` (TASK_2026_278; replaces
  the deleted `SkillJunctionService`). `agent-sdk` must never import
  `harness-sync` — see `src/lib/harness/harness-preflight.port.ts`

## Public API

`SdkAgentAdapter`, `InternalQueryService`, `SdkMessageTransformer`, `SessionMetadataStore`, `SessionImporterService`, `SessionHistoryReaderService`, `JsonlReaderService`, `SdkPermissionHandler`, `ProviderModelsService`, `ClaudeCliDetector`, `SubagentMessageDispatcher`, `CompactionCallbackRegistry`, `CompactionHookHandler`, `SessionIdResolvedCallbackRegistry`. Errors: `SdkError`, `SessionNotActiveError`, `ModelNotAvailableError`. Registration: `registerSdkServices`, `SDK_TOKENS`. Constants: `ANTHROPIC_PROVIDERS` (provider entries carry `defaultTiers` for bare tier resolution).

## Internal Structure

- `src/lib/sdk-agent-adapter.ts` — main interactive adapter; emits session lifecycle events
- `src/lib/internal-query/` — one-shot SDK query path (TASK_2025_145) for non-chat callers
- `src/lib/message-transform/` + `sdk-message-transformer.ts` — SDK message → Ptah message
- `src/lib/permission/` + `sdk-permission-handler.ts` — tool permission gate (forwards to UI)
- `src/lib/providers/` — Anthropic-compatible provider registry (`provider-registry.ts`)
- `src/lib/detector/claude-cli-detector.ts` — checks Claude CLI availability
- `src/lib/helpers/history/jsonl-reader.service.ts` — raw JSONL turn reader (consumed by skill-synthesis)
- `src/lib/helpers/` — system prompt assembly, tier env defaults, compaction registry, subagent dispatcher
- `src/lib/harness/harness-preflight.port.ts` — `HARNESS_PREFLIGHT_TOKEN` +
  `IHarnessPreflight`, the structural port `SessionQueryExecutor` calls before
  a session starts. No import of `harness-sync`; each host aliases the token
  onto `HARNESS_SYNC_TOKENS.PREFLIGHT` in one line of registration, and
  `HarnessPreflightService` satisfies the interface with no import back
- `src/lib/cli-agents/`, `ptah-cli/`, `prompt-harness/` — Ptah CLI subagent wiring
- `src/lib/curator-llm-adapter/` — bridges `ICuratorLLM` (memory-contracts) onto `InternalQueryService`
- `src/lib/auth/`, `stream-processing/`, `errors/`, `wiring/`, `di/`, `types/`

## Key Files

- `src/lib/sdk-agent-adapter.ts` — primary adapter, owns sessionId from SDK system 'init' message
- `src/lib/session-metadata-store.ts` — lightweight UI metadata only (name/timestamps/cost); SDK owns message persistence
- `src/lib/internal-query/internal-query.service.ts` — entry point for headless SDK queries
- `src/lib/di/tokens.ts` — `SDK_TOKENS`
- `src/lib/di/register.ts` — `registerSdkServices` registration helper
- `src/lib/helpers/index.ts` — system prompt builder, dispatcher, compaction registry

## Dependencies

**Internal**: `@ptah-extension/shared`, `@ptah-extension/platform-core`, `@ptah-extension/vscode-core`, `@ptah-extension/memory-contracts`, `@ptah-extension/plugin-marketplace`
**External**: `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, `axios`, `tsyringe`, `zod`, `eventemitter3`, `cross-spawn`, `which`, `uuid`

Deliberately NOT `@ptah-extension/harness-sync`. `SessionQueryExecutor` needs
one bounded call before a session starts; taking a real dependency on the
reconciler lib would put this 10-concern adapter upstream of a lib that has to
stay a leaf. The port in `src/lib/harness/` is the whole relationship.

## Guidelines

- **Harness plugins live in TWO roots and only ONE of them may be mirrored.** `~/.ptah/plugins` is user-global; `{ws}/.ptah/plugins` is workspace-scoped and committable beside `.ptah/specs`. Both reach `resolveCurrentPluginPaths` (the reconciler's overlay); only `discoverHarnessPluginPaths` — the user-global one — reaches each host's `buildMirrorSources`. That asymmetry is what makes the scope real, and it is the same rule `discoverSkillsShPluginPaths` documents: the user-layer mirror clones create-if-absent into `~/.ptah/user/skills`, and the user layer is the desired state's BASE, so a mirrored workspace skill would outlive its workspace and propagate into every other project forever. **Never add `discoverWorkspaceHarnessPluginPaths()` to `buildMirrorSources`.** A slug present in both roots resolves workspace-wins with a warn, and `ptah.harness.createSkill` refuses the second write rather than creating the clash.
- **Session identity**: the SDK's UUID from the system 'init' message is the canonical sessionId everywhere. Never mint a Ptah-side sessionId.
- **Message persistence**: rely on SDK JSONL files at `~/.claude/projects/{sessionId}.jsonl`. `SessionMetadataStore` only tracks UI metadata.
- **Interactive vs headless**: chat path = `SdkAgentAdapter`; everything else (skill synthesis, memory curator) = `InternalQueryService`.
- **One message per turn**: `SessionStreamPump` yields a user message only when `SessionRecord.turnInFlight` is false, and claims it before every yield. Ptah owns the follow-up queue on purpose — a prompt handed to the SDK mid-turn is classified as a _queued command_: the SDK enqueues it, removes it, writes it as a `queued_command` transcript attachment, and never materialises it as a user turn. It is silently lost, and the model is never told. Measured before the fix: 180 removed queue items, 0 delivered, 58 of them human prompts (TASK_2026_294). The release is `StreamTransformConfig.onTurnEnd`, fired first inside the `result` branch — NOT `onResultStats`, which `validateStats` can skip.
- **Hook session identity**: a hook callback MUST resolve its session id through `resolveHookSessionId` / `resolveHookCwd` (`src/lib/helpers/hook-session-resolver.ts`) — payload first, closure second, `''` from either source treated as absent — and MUST NOT publish the result until it has rejected `null`. `SdkQueryOptionsBuilder.createHooks` captures whatever `SessionQueryExecutor` handed it as `sessionId` — the `?? ''` coercion this rule was first written against is gone, and both signatures now model absence (`createHooks(cwd: string, sessionId?: string, …)` → `CompactionHookHandler.createHooks(sessionId: string \| undefined, …)`). For a NEW session the captured id is the **tabId**, not the SDK UUID, which arrives later in the system `init` message: the closure holds a real but non-canonical id for the whole query, and since a tabId is itself a UUID v4 no handler can tell the two apart by inspection (TASK_2026_296). That is why the payload comes first. PreCompact skipped the resolve entirely and fanned the unresolved id to the memory curator, whose transcript reader rejected it as path traversal and curated a placeholder instead of the conversation (TASK_2026_293). Seven more handlers resolved but never rejected, and `SubagentStart` gated registration on the closure while the real parent id sat on the payload — which silently unregistered every subagent of an internal one-shot query, killing steering, stop, background listing and resumption for it (TASK_2026_295). The resolver returns `null`, never `''`, so "no id" cannot be published by accident.
- **MCP caller identity**: `SdkQueryOptionsBuilder.buildMcpServers` MUST emit the Ptah MCP URL as `http://localhost:{port}/session/{routingId}`, never the bare origin. That segment is the only channel telling an MCP tool call which session made it — `extractCallerSessionId` (vscode-lm-tools `http-server.handler.ts:145`) parses it onto `request._callerSessionId` and `ptah_agent_spawn` uses it as `parentSessionId`. Drop it and the consumer falls back to `getActiveSessionIds()[0]`, so with two sessions open session B's spawn is attributed to session A (TASK_2026_295). That consumer fallback is deliberate — stdio, CLI and internal one-shot callers genuinely have no caller id — so the producer must never emit an anonymous URL on the interactive path; a missing routing id throws `SdkError`. The id is `sessionConfig.tabId ?? sessionId`, matching `SessionQueryExecutor`'s `registerKey` so the consumer's `resolveSessionId` can `find()` it. A tabId is correct here: for a new session it is the only id that exists, since the SDK UUID arrives later in the system `init` message. Internal one-shot queries use `SdkQueryRunner.buildOneShotMcpServers`, which has no segment by construction.
- **Compaction**: subscribers must register via `CompactionCallbackRegistry`, not by patching the adapter.
- **Session-id resolution is fanned out, not owned**: `SdkAgentAdapter` fires `SessionIdResolvedCallbackRegistry.notifyAll` from BOTH resolve sites (resume and new-session) **alongside** `SdkAdapterCallbackRegistry.emitSessionIdResolved`, never instead of it. The single-slot `setSessionIdResolvedCallback` is part of the shared `IAgentAdapter` port (`agent-adapter.types.ts:253`) and is already consumed by `cli-agent-runtime` (`wiring/sdk-callbacks.ts`), so promoting it into a fan-out would be a breaking port change for no gain (TASK_2026_296). The registry exists because a residual hook path — one whose payload genuinely lacks `session_id` and falls back to the tabId-bearing closure documented above — arms consumer state under the **tabId**, while `SessionEnd` always canonicalises to `realSessionId ?? tabId` and arrives under the UUID. `MemoryTriggerService` and `SkillTriggerService` subscribe and migrate their keyed state (`rekeySession`). A subscriber's handler MUST be synchronous, MUST refuse to overwrite an entry already held under the destination id, and MUST re-arm any timer with its REMAINING delay — a `setTimeout` closure captures the id it was armed with. Nothing anywhere may detect a tabId by SHAPE: a tabId is itself a UUID v4.
- Always `catch (error: unknown)` and narrow.
- Boundary inputs validated via zod schemas.

## Cross-Lib Rules

Used by: `rpc-handlers`, `memory-curator` (via curator-llm-adapter), `skill-synthesis` (via `JsonlReaderService` + `InternalQueryService`), app layers.
Forbidden imports: `platform-{cli,electron,vscode}` (adapter selection lives in app layer), `@ptah-extension/harness-sync` (structural port only, see `src/lib/harness/`).
