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

Types: `MemoryHit`, `MemoryHitPage`, `MemoryRecord`, `MemoryListPage`, `SymbolChunkInsert`, `ExtractedMemoryDraft`, `ResolvedMemoryDraft`.
Interfaces: `IMemoryReader`, `IMemoryLister`, `ICuratorLLM`, `ICompactionCallbackRegistry`, `ISymbolSink`.
Tokens: `MEMORY_CONTRACT_TOKENS`.

## Internal Structure

- `src/lib/memory-reader.port.ts` — `IMemoryReader`, `IMemoryLister`, `MemoryHit/Record/Page` types
- `src/lib/curator-llm.port.ts` — `ICuratorLLM` (consumed by curator; implemented in `agent-sdk/curator-llm-adapter`)
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
