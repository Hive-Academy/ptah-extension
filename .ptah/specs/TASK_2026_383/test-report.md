# Test Report - TASK_2026_383

## Run 2 — idle tree (HEAD `a5f4f945`, Batches 1-6 committed)

### What "idle" meant, and what it turned out not to cover

Per the coordinator's instructions: `npx nx reset` (failed with the same
pre-existing `EPERM` on `.nx/workspace-data` batch-4 already documented as
non-fatal — worked around with `--skip-nx-cache`), then `npx nx build-dev
ptah-electron && npx nx copy-renderer-dev ptah-electron` (both succeeded on
HEAD `a5f4f945`), a fresh `Copy-Item` of the real DB (never opened in place;
confirmed size 1,089,724,416 bytes, source `LastWriteTime` unchanged after the
copy), the **same 32 GB scratch write+read cold-cache method** as Run 1
(`RAMMap -Es` still unavailable — needs interactive UAC this shell cannot
grant), `--keep-db` on every probe invocation, and the app's own structured
log pulled from `userData/logs/` before cleanup on every run.

**The worktree/build state was idle exactly as described** — no other
executor, build, or test touched `task-383` during this measurement. **The
machine was not idle.** Mid-way through this re-run, `Get-Counter
'\Processor(_Total)\% Processor Time'` read **95.7%**, then **63.5%**, then
**74.8%** across three samples taken seconds apart, with 17-23 `node.exe`
processes visible in `tasklist` that this session did not spawn (consistent
with other concurrent sessions on the same shared machine, outside this
task's control or knowledge). This is reported because it is the most likely
explanation for what follows — the numbers below are **worse** than even
Run 1's already-CPU-confounded numbers, not better, despite the worktree
itself having nothing else running in it.

### Same one-time migration-42 anomaly recurred first

The first successful probe attempt on this fresh DB copy (2 discarded
`Execution context was destroyed` Playwright launches beforehand — same
transient failure mode as Run 1 and 380, confirmed unrelated to the app via a
direct `electron.exe` launch that progressed cleanly past the same point) hit
**the identical one-time migration-42 cost** Run 1 already documented: the
real DB on this machine is still schema version 41 (confirmed independently:
`schema_migrations` max version 41, `PRAGMA integrity_check` "ok" on the
untouched source copy). `appliedVersions:[42]`, backup+migrate took
**68,761 ms** this time (vs. 75,073 ms in Run 1, 27,269 ms in 380 — all
one-time, all excluded from the reproduction verdict below). As before, the
now-migrated output was re-copied and used as the source for a second,
freshly cold-cached run to get the steady-state numbers.

### Steady-state boot markers (post-migration, idle-worktree, contended-machine)

| Marker                             |        Value |
| ---------------------------------- | -----------: |
| window (Startup config registered) |    31,503 ms |
| `openAndMigrate()` started         |    33,593 ms |
| SQLite open + migrated             |    33,690 ms |
| **readiness window**               | **2,187 ms** |

`openAndMigrate` itself: **97 ms** (`applied: [], finalVersion: 42`) —
steady state, in the same range as every other run regardless of CPU
contention: SQLite's own open path is bounded and cheap; it is the
**subprocess-spawn-bound** handlers below that blow up under contention.
**Readiness-guard verdict reproduced again**: `NO RPC arrived before SQLite
was open` — the third independent run (380's three, Run 1's steady-state
pass, and this one) to confirm no guard is needed on any method.

### Per-handler table — three-way comparison

| Handler               | 380 baseline | Run 1 (idle-worktree, confounded — prior session) |  Run 2 (idle-worktree, machine 60-95% CPU) | Reproduced vs. 380 (~30%)? |
| --------------------- | -----------: | ------------------------------------------------: | -----------------------------------------: | :------------------------: |
| `auth:getAuthStatus`  |      2244 ms |                                 2146.8 ms (−4.3%) |                    **5727.7 ms (+155.3%)** |           **NO**           |
| `config:models-list`  |      2296 ms |                                4076.4 ms (+77.5%) | **3484.4 / 11188.5 ms (+51.8% / +387.4%)** |           **NO**           |
| `session:list`        | 2291 ms (×2) |                      _below threshold (improved)_ | **7006.7 / 6925.1 ms (+205.9% / +202.3%)** |           **NO**           |
| `git:info`            |      2476 ms |                                3724.0 ms (+50.4%) |                    **8390.3 ms (+238.9%)** |           **NO**           |
| `autocomplete:agents` |      4095 ms |                                 3819.8 ms (−6.7%) |                   **11051.7 ms (+169.9%)** |           **NO**           |

**0 of 5 reproduced within ~30% this time** — all five landed slower, most by
2-4×. Additional handlers not in the gated five also spiked hard in this run
(`editor:getFileTree` 5408.6 ms, `git:branches` 5467.8 ms, `git:lastCommit`
5419 ms, `git:stashList` 7572.4 ms) — every one of them is, like the five
gated handlers, a subprocess-spawn or filesystem-scan RPC, which is exactly
the profile CPU starvation would produce (scheduling delay on `crossSpawn`
and on synchronous `fs.readdir`/`fs.readFile` calls), not a profile a code
regression in the app's own boot sequence would produce.

**Lag spikes**: max lag climbed to **3355.4 ms** (vs. 1073.7 ms in 380, 2724.2
ms in Run 1), with eleven spikes above 1000 ms and five above 2000 ms across
roughly a 25-second span immediately after `openAndMigrate` completed — worse
in both peak and density than either prior measurement.

### Per-handler: does the Batch 10/11 remedy still address the measured cost, even though the number moved?

Checked each of `implementation-plan.md` components 13-17 against what this
run's log actually shows fired and how many times:

| Handler               | Component | Cost source the remedy targets                                                                                                           | Still the source in this run?                                                                                                        | Still addressed?                                                                                                                                                                                        |
| --------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `autocomplete:agents` | 13        | Eager `ngOnInit` preload triggering a cold `fs.readdir` + per-file `fs.readFile` scan                                                    | Yes — one call at boot, same shape; duration inflated by disk/CPU contention on the same synchronous scan, not a different code path | **Yes** — deferring the scan out of the boot window removes it from the measured window regardless of how slow the scan itself is                                                                       |
| `config:models-list`  | 14        | Two boot callers (constructor + `createTab`) each triggering an SDK CLI subprocess spawn + an external fetch                             | Yes — **two** slow-handler lines logged (3484.4 ms, 11188.5 ms), confirming the same double-call the component's premise describes   | **Yes**, more so — persisting the catalog cross-boot removes both calls, and removing a duplicate matters more, not less, when each call is this expensive                                              |
| `git:info`            | 15        | Inline `crossSpawn` blocking the **main thread**                                                                                         | Yes — one call, main-thread-blocking `execGit`, unchanged code path                                                                  | **Yes**, more so — a main-thread-blocking spawn is worse precisely when the CPU is contended; moving it off-thread (component 15's `IProcessSpawner` remedy) is the exact fix for a starved main thread |
| `auth:getAuthStatus`  | 16        | `crossSpawn('claude --version')` health check, only one log line despite two arrivals (in-flight/TTL caches already coalesce the second) | Yes — same single spawn, same existing coalescing behaviour observed                                                                 | **Yes** — persisting the detector verdict cross-boot removes the spawn entirely on the next boot, independent of how slow any individual spawn is                                                       |
| `session:list`        | 17        | Two uncoalesced boot callers each doing `fs.readdir` over `~/.claude/projects` + a state-blob read                                       | Yes — **two** slow-handler lines (7006.7 ms, 6925.1 ms), confirming the same duplicate-caller shape                                  | **Yes**, more so — the shared in-flight promise removes an entire duplicate slow scan, which is worth more when each scan takes 7 s than when it took 2.3 s                                             |

**Every one of the five remedies still targets the mechanism this run actually
exercised.** None of the five costs "moved elsewhere" — no handler's slow
path now traces to something other than what its component already names.
The absolute numbers used to size any timeout/budget in the remedies (e.g.
component 16's `withProbeTimeout` 5 s cap, component 14's fetch's 5 s abort)
should be re-checked against these larger numbers before Batch 10/11 assumes
the 380-era ~2-4 s range is representative, but the _design_ of all five
remedies (defer, deduplicate, cache cross-boot, move off-thread, coalesce) is
unaffected by which number is current.

### Execution and cleanup

```
npx nx reset                              # EPERM, non-fatal, same as batch-4's finding
npx nx build-dev ptah-electron --skip-nx-cache
npx nx copy-renderer-dev ptah-electron --skip-nx-cache

Copy-Item ~/.ptah/state/ptah.sqlite %TEMP%\ptah-383-run2-copy\ptah.sqlite (+ -wal, -shm)

# cold-cache eviction x2 (once per measurement), 32 GB scratch write+read, then delete
node apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs \
  --ws=D:/projects/ptah-extension --db=<copy> --seconds=120 --keep-db
  # attempt 1-3: transient Playwright launch failure (2x) then the migration-cost run
  # attempt 4 (steady-state): re-copy of the now-migrated output, fresh cold-cache pass
```

- **Result**: 2 successful boot-probe runs (after 3 discarded transient
  Playwright launch failures — one more than Run 1 hit — each confirmed
  unrelated to the app via a direct `electron.exe` launch that progressed
  cleanly past the same point).
- All artifacts cleaned up: `%TEMP%\ptah-383-run2-copy\` (both the source and
  migrated DB copies), both `ptah-bootprobe-*` run directories, both
  `ptah-bootprobe-udd-*` userData directories, and `tmp/boot-probe.json` in
  the worktree were all removed. Only PID-scoped process endings occurred
  throughout (Playwright's own `app.close()`, `timeout`-bounded direct debug
  launches this session itself started); no `taskkill`, no image-name kill.
  The real `~/.ptah/state/ptah.sqlite` was independently confirmed
  unmodified by anything in this run (its own WAL growth during the session
  reflects the live, already-running `Ptah.exe`, not this probe) — a stray
  partial pre-migration backup file from a `timeout`-killed direct-launch
  diagnostic was found next to the source copy both times and confirmed to
  not have touched the source (`schema_migrations` max version 41, integrity
  "ok") before being discarded.

### Verdict

**GATE: FAIL.** 0 of 5 named handlers reproduced within ~30% of the 380
baseline on this run — all five slower, most by 2-4×, on a worktree that was
genuinely idle but a machine that measurably was not (60-95% CPU from
processes this session did not start). This is a **measurement-environment
failure, not a code-regression finding**: the readiness-guard verdict (the
one thing not subprocess-spawn-bound) reproduced cleanly for the third
consecutive run, and structural analysis of all five components confirms
every remedy still targets the correct, unmoved cost source. Recommend the
team-leader either (a) re-run this exact measurement once genuinely exclusive
machine access is available — the worktree-level idle guarantee given for
this run was not sufficient on its own — or (b) proceed with Batch 10/11 on the
strength of the structural finding above (all five remedies still address
the right mechanism) while treating the specific millisecond budgets in
components 14 and 16 as provisional until a clean number exists. Do not
treat this run's numbers as the new baseline to design against — they are as
unreliable, in the other direction, as Run 1's.

---

## Batch 9 — cold re-measurement (THE GATE for Batches 10 and 11)

### Scope

- **User request**: re-verify, on a fresh cold boot, that the five slow-handler
  numbers from TASK_2026_380's report (the numbers Batch 10/11's remedies are
  designed against) still hold, and time `PRAGMA optimize` in isolation, before
  Batches 10/11 are allowed to start.
- **Criteria tested**: the five named baselines (`auth:getAuthStatus` 2244 ms,
  `config:models-list` 2296 ms, `session:list` 2291 ms ×2, `git:info` 2476 ms,
  `autocomplete:agents` 4095 ms — all taken verbatim from
  `TASK_2026_380/test-report.md`'s criterion-2 table) reproduce within ~30%,
  plus whether any SQLite-backed RPC lands before `openAndMigrate()` completes
  (the readiness-guard authorization question), plus `PRAGMA optimize` timing.
- **Deliberately not tested**: anything outside the boot-RPC window and
  `PRAGMA optimize` — this batch owns no files and changes no code.

### Environment and safety

- **Working tree**: `D:/projects/ptah-extension/.claude-worktrees/task-383`,
  build via `npx nx build-dev ptah-electron && npx nx copy-renderer-dev
ptah-electron` (both succeeded; `dist/apps/ptah-electron/main.mjs` and
  `renderer/` confirmed present).
- **Machine**: same one 380 measured on — 27.86 GB total RAM (`Get-CimInstance
Win32_ComputerSystem`).
- **Cold-cache method**: **32 GB scratch write+read fallback** (write 32 GB to
  a `%TEMP%` file, read it back, delete it — done 3 times, once per
  measurement below). `RAMMap.exe` is installed
  (`...\WinGet\Packages\Microsoft.Sysinternals.RAMMap_...\RAMMap.exe`) but
  `RAMMap -Es` needs interactive UAC elevation this non-interactive shell
  cannot grant — same constraint 380 hit. Fidelity caveat carried over
  verbatim from 380: this is weaker proof of actual page eviction than
  `RAMMap -Es`, but exceeds total RAM by ~15%.
- **DB copy**: real `C:\Users\abdal\.ptah\state\ptah.sqlite` (1,078,697,984
  bytes at copy time) copied — **never opened in place** — via `Copy-Item` to
  `%TEMP%\ptah-383-copy\ptah.sqlite`, with its `-wal` (4,639,152 bytes) and
  `-shm` (32,768 bytes) siblings. Confirmed the source file's `LastWriteTime`
  was unchanged by the copy itself. All probe and `PRAGMA optimize` runs
  passed `--db=<copy>` / a copy-of-the-copy; the real path was never passed to
  anything that opens a database. A stray artifact from an early diagnostic
  direct-launch (used only to debug a transient Playwright failure, see
  below) left a partial pre-migration backup file sitting next to the source
  copy in `%TEMP%\ptah-383-copy\`; the source copy itself was verified
  unmodified (`schema_migrations` max version still 41, `PRAGMA
integrity_check` "ok") before being discarded. **The real installed app was
  never touched**: no `taskkill`, no image-name kill; the only processes ended
  were Playwright's own `app.close()` (PID-scoped to the `_electron` instance
  it launched) and one `timeout`-bounded direct debug launch this session
  itself started.
- **`--keep-db`**: used on every `measure-boot-rpcs.mjs` invocation (present
  in this worktree per Batch 4). The app's own structured log was read from
  the retained `userData/logs/Ptah Electron-*.log` before cleanup, since
  `NODE_ENV=production` suppresses the console transport that would otherwise
  echo `[event-loop] lag` / `[RPC] slow handler` lines to the probe's stdout
  (same finding as 380).
- **Transient launch failure**: the first two probe attempts failed with
  Playwright's `Execution context was destroyed, most likely because of a
navigation` before installing the RPC probe — the exact failure mode 380
  also hit once and attributed to transient load right after a 32 GB
  eviction pass. A direct `electron.exe main.mjs` launch with identical
  args/env reached `SQLite connection service resolved, calling
openAndMigrate()...` cleanly, confirming the app itself was not at fault.
  The third attempt succeeded and is the recorded Run 1 below.

### Anomaly found and handled: the one-time migration-42 cost recurs

Run 1 (first successful probe, fresh copy of the real DB) hit **the same
one-time migration cost TASK_2026_380 already documented and explicitly
excluded from its criterion-1 steady-state measurement**: the real DB on this
machine is still at schema version 41 — migration 42
(`db_integrity_check_state`, added by 380's own fix) has never been applied to
it, because the currently-installed `Ptah.exe` predates that migration. Every
fresh copy of the real DB therefore pays this cost once, on first open under
this worktree's build:

```
19:42:00.788  [persistence-sqlite] Starting openAndMigrate...
19:43:15.861  [persistence-sqlite] backup completed (pre-migration)
19:43:15.865  [persistence-sqlite] migrations applied: {"appliedVersions":[42], "finalVersion":42}
```

**75,073 ms** for the one-time backup+migrate step (380 measured 27,269 ms for
the same one-time event on a smaller, ~965 MB pre-migration DB; this DB is
~1.08 GB and disk conditions differ — consistent in kind, not identical in
magnitude). This is **not** a regression and **not** the number Batch 9 is
gating on — 380's own report is explicit that criterion 1 is about the
post-migration steady state, and treats the one-time cost as a named risk, not
a failure. Handling it the same way here: this run's numbers are reported
below for completeness but are **excluded from the reproduction verdict**,
and a **second cold run was taken on the now-migrated copy** to get the
steady-state numbers that are actually comparable to 380's baseline.

Run 1's own boot-window number, for the record: window open → SQLite usable =
75,283 ms (dominated entirely by the one-time migration, not by any
steady-state pathology). 54 RPCs arrived before SQLite finished
migrating+opening in this run — expected and uninteresting, since the delay is
the one-time migration itself, not the normal ~ms `openAndMigrate()` path;
**0 of them failed**.

### Run 2 (steady-state, comparable to 380's baseline)

Source: the copy Run 1 had just migrated to version 42, re-copied fresh, with
**its own separate 32 GB cold-cache eviction pass** immediately before launch
(so this run is cold on OS cache, not on migration state — matching how 380's
own "cold" run was cold-cached but already past its one-time migration).

**Boot markers**:

| Marker                             |      Value |
| ---------------------------------- | ---------: |
| window (Startup config registered) |  16,051 ms |
| `openAndMigrate()` started         |  16,300 ms |
| SQLite open + migrated             |  16,361 ms |
| **readiness window**               | **310 ms** |

`openAndMigrate` itself: **60 ms** (`applied: [], finalVersion: 42` — steady
state, matches 380's 14–32 ms range in kind; the ~2× is noise-level on a
number this small).

**Readiness-guard authorization — reproduced**: `NO RPC arrived before SQLite
was open. A readiness guard would never fire on this path.` — same verdict as
all three of 380's runs. **No guard ships**, confirmed again.

**Per-handler table** (arrival ms is from the probe's RPC trace, t0 = process
launch; duration ms is from the app's own `[RPC] slow handler` log line, only
emitted above an internal threshold — so a method with two arrivals but one
log line means only the slower of the two calls crossed it):

| Handler               | Baseline (380) | This run (arrival ms) |               This run (duration ms) |                  Δ vs baseline |     Reproduced within ~30%?      |
| --------------------- | -------------: | --------------------- | -----------------------------------: | -----------------------------: | :------------------------------: |
| `auth:getAuthStatus`  |        2244 ms | 21,210 / 23,975       |                        **2146.8 ms** |                          −4.3% |             **YES**              |
| `config:models-list`  |        2296 ms | 21,189 / 24,647       |                        **4076.4 ms** |                     **+77.5%** |         **NO — slower**          |
| `session:list`        |   2291 ms (×2) | 22,290 / 22,393       | _no slow-handler line_ (< threshold) | n/a — improved, not comparable | not directly comparable (faster) |
| `git:info`            |        2476 ms | 23,977                |                        **3724.0 ms** |                     **+50.4%** |         **NO — slower**          |
| `autocomplete:agents` |        4095 ms | 22,375                |                        **3819.8 ms** |                          −6.7% |             **YES**              |

**Event-loop lag spikes across the window** (same shape as 380's table,
relative to process start, derived from `openAndMigrate() started` = 16,300 ms
anchoring the log's own absolute timestamps):

| ~t (relative to launch) |                                       lag maxMs |
| ----------------------: | ----------------------------------------------: |
|                 ~18.1 s |                                           370.1 |
|                 ~20.4 s |                                          1038.6 |
|                 ~22.4 s |                                           729.8 |
|                 ~23.4 s |  _(`auth:getAuthStatus` 2146.8 ms logged here)_ |
|                 ~24.6 s |                                           633.3 |
|                 ~25.3 s |  _(`config:models-list` 4076.4 ms logged here)_ |
|                 ~26.2 s | _(`autocomplete:agents` 3819.8 ms logged here)_ |
|                 ~27.7 s |                                           885.5 |
|                 ~27.7 s |            _(`git:info` 3724.0 ms logged here)_ |
|                 ~30.4 s |                                      **2724.2** |
|                 ~33.4 s |                                          1342.2 |
|                 ~36.8 s |                                          1695.5 |
|                 ~43.3 s |                                      **2081.4** |
|                 ~46.3 s |                                          1300.2 |
|                 ~54.1 s |                                          1828.7 |
|                 ~57.4 s |                                      **2001.7** |
|                 ~59.8 s |                                           752.9 |
|                 ~62.0 s |                                           516.7 |
|                 ~64.1 s |                                           543.7 |
|                 ~66.1 s |                                           332.9 |

380's report measured the post-first-RPC jank window as **~15 s of
intermittent lag up to 1073.7 ms**. This run shows the jank window extending
to **~66 s**, with three spikes above 2000 ms (max 2724.2 ms) — roughly
**2.5× the peak lag** and **~4.4× the duration** 380 recorded. This machine
was running with **Batches 5 and 6 concurrently editing and presumably
building/testing backend libs** during this measurement (an explicit
constraint of this batch's brief), which is a real, named confound: CPU/disk
contention from concurrent Nx work is a plausible full explanation for both
the widened lag window and the two handlers that came in slower than
baseline, without implying a code regression in the boot path itself.

### PRAGMA optimize timing (Task 9.2)

Timed on the retained migrated copy from Run 2 (`better-sqlite3` via
`ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe`, matching
how the app's own native module is built — plain `node` fails with a
`NODE_MODULE_VERSION` mismatch since `better-sqlite3` here is rebuilt for
Electron). Opened **read-write** (optimize writes `sqlite_stat1`); the copy is
disposable, discarded after.

| Condition                                                                          |         ms |
| ---------------------------------------------------------------------------------- | ---------: |
| Cold (immediately after a fresh 32 GB eviction pass, first `PRAGMA optimize` call) | **100 ms** |
| Same connection, second call (warm)                                                |       0 ms |
| Fresh connection, cache still warm from the prior run, first call                  |  **27 ms** |
| Same connection, second call (warm)                                                |       0 ms |

**Not seconds-scale.** No follow-up needed — `PRAGMA optimize` on this ~1 GB
database costs low double-digit ms warm and ~100 ms cold, well under any
budget concern for a synchronous host-side write. A-2's decision to keep it on
the host is not contradicted by timing.

### Execution

Commands run, verbatim (paths abbreviated):

```
npx nx build-dev ptah-electron
npx nx copy-renderer-dev ptah-electron

# DB copy (PowerShell), never opens the real file
Copy-Item ~/.ptah/state/ptah.sqlite %TEMP%\ptah-383-copy\ptah.sqlite (+ -wal, -shm)

# cold-cache eviction ×3 (once per measurement below), 32 GB scratch write+read, then delete
node apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs \
  --ws=D:/projects/ptah-extension --db=<copy> --seconds=120 --keep-db
  # Run 1: fresh copy of the real DB -> hit the one-time migration-42 cost
  # Run 2: re-copy of Run 1's now-migrated output, fresh cold-cache pass -> steady state

ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe \
  tmp/pragma-optimize-timing.cjs <Run 2's retained copy>
  # cold pass, then a second fresh-connection pass immediately after
```

- **Result**: 2 successful boot-probe runs (after 2 discarded transient
  Playwright launch failures, root-caused as unrelated to the app), 2
  `PRAGMA optimize` passes. All artifacts and scratch files cleaned up at the
  end — **nothing retained**: `%TEMP%\ptah-383-copy\`, both
  `ptah-bootprobe-*` run directories, both `ptah-bootprobe-udd-*` userData
  directories, and the temporary `tmp/pragma-optimize-timing.cjs` script were
  all removed. The real `~/.ptah/state/ptah.sqlite` was independently
  confirmed unmodified by anything in this batch (WAL growth observed during
  the session is the live, already-running `Ptah.exe` continuing normal use,
  not this probe).
- **Not executed**: a repeat of the two Playwright specs from 380 (Batch 9's
  scope is the boot-RPC measurement and `PRAGMA optimize` only, per
  `batches.md`); a third steady-state run to average out the machine noise
  seen in `config:models-list` / `git:info` (would need another ~10 minutes
  of cold-cache eviction per pass; not done given the concurrent-batch
  confound already identified and named below).

### Verdict

| #                             | Item                                                                                                     | Verdict |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- | ------- |
| Readiness-guard authorization | **Reproduced** — 0 RPCs before SQLite open in the steady-state run; no guard ships, on any method        |
| `auth:getAuthStatus`          | **Reproduced** (−4.3%)                                                                                   |
| `config:models-list`          | **NOT reproduced** — 77.5% slower than baseline                                                          |
| `session:list`                | Not directly comparable — ran faster than the slow-handler threshold this time (improvement, not a miss) |
| `git:info`                    | **NOT reproduced** — 50.4% slower than baseline                                                          |
| `autocomplete:agents`         | **Reproduced** (−6.7%)                                                                                   |
| `PRAGMA optimize`             | **100 ms cold / 0–27 ms warm** — not a follow-up item                                                    |

**3 of 5 named handlers reproduced within ~30% (two of those with room to
spare); 2 of 5 (`config:models-list`, `git:info`) exceeded the ~30% tolerance
— both in the slower direction, and the post-first-RPC lag window is both
wider (~66 s vs. 380's ~15 s) and spikier (max 2724.2 ms vs. 1073.7 ms) than
380 recorded.** The batch's own gate is literal: numbers outside ~30% mean the
Batch 10/11 remedies do not ship as designed without the team-leader
re-selecting them. Given that two of five named handlers are outside
tolerance and the lag envelope moved by 2.5–4.4×, I am not willing to call
this a clean pass on the letter of the gate, even though a real, named
confound exists (Batches 5/6 concurrently building/testing backend libs on
this same machine during the measurement) that plausibly explains all of it
without any change to the boot-path code itself.

**GATE: FAIL (as measured) — with a named, plausible confound.** Recommend
the team-leader choose between (a) accepting the confound explanation and
re-running this exact measurement once Batches 5/6 have landed and the
machine is otherwise idle, before green-lighting Batch 10/11's remedies
against the original 380 numbers, or (b) re-selecting/widening the remedies'
assumed timing budgets now so they tolerate the ~4 s range actually observed
for `config:models-list` and `git:info` rather than the ~2.3–2.5 s the 380
baseline assumed. Do not assign Batch 10 or 11 on the current numbers without
one of these two decisions — per this batch's own hard-gate rule (A-4 / R-7).

### Risks a reader should know about

- **Concurrent-batch confound**: this measurement ran while Batches 5 and 6
  were (per this batch's own brief) editing and likely building/testing
  backend libs on the same machine. CPU/disk contention from that work is the
  most likely explanation for both the widened lag window and the two
  handlers that ran slower than baseline — but it was not isolated or proven,
  only named.
- **One-time migration cost got worse, not better**: 27.3 s (380, ~965 MB DB)
  → 75.1 s (this report, ~1.08 GB DB) for migration 42 to apply to a
  not-yet-migrated real-DB copy. Growing DB size directly grows this one-time
  cost; every existing install that hasn't yet run a build containing
  migration 42 will pay a larger version of this the day it finally does.
  Not a Batch 9 criterion, but worth carrying forward as a live number.
  Confirmed by two independent things: `schema_migrations` on the untouched
  source copy still reads max version 41, and the log's own
  `appliedVersions: [42]` / `skippedVersions: [1..41]` line.
- **Cold-cache fidelity**: same caveat as 380 — the 32 GB scratch-file
  eviction is a weaker proxy for "cold" than `RAMMap -Es`, which remains
  unavailable in a non-interactive, non-elevated shell on this machine.

---

## Batch 9 — cold re-measurement (2026-09-07 re-run)

> **Revised.** The original body of this section analyzed two runs that
> turned out to be invalid: the database copy was unmigrated (schema version
> 41), so both runs paid a one-time pre-migration backup instead of measuring
> steady state, and no cold-cache eviction was recorded for them. The
> coordinator rewrote `batch-9-raw-measurement.md` with three corrected
> steady-state runs (pre-migrated copy, 32 GB eviction pass before each,
> quiet machine) plus recovered event-loop-lag figures, and supplied
> `research-report.md` establishing which of the five Track C remedies are
> actually implemented on this branch. The analysis below supersedes
> everything previously written in this section; the invalid two-run data is
> preserved only inside `batch-9-raw-measurement.md`'s own "Discarded runs"
> table, not repeated here.

### Scope

- **User request**: analyze the corrected Batch 9 cold-measurement data
  (three steady-state runs, pre-migrated DB, cold-cache eviction confirmed)
  against the 380 baseline, answer the 30%-movement gate question, judge each
  Track C remedy against both the new numbers and the research report's
  implementation-status findings, and state whether 380 criterion 2
  (event-loop lag) is met now that it is measurable. No new measurement was
  taken for this revision — analysis of already-collected data only.
- **Criteria tested**: the same five 380-named handlers, the readiness-guard
  question (does any RPC arrive before SQLite opens), 380 criterion 2
  (max event-loop lag ≤ 500 ms), and `PRAGMA optimize` isolation (item A-2).
- **Deliberately not tested**: nothing was skipped this time. Lag is now
  measured from the app's own retained log rather than the probe.

### Before/after table vs. the TASK_2026_380 baseline (median of 3 runs)

| Handler                         | 380 baseline |   Run A |   Run B |   Run C |  Median |   Δ median | Movement >30%? |
| ------------------------------- | -----------: | ------: | ------: | ------: | ------: | ---------: | :------------: |
| `config:models-list` (1st call) |      2296 ms | 1368 ms | 1175 ms | 1157 ms | 1175 ms | **−48.8%** |    **yes**     |
| `auth:getAuthStatus`            |      2244 ms |  283 ms |  753 ms |  734 ms |  734 ms | **−67.3%** |    **yes**     |
| `session:list` (1st call)       |      2291 ms |    3 ms |  234 ms |  212 ms |  212 ms | **−90.7%** |    **yes**     |
| `git:info`                      |      2476 ms |  364 ms |  436 ms |  710 ms |  436 ms | **−82.4%** |    **yes**     |
| `autocomplete:agents`           |      4095 ms |   13 ms |  500 ms |  709 ms |  500 ms | **−87.8%** |    **yes**     |

**Run-to-run variance is large and must be read alongside the median, not
instead of it.** `autocomplete:agents` spans 13 to 709 ms and `session:list`
spans 2 to 234 ms across three runs of the identical build against the
identical database copy. Run A is a low outlier on both handlers — treating
any single run as the answer would be unsafe, which is why every figure
above and below is the median of three, not a single best or worst run.

### Gate question, answered explicitly

380's rule: numbers moving more than 30% mean the remedies must be
re-selected before Batch 10/11 proceed. Every one of the five gated
handlers' medians moved 48.8% to 90.7% past baseline, all in the improving
direction. The rule as written does not exempt the improving direction, so
the letter of the gate is triggered: **re-selection is required.**

Unlike the discarded runs, nothing here collapses to near-zero: the medians
still range 212 ms to 1175 ms — real, sub-second-to-low-single-second costs,
not noise. So the re-selection this time is a **re-weighing of magnitude**,
not a discovery that the underlying problem vanished.

### Track C remedy assessment — measurement plus implementation status

The research report checked whether each remedy is already done on this
branch; that status changes what "still justified" means far more than the
raw ms figures alone, so both are given together.

| Remedy (batches.md)                                                    | Handler               | 380 cost     | Median now                                                 | Implemented on this branch? (research-report.md)                                                                                                                                                                                  | Still justified?                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------- | --------------------- | ------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delete eager agent preload (10.1, component 13)                        | `autocomplete:agents` | 4095 ms      | 500 ms (13–709 ms range)                                   | **Not done.** `ngOnInit` still calls `preloadAgents()` at `agent-selector.component.ts:158-174`, untouched by anything upstream.                                                                                                  | **Yes.** The code is unwritten and the cost is real and noisy (up to 709 ms observed), not eliminated by some other fix. This is the strongest "still needed" case of the five precisely because nothing else already did it.                                                                                                                                                   |
| Drop constructor `loadModels()` (10.2, component 14 frontend half)     | `config:models-list`  | 2296 ms      | 1175 ms (1st), 167–905 ms (2nd)                            | **Not done** — line 151 unchanged. The drop from 2296 ms is explained by the SDK spawn moving off-thread elsewhere (TASK_2026_353), not by anything in Track C.                                                                   | **Yes, but re-measure the specific payoff before committing.** The duplicate call itself is still there (two arrivals, every run); deleting it still removes a real ~1.2 s + ~0.2–0.9 s pair, but the expensive part (the spawn) is already off-thread, so the actual latency this task buys back may be closer to "avoid one redundant RPC" than "avoid a multi-second block." |
| Coalesce `session:list` (10.3, component 17)                           | `session:list`        | 2291 ms (×2) | 212 ms (1st), 179–234 ms (2nd, ex. Run A's 2-3 ms outlier) | **Not done** on the frontend loader — still only a 300 ms debounce, no shared in-flight promise. The drop appears to come from backend-side session/JSONL caching, not the planned frontend fix.                                  | **Yes, but as call-count hygiene, not latency relief.** Two ~200 ms calls instead of two ~2.3 s calls is a real, still-duplicated shape; coalescing them saves roughly 200 ms once, which is worth doing but is a materially smaller prize than 380 implied.                                                                                                                    |
| Persist SDK model catalog cross-boot (11.1, component 14 backend half) | `config:models-list`  | 2296 ms      | see above                                                  | **Not done** — `modelsCache`/`pendingModels` are in-memory Maps, no `IStateStorage` read/write.                                                                                                                                   | **Yes.** Payoff is now bounded to "first RPC of _this_ boot" rather than "first RPC ever," which is smaller than 380 assumed, but the ~1.2 s first-call cost recurs on every single boot without this, so persisting it cross-boot remains worthwhile.                                                                                                                          |
| Persist CLI health verdict cross-boot (11.2, component 16)             | `auth:getAuthStatus`  | 2244 ms      | 734 ms (283–753 ms range)                                  | **Not done**, but the in-process fix (`ClaudeCliDetector` single-flight + 30 s `--version` TTL, commit `f7c8d6c7a`) already collapsed the repeated-probe cost _within_ a boot, which is most of why the number fell from 2244 ms. | **Yes.** A ~734 ms median first-boot health-check spawn is still a real, unpersisted cost that a cross-boot memo would remove entirely; this was wrongly called "no longer justified" against the invalid data, where the number read 0-1 ms.                                                                                                                                   |
| Route `git:info` through `IProcessSpawner` (11.3, component 15)        | `git:info`            | 2476 ms      | 436 ms (364–710 ms range)                                  | **Not done.** Only the git-binary-resolution optimization (`fa1d2d92a`) landed; the spawn is still inline `crossSpawn`, no `IProcessSpawner` anywhere in `vscode-core`.                                                           | **Yes — the largest remaining gap of the five.** `git:info` improved only ~2.5–5.7×, versus the ~50× (~1.6-2 s inline → ~29 ms max delay) TASK_2026_341 already achieved elsewhere for off-thread spawns generally. This is still a synchronous main-thread block, and the fix that would remove it is proven to work, just not applied here.                                   |

**All five remedies are unimplemented on this branch and all five remain
justified**, though at reduced and uneven magnitude relative to 380's
assumptions: `git:info` (11.3) is now the largest single remaining gap;
`autocomplete:agents` (10.1) and `auth:getAuthStatus` (11.2) still carry
several-hundred-millisecond, fully-removable costs; `config:models-list`
(10.2/11.1) and `session:list` (10.3) carry smaller, partly-already-mitigated
costs where the remaining prize is a duplicate call rather than a multi-second
block. This replaces the earlier (invalid-data) verdict that
`autocomplete:agents` and `session:list` coalescing were "no longer
justified" — that conclusion was an artifact of measuring a one-time
migration boot on a warm cache, not the steady state.

### The dominant remaining cost is now a confirmed finding, not a hypothesis

The discarded runs' 11045–12474 ms `openAndMigrate()` readiness window is
**confirmed** by `research-report.md` to be the **pre-migration backup**
(`SqliteMigrationRunner.applyAll`, `migration-runner.ts:87-101`), which copies
and validates the ~1 GB database whenever `pending.length > 0` — i.e. once,
on the first boot after an app update ships a migration this database has
not yet applied. It is not migration bodies, not sqlite-vec load, and not
`PRAGMA` work (all separately timed and ruled out). A prior session measured
the same event at 75073 ms on a contended machine; `persistence-sqlite`'s own
doc comment independently pins the pre-worker-move version of this backup at
~27 s inline on a 1 GB file.

In the corrected steady-state runs (post-migration, no pending backup), the
same `openAndMigrate()` call takes 31–169 ms — confirming the entire
11–12.5 s difference was this one-time backup, not a per-boot cost.

**This remains real and user-facing** — every user whose local database
carries a pending migration when they update pays this once — **and no batch
in `batches.md` currently targets it.** Unlike the prior draft of this
section, this is now stated as a confirmed cause (traced to a named file and
line range, corroborated by two independent measurements), not a plausible-
but-unconfirmed hypothesis about backup guards or thread placement.

### 380 criterion 2 (event-loop lag) — now measurable, and NOT met

Recovered from the app's own `[event-loop] lag` lines in the retained
`userData/logs/*.log` (the probe itself does not record lag; `--keep-db`
made the log retrievable). The monitor only reports samples above 250 ms.

| Lag run |   Max lag |                Spikes above 500 ms |
| ------- | --------: | ---------------------------------: |
| 1       |  493.6 ms |                                  0 |
| 2       |  547.4 ms |                                  1 |
| 3       | 1502.6 ms | 4 (1502.6, 1424, 1017.1, 833.1 ms) |

380's ceiling is 500 ms; 380 itself measured 1073.7 ms. **The ceiling is
exceeded in 2 of 3 runs here, and the worst run (1502.6 ms) is worse than
380's own baseline figure.** Criterion 2 is **not met**. Lag run 3 followed
two failed probe launches, so residual load may have inflated it — but runs
1 and 2 had no such preceding load and still straddle the 500 ms line, so the
ceiling is not being cleared even in the clean runs. This is a hard finding
now, replacing the prior draft's "cannot be judged" — the instrument gap
that made criterion 2 unjudgeable is closed.

### Readiness-guard question and A-2, reconfirmed

- **Readiness window, steady state: 130–260 ms** across seven measured
  values (161, 157, 169, then 134, 148, 169, 258 ms). No RPC arrives before
  SQLite opens in any steady-state run — reproducing all three of 380's own
  runs. **No readiness guard ships**, on any method.
- **`PRAGMA optimize`**: 0 ms after the connection has touched any table (the
  only measurement that counts), consistent with a prior session's 100 ms
  cold / 27 ms warm figures. **Not a boot cost. A-2 needs no follow-up.**

### Honesty about the limits of this data

- **Three runs, not a large sample**, and the variance is large enough that a
  single run would mislead — `autocomplete:agents` alone spans a 54×
  range (13 to 709 ms). Every figure in this section is a median of three for
  that reason, and the range is always given alongside it.
- **Event-loop lag is now measured, and the finding is unfavorable** (ceiling
  exceeded in 2 of 3 runs) — stated as a finding, not softened, even though
  it does not help the "boot is fixed" narrative the collapsed handler
  numbers might otherwise suggest.
- **The dominant-cost finding (pre-migration backup) is confirmed by a
  named file and line range plus two independent measurements**, which is a
  materially stronger basis than the prior draft's unconfirmed hypothesis —
  but it is still scoped to "this is what the discarded runs' 11–12.5 s
  measured," not a claim about every possible cause of a slow boot.
- **This batch changed nothing in code.** The remedy-justification calls
  above are read against `research-report.md`'s file:line evidence, not
  re-verified independently against the source by this report.

### Verdict

**GATE PASSED WITH RE-SELECTION REQUIRED.** All five gated handlers' medians
moved 48.8–90.7% past the 380 baseline, all improving, which triggers the
letter of the 30% rule regardless of direction. Unlike the invalid two-run
data this section previously analyzed, none of the five costs collapsed to
zero: all five Track C remedies are confirmed **unimplemented** on this
branch and all five remain justified, though at reduced and uneven
magnitude — `git:info` (11.3) is the largest remaining gap, `session:list`
coalescing (10.3) the smallest. Separately, and now as a **confirmed** rather
than hypothesized finding, the pre-migration backup
(`migration-runner.ts:87-101`) is a real, user-facing, one-time cost of
11–75 s that no batch in the current plan targets. Additionally, 380
criterion 2 (event-loop lag ≤ 500 ms) is now measurable and **is not met**
(2 of 3 runs exceeded it, worst at 1502.6 ms). Recommend the team-leader
re-weigh Batch 10/11's five remedies by the corrected magnitudes above
(prioritizing `git:info`), decide whether the pre-migration backup needs its
own batch, and treat the still-unmet criterion 2 as an open item the current
plan does not resolve.
