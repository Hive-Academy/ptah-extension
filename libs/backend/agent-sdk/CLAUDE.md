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

`SdkAgentAdapter`, `InternalQueryService`, `SdkMessageTransformer`, `SessionMetadataStore`, `SessionImporterService`, `SessionHistoryReaderService`, `JsonlReaderService`, `SdkPermissionHandler`, `ProviderModelsService`, `ClaudeCliDetector`, `SubagentMessageDispatcher`, `CompactionCallbackRegistry`, `CompactionHookHandler`. Errors: `SdkError`, `SessionNotActiveError`, `ModelNotAvailableError`. Registration: `registerSdkServices`, `SDK_TOKENS`. Constants: `ANTHROPIC_PROVIDERS` (provider entries carry `defaultTiers` for bare tier resolution).

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

- **Session identity**: the SDK's UUID from the system 'init' message is the canonical sessionId everywhere. Never mint a Ptah-side sessionId.
- **Message persistence**: rely on SDK JSONL files at `~/.claude/projects/{sessionId}.jsonl`. `SessionMetadataStore` only tracks UI metadata.
- **Interactive vs headless**: chat path = `SdkAgentAdapter`; everything else (skill synthesis, memory curator) = `InternalQueryService`.
- **Compaction**: subscribers must register via `CompactionCallbackRegistry`, not by patching the adapter.
- Always `catch (error: unknown)` and narrow.
- Boundary inputs validated via zod schemas.

## Cross-Lib Rules

Used by: `rpc-handlers`, `memory-curator` (via curator-llm-adapter), `skill-synthesis` (via `JsonlReaderService` + `InternalQueryService`), app layers.
Forbidden imports: `platform-{cli,electron,vscode}` (adapter selection lives in app layer), `@ptah-extension/harness-sync` (structural port only, see `src/lib/harness/`).
