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
- `src/lib/curator-llm/` — local copy of `ICuratorLLM` interface (re-exported),
  the last-resort `clamp-transcript.ts` guard, the pure `transcript-windows.ts`
  windowing module and the `CuratorWindowRunner` collaborator
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
- **The curator prompt cap lives in `MemoryCuratorService.doCurate`, not at any call site** (`curator-llm/clamp-transcript.ts`, `CURATOR_TRANSCRIPT_MAX_CHARS` = 32 KB). TASK_2026_367 changed the SHAPE of that bound to a window set (see the next bullet) but not its place — the method is now `windowForModel` and the clamp described here is the last-resort guard inside it. It is there because the fault it closes WAS a call site that forgot. `MAX_JSONL_BYTES` inside `composeTranscript` bounds the live trigger path only; the boot scan called `transcriptReader.read()` with no `tailBytes` AND skipped `composeTranscript`, so a 268-turn session reached the model as a 170 655-character prompt (`tmp/logs/log.log:1017`, TASK_2026_352). Nothing below defends — the curator adapter forwards `prompt` verbatim and `SdkQueryRunner` only logs its length. Every entry (PreCompact, boot scan, `memory:rebuildIndex`, `curateNow`) funnels through `doCurate`, which is what makes the cap unbypassable. `clampTranscript` keeps HEAD and TAIL with a 25/75 split and an explicit elision marker: a tail-only window is right for a compaction transcript, where the caller knows the head was summarised, and wrong for a whole session, where the opening turns carry the user's stated goal — exactly the durable knowledge `EXTRACT_SYSTEM_PROMPT` asks for. The tail takes the larger share because it holds the outcome plus the bounded `# Structured observations` / `# Episode summary` sections. The marker is not decoration: splicing two disjoint halves with no seam invites the model to infer a causal link the session never contained. It is budgeted against an UPPER BOUND (`buildMarker(originalChars, originalChars)`) so the real marker always fits and never forces a post-hoc tail trim — which is what keeps the number the marker PRINTS equal to the `droppedChars` the function REPORTS. The boot-scan `read()` now also passes `TRANSCRIPT_TAIL_BYTES`, matching the live path, so the oversized string is never read off disk in the first place.
- **The curator budget is stated in LLM CALLS, not characters** (`curator-llm/transcript-windows.ts`, TASK_2026_367). `doCurate` no longer clamps a transcript to one 32 KB prompt. It calls `windowForModel`, which runs `compressToolNoise` (tool_result body → 600 characters, Bash command → 80, the same two figures `TranscriptWindowReader` uses) and then, only if the compressed text still does not fit, splits it into at most `CURATOR_MAX_WINDOWS` = 8 record-boundary windows of `CURATOR_WINDOW_MAX_CHARS` each — imported from `clamp-transcript.ts`, never re-declared, because a window IS one model prompt. **The ceiling is 9 calls per pass: 8 `extract` plus 1 `resolve`.** The common case is unchanged at 2: a transcript that fits after compression produces exactly ONE window, byte for byte, so an ordinary session costs what it always cost. That short-circuit is an explicit branch in `planCuratorWindows`, and a spec pins it. `clampTranscript` still runs, at `CAP * MAX_WINDOWS`, and is now the LAST-RESORT guard: its warn means "this session exceeded even the chunked budget", which raised worst-case coverage on the 366 540-character sample from 8.8 percent to at least 71 percent. `CuratorWindowRunner.extractAcrossWindows` spends the calls sequentially — the windows share one provider and one quota gate — checks `signal.aborted` BETWEEN windows, abandons the run on a throw, stops on `status: 'stalled'`, and unions the drafts while dropping exact-duplicate `(subject, content)` pairs before the single `resolve`. Never silently curate a partial transcript: a partial extraction that looks complete is worse than a recorded failure.
- **The boot scan is ARMED, not run, by `start()`** (`memory.triggers.bootScanDelayMs`, default 5 min; `memory.triggers.bootScanIdleBackoffMs`, default 5 min). Its callback calls `curator.curate` INLINE — one LLM round trip per eligible session, bounded only by a 200 ms throttle and the hourly limiter — so firing it from `start()` put every one of those calls in the first seconds after launch (`tmp/logs/log.log:676,678`), beside skill-synthesis drains that ran 122 s and 156 s on the same boot. None of it is urgent: every session it reads ended before the process existed. The delay and the re-arm answer DIFFERENT questions — "has the host settled" (a clock question) and "is the user working right now" (an activity question) — and both are needed, because `lastActivityAt` is `null` at boot exactly as `ForegroundActivityTracker` reports `Infinity`, so an activity check alone would always pass at the worst moment. The re-arm is unbounded on purpose: it only continues while chat activity keeps arriving, so it terminates as soon as the user stops. The activity stamp sits ABOVE `onActivity`'s `idleMs` guard — `idleMs <= 0` disables the per-session idle TIMER, it does not mean the user stopped typing. `stop()` clears the timer; the timer is `unref`'d so a pending scan cannot hold the process alive.
- `catch (error: unknown)`.

## Cross-Lib Rules

Used by `rpc-handlers` (memory + indexing). Should not import `rpc-handlers` or `agent-sdk` (only via `ICuratorLLM` port).
