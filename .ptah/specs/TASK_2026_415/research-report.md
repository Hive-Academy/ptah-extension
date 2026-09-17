# TASK_2026_415 — Research report: repeated `boot:getReadiness` RPC timeouts and initial-load UI freeze

Status: read-only research. No product code changed. No commits, no pushes, no
agent spawns, no production DB/log mutation, no live-app restart.
Checkout examined: `D:/projects/ptah-extension/.claude-worktrees/boot-readiness-timeout`.
Log examined: `C:/Users/abdal/AppData/Roaming/Ptah/logs/Ptah Electron-2026-09-10.log`.

---

## 1. Verdict in one paragraph

The `boot:getReadiness` handler is registered early and is cheap. The timeouts
are caused by main-process event-loop starvation during post-window boot work.
One blocking path is demonstrated by arithmetic from measured file sizes: the
Electron workspace-state adapter re-serializes the whole 255.67 MB state file on
every key write, on the main thread. The renderer's 5-second readiness pull then
times out repeatedly while the loop is blocked. A second blocking path
(synchronous target-side file reads in the harness reconcile pass) is confirmed
present in source but its share of the freeze is correlational until a CPU
profile is captured.

---

## 2. What the timeout is NOT (excluded mechanisms)

| Hypothesis                     | Verdict               | Evidence                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handler not registered         | Excluded              | Log: RPC surface registered at `15:40:58.850`, `boot:getReadiness` included. The starved window starts at `15:41:12` — after registration.                                                                                                                                                                                      |
| Handler slow or waiting on I/O | Excluded              | `boot:getReadiness` reads `PLATFORM_TOKENS.BOOT_READINESS` → `ElectronBootReadinessProvider` → `coordinator.snapshot()`. In-memory read. Never throws. Fails OPEN to ready/settled. Registered in `apps/ptah-electron/src/activation/bootstrap.ts` as `useValue` (last registration wins over the vscode-core null adapter).    |
| Transport not ready            | Excluded              | The RPC surface was up before the window. Other RPC calls reached the main process during it (`[RPC] slow handler` lines exist for other methods). The calls were queued behind a blocked loop, not lost.                                                                                                                       |
| Renderer blocking              | Excluded as the cause | The renderer issued the pulls; each pull carries a 5 s timeout (`libs/frontend/core/src/lib/services/boot-status.service.ts:57`). The pull times out because the main process cannot turn the loop within 5 s. One renderer-side defect candidate exists (overlapping pulls, §6), but it is a symptom amplifier, not the cause. |

Remaining mechanism: **backend event-loop starvation**. Confirmed by the
`[event-loop] lag` run in the same window (§3). Per `libs/backend/vscode-core/CLAUDE.md`
("Diagnosing a hang"): lag with no matching slow-handler line for the call
means the block is background work on the main thread.

---

## 3. The starved window (boot 2, 2026-09-10 log)

| Time           | Event                                                                                 |
| -------------- | ------------------------------------------------------------------------------------- |
| `15:40:58.850` | RPC surface registered (incl. `boot:getReadiness`).                                   |
| `15:41:12.046` | `[SessionImporter] Scanning` — starved window starts.                                 |
| `15:42:50`     | Lag `maxMs 9244.2` — worst sample.                                                    |
| `15:43:46`     | Lag falls to `687.9` — the run ends.                                                  |
| `15:43:48.218` | `Import complete: {"imported":0,"fromIndex":0}` — window closes after ~2 min 36 s.    |
| `15:43:52.720` | `[UserLayerMirror] mirrorAll complete {"skipped":45,…}`.                              |
| `15:43:52.833` | `[UserLayerMirror] reconcile complete {"noop":25,"fastForwarded":0,"diverged":20,…}`. |
| `15:43:52.873` | `skill_registry catalog synced {"upserted":45,"linked":1}`.                           |

Key readings:

- The lag run climbs `829.9 → 1193.3 → 3307.2 → … → 9244.2` and falls to
  `687.9` exactly as the user-layer pass and the catalog sync complete.
- `p99Ms == maxMs` on the worst samples. The monitor samples every 2 s, so
  `p99 == max` means the whole 2 s window was blocked.
- SessionImporter imported **0** and pruned **0**. It was a victim of the
  congested loop, not a cause: its own work in this boot was an index-file read
  (file absent → early exit), a 50-file skip-if-exists scan, and an async prune
  walk with zero deletions.

Boot 1 (earlier boot in the same log): imports ended `23:08:41.750` with
`imported: 13`, each import spaced 2–4 s; `[RPC] slow handler harness:health
57880.2ms`; `indexing:getStatus` 24 s. `harness:health` with a cache miss runs
`reconciler.verify()` — a full `plan()` pass with per-target walks
(`libs/backend/rpc-handlers/src/lib/harness/health/harness-health-rpc.service.ts:99-136`)
— which explains the 57.9 s duration and confirms a full plan pass was in
flight during that boot.

---

## 4. Demonstrated blocking write path: `ElectronStateStorage`

Measured on disk (read-only):

| File                   | Size                              | Notes                                                                                                                                |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `workspace-state.json` | **255.67 MB** (267,412,430 bytes) | 190 keys. `ptah.sessionMetadata` alone = 127.10 MB (685 sessions, largest record 27.33 MB). 186 `ptah.agentOutput:*` keys = 83.8 MB. |
| `global-state.json`    | 13,963 bytes                      | Cheap. Not a factor.                                                                                                                 |
| `ptah.sqlite`          | 1.13 GB                           | Synchronous better-sqlite3. See §5.                                                                                                  |

Source: `libs/backend/platform-electron/src/implementations/electron-state-storage.ts`.

- `update(key, value)` (`:28-39`) mutates the in-memory map, then chains
  `persist()`.
- `persist()` (`:64-74`) calls `JSON.stringify(this.data, null, 2)` at `:70` —
  **the entire 190-key, 255.67 MB object**, pretty-printed, before every write.
  `fsPromises.writeFile` is async, but `JSON.stringify` is synchronous CPU work
  on the main thread. One write of any key — including a small flag — pays a
  multi-second stringify of the whole store.
- `updateSync` (`:41-49`) → `persistSync()` (`:76-82`) is worse:
  `fs.writeFileSync` of the full serialization, synchronous end to end.
- `loadSync()` (`:55-62`) runs at construction: `readFileSync` + `JSON.parse`
  of the whole file. Every `WorkspaceAwareStateStorage.addWorkspace`
  (`libs/backend/vscode-core/src/services/workspace-aware-state-storage.ts:46-51`)
  constructs a storage and pays the full parse.
- `registerStateStorageAdapters`
  (`libs/backend/vscode-core/src/di/register-storage-shims.ts:113-134`) binds
  `TOKENS.STORAGE_SERVICE` over this storage, so ordinary workspace-key writes
  from anywhere in the backend land on this path.

Boot 1 evidence: the 13 session imports were spaced 2–4 s each. Each import
writes `ptah.sessionMetadata` (127 MB value). Under the current adapter, every
such flush re-serializes all 255.67 MB. The observed spacing matches the
expected stringify cost. Boot 2 imported nothing, so in boot 2 the freeze
shifted to the user-layer reconcile pass and the SQLite catalog sync (§5).

The renderer pull (5 s timeout) cannot win against a loop holding 3–9 s blocks.
Repeated `boot:getReadiness` timeouts are the direct symptom.

---

## 5. Confirmed synchronous main-thread work remaining on the boot path

### 5.1 Harness reconcile, TARGET side (harness-sync)

TASK_2026_323 made the SOURCE hash walk async
(`libs/backend/harness-sync/src/lib/hash/content-hash.ts` — `fs/promises`,
`HASH_BATCH_SIZE = 16`, `setImmediate` yields, `ContentHashOptions.signal`;
`abort/pass-abort.ts` owns `yieldToEventLoop` and the per-target commit point).
The user-layer mirror itself is also fully async — no `*Sync` fs call exists in
`libs/backend/agent-generation/src/lib/services/user-layer/` (grep, non-spec
files).

The TARGET side did not get the same treatment:

- `libs/backend/harness-sync/src/lib/targets/workspace-target.ts:411` —
  `content: readFileSync(sourceFile, 'utf-8')` in the copy plan.
- `workspace-target.ts:919` — `content: readFileSync(write.source, 'utf-8')` in
  apply.
- `hashTransformedDirSync` (same file, beside `copyDirectoryTransformed`) — a
  synchronous directory hash used in the adopt comparison. An async fold
  (`digestFileMap` in `content-hash.ts`) already exists and the async
  transformed-dir hash lives in `targets/copy-engine.ts`.
- `libs/backend/harness-sync/src/lib/targets/claude-target.ts:493,551,566,610,614`
  — `lstatSync`/`readdirSync`/`readFileSync`.
- `harness-manifest.builder.ts:389,529` — `readdirSync` one-level listings,
  documented as a deliberate exception.

Every `mode: 'full'` trigger (activation, folder change, plugin toggle,
content download) re-hashes targets. The boot-2 detached user-layer pass
(`reconcile complete` at `15:43:52.833`, `diverged: 20` over ~45 skills ×
targets) ran through the whole starved window and is the strongest candidate
for the 3–9.2 s lag bursts.

### 5.2 SQLite catalog sync (skill-synthesis)

`SkillRegistryCatalogService.sync`
(`libs/backend/skill-synthesis/src/lib/skill-registry-catalog.service.ts:45-89`)
awaits an async clone list, then performs 45 `registry.upsert` calls.
`SkillRegistryStore.upsert` (`skill-registry.store.ts:61-63`) is a
synchronous better-sqlite3 `prepare`/`run` against the 1.13 GB DB. 45 small
upserts are bounded and cheap individually; they completed at `15:43:52.873`,
the moment the lag run ended. This is a co-terminator of the user-layer pass,
not an independent cause.

### 5.3 `quick_check` — already gone

TASK_2026_380's root cause 1 no longer applies:
`libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts` contains
no `runBootChecks`/`quick_check` on the boot path (grep verified). The
2026-09-10 freeze is the REMAINING work, not a regression of 380.

---

## 6. Renderer pull contract — verified, with one defect candidate

`libs/frontend/core/src/lib/services/boot-status.service.ts` verified:

- Pull once on construction, then every `DEFAULT_READINESS_RETRY_AFTER_MS`
  (2000 ms) while `warming` (`:196-201`). Timeout 5000 ms (`:57`).
- The pull is **mandatory**, not a nicety: the host emits
  `boot:readinessChanged` at `did-finish-load`, which fires before Angular
  installs its `message` listener, so the first transition is routinely lost
  (`:9-14`). This verifies the memory lead "pull recovery is required because
  pushes before Angular bootstrap can be lost" — it is stated in the source.
- Monotonic guard: a late pull cannot rewind a newer push (`:175`).
- The `ready` default is load-bearing for the VS Code host (`:25-31`). No
  change proposed there — never fake ready, never block the VS Code webview.

**Defect candidate (acceptance: "bound polling/inflight").** The watchdog is
`setInterval(() => { void this.pullReadiness(); }, 2000)`. It does not await
and keeps no in-flight flag. While the main process is starved, a pull takes
the full 5 s timeout, so ticks stack: up to 3 concurrent pulls, ~78 queued RPC
calls across the 2 min 36 s window. Each call is individually bounded, but the
cumulative inflight set is not. A single-flight guard (skip the tick while a
pull is unsettled) fixes this without changing any timeout or faking state.

---

## 7. Verified memory leads

| Lead                                                                                       | Verdict                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TASK_2026_380 five boot RPCs / `measure-boot-rpcs.mjs`                                     | Exists: `D:/projects/ptah-extension/.ptah/specs/TASK_2026_380/measure-boot-rpcs.{cold,warm,logcapture}.log`. Reusable harness for an isolated slow-boot fixture (inspect/adapt — do not run against the live profile). |
| 380 root cause 1 (`quick_check`)                                                           | Fixed and landed in this checkout. Not the current freeze.                                                                                                                                                             |
| 380 root cause 2 (readiness contract unwired)                                              | Since wired: `BootStatusService`, `boot:getReadiness`, `boot:readinessChanged` push all exist and are exercised by `boot-status.service.spec.ts` and `webview-e2e-harness/.../boot-progress.e2e.spec.ts`.              |
| Boot scan delay keys (`bootScanDelayMs`, `bootScanIdleBackoffMs`, 7-day migration ceiling) | Present (`skill-synthesis` CLAUDE.md, TASK_2026_380).                                                                                                                                                                  |
| "Pull recovery required"                                                                   | Verified in source, §6.                                                                                                                                                                                                |
| `NullBootReadinessProvider` overridden                                                     | Verified: `bootstrap.ts` registers `ElectronBootReadinessProvider` last; last registration wins.                                                                                                                       |

---

## 8. Disproven hypotheses

- Handler not registered / transport not ready / handler waiting — §2.
- `sessions-index.json` parse cost — the file does not exist on this machine.
- Global state file size — 13,963 bytes.
- Importer prune deletions — zero deletions logged in both boots.
- Symbol indexer auto-start — indexing starts from a manual button
  (`workspace-indexing.component.ts:99`), not at boot.
- `quick_check` on boot — removed (§5.3).
- SessionImporter as the boot-2 cause — imported 0, pruned 0; it was a victim.

---

## 9. Attribution limits and unverified items

- **No CPU profile was captured.** Capturing one requires a slow boot while the
  app runs (`window.ptahDiag.captureCpuProfile(10000)` or
  `PTAH_PROFILE_ON_LAG_MS`), and the live app must not be restarted under this
  task's constraints. Per repo doctrine the profile is the definitive
  attribution tool for background-work lag. The plan therefore contains a
  profile step, and Fix 1 stands on arithmetic that does not depend on it.
- §4 is demonstrated by construction (a 255.67 MB `JSON.stringify` on the main
  thread per key write is synchronous by language semantics). §5.1 is confirmed
  present in source; its share of the 2026-09-10 window is a correlation
  (strong: the lag run ends exactly at the pass's completion) until a profile
  exists.
- **Installed-bundle vs source mismatch: not checked.** The installed app
  bundle was not read (install path not confirmed under read-only constraints).
  The source checkout is the worktree at branch `fix/boot-readiness-timeout`,
  HEAD `30d37f61c`. If the installed app is older than this source, the
  observed behavior maps to the installed bundle, not exactly to these line
  numbers.
- Renderer paint cost (Angular bootstrap) was not profiled; the boot screen
  exists and the evidence shows the renderer waited on RPC, not on its own work.

---

## 10. Findings, ranked

1. **`ElectronStateStorage` whole-store re-serialization on every key write**
   (and whole-store sync parse at load). Demonstrated blocking write path.
   Fix is minimal and adapter-local — see `implementation-plan.md` Fix 1.
2. **Synchronous target-side I/O in the harness reconcile full pass**
   (`workspace-target.ts:411/:919`, `hashTransformedDirSync`,
   `claude-target.ts` sync reads). Confirmed present; the likely owner of the
   boot-2 lag bursts. Fix 3, gated on a profile.
3. **Readiness watchdog can stack overlapping pulls** while the main process is
   starved. Renderer-side amplifier. Fix 2 (single-flight guard).
4. Follow-up (out of scope): `ptah.sessionMetadata` at 127 MB in JSON state is
   a data-model problem; that data belongs in SQLite. Recorded, not planned.
