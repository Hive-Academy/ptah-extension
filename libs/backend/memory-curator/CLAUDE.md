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
  windowing module, the `CuratorWindowRunner` collaborator, the
  `CuratorJobQueue` pass serialiser and the `queue-slot-timeout.ts` congestion
  helpers
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
- **The curator budget is stated in LLM CALLS, not characters** (`curator-llm/transcript-windows.ts`, TASK_2026_367). `doCurate` no longer clamps a transcript to one 32 KB prompt. It calls `windowForModel`, which runs `compressToolNoise` (tool_result body → 600 characters, Bash command → 80, the same two figures `TranscriptWindowReader` uses) and then, only if the compressed text still does not fit, splits it into at most `CURATOR_MAX_WINDOWS` = 8 record-boundary windows of `CURATOR_WINDOW_MAX_CHARS` each — imported from `clamp-transcript.ts`, never re-declared, because a window IS one model prompt. **The ceiling is 9 calls per pass: 8 `extract` plus 1 `resolve` — except on a MANUAL PreCompact, where it is 2 (see the next bullet).** The common case is unchanged at 2: a transcript that fits after compression produces exactly ONE window, byte for byte, so an ordinary session costs what it always cost. That short-circuit is an explicit branch in `planCuratorWindows`, and a spec pins it. `clampTranscript` still runs, at `CAP * MAX_WINDOWS`, and is now the LAST-RESORT guard: its warn means "this session exceeded even the chunked budget", which raised worst-case coverage on the 366 540-character sample from 8.8 percent to at least 71 percent. `CuratorWindowRunner.extractAcrossWindows` spends the calls sequentially — the windows share one provider and one quota gate — checks `signal.aborted` BETWEEN windows, abandons the run on a throw, stops on `status: 'stalled'`, and unions the drafts while dropping exact-duplicate `(subject, content)` pairs before the single `resolve`. Never silently curate a partial transcript: a partial extraction that looks complete is worse than a recorded failure.
- **A MANUAL PreCompact plans ONE window; only that path narrows (TASK_2026_374).** `start()` passes `maxWindows: 1` when the fan-out payload says `trigger: 'manual'`, so a hand-typed `/compact` costs 2 LLM calls instead of up to 9. The figure it is answering: a 372-event / 333 538-token session split into eight windows and spent them at 24, 37 and 27 seconds apiece — `extractAcrossWindows` is sequential by design and the `memory-curator` internal-query lane has a per-lane concurrency of 1 — so roughly four minutes of background `claude.EXE` ran on the same account and quota as the compaction the user was standing there waiting for. Automatic threshold compaction keeps the full eight, because nobody is waiting on it and the middle-of-session coverage is the whole point of the chunked budget. **A caller may only LOWER the ceiling.** `clampWindowBudget` (`curator-llm/curator-window-runner.ts`) forces any supplied value into `[1, CURATOR_MAX_WINDOWS]` inside `planWindows`, which is what keeps `doCurate`/`windowForModel` THE one place a transcript is bounded — a parameter a call site could widen would not be a bound, it would be a suggestion, and a call site getting the bounding wrong is the exact fault TASK_2026_352 closed. The clamp sits in `planWindows` rather than in `windowForModel` because `planWindows` is the single seam between the service and the pure windowing module. Do not narrow any other entry point (boot scan, `memory:rebuildIndex`, `curateNow`, the trigger service) without the same kind of evidence. **The clamp report is logged at two levels and that split is load-bearing**: at the full budget it stays a `warn` reading "exceeded the chunked curation budget", which is rare and means the session defeated every cheaper defence; under a narrowed budget it is an `info` reading "clamped to the narrowed curation budget", because at one window every long session trips it on every manual compaction, and a warn that fires on the expected path trains people to ignore the line still carrying the rare signal. Both payloads carry `budgetWindows` so the two are distinguishable in a log without reading the message text.
- **ONE curation pass at a time, and a lost concurrency slot is a DEFERRAL rather than a failed run (TASK_2026_376 F4).** `curate()` submits every pass through `CuratorJobQueue` (`curator-llm/curator-job-queue.ts`), a promise chain on the singleton service. The fault it closes: a transcript costs up to eight SEPARATE one-shot queries on the `memory-curator` internal-query lane, spent sequentially, so the pass RELEASES its slot between window N and window N+1. With a second pass queued behind it the gate's FIFO scan admits that waiter the instant window N releases, window N+1 goes to the back behind a whole competing query, and a wait past `ptah.internalQuery.queueTimeoutMs` (60 s) is rejected with `InternalQueryQueueTimeoutError`. Measured 2026-09-03: one session split into three windows while two OTHER sessions (`ff10bd1d-…`, `83aca9e8-…`) reported `extracted: 0` with their `observation_queue` rows already marked processed. Serialising costs no throughput — `lane: 'memory-curator'` has exactly one call site and a per-lane ceiling of one, so two passes were already serialised BY THE GATE, one query at a time, with a destructive 60 s ceiling on each wait. This moves the same waiting one level up, where it is ordered and loses nothing. **Do not fix this by raising `maxConcurrentPerLane` or `maxConcurrent`** — the per-lane ceiling is the load-bearing half of TASK_2026_352 and raising it lets the curator claim both global slots and starve skill-synthesis. This is not a second semaphore either: it admits nothing and counts no slots, and every query it releases still faces the one gate with the one admission predicate. The residual case the queue cannot cover is the GLOBAL ceiling — two unrelated lanes holding both slots — so a queue timeout is retried on the same query against `QueueSlotRetryBudget`, ONE allowance of 2 shared by every extract window and the resolve call of a pass, with no delay because a FIFO wait IS the backoff. When the allowance is gone the pass returns `outcome: 'stalled'` (`recordCuratorDeferral`), NOT `'ran'`: nothing dispatched, so `MemoryTriggerService` leaves the observation rows unprocessed and `BootScanRunner` leaves the watermark, and the next drain curates the session. The timeout is recognised by ERROR NAME through the `cause` chain (`curator-llm/queue-slot-timeout.ts`) because `InternalQueryQueueTimeoutError` lives in `agent-sdk`, which depends on this lib — the same convention the curator adapter already uses for `ProviderAuthError` and `ProviderQuotaError`.
- **The boot scan is ARMED, not run, by `start()`** (`memory.triggers.bootScanDelayMs`, default 5 min; `memory.triggers.bootScanIdleBackoffMs`, default 5 min). Its callback calls `curator.curate` INLINE — one LLM round trip per eligible session, bounded only by a 200 ms throttle and the hourly limiter — so firing it from `start()` put every one of those calls in the first seconds after launch (`tmp/logs/log.log:676,678`), beside skill-synthesis drains that ran 122 s and 156 s on the same boot. None of it is urgent: every session it reads ended before the process existed. The delay and the re-arm answer DIFFERENT questions — "has the host settled" (a clock question) and "is the user working right now" (an activity question) — and both are needed, because `lastActivityAt` is `null` at boot exactly as `ForegroundActivityTracker` reports `Infinity`, so an activity check alone would always pass at the worst moment. The re-arm is unbounded on purpose: it only continues while chat activity keeps arriving, so it terminates as soon as the user stops. The activity stamp sits ABOVE `onActivity`'s `idleMs` guard — `idleMs <= 0` disables the per-session idle TIMER, it does not mean the user stopped typing. `stop()` clears the timer; the timer is `unref`'d so a pending scan cannot hold the process alive.
- `catch (error: unknown)`.

## Cross-Lib Rules

Used by `rpc-handlers` (memory + indexing). Should not import `rpc-handlers` or `agent-sdk` (only via `ICuratorLLM` port).
