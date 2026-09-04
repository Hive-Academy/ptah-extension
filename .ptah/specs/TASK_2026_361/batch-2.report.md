# Batch 2 report — persistence, analysis, trace, and abortable services

Executor: backend-developer. Scope: Task 2.1 of `batches.md`, built on the
uncommitted Batch 1 types. All work is in `libs/backend/agent-generation`.

## Files

Created:

- `src/lib/services/analysis-storage.service.spec.ts` — 29 tests.
- `src/lib/services/wizard/multi-phase-analysis.service.spec.ts` — 14 tests.
- `src/lib/services/wizard/analysis-run-checkpoint.ts` — collaborator extracted
  under the facade rule (see below).

Modified:

- `src/lib/services/analysis-storage.service.ts`
- `src/lib/services/wizard/multi-phase-analysis.service.ts`
- `src/lib/services/enhanced-prompts/enhanced-prompts.service.ts`
- `src/lib/services/content-generation.service.ts`
- `src/lib/services/file-writer.service.ts`
- `src/lib/services/orchestrator.service.ts`
- `src/lib/services/enhanced-prompts/enhanced-prompts.service.spec.ts`
- `src/lib/services/content-generation.service.spec.ts`
- `src/lib/services/file-writer.service.spec.ts` (rewritten on the in-memory
  `IFileSystemProvider` mock; the old `fs/promises` mocks are gone)
- `src/lib/services/orchestrator.service.spec.ts`
- `src/lib/types/core.types.spec.ts` (orchestrator grant: fixture gains the new
  `GenerationSummary` fields)
- `package.json` of the lib (outside the list; see Deviations)

Not touched: `lib/di/register.ts`, `src/index.ts`, every file under
`libs/backend/rpc-handlers` and `libs/frontend/setup-wizard`, all Batch 1 type
files.

## What each service change does

### AnalysisStorageService (551 lines)

- Now the only owner of `.ptah/analysis` I/O. Constructor gains
  `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`; every `fs/promises` call is gone.
  Parent directories are created explicitly through the port before every
  first write (`writePhaseFile`, `writeManifest`, `writeGenerationManifest`,
  `writeEnhancedPromptTrace`).
- Version-3 manifest: `writeManifest` and `loadManifest`. Every read goes
  through `MultiPhaseManifestSchema.safeParse`; a version-2, malformed-JSON or
  schema-invalid manifest returns `null` and is never deleted.
- Generation checkpoint: `getGenerationManifestPath`,
  `writeGenerationManifest`, `loadGenerationManifest` (Zod-validated) and
  `updateGenerationManifest`. The path is `<slug>/generation-manifest.json`,
  or `<root>/generation-manifest.json` when the run has no slug.
- `findLatestResumableRun` returns the newest run (by `updatedAt`) whose
  analysis lifecycle is not `completed` or whose generation checkpoint is not
  `completed`, and falls back to a slug-less root checkpoint. Read-only.
- `resolveAuthorizedAnalysisDir(workspace, candidate)` canonicalizes an
  absolute or workspace-relative path and returns `null` for `..` escapes and
  absolute paths outside `<workspace>/.ptah/analysis`. Batch 3 uses it at the
  RPC boundary.
- `writeEnhancedPromptTrace(workspace, analysisDir | null, prompt, metadata)`
  writes `enhanced-prompt.md` and `enhanced-prompt.json` into the slug
  directory or the analysis root, and throws on failure.
- `ensureSlugDir` (non-destructive, for resume) sits beside the unchanged
  destructive `createSlugDir` (fresh runs). `phaseFileExists` replaces the
  `fs.access` probe the analysis service used. `list`, `loadMultiPhase` and a
  new `toResponse` helper emit the v3 wire fields.

### MultiPhaseAnalysisService (877 lines) + AnalysisRunCheckpoint (211 lines)

- `executePhase` returns `{ resultReceived, timedOut, assistantText, error? }`.
  Text is captured inside `createTextCapturingStream` from complete `assistant`
  messages (concatenated `text` blocks) plus the successful `result` text; the
  throttled `SdkStreamProcessor` emitter is UI-only. The lossy `textChunks`
  fallback is deleted (a spec proves an emitter delta never reaches disk).
- A phase is `completed` only when a successful result arrived and the phase
  file exists or is created from the complete captured text. `analysis_timeout`,
  a stream that ended without a result, an error result or a thrown stream
  error all produce `failed` with a non-empty error; captured text is still
  written to the phase file for diagnosis.
- `cancelAnalysis` is a pause: lifecycle `paused`, the active phase back to
  `pending` with its partial file kept, later phases `pending`, no deletion.
- `options.resume === true` loads the slug's v3 manifest through
  `ensureSlugDir`, normalizes stale `running` to `pending`, skips only
  `completed` phases and keeps `runId` and `model`. Without a resumable
  manifest the call falls back to a fresh run (new `ulid()` `runId`).
- Checkpoints are written before phase 1, on every `pending -> running`, after
  every terminal transition, and at pause/finish. `finish` sets `completed`
  when every phase completed and `failed` otherwise, so a run with a failed
  phase stays discoverable for resume. A checkpoint-write failure before phase
  1 returns `Result.err` with no SDK call.
- Facade rule: `MultiPhaseAnalysisService` keeps its name, token and
  `analyzeWorkspace`/`cancelAnalysis` signatures. The manifest bookkeeping
  (open fresh or resumed, mark running/completed/failed, pause, finish,
  persist with `updatedAt`/`totalDurationMs`) moved into the composed
  `AnalysisRunCheckpoint`, which knows nothing about the SDK stream. The file
  still exceeds the 700-line soft ceiling because the UI stream-to-flat-event
  conversion (about 300 lines) stayed in place; it was not part of this batch.

### EnhancedPromptsService (1,233 lines)

- `enrichWithMultiPhaseAnalysis` returns
  `{ analysisDirectory: string | null; phaseIds: string[] }` — completed
  phases whose content was loaded, nothing else.
- After `generatedPrompt` and `configHash` exist and BEFORE `stateStore.save`
  and `cacheService.set`, the trace is written through the injected
  `AnalysisStorageService` (`AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE`,
  typed as a `Pick<..., 'writeEnhancedPromptTrace'>`). Metadata:
  `generatedAt`, `configHash` (`''` when unavailable), `detectedStack`,
  `analysisDirectory` (workspace-relative, posix separators, or `null`),
  `analysisPhaseIds`, `promptLength`. A trace failure returns
  `success: false`, updates no state and no cache, and releases the lock.
  `regenerate` goes through the same path with the latest slug.
- The constructor gains one parameter; the spec factory passes an eighth mock.
  `setAnalysisReader` is unchanged.

### ContentGenerationService (1,115 lines)

- `fillDynamicSections` links `sdkConfig.abortSignal` to the per-call
  controller before `InternalQueryService.execute` and removes the listener in
  `finally`. An already-aborted signal throws before the SDK is called.
- An external abort rethrows `GenerationAbortedError` (also when the stream
  ended quietly after the abort); `generateContent` rethrows it instead of
  returning `Result.err`, so the orchestrator never writes fallback content
  after a cancel or watchdog timeout. Internal failures still fall back.
- Returns `{ content, warnings, rejectedSections, tailoredSections }`:
  rejections are validator rejections only; tailored counts accepted, non-empty
  LLM replacements (LLM and VAR sections).

### AgentFileWriterService (399 lines)

- Constructor gains `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`; `fs/promises` is
  gone. `writeAgent` creates the parent directory through the port, reads the
  target, returns `{ filePath, status: 'unchanged' }` without writing when the
  bytes match, otherwise writes and returns `'written'`.
- `writeAgentsBatch` returns one result per agent and, on a later failure,
  rolls back only files this batch newly wrote (`unchanged` files pre-existed).

### AgentGenerationOrchestratorService (1,262 lines)

- Consumes the canonical `OrchestratorGenerationOptions` from `core.types.ts`
  and re-exports the type, so `src/index.ts` is unchanged.
- Phases 3 and 4 are one per-agent loop (`produceAgents`): the abort signal is
  checked before each render and before each write; a rendering abort is
  caught; remaining agents become `failed` outcomes with
  `not generated: <reason>`; `options.onAgentOutcome` fires once per terminal
  outcome; `abortSignal` is forwarded in the SDK config.
- `GenerationSummary` gains `outputDirectory`, `writtenCount`,
  `unchangedCount`, `failedCount`, aggregated `rejectedSections` /
  `tailoredSections`, `lifecycle` (`timed-out` for reason
  `generation_timeout`, `paused` for any other abort, `completed` /
  `failed` otherwise) and `outcomes`. `agents: GeneratedAgent[]` is kept.
  Without an abort, the two existing `Result.err` cases ("No agents were
  successfully rendered", "All agent file writes failed") are preserved.

## Spec coverage added

- analysis-storage: authorized-dir canonicalization (accept/reject), destructive
  vs non-destructive slug creation, v3 round-trip, v2 / malformed / failed-
  without-error rejection with the file untouched, generation checkpoint
  create/load/update and root fallback, resumable-run discovery (latest,
  completed-analysis-with-unfinished-generation, all-complete, v2 ignored,
  root fallback), trace with slug and with fallback root, trace failure,
  `list` / `loadMultiPhase`.
- multi-phase-analysis: success with agent-written file plus checkpoint
  sequence; file created from full captured text; no result; error result;
  timeout under fake timers with diagnostic text kept; pause; resume skipping
  completed and restarting stale `running` with `runId` kept and no delete;
  resume fallback to fresh; v2 not resumed; first-checkpoint failure starts no
  SDK work; progress broadcast.
- enhanced-prompts: trace written before state save with slug and only
  completed phase IDs; fallback root with `null`; trace failure blocks state
  and cache; regenerate traces into the latest slug.
- content-generation: external abort reaches the SDK controller and rethrows;
  quiet stream end after abort rethrows; pre-aborted signal skips the SDK;
  listener removed; rejected/tailored counts; zero counts on no output;
  internal failure still falls back.
- file-writer: written vs unchanged, parent directory before write, batch
  mixed statuses, rollback of newly written files only, plus the ported error
  and path-security cases.
- orchestrator: abort signal in SDK config; abort during rendering writes
  nothing and pauses; abort after the first write stops later writes and
  reports timed-out; mixed written/unchanged/failed aggregation with section
  counts and output directory; `onAgentOutcome` once per agent in order;
  failed template load as a failed outcome.

## Commands run

1. `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation @ptah-extension/shared --skip-nx-cache`
   — header `Running targets typecheck, lint for 2 projects`; PASS.
   shared: 0 errors, 1 pre-existing warning. agent-generation: 0 errors,
   419 warnings (390 before this batch; the 29 new ones are all
   `@typescript-eslint/no-non-null-assertion` in the new spec code and the
   writer, the same style the surrounding code uses).
2. `npx nx run-many -t test -p @ptah-extension/agent-generation @ptah-extension/shared --skip-nx-cache`
   — header `Running target test for 2 projects`; PASS.
   shared: 49 suites / 1,216 tests. agent-generation: 30 suites / 947 tests
   (was 28 passing suites / 717 tests with 4 red suites after Batch 1).
3. `npx prettier --write` on all 14 touched TypeScript files — PASS.
4. `git diff --check -- libs/backend/agent-generation` — clean.

No git commit, stash, checkout or reset was run.

## Deviations

- `libs/backend/agent-generation/package.json` gained `"ulid": "2.3.0"`. It is
  outside the batch file list, but the `@nx/dependency-checks` lint rule made
  the missing entry a lint ERROR once the service imported `ulid` (which the
  batch instructions asked for). One line, no version change (the root pin).
- The enhanced-prompt trace is written through `AnalysisStorageService`
  (injected by constructor), as the batch instructions require, rather than by
  an `IFileSystemProvider` injected into `EnhancedPromptsService` as the
  implementation plan section 2 suggested. This keeps one owner for
  `.ptah/analysis` writes.
- `EnhancedPromptsService` does not itself authorize an explicit `analysisDir`;
  the plan assigns that to the RPC handler (Batch 3), which should call
  `AnalysisStorageService.resolveAuthorizedAnalysisDir` before the service is
  reached. The existing spec that passes an out-of-workspace explicit
  directory therefore still passes.
- `resume: true` with no resumable v3 manifest (missing, malformed, version 2,
  or already `completed`) falls back to a FRESH run, and a fresh run still
  recreates the slug directory (the pre-existing destructive `createSlugDir`).
  Read paths (`loadManifest`, `findLatest*`) never delete; only an explicit or
  fallback fresh run does. This matches the batch instruction.
- Analysis lifecycle after a finished pipeline is `completed` only when every
  phase completed; otherwise `failed`. The manifest type had no "completed
  with failures" state, and `failed` keeps such a run discoverable by
  `findLatestResumableRun` so its failed phases can be re-run.
- No `AbortSignal.any` is used; the content-generation link is a manual
  listener removed in `finally`, so the caller's signal is never mutated.

## Notes for Batch 3

- `AnalysisStorageService` new public API: `resolveAuthorizedAnalysisDir`,
  `ensureSlugDir`, `phaseFileExists`, `getGenerationManifestPath`,
  `writeGenerationManifest`, `loadGenerationManifest`,
  `updateGenerationManifest`, `findLatestResumableRun`,
  `writeEnhancedPromptTrace`, `toResponse`.
- `MultiPhaseAnalysisService.analyzeWorkspace` now returns `Result.ok` with
  lifecycle `paused` on cancel (previously phases were marked `skipped`).
- Composition roots must provide `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` before
  `AnalysisStorageService`, `AgentFileWriterService` or `EnhancedPromptsService`
  are resolved; `batches.md` records this as already true for all three.

## Blocked

None.
