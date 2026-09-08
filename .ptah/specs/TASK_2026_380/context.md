# TASK_2026_380 — Unfreeze Electron cold start

## User intent

> "The first initial load took lots of time and the application was quite unusable. I'm thinking we need to show something like a loading spinner or a way to offload the work that happens into a proper UI and UX loading experience that truly solves the issue in 2 ways: performance-wise and user-experience-wise."

Source evidence: `C:\Users\abdal\AppData\Roaming\Ptah\logs\Ptah Electron-2026-09-05.log` (two boots, 15:18 and 19:54, identical shape).

## Measured timeline (boot 1, main process)

| Time                 | Event                                                                                                                                  | Main thread blocked                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 15:18:45.4           | DI registration done                                                                                                                   |                                          |
| 15:18:47.3           | RPC surface up, MCP started, CLI detection begins                                                                                      | 2.4 s lag at :49.7                       |
| 15:18:53.7           | Window created (`UpdateManager.start` marks post-window)                                                                               |                                          |
| 15:18:53.7           | `openAndMigrate` starts on 986 MB `ptah.sqlite`                                                                                        |                                          |
| 15:19:17.2           | `quick_check passed`                                                                                                                   | **25.8 s lag**                           |
| 15:19:19.0           | SKILL.md migration walked 2567 + 2566 files, `skippedByMarker:false`                                                                   | ~1.7 s                                   |
| 15:19:19.8           | Renderer RPCs finally answered. `chat:resume` 5761 ms, `config:models-list` 3047 ms, `autocomplete:agents` 2039 ms, file index 3005 ms | 1.8 s lag                                |
| 15:19:30 to 15:21:00 | Skill boot scan enqueues ~45 sessions (`source:"boot"`)                                                                                | **1.4 to 2.2 s lag every ~2 s for 90 s** |

Boot 2: `quick_check` 20.0 s, 20.7 s lag, same slow handlers.

Window is on screen from :53.7 but the main process is frozen until :19.8, so every renderer RPC waits ~26 s. Then the UI stutters for another ~90 s.

## Root causes (ranked)

1. **`PRAGMA quick_check` on every boot, synchronous, on the main process.** `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts:602-635` (`runBootChecks`) is called from `openAndMigrate` (`:214`). better-sqlite3 is synchronous; on a 986 MB file it reads the whole database. 20–26 s per launch, blocks every IPC reply. Result never changes between boots. ~70 % of the freeze.

2. **Readiness contract exists but is unwired.** `libs/shared/src/lib/types/rpc/rpc-readiness.types.ts` and `MESSAGE_TYPES.BOOT_READINESS_CHANGED` shipped in TASK_2026_331 B2A.T1/T2, but B2A.T3–T5 and all of B2B were cancelled ("premise refuted"). `isRpcReadinessError`, `rpcReadinessError`, `boot:readinessChanged` have zero callers outside `libs/shared`. `BootCoordinator.readiness` (`apps/ptah-electron/src/activation/boot-coordinator.ts:188-227`) is never broadcast. The renderer (`apps/ptah-extension-webview/src/app/app.html:4-13`) shows a generic spinner until `handleInitialView` resolves, then paints the shell whose panels silently wait on a frozen RPC.

3. **Skill boot scan fires immediately in `start()`, memory boot scan waits 5 min.** `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:166-169` runs `runBootScan` synchronously at start. Memory curator arms its scan with `memory.triggers.bootScanDelayMs` (default 5 min) and re-arms on foreground activity. The skill scan has only a boolean (`skillSynthesis.triggers.bootScan`). Each session enqueue costs ~1.5 s of main-thread time (streamed JSONL extract + `BEGIN IMMEDIATE` insert on the 986 MB DB); 45 sessions ≈ 90 s of ~80 % blocked event loop, exactly when the user tries the first interaction. Which half of the 1.5 s is synchronous needs a CPU profile (`CPU_PROFILE_CAPTURE` exists); the delay fix does not depend on that answer.

4. **SKILL.md migration walk ran despite the 0041 marker** (`skippedByMarker:false` on both boots, both roots). Either the marker row is never written (walk had errors? — log shows `errors:[]`) or the 24 h age ceiling expired. ~1.7 s sync I/O. Check `skill_md_migration_state` rows and the write condition in `skill-md-migration.ts`.

5. **Pre-window path has a 2.4 s lag** during CLI detection (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/fix-path.ts:68` uses `spawnSync`; adapters shell out to `where`). Window appears 8.3 s after process start. Lower priority.

## Proposed fix — two tracks

### Track A — performance (backend)

- **A1.** Move `quick_check` off the boot path. Preferred: run it in the existing daily backup cron job (`SqliteBackupService` / `startThothCron`) or in a `utilityProcess`, persist last-check timestamp + result in a small table, and skip it at boot when the last clean check is < 7 days old. Boot keeps `foreign_key_check` only (index-driven, cheap) or skips both under the same rule. Expected gain: ~22 s per launch.
- **A2.** Add `skillSynthesis.triggers.bootScanDelayMs` mirroring `memory.triggers.bootScanDelayMs` (+ idle backoff), armed with an `unref`'d timer, re-armed on foreground activity. Expected gain: the 90 s stutter moves to idle time.
- **A3.** Diagnose and fix the SKILL.md marker miss.
- **A4.** (Optional) capture a boot CPU profile to confirm the per-session 1.5 s source.

### Track B — user experience (frontend + coordinator)

- **B1.** `BootCoordinator` broadcasts `boot:readinessChanged` via `WebviewManager` on every transition. Extend `BootReadinessChangedPayload` with a `phase` label (`database`, `skills`, `sessions`, `index`, …) and optional detail (e.g. DB size). One message type already exists.
- **B2.** New `BootStatusService` in `libs/frontend/core` (signal + `MESSAGE_HANDLERS` entry) reading that message; `db:health` poll as first-paint fallback.
- **B3.** Replace the generic spinner in `app.html` with a staged boot screen (logo, phase list with checkmarks, elapsed time, human copy such as "Checking a 986 MB database"). Shell still paints early; SQLite-backed panels render skeletons bound to `bootStatus()` instead of empty states.
- **B4.** Guard the SQLite-backed startup RPCs (`chat:resume`, `memory:*`, `skillSynthesis:*`, `session:list` post-import) with `rpcReadinessError` while the persistence gate is unsettled; frontend retries on `retryAfterMs` or on the readiness push. Revives cancelled B2A.T4 + B2B.T1.

**Ordering constraint:** Track B cannot animate while `quick_check` holds the main thread — A1 is a prerequisite for any status UI to be visible, or `quick_check` must move to a worker in the same batch.

## User decisions (Checkpoint 1.5 / 0.1)

- **quick_check placement: mix of "daily cron + 7-day skip" and "utilityProcess".** Concretely: the integrity check NEVER runs inline on the main process. Boot reads a persisted last-clean-check record; when it is < 7 days old the check is skipped. When it is due (absent, stale, or a prior failure), the check runs in a separate process (Electron `utilityProcess`, following the existing `embedder-worker.mjs` / `voice-worker.mjs` pattern) against its own read-only connection, and the result + timestamp is persisted when it completes. The nightly cron job is the scheduled owner of "is it due"; boot only triggers the same dispatch when due, never awaits it. Hosts without a worker factory (VS Code, CLI) fall back to the cron/skip rule with an in-process check off the boot path (e.g. `setImmediate` after readiness, or skip entirely) — the architect decides.
- **CLI delegation: disabled.** Sub-agents only.

## Scope addition (user, after Checkpoint 2 review)

> "Can we also surface all of our memory and back-office operations in the header near the theme switcher, showing as a rotated text or online news line?"

**Track B5 — back-office activity ticker.** A single-line, rotating "news line" in the Electron shell header, next to the theme toggle, that surfaces background operations as they happen: boot phases, memory curator runs / observations captured / corpus changes, embedder + vec status, workspace indexing progress, skill-synthesis events (boot scan, enqueue, drain, promotion), cron job runs (backup, integrity check), harness reconcile, session import. Orchestrator defaults, unless the architect finds a reason otherwise:

- Rotates through the most recent events; quiet/collapsed when nothing has happened for a while; never blocks or steals focus.
- Click opens the Thoth tab (the existing home of Memory / Skills / Cron / Gateway).
- Frontend consumes ONE new push message (an activity event with `source`, `kind`, `summary`, `timestamp`) rather than subscribing to every subsystem's message individually; the backend fan-in lives where subsystem events are already bridged to `WEBVIEW_MANAGER` (`boot-thoth-runtime.ts` memory bridges are the precedent). Subsystems that already broadcast (`MEMORY_EXTRACTED`, `INDEXING_PROGRESS`, …) may be re-mapped in the frontend instead if that is cheaper — architect decides.
- Bounded ring buffer (e.g. last 50) in the frontend service; the same service can later feed a fuller activity log in Thoth.
- VS Code webview: the header lives in `ElectronShellComponent`, so nothing renders there; the service must still be harmless.

## Strategy

- Type: REFACTORING (+ FEATURE for the boot screen). Pattern: Partial — software-architect → team-leader → backend-developer ∥ frontend-developer → senior-tester → reviewers.
- Requirements are captured here; no project-manager pass needed.
- Files expected to change: `persistence-sqlite` (connection service, new check-state store/migration), `cron-scheduler` or `thoth-runtime` (scheduled check), `skill-synthesis` (trigger config + service), `ptah-electron/activation` (coordinator broadcast), `shared` (payload widening), `frontend/core` (boot status service), `frontend/chat` + `ptah-extension-webview` (boot screen, skeletons), `rpc-handlers` (readiness guards).
