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

## Public API

`SdkAgentAdapter`, `InternalQueryService`, `SdkMessageTransformer`, `SessionMetadataStore`, `SessionImporterService`, `SessionHistoryReaderService`, `JsonlReaderService`, `SdkPermissionHandler`, `ProviderModelsService`, `ClaudeCliDetector`, `SubagentMessageDispatcher`, `CompactionCallbackRegistry`, `CompactionHookHandler`. Errors: `SdkError`, `SessionNotActiveError`, `ModelNotAvailableError`. Registration: `registerSdkServices`, `SDK_TOKENS`. Constants: `ANTHROPIC_PROVIDERS`, `TIER_TO_MODEL_ID`, `DEFAULT_FALLBACK_MODEL_ID`.

## Internal Structure

- `src/lib/sdk-agent-adapter.ts` — main interactive adapter; emits session lifecycle events
- `src/lib/internal-query/` — one-shot SDK query path (TASK_2025_145) for non-chat callers
- `src/lib/message-transform/` + `sdk-message-transformer.ts` — SDK message → Ptah message
- `src/lib/permission/` + `sdk-permission-handler.ts` — tool permission gate (forwards to UI)
- `src/lib/providers/` — Anthropic-compatible provider registry (`provider-registry.ts`)
- `src/lib/detector/claude-cli-detector.ts` — checks Claude CLI availability
- `src/lib/helpers/history/jsonl-reader.service.ts` — raw JSONL turn reader (consumed by skill-synthesis)
- `src/lib/helpers/` — system prompt assembly, tier env defaults, compaction registry, subagent dispatcher
- `src/lib/cli-agents/`, `ptah-cli/`, `prompt-harness/` — Ptah CLI subagent wiring
- `src/lib/curator-llm-adapter/` — bridges `ICuratorLLM` (memory-contracts) onto `InternalQueryService`
- `src/lib/auth/`, `stream-processing/`, `errors/`, `wiring/`, `di/`, `types/`

## Key Files

- `src/lib/sdk-agent-adapter.ts` — primary adapter, owns sessionId from SDK system 'init' message
- `src/lib/session-metadata-store.ts` — lightweight UI metadata only (name/timestamps/cost); SDK owns message persistence
- `src/lib/internal-query/internal-query.service.ts` — entry point for headless SDK queries
- `src/lib/di/tokens.ts` — `SDK_TOKENS`
- `src/lib/di/register.ts` — `registerSdkServices` registration helper
- `src/lib/helpers/index.ts` — TIER_TO_MODEL_ID, system prompt builder, dispatcher, compaction registry

## Dependencies

**Internal**: `@ptah-extension/shared`, `@ptah-extension/platform-core`, `@ptah-extension/vscode-core`, `@ptah-extension/memory-contracts`
**External**: `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, `axios`, `tsyringe`, `zod`, `eventemitter3`, `cross-spawn`, `which`, `uuid`

## Guidelines

- **Session identity**: the SDK's UUID from the system 'init' message is the canonical sessionId everywhere. Never mint a Ptah-side sessionId.
- **Message persistence**: rely on SDK JSONL files at `~/.claude/projects/{sessionId}.jsonl`. `SessionMetadataStore` only tracks UI metadata.
- **Interactive vs headless**: chat path = `SdkAgentAdapter`; everything else (skill synthesis, memory curator) = `InternalQueryService`.
- **Compaction**: subscribers must register via `CompactionCallbackRegistry`, not by patching the adapter.
- Always `catch (error: unknown)` and narrow.
- Boundary inputs validated via zod schemas.

## Cross-Lib Rules

Used by: `rpc-handlers`, `memory-curator` (via curator-llm-adapter), `skill-synthesis` (via `JsonlReaderService` + `InternalQueryService`), app layers.
Forbidden imports: `platform-{cli,electron,vscode}` (adapter selection lives in app layer).
