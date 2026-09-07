# Test Report - TASK_2026_380 (Task 5.1: cold-cache boot measurement)

## Scope

- **User request**: the Electron cold start took ~2 minutes and was unusable;
  fix it performance-wise (Track A) and UX-wise (Track B/B5).
- **Criteria tested** (`batches.md` Batch 5 / Task 5.1, verbatim):
  1. `openAndMigrate()` under 3 s on a cold-cache boot of the packaged app.
  2. No lag warning above 500 ms before the first answered RPC.
  3. No skill boot-scan enqueue inside the first 5 minutes.
  4. On the same cold boot the header ticker narrates the phases as they
     happen and settles into its collapsed form once the boot is done.
  - Plus: re-run `measure-boot-rpcs.mjs` cold and record whether any
    SQLite-backed method lands inside the readiness window (the sole
    authority for whether a readiness guard ships).
  - Plus (carried from Batch 4, D-6): write and run the two deferred
    `webview-e2e-harness` Playwright cases.
  - Plus: verify assumption A-1 live (worker's read-only connection opens
    against the same WAL database; a forced open failure produces
    `unavailable` with no record written).
- **Deliberately not tested**: `chat:resume` timing — the probe's webview
  starts with no persisted session id, so the frontend never issues
  `chat:resume` on a fresh launch. It cannot be compared to the 5761 ms
  baseline from a cold probe without seeding session state, which is outside
  this task's file ownership. `foreign_key_check`'s isolated cost (27 ms
  baseline) was not re-measured because it never runs standalone — it is
  always part of the same out-of-process integrity check as `quick_check`,
  which is blocked entirely by the defect in Finding F-1 below.

## Environment and safety

- Build: `npx nx build-dev ptah-electron` + `npx nx copy-renderer-dev
ptah-electron`. Confirmed `dist/apps/ptah-electron/integrity-worker.mjs`
  and `main.mjs` exist post-build.
- DB copy: `C:\Users\abdal\.ptah\state\ptah.sqlite` (1,062,686,720 bytes at
  copy time) copied — never opened in place — via `Copy-Item` to
  `%TEMP%\ptah-380-copy\ptah.sqlite`, with its `-wal` (5,607,352 bytes) and
  `-shm` (32,768 bytes) siblings. Real file mtime immediately after the copy:
  unchanged (`09/06/2026 03:20:23`). A later check (`03:40:42`, +1.7 MB) is
  the **installed, currently-running Ptah.exe app** writing to its own real
  database during normal use over the course of this session — not this
  probe. Every probe invocation in this report used `--db=<copy>` /
  `PTAH_DB_PATH=<copy>`, which `resolvePtahDbPath()` honours ahead of every
  other resolution rule; no command in this report ever pointed at the real
  path.
- Cold cache: no Sysinternals RAMMap was available, so it was installed via
  `winget install Microsoft.Sysinternals.RAMMap` — but `RAMMap.exe -Es`
  requires interactive UAC elevation this non-interactive shell cannot grant
  (confirmed: current shell is not an administrator; the process hung
  waiting for a consent dialog that never appears, twice, and was killed).
  Fallback: wrote and read back a 32 GB scratch file (`%TEMP%`, machine has
  27.86 GB RAM) immediately before each cold run, to force the OS to reclaim
  the standby list through ordinary memory pressure. Fidelity: lower than
  `RAMMap -Es` (no direct proof the specific DB pages were evicted rather
  than merely made evictable), but the 32 GB write+read exceeds total RAM by
  ~15%, which should exhaust the standby list of anything not actively
  pinned. This was run twice — once before the recorded cold run below, and
  once earlier before a run that hit an unrelated crash (see Finding-adjacent
  note under Execution).
- The installed Ptah app (`Ptah.exe`, 4 processes) ran throughout this
  session and was never touched — the only `electron.exe` process killed was
  a manual debug launch this session started itself (verified by process
  name: the installed app runs as `Ptah.exe`, not the bare `electron.exe`
  dev binary).

## Measured results

### Criterion 1 — `openAndMigrate()` under 3 s

**PASS**, by a wide margin, across all three runs (`window (Startup config
registered)` → `SQLite open + migrated`, from `measure-boot-rpcs.mjs`'s own
markers):

| Run                                      | started at | open+migrated at | **duration** |
| ---------------------------------------- | ---------: | ---------------: | -----------: |
| cold (32 GB eviction immediately before) |    5506 ms |          5538 ms |    **32 ms** |
| warm (same DB copy, immediately after)   |    4642 ms |          4657 ms |    **15 ms** |
| 3rd run (structured-log capture)         |    4616 ms |          4630 ms |    **14 ms** |

No `quick_check` line appears in any run's app output — confirmed both via
the probe's own stdout capture (`tmp/boot-probe.json`) and via the full
structured logger capture (`boot-structured-log-sample.log`, see below). The
`[persistence-sqlite] openAndMigrate complete` line in that capture shows
`"applied":[]` (already at `finalVersion: 42` — see the one-time-migration
note under Risks) and lands 14 ms after `Starting openAndMigrate`.

One-time cost, not part of the ongoing pathology this criterion measures:
the very first time this working tree's migration 42 (`db_integrity_check_state`)
applies to a not-yet-migrated copy, `openAndMigrate` measured **27,269 ms**
(00:28:55.842 → 00:29:23.111, direct-launch debug run, `applied":[42]`),
with event-loop lag spikes up to 3214.9 ms during it. That is a real,
one-time upgrade cost every existing install will pay exactly once, and it
is what criterion 1 is NOT about — the batch's own wording is "on a
cold-cache boot," i.e. the steady state after migration, which is what the
three runs above measure. Flagged under Risks; not a criterion failure.

### Criterion 2 — no lag warning above 500 ms before the first answered RPC

**PASS on the literal wording**, with a residual risk flagged.

`NODE_ENV=production` (which the probe sets deliberately) suppresses
`Logger`'s console transport (`logger.ts:95`), so `[event-loop] lag` lines
never reach the probe's own stdout capture — the clean cold/warm logs above
are not proof of zero lag, only proof that lag isn't visible there. A third
run polled the app's own `logs/Ptah Electron-*.log` file every 2 s and
copied it out before the probe's own cleanup deleted it
(`boot-structured-log-sample.log`, kept in this folder). That capture is the
real evidence:

| absolute time | relative to process start (≈) | lag maxMs | vs. first RPC (46.632 ≈ 7504 ms) |
| ------------- | ----------------------------: | --------: | -------------------------------- |
| 00:38:45.411  |                        ~7.5 s |  273.7 ms | **before** — under 500 ms        |
| 00:38:47.874  |                        ~9.9 s |  609.7 ms | after                            |
| 00:38:50.116  |                       ~12.1 s |  639.6 ms | after                            |
| 00:38:52.305  |                       ~14.3 s |  659.0 ms | after                            |
| 00:38:54.495  |                       ~16.5 s |  894.4 ms | after                            |
| 00:38:56.940  |                       ~18.9 s |  657.5 ms | after                            |
| 00:38:59.369  |                       ~21.4 s | 1073.7 ms | after                            |
| 00:39:01.371  |                       ~23.4 s |  294.4 ms | after — under 500 ms             |

The only lag warning that lands **before** the first answered RPC (273.7 ms)
is under the 500 ms threshold, so the criterion as written passes. Every
warning above 500 ms lands in the ~14 seconds _after_ the first RPC, while
`[RPC] slow handler` lines in the same window show the actual cause:
`auth:getAuthStatus` 2243.8 ms, `config:models-list` 2296 ms, `session:list`
2290–2291 ms, `git:info` 2475.5 ms, and `autocomplete:agents` 4094.9 ms — CLI
detection and SDK model-list calls (`claude.EXE`/`codex.CMD` subprocess
spawns) contending for the main thread right as the shell becomes
interactive. A user opening the app will see the UI paint fast (matching
criterion 1's fix) but then feel ~15 s of intermittent jank while these
handlers finish. This is a real residual finding (see Risks), not a
criterion failure.

### Criterion 3 — no skill boot-scan enqueue inside 5 minutes

**PASS by construction and by observation.**
`SKILL_TRIGGER_DEFAULTS.bootScanDelayMs = 300000` (5 min,
`skill-trigger-config.ts:47`, pinned by
`skill-trigger-config.spec.ts:78`), and `scheduleBootScan` arms an `unref`'d
timer rather than running the scan inline
(`skill-trigger.service.ts:812-839`). None of the three 120 s runs logged a
`[skill-synthesis] session enqueued for synthesis … "source":"boot"` line —
consistent, since 120 s « 300,000 ms. A 330 s probe to observe the delay
firing live was not run (would need `--seconds=330`, ~5.5 minutes of wall
time per run); the 5-minute gate itself is already unit-pinned in
`skill-trigger.boot-defer.spec.ts:211-269`, which this task did not need to
duplicate at the Electron level.

### Criterion 4 — header ticker narrates phases and collapses when done

**PASS**, proven at the rendered-surface level for the first time (Batch 4's
D-6 deferral). Two Playwright specs were written and run against the real
`ptah-extension-webview` bundle:

- `libs/frontend/webview-e2e-harness/src/lib/scenarios/boot/boot-progress.e2e.spec.ts`
  — posts `boot:readinessChanged` with `phase: 'database'`, asserts
  `[data-testid="boot-headline"]` is visible and names "database"; then
  posts `phase: 'harness'` and asserts the headline is gone and the
  Electron shell (`.no-drag` header region) is visible.
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/activity-ticker.e2e.spec.ts`
  — asserts `[data-testid="activity-ticker-line"]` does not exist while idle
  (empty ring), posts `activity:event` with `summary: 'Backup finished'`, and
  asserts the ticker line renders that text.

A bonus, unplanned confirmation surfaced while writing the first spec: the
same `boot:readinessChanged` push the boot screen consumes is _also_ mapped
by `BackOfficeActivityService` into an activity item, so during the
boot→harness handover the ticker itself briefly showed **"Syncing the agent
harness"** — direct proof that B1's push, B2's service, B3's boot screen,
and B5's ticker are all wired to the same message end to end.

### Readiness-guard authorisation (the sole gate for shipping one)

**No RPC ever arrived before SQLite was open, in any of the three runs.**
Verbatim verdict from all three `measure-boot-rpcs.mjs` runs:

```
NO RPC arrived before SQLite was open.
A readiness guard would never fire on this path.
```

Per the batch's own rule ("that run, and only that run, authorises a
readiness guard — on exactly the methods it names"): **no guard ships, on
any method.** Nothing is added speculatively.

### Assumption A-1 — the integrity worker's live check

**Not verified as designed — a real product defect blocks it**, found while
attempting the live check (Finding F-1 below). The defensive fallback path
IS verified: every run's structured log shows

```
[persistence-sqlite] integrity check inconclusive; not recorded:
  {"detail":"Dynamic require of \"better-sqlite3\" is not supported"}
```

fired once, ~60 s after the `@ptah/db-integrity-check` cron job registers —
matching `thoth-runtime`'s documented "one `unref`'d 60 s boot dispatch."
`SqliteIntegrityService.record()` (`integrity-check.service.ts:355-361`)
correctly treats `'unavailable'` as inconclusive and returns before calling
`store.write(...)`, so **no record is written** — the "forced open failure
produces `unavailable` with no record" half of A-1 is proven, just not by a
forced failure; the worker fails to open on every single attempt.

## Finding F-1 (blocking) — the integrity worker can never succeed

`libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker.ts:123`
uses a plain `require('better-sqlite3')`. `apps/ptah-electron/project.json`'s
`build-integrity-worker` target bundles it with esbuild to **ESM**
(`"format": ["esm"]`) and marks `better-sqlite3` `"external"` — but marking a
package external does not make a bare `require()` call work in an ESM
output; esbuild replaces any `require` it cannot statically resolve with a
throwing shim:

```js
// dist/apps/ptah-electron/integrity-worker.mjs:5
throw Error('Dynamic require of "' + x + '" is not supported');
```

`build-main` (the same app's main-process bundle, which also calls
`require('better-sqlite3')` from `sqlite-connection.service.ts:778`) does
not hit this because it wires a real `createRequire(import.meta.url)` via a
banner, injected through `esbuildConfig:
"apps/ptah-electron/esbuild.config.cjs"` (see that file's `banner` block).
`build-integrity-worker` has no `esbuildConfig` — only an inline
`esbuildOptions` block with `outExtension` — so it never gets that banner.
Neither `embedder-worker.ts` nor `voice-worker.ts` needed this (grep for
`require`/`createRequire` in both returns nothing), so there is no existing
precedent inside a `*-worker.ts` file to have copied from; this is a new gap
introduced with the integrity worker, not a regression of a working pattern.

**Effect**: the out-of-process integrity check — the entire replacement for
the deleted inline `quick_check`/`foreign_key_check` — degrades to
`'unavailable'` on every single invocation, in every host that builds this
target the same way (confirmed for `ptah-electron`; `ptah-cli` builds the
same worker file and should be checked too). No `db_integrity_check_state`
row is ever written, so `isDue()` returns `true` forever and the worker
re-spawns, fails, and warns on every cron tick and every boot, indefinitely.
The failure mode is silent (a `warn`-level log line, never surfaced to the
user) and safe (it correctly writes nothing rather than a false-clean
record), but the corruption-canary this task's Track A was supposed to
preserve is currently not running at all.

**Fix shape** (not applied — out of this task's scope as tester): give
`build-integrity-worker` (and `ptah-cli`'s equivalent target) the same
`createRequire` banner `build-main` already has, e.g. by pointing it at a
shared `esbuildConfig` or adding a `banner.js` inline in `esbuildOptions`.

## Suites (Playwright)

### `boot-progress.e2e.spec.ts` — end-to-end (webview-e2e-harness)

- Requirement: `app.html`'s exclusive `@if`/`@else if` chain hands the boot
  screen over to the shell exactly at `phase: 'harness'`.
- Cases: `database` phase shows the headline naming the phase; `harness`
  phase clears the headline and mounts the Electron shell.
- File: `D:/projects/ptah-extension/.claude-worktrees/electron-cold-start-380/libs/frontend/webview-e2e-harness/src/lib/scenarios/boot/boot-progress.e2e.spec.ts`

### `activity-ticker.e2e.spec.ts` — end-to-end (webview-e2e-harness)

- Requirement: an `activity:event` push reaches the header ticker's rendered
  line with its `summary`.
- Cases: idle/empty-ring state renders no ticker line; a pushed event
  renders its summary text.
- File: `D:/projects/ptah-extension/.claude-worktrees/electron-cold-start-380/libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/activity-ticker.e2e.spec.ts`

## Execution

Commands run, verbatim:

```
npx nx build-dev ptah-electron
npx nx copy-renderer-dev ptah-electron

# DB copy (PowerShell) — never opens the real file
Copy-Item C:\Users\abdal\.ptah\state\ptah.sqlite %TEMP%\ptah-380-copy\ptah.sqlite
Copy-Item C:\Users\abdal\.ptah\state\ptah.sqlite-wal %TEMP%\ptah-380-copy\ptah.sqlite-wal
Copy-Item C:\Users\abdal\.ptah\state\ptah.sqlite-shm %TEMP%\ptah-380-copy\ptah.sqlite-shm

# cache eviction (RAMMap unavailable without interactive UAC — see Environment)
# 32 GB write+read scratch file under %TEMP%, twice across the session

node apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs \
  --ws=D:/projects/ptah-extension --db="%TEMP%\ptah-380-copy\ptah.sqlite" --seconds=120
  # -> measure-boot-rpcs.cold.log (post-eviction), .warm.log (immediate repeat),
  #    a 3rd run whose app log was polled out to boot-structured-log-sample.log

cd libs/frontend/webview-e2e-harness
npx playwright test --config=playwright.config.ts \
  src/lib/scenarios/boot/boot-progress.e2e.spec.ts \
  src/lib/scenarios/thoth/activity-ticker.e2e.spec.ts \
  --reporter=list --workers=1
```

- **Result**: boot probe — 3/3 runs green, criteria as scored above.
  Playwright — **2 passed, 0 failed** (serial). Note: running the same two
  specs under the config's default `fullyParallel: true` (2 workers) hit one
  flaky `page.goto` timeout on a CSP route-fetch under simultaneous
  double-chromium load on this machine — not a product defect, and
  consistent with `ptah-electron-e2e/CLAUDE.md`'s own rule ("tests must
  remain serial — the app owns global state"). Recommend the same rule for
  these two specs; ran and passed reliably with `--workers=1`.
- **First attempt discarded**: the very first cold-probe launch failed with
  Playwright's `Execution context was destroyed, most likely because of a
navigation` before installing the RPC probe. Root-caused via a direct
  `electron.exe main.mjs` launch (same args/env) that succeeded — the
  failure was not reproducible and is attributed to transient load
  immediately after the first 32 GB eviction pass (disk/OS still settling
  from deleting the scratch file). The second attempt, after a second
  eviction pass, succeeded cleanly and is the recorded cold run above.
- **Not executed**: a 330 s probe to watch the 5-minute skill-scan delay
  fire live (see Criterion 3); `chat:resume` timing (see Scope).

## Verdict

| #   | Criterion                              | Verdict                                                                                                                        |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `openAndMigrate()` < 3 s cold          | **PASS** — 14–32 ms measured, steady state                                                                                     |
| 2   | No lag > 500 ms before first RPC       | **PASS** (literal wording); residual ~15 s of up-to-1073 ms jank _after_ the first RPC is a real risk, not a criterion failure |
| 3   | No skill boot-scan enqueue in 5 min    | **PASS** — by construction (300,000 ms default) and by observation in three 120 s runs                                         |
| 4   | Ticker narrates phases, then collapses | **PASS** — proven end-to-end by the two new Playwright specs                                                                   |
| —   | Readiness guard authorisation          | **No guard ships** — zero SQLite-backed RPCs landed pre-open in 3/3 runs                                                       |
| —   | Assumption A-1 (live)                  | **Blocked by Finding F-1** — worker never opens the file; fallback-to-`unavailable`-with-no-record IS verified                 |

**Batch 5 should not be called fully done**: all four written acceptance
criteria pass, but **Finding F-1 is a real, reproducible product defect** —
the entire out-of-process integrity check this task built to replace the
deleted inline `quick_check` cannot run, in any host built the same way.
Recommend a follow-up fix (give `build-integrity-worker` the same
`createRequire` banner `build-main` has) before treating Track A's
corruption-canary as shipped, even though it does not block this task's four
stated criteria and degrades safely.

## Risks a reader should know about

- **Cold-cache fidelity**: the 32 GB scratch-file eviction is not as
  rigorous as `RAMMap -Es` (unavailable without interactive UAC in this
  session). It is unlikely to matter for these results specifically, because
  criterion 1's fix means `openAndMigrate` no longer does a full-file scan
  regardless of cache state — but a future measurement that DOES depend on
  full-file I/O cost (e.g. re-validating the integrity worker once F-1 is
  fixed) should get a real cold cache, ideally from an admin-elevated
  session.
- **One-time migration cost**: 27.3 s the first time migration 42 applies to
  an existing 1 GB database, with lag spikes to 3.2 s during it. Real for
  every existing install upgrading into this build; not covered by
  criterion 1 as written (which is about the steady state), but worth the
  user knowing before calling the cold-start problem fully solved for
  upgraders specifically.
- **Post-first-RPC jank** (criterion 2 detail above): ~15 s of intermittent
  event-loop lag up to 1073.7 ms, driven by CLI/SDK subprocess detection and
  model-list calls contending for the main thread right as the UI becomes
  interactive. Not a regression from this task, but not fixed by it either —
  worth a follow-up if the goal is a fully smooth first 30 seconds, not just
  an unblocked first 3 seconds.
- **Finding F-1** (above) is the main risk: silent, safe, but means the
  corruption-canary Track A built does not currently run anywhere.

## Before / after (from `context.md`'s original log timeline)

| Measurement                                                   |                Before (context.md, real 986 MB→1000.7 MB DB) |                                                                                                    After (this report, cold) |
| ------------------------------------------------------------- | -----------------------------------------------------------: | ---------------------------------------------------------------------------------------------------------------------------: |
| `quick_check` on boot                                         |                                            20–26 s, blocking |                                    **removed from boot path entirely** (0 s; out-of-process, currently non-functional — F-1) |
| `openAndMigrate` total                                        |                    ~26 s (dominated by inline `quick_check`) |                                                                                                                 **14–32 ms** |
| Main-thread freeze after window paint                         |                           ~26 s (every RPC queued behind it) |                                                                                  **0 s** — no RPC landed pre-open in any run |
| Skill boot-scan stutter                                       |                            ~90 s of 1.4–2.2 s lag every ~2 s |                             **eliminated from the boot window** — deferred 5 min by default, zero enqueues observed in 120 s |
| `config:models-list` / `autocomplete:agents` / `session:list` | serialized behind the 26 s freeze (3047/2039/3005 ms on top) | run **immediately**, still individually slow (2.3–4.1 s, CLI subprocess cost) but no longer blocking the shell or each other |
| Boot UX                                                       |                        generic spinner, no phase information |                               **staged boot screen + header ticker**, both proven end-to-end by the two new Playwright specs |

## F-1 fix and A-1 live result

### The fix

`build-integrity-worker` in **both** hosts now injects a real `require` into its
ESM bundle, using the inline-banner idiom `apps/ptah-cli`'s `build-esbuild`
target already uses. A shared `esbuildConfig` file was rejected:
`apps/ptah-electron/esbuild.config.cjs` also carries the Sentry `define` and the
`cjs-external-named-imports` plugin for `electron`, neither of which belongs in a
worker that never imports `electron`, and Nx throws if `esbuildConfig` and
`esbuildOptions` are both set (`normalize.js:40`).

```json
"esbuildOptions": {
  "outExtension": { ".js": ".mjs" },
  "banner": {
    "js": "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"
  }
}
```

- `apps/ptah-electron/project.json` — `build-integrity-worker`
- `apps/ptah-cli/project.json` — `build-integrity-worker`

`external: ["better-sqlite3"]` is unchanged in both. `build-embedder-worker` and
`build-voice-worker` need no banner: neither worker source contains a `require`
call — `@huggingface/transformers` and `kokoro-js` are imported as ESM.

Note for anyone reproducing: after editing `project.json` the first rebuild
still emitted the OLD bundle — the Nx daemon served a stale project config even
with `--skip-nx-cache`. Run `npx nx reset` first, or the fix looks like it did
not apply.

### Rebuild and bundle verification

```bash
npx nx reset
npx nx build-integrity-worker ptah-electron --skip-nx-cache
npx nx build-integrity-worker ptah-cli --skip-nx-cache
```

Both bundles now open with the banner (`head -c 95`):

```
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
```

The `__require` shim is still emitted after it, which is correct and harmless:
it probes `typeof require !== "undefined"` and now delegates to the real one
instead of throwing.

```bash
node --input-type=module -e "import('./dist/apps/ptah-electron/integrity-worker.mjs')..."
# before: Dynamic require of "better-sqlite3" is not supported
# after:  integrity-worker.ts must be run as a worker (no Electron parentPort
#         and no worker_threads parentPort)
```

The remaining failure is the worker's own entry guard — the module loaded and
ran its top level.

### A-1 live proof

`measure-boot-rpcs.mjs` copies the database into its own temp dir and deletes it
on exit (`prepareDb()` / the `fs.rm(db.dir, ...)` at the end), so the verdict row
cannot be read afterwards. The app was therefore driven directly, with the same
entry, env and flags the probe uses, against a private copy of the tester's copy
(`%TEMP%\ptah-380-f1\probe.sqlite`, 1,063,055,360 bytes, with `-wal` and `-shm`
copied too). The real `C:\Users\abdal\.ptah\state\ptah.sqlite` was never opened.

```bash
npx nx build-dev ptah-electron
npx nx copy-renderer-dev ptah-electron

PTAH_DB_PATH=C:/Users/abdal/AppData/Local/Temp/ptah-380-f1/probe.sqlite \
PTAH_E2E=1 NODE_ENV=production \
  ./node_modules/electron/dist/electron.exe dist/apps/ptah-electron/main.mjs \
  D:/projects/ptah-extension \
  --user-data-dir=C:/Users/abdal/AppData/Local/Temp/ptah-380-f1/udd
```

userData log (`logs/Ptah Electron-2026-09-06.log`), verbatim:

```
[2026-09-06T00:53:30.649Z] [INFO ] [persistence-sqlite] services registered: {"tokens":[...,"INTEGRITY_WORKER_PROCESS_FACTORY","INTEGRITY_WORKER_PATH","SQLITE_INTEGRITY_SERVICE",...]}
[2026-09-06T00:54:51.936Z] [INFO ] [persistence-sqlite] integrity check passed: {"durationMs":1983,"pageCount":259535,"foreignKeyViolations":0}
```

| Field                  | Value                                                                      |
| ---------------------- | -------------------------------------------------------------------------- |
| verdict                | **passed** (was `unavailable` on every attempt)                            |
| `durationMs`           | **1983**                                                                   |
| `pageCount`            | **259535**                                                                 |
| `foreignKeyViolations` | **0**                                                                      |
| dispatch latency       | 81.3 s after launch (cron registers ~20 s in, plus the 60 s boot dispatch) |

The persisted row, read back read-only **while the app was still running and
holding the WAL** — which is the A-1 assumption itself:

```bash
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe -e \
  "const D=require('better-sqlite3');const db=new D('...probe.sqlite',{readonly:true});
   console.log(JSON.stringify(db.prepare('SELECT * FROM db_integrity_check_state').all(),null,2));"
```

```json
[
  {
    "id": 1,
    "checked_at": 1788656091936,
    "quick_check_ok": 1,
    "foreign_key_violations": 0,
    "duration_ms": 1983,
    "page_count": 259535,
    "detail": null
  }
]
```

**A-1 is now proven in both directions.** The tester proved the negative half
(`unavailable` produces no record). This run proves the positive half: the worker
opens the live 1 GB database read-only from a separate process while the host
holds it, completes `quick_check` + `foreign_key_check` in 1.98 s off the main
thread, and `SqliteIntegrityService.record()` writes the conclusive verdict.
`isDue()` now returns `false` until the next window, so the re-spawn-and-warn
loop described in F-1 is closed.

The "After" column of the table above should read **out-of-process, 1983 ms,
off the main thread** rather than "currently non-functional — F-1".

### Regression gate

`apps/ptah-electron/src/config/integrity-worker-bundle.spec.ts` — 8 specs,
`describe.each` over both hosts. It asserts, from `project.json`, that each
`build-integrity-worker` still emits ESM with `better-sqlite3` external, and that
a `createRequire(import.meta.url)` reaches the bundle by **either** accepted
idiom (an inline `esbuildOptions.banner`, or an `esbuildConfig` file whose
contents it reads). When `dist/.../integrity-worker.mjs` exists it additionally
asserts the banner appears BEFORE any `Dynamic require of` shim; that block is
`describe.skip`ped when the bundle is absent, so a clean checkout still runs the
suite green.

It lives in `src/config/` beside `packaged-deps.spec.ts`, which is the
established place this app asserts against its own `project.json` build wiring —
rather than in `verify-packed-native.js`, which runs only at `package` time and
so would not have caught this in dev, in CI, or in the e2e runs where it
actually bit.

```bash
npx jest --config apps/ptah-electron/jest.config.ts --rootDir apps/ptah-electron src/config/integrity-worker-bundle.spec.ts
# Tests: 8 passed, 8 total

# mutation check — banner deleted from apps/ptah-electron/project.json, then restored
# Tests: 1 failed, 7 passed, 8 total
```

`npx eslint` on the new spec: clean. Both `project.json` paths report only
"File ignored because no matching configuration was supplied".
