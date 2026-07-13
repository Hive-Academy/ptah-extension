# @ptah-extension/memory-curator

[Back to Main](../../../CLAUDE.md)

## Purpose

Letta-style tiered memory (core/recall/archival) curated automatically on SDK PreCompact firings. Hybrid search via FTS5 (BM25) + sqlite-vec with Reciprocal Rank Fusion, fallback to BM25-only. Also owns the user-controlled workspace indexing pipeline (TASK_2026_114).

## Boundaries

**Belongs here**:

- Memory store, search, salience scoring, decay job, curator service
- Embedder worker client (registered under `PERSISTENCE_TOKENS.EMBEDDER`) +
  the host-implemented `IEmbedderWorkerProcessFactory` port
- The `embedder-worker.ts` utilityProcess entry (bundled separately to
  `embedder-worker.mjs`) + its id-correlated `embedder-worker-protocol.ts`
- `IMemoryWriter` adapter (registered under `PLATFORM_TOKENS.MEMORY_WRITER`)
- Workspace fingerprint derivation
- `IndexingControlService` — user-controlled indexing pipeline

**Does NOT belong**:

- DB connection (use `persistence-sqlite`)
- LLM calls (consume `ICuratorLLM` from `memory-contracts`; implementation lives in `agent-sdk`)
- RPC surface (in `rpc-handlers`: `MemoryRpcHandlers`, `IndexingRpcHandlers`)
- Electron `utilityProcess.fork` (host-implemented via `IEmbedderWorkerProcessFactory` — never `import 'electron'` here)

## Public API

Domain types: `Memory`, `MemoryChunk`, `MemoryId`, `ChunkId`, `MemoryTier`, `MemoryKind`, `MemoryInsert`, `ChunkInsert`, `MemorySearchHit/Response`, `MemoryListResponse`, `MemoryStatsResponse` + factories `memoryId`, `chunkId`.
Services: `MemoryStore`, `MemorySearchService`, `SalienceScorer`, `MemoryDecayJob`, `MemoryCuratorService`, `EmbedderWorkerClient`, `MemoryWriterAdapter`, `IndexingControlService`.
Helpers: `sha256Hex`, `formatSeedPrefix`, `parseSeedPrefix`, `deriveWorkspaceFingerprint`, `deriveGitHeadSha`.
DI: `MEMORY_TOKENS`, `MemoryDIToken`, `registerMemoryCuratorServices`.
Re-exports `ICuratorLLM`, `ExtractedMemoryDraft`, `ResolvedMemoryDraft` from `memory-contracts`.

## Internal Structure

- `src/lib/memory.store.ts` — CRUD + hybrid search SQL
- `src/lib/memory-search.service.ts` — RRF fusion, BM25 fallback
- `src/lib/salience-scorer.ts` — score recall→archival transitions
- `src/lib/memory-decay.job.ts` — registered with cron-scheduler
- `src/lib/memory-curator.service.ts` — PreCompact reactor; runs draft extraction → dedup → upsert
- `src/lib/memory-writer.adapter.ts` — `IMemoryWriter` implementation with prefix-line helpers
- `src/lib/control/indexing-control.service.ts` — workspace indexing pipeline (start/pause/resume/status)
- `src/lib/embedder/` — embedder worker process client (`EmbedderWorkerClient`,
  main-side proxy: lazy spawn, idle-teardown, respawn-on-exit, crash-loop
  guard), the host `IEmbedderWorkerProcessFactory` port, the `embedder-worker.ts`
  utilityProcess entry, and the shared `embedder-worker-protocol.ts`. The worker
  runs in a separate OS process (Electron `utilityProcess`), so a native ONNX
  `abort()` kills only the child; the client rejects in-flight requests and
  respawns on the next request — no permanent failed flag. Config
  (`modelCacheDir`) arrives only via the `init` message. On VS Code / CLI no
  factory is registered → the embedder is unavailable and search falls back to
  BM25-only (mirrors the voice-providers degrade).
- `src/lib/curator-llm/` — local copy of `ICuratorLLM` interface (re-exported)
- `src/lib/workspace-fingerprint.ts`
- `src/lib/di/{tokens,register}.ts`

## Dependencies

**Internal**: `@ptah-extension/memory-contracts`, `@ptah-extension/persistence-sqlite`, `@ptah-extension/platform-core`
**External**: `tsyringe`, sqlite + sqlite-vec (via persistence-sqlite)

## Guidelines

- All DB access via the shared connection from `persistence-sqlite` — never open new handles.
- `MemoryWriterAdapter.upsert` keys by stable `(fingerprint, subject)` identity — preserve this invariant.
- Curator runs are idempotent; dedup happens via cosine similarity (`SkillClusterDedup` pattern not used here — see salience-scorer).
- Indexing pipeline must accept `IndexingRunDeps` for testability — do not embed concrete services in the loop.
- `catch (error: unknown)`.

## Cross-Lib Rules

Used by `rpc-handlers` (memory + indexing). Should not import `rpc-handlers` or `agent-sdk` (only via `ICuratorLLM` port).
