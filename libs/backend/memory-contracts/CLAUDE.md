# @ptah-extension/memory-contracts

[Back to Main](../../../CLAUDE.md)

## Purpose

Pure contracts (interfaces + tokens) for the Letta-style memory subsystem. Lets producers (workspace-intelligence symbol indexer, agent-sdk compaction) and consumers (memory-curator, rpc-handlers) decouple from concrete implementations.

## Boundaries

**Belongs here**:

- Port interfaces and token registry
- Plain DTOs/types used at port boundaries

**Does NOT belong**:

- Any concrete service, persistence, or LLM logic (lives in `memory-curator`)

## Public API

Types: `MemoryHit`, `MemoryHitPage`, `MemoryRecord`, `MemoryListPage`, `SymbolChunkInsert`, `ExtractedMemoryDraft`, `ResolvedMemoryDraft`, `BuildCorpusParams`, `CorpusRef`, `CorpusListEntry`, `CorpusRebuildResult`, `CorpusPrimeResult`.
Interfaces: `IMemoryReader`, `IMemoryLister`, `IMemoryUsageRecorder`, `ICuratorLLM` (+ `CuratorCallOptions`), `ICompactionCallbackRegistry`, `ISymbolSink`, `IKnowledgeAgent`.
Tokens: `MEMORY_CONTRACT_TOKENS` (including `MEMORY_USAGE_RECORDER`), `KNOWLEDGE_AGENT_TOKEN`.

## Internal Structure

- `src/lib/memory-reader.port.ts` — `IMemoryReader`, `IMemoryLister`, `MemoryHit/Record/Page` types
- `src/lib/memory-usage-recorder.port.ts` — `IMemoryUsageRecorder` explicit-use port
- `src/lib/curator-llm.port.ts` — `ICuratorLLM` (consumed by curator; implemented in `agent-sdk/curator-llm-adapter`). `CuratorStallReason` is `provider-cooling-down` (quota gate, before dispatch) or `provider-unreachable` (dispatched, network-class failure, TASK_2026_437 C14 f); both keep the caller's input. `extract`/`resolve` take an optional `CuratorCallOptions { userInitiated? }` (TASK_2026_437 C14): `true` only for `memory:runNow`, which makes the adapter use the ungoverned `user-action` lane instead of `memory-curator`.
- `src/lib/compaction-callback.port.ts` — registry interface (implementation in `agent-sdk`)
- `src/lib/symbol-sink.port.ts` — sink for workspace symbol chunks
- `src/lib/tokens.ts` — `MEMORY_CONTRACT_TOKENS`

## Dependencies

**Internal**: none
**External**: none (pure types)

## Guidelines

- Stay zero-dep — adding runtime deps here forces them on every consumer.
- All contracts use `readonly` and `Promise<...>` signatures; no events here (use compaction registry port).
- Bumps to interfaces are breaking — coordinate with `memory-curator`, `agent-sdk`, `workspace-intelligence`.

## Cross-Lib Rules

Imported by `agent-sdk`, `memory-curator`, `workspace-intelligence`, `vscode-lm-tools`, `rpc-handlers`. Imports nothing.
