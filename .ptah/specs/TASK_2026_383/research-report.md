# Research Report - TASK_2026_383

## Question

- Decision this supports: whether Batches 10 and 11 (Track C frontend/backend
  remedies) still need to be executed, given the re-measured boot numbers
  collapsed relative to the TASK_2026_380 baseline before either batch ran.
- Question: for each of the five planned Track C remedies, does the code on
  `task/383-degradation-audit` (based on `electron-cold-start-380`, PR #463)
  already do it — and separately, what does `openAndMigrate()` spend
  11.0-12.5 s on for a 1058 MB database?
- Bounds: did not re-run the boot measurement myself; did not investigate the
  frontend `autocomplete:agents` improvement beyond the two files named in the
  prompt; did not read every migration in `MIGRATIONS`, only the runner logic
  and the backup path it triggers.

## Answer

The leading hypothesis is **half right**: three of the five planned remedies
were already substantially addressed on the base branch by _different_
mechanisms than Track C planned (off-thread SDK spawns, CLI-detector
coalescing, a resolved-once git binary), which is why the numbers collapsed
without Track C's own changes landing. But the two remedies with the most
specific file-level plans — deleting the `ngOnInit` agent preload (10.1) and
routing `git:info` through `IProcessSpawner` (11.3) — are demonstrably **not**
done: the preload still runs at `agent-selector.component.ts:158-159`, and
`exec-git.ts` still calls `crossSpawn` inline with no `IProcessSpawner` in
sight. The dominant remaining cost, `openAndMigrate()`'s 11-12.5 s, is neither
a migration body, sqlite-vec load, nor `PRAGMA` work — it is the **pre-migration
backup** (`migration-runner.ts:88-101`) copying and validating the 1058 MB file
on a worker thread, which the doc comment in `persistence-sqlite/CLAUDE.md`
already pins at ~27 s inline on a 1 GB file before it was moved off-thread; the
28 RPCs answering OK during the window is exactly what "off the host's main
thread" predicts.

## Evidence

| Claim                                                                                                                                                                                                                                                         | Source                                                                                                                                                        | Date                                             | Verified how                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-selector.component.ts` still calls `preloadAgents()` from `ngOnInit`                                                                                                                                                                                   | `libs/frontend/chat-ui/src/lib/molecules/chat-input/agent-selector.component.ts:158-159`                                                                      | current branch                                   | read the file                                                                                                                                                     |
| `AgentDiscoveryFacade.fetchAgents()` has cache/generation/in-flight guards (`_isCached`, `_isLoading`, `_generation`) that make a repeated call cheap                                                                                                         | `libs/frontend/core/src/lib/services/agent-discovery.facade.ts:19-156`                                                                                        | current branch                                   | read the file                                                                                                                                                     |
| `ModelStateService` constructor still calls `this.loadModels()` at line 151                                                                                                                                                                                   | `libs/frontend/core/src/lib/services/model-state.service.ts:150-151`                                                                                          | current branch (unchanged since `7a0a8a948`)     | read the file, `git log`                                                                                                                                          |
| `SdkModelService.fetchModelsViaSdk` now spawns via `OffThreadProcessSpawner` instead of blocking the main thread                                                                                                                                              | `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts:264-265,576-650`; documented as TASK_2026_353 in `libs/backend/agent-sdk/CLAUDE.md`              | undated (CLAUDE.md), code present on branch      | read the file, cross-checked commit `096c1719f`/history                                                                                                           |
| `SessionLoaderService` still has only a 300 ms debounce (`loadSessions`/`_loadSessionsImmediate`), no shared in-flight promise across the two callers                                                                                                         | `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:171-192`                                                                            | current branch                                   | read the file                                                                                                                                                     |
| `ClaudeCliDetector` already coalesces detection (`detectionInFlight`) and `--version` probes (`probeVersion`, 30 s TTL, success-only cache)                                                                                                                   | `libs/backend/agent-sdk/CLAUDE.md` bullet on `ClaudeCliDetector`; commit `f7c8d6c7a` "cache auth status, dedupe CLI probes"                                   | undated / commit dated per branch history        | read CLAUDE.md doc, `git log -- claude-cli-detector.ts`                                                                                                           |
| No persisted cross-boot model catalog or CLI-health verdict exists — both caches are described as process-local in the same CLAUDE.md bullets                                                                                                                 | `libs/backend/agent-sdk/CLAUDE.md` ("Three read caches..." bullet); no `IStateStorage` references found in `sdk-model-service.ts` or `claude-cli-detector.ts` | undated                                          | grep for `IStateStorage` in both files returned nothing                                                                                                           |
| `exec-git.ts` resolves the git binary once (`gitCommand()`) but still spawns inline via `crossSpawn`, with no `IProcessSpawner`                                                                                                                               | `libs/backend/vscode-core/src/utils/exec-git.ts:15-57,141-211`; commit `fa1d2d92a` "resolve the git binary once instead of per spawn"                         | current branch / commit dated per branch history | read the file, `git log`                                                                                                                                          |
| `IProcessSpawner` / `SDK_PROCESS_SPAWNER` / `OffThreadProcessSpawner` are not referenced anywhere under `libs/backend/vscode-core/src`                                                                                                                        | grep across `libs/backend/vscode-core/src`                                                                                                                    | current branch                                   | grep returned no files                                                                                                                                            |
| `GitInfoService` coalesces in-flight identical calls for cacheable read methods but deliberately excludes `getGitInfo` itself from caching                                                                                                                    | `libs/backend/vscode-core/src/services/git-info.service.ts:244-267`                                                                                           | current branch                                   | read the file                                                                                                                                                     |
| `openAndMigrate()` no longer runs `quick_check`/`foreign_key_check` inline — that was measured at 1868 ms warm / 20-26 s cold on a 1 GB db and moved to an interval-gated, out-of-process check dispatched by `thoth-runtime` (TASK_2026_380)                 | `libs/backend/persistence-sqlite/CLAUDE.md` guideline bullet                                                                                                  | undated                                          | read CLAUDE.md, cross-checked `sqlite-connection.service.ts` has no quick_check call                                                                              |
| `SqliteMigrationRunner.applyAll` runs a **pre-migration backup** (`this.backupService.backup('pre-migration')`) whenever `pending.length > 0`, awaited before any migration SQL executes                                                                      | `libs/backend/persistence-sqlite/src/lib/migration-runner.ts:87-101`                                                                                          | current branch                                   | read the file                                                                                                                                                     |
| The backup+validation pair is worker-driven (`DbWorkerRunner`) off the host main thread as of TASK_2026_383, and the same copy+`quick_check` pair "measured ~27 s inline on a real 1 GB file, all of it on the boot path" before that move                    | `libs/backend/persistence-sqlite/CLAUDE.md`, `backup.service.ts` bullet                                                                                       | undated                                          | read CLAUDE.md; confirmed `backup.service.ts:237-294` calls `this.runner.run(...)` with `BACKUP_WORKER_BUDGET_MS` (20 min budget) rather than opening a DB itself |
| `openAndMigrate()` applies `PRAGMA`s (`journal_mode=WAL`, `foreign_keys=ON`, `synchronous=NORMAL`, `temp_store=MEMORY`, `mmap_size=256MiB`, `busy_timeout=5000`) and loads sqlite-vec, both logged as discrete debug steps before the migration runner starts | `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts:85-92,206-221`                                                                          | current branch                                   | read the file                                                                                                                                                     |

## Options

Not applicable in the usual sense — this report is a status audit of five
named remedies, not a comparison of implementation options. Per-item status:

| Remedy (Track C)                                | Status on this branch                                                                                                                                                                                                                                                                                                                                          | Evidence                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 10.1 Delete eager agent preload                 | **Not done.** `ngOnInit`→`preloadAgents()` is still present exactly as batches.md describes.                                                                                                                                                                                                                                                                   | `agent-selector.component.ts:158-174`                                           |
| 10.2 Drop constructor `loadModels()`            | **Not done.** Line 151 constructor call is unchanged. The measured drop (2296→1358-1626 ms) instead comes from the SDK-side spawn moving off-thread (TASK_2026_353), which removed the multi-second main-thread block but not the extra RPC.                                                                                                                   | `model-state.service.ts:150-151`; `sdk-model-service.ts:576-650`                |
| 10.3 Coalesce `session:list`                    | **Not done** on the frontend loader (still only a 300 ms debounce, no shared in-flight promise across the dashboard and chat-lifecycle callers). The 5-18 ms figure implies the improvement is elsewhere (backend-side session-dir/JSONL caching per `agent-sdk/CLAUDE.md`'s `JsonlReaderService` memoization), not the planned frontend single-flight change. | `session-loader.service.ts:171-192`                                             |
| 11.1 Persist SDK model catalog cross-boot       | **Not done.** `modelsCache`/`pendingModels` remain in-memory Maps with no `IStateStorage` read/write.                                                                                                                                                                                                                                                          | `sdk-model-service.ts:230-266`; grep for `IStateStorage` empty                  |
| 11.2 Persist CLI health verdict cross-boot      | **Not done**, but the in-process fix (single-flight detection + 30 s `--version` TTL) already collapsed the repeated-probe cost within one boot, which is most of what made `auth:getAuthStatus` fall to 0-1 ms.                                                                                                                                               | `agent-sdk/CLAUDE.md` `ClaudeCliDetector` bullet                                |
| 11.3 Route `git:info` through `IProcessSpawner` | **Not done.** Only the git-binary-resolution optimization (`fa1d2d92a`) landed; the spawn itself is still inline `crossSpawn`, matching the still-substantial 475-618 ms (down from 2476 ms, but far from the ~29 ms max-delay TASK_2026_341 achieved for the off-thread path).                                                                                | `exec-git.ts:141-211`; no `IProcessSpawner` reference anywhere in `vscode-core` |

## Disagreements

- The task prompt's hypothesis ("PR #463 already landed remedies that Track C
  was still planning to write") versus what the code shows: PR #463 (the
  `electron-cold-start-380` commits, e.g. `0c7e4d05c`, `ee6ad1d8a`,
  `4a00d8c74`, `156637eb2`, `5d0f0356b`) landed boot-screen/back-office and
  integrity-check-off-boot-path work — none of it is the five Track C items.
  The actual explanation for the collapsed numbers is a **different, earlier**
  set of fixes already merged into `main` before both #380 and #383 branched:
  TASK*2026_353 (off-thread SDK model/version spawns), TASK_2026_341 (off-thread
  CLI process spawns generally) and the CLI-detector/auth-status coalescing
  commit `f7c8d6c7a`. Batches.md's own file annotations (e.g. "PC-5", "PC-1")
  already anticipated some of this by pointing at exact still-open line numbers
  — the batch plan is not stale on autocomplete:agents/config:models-list/
  session:list being \_partially* fixed elsewhere, it is stale on assuming the
  fix routes were the ones Track C names.

## Local consequences

- `libs/frontend/chat-ui/.../agent-selector.component.ts`: Task 10.1 is still
  real work — the preload has not been touched by anything upstream.
- `libs/frontend/core/.../model-state.service.ts`: Task 10.2's one-line delete
  is still real work, but its measured payoff is now smaller than 380's
  baseline suggested, since the expensive part (the SDK spawn) is already
  off-thread. Re-measure the actual RPC-count/latency delta from deleting just
  line 151 before committing to the batch as originally scoped.
- `libs/frontend/chat/.../session-loader.service.ts`: Task 10.3 is still real
  work for the _frontend_ double-call, but the 5-18 ms figure implies the
  backend already answers cheaply after the first call in-boot; the batch's
  value is now about call-count hygiene, not the multi-second latency 380
  measured.
- `libs/backend/agent-sdk/.../sdk-model-service.ts` and
  `claude-cli-detector.ts`: Tasks 11.1/11.2 (cross-boot persistence) are still
  fully unimplemented — every existing cache resets on process restart. Their
  payoff is now bounded by "first RPC of THIS boot," not "first RPC ever,"
  which is a smaller number than 380's baseline implied but still nonzero
  (1358-1626 ms and low-hundreds ms respectively per the re-measurement table).
- `libs/backend/vscode-core/src/utils/exec-git.ts` and `git-info.service.ts`:
  Task 11.3 is still real work and is the largest remaining gap of the five —
  `git:info` dropped only ~2.5-5x, not the ~50x TASK_2026_341 achieved for
  off-thread CLI spawns generally, because the off-thread mechanism was never
  applied here.
- `libs/backend/persistence-sqlite/src/lib/migration-runner.ts:87-101` and
  `backup.service.ts`: the `openAndMigrate()` cost is a **pre-migration
  backup**, not the migration bodies, sqlite-vec, or `PRAGMA` work. This only
  fires when `pending.length > 0` — i.e., the 1058 MB test database had at
  least one unapplied migration when measured. This is a separate, real cost
  center from anything in Batches 10/11 and is out of Track C's stated scope
  (frontend eager-fetch + git/model/session backend remedies); it is not
  something either batch's file list touches.

## Unknowns

- Whether the 1058 MB test database actually had a pending migration at
  measurement time (which would explain why the backup fired) or whether
  `pending.length > 0` for some other reason (e.g., a genuinely new
  installation copying an old snapshot) — I did not have access to the
  measurement run's logs, only the code path that would produce this
  behavior. The smallest experiment: grep the boot log for
  `"pre-migration"` or `"migrations applied"` around the `openAndMigrate`
  window; if `appliedVersions` is non-empty and `skippedVersions` is large,
  this confirms a pending-migration backup was the trigger.
- Whether the backup's ~11-12.5 s wall time on this box is consistent with
  the CLAUDE.md's ~27 s inline figure for the same class of file (which
  predates the worker move) — I could not re-run the measurement myself, so I
  cannot say whether the off-thread version is simply faster in wall-clock
  terms, or whether the ~11-12.5 s is a partial (copy-only, no validation)
  cost. Reading `backup.service.ts` around lines 237-294 for the actual
  `DbWorkerRunner.run()` protocol and correlating with `tmp/logs/log.log`
  timestamps around `openAndMigrate` would settle this.
- Whether `autocomplete:agents`'s drop to 5-7 ms is fully explained by
  `AgentDiscoveryFacade`'s cache (i.e. the dropdown had already been opened
  once earlier in the same boot window by test tooling) or by some other
  factor — I read the cache mechanism but did not trace the actual RPC-arrival
  sequence in the measurement log.
