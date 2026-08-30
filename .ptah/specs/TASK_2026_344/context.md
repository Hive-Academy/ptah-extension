# TASK_2026_344 — context

## Evidence (tmp/logs/log.log)

- 701 → 863-864: qa3elhamor (264 files, 60 dirs) re-index 7657 ms. Same folder again at
  1640 (2686 ms), 2060 (2539 ms), 2273 (4025 ms) — rebuilt from scratch on every switch
  although it was never closed.
- 1125 → 1345-1346, 1730 → 1834-1835, 2085 → 2164-2165: property-hub (15249/15399 files,
  ~4.9k dirs) rebuilt three times: 14826, 9969, 8626 ms.
- 1347-1350, 1836-1840, 2166-2169: runs of `[event-loop] lag` 260-554 ms. `EventLoopMonitor`
  samples every 2 s and warns at max >= 250 ms
  (`libs/backend/vscode-core/src/diagnostics/event-loop-monitor.ts:69,77`), so each run is
  ~6-8 s of sustained sub-second stalls. Each run begins exactly at a property-hub "Ready"
  line; no run follows a qa3elhamor "Ready".
- The 1.6-1.8 s lags at 952, 1019, 1071, 1097, 1362, 1381 … coincide with `SdkQueryRunner`
  launches and belong to TASK_2026_341, not to the index.

## Root cause

1. **Single-active-root state.** `workspace-file-index.service.ts:243-258` (`ensureReadyFor`):
   a different normalized key => `disposeWatcher()`, maps cleared in `build()` (312-313),
   full rebuild. Deliberate under TASK_2026_200 §7.2, but it makes A→B→A between two OPEN
   folders pay the full walk each time. `IWorkspaceProvider.getWorkspaceFolders()` /
   `onDidChangeWorkspaceFolders` were not consulted, so nothing distinguished "switched
   away" from "closed". Precedent for the right shape already existed in the same lib:
   autocomplete caches are keyed per root and watchers are armed per open folder
   (`src/autocomplete/workspace-folder-watchers.ts`).
2. **Wrong walk for the job.** `build()` (338-347) consumed
   `WorkspaceIndexerService.indexWorkspaceStream` (`workspace-indexer.service.ts:370-457`).
   Per file it awaited `ignoreResolver.isIgnored` (which loops every pattern of every ignore
   file through `PatternMatcherService.isMatch`, `JSON.stringify`-ing the options per call
   with a 1000-entry result LRU that thrashes on 15k paths), awaited a sequential
   `statOrNull`, and ran `classifyFile`. The file index needs only paths — its own header
   says it does not stat, yet it did, via the indexer.
3. **Watcher re-armed per switch.** `setupWatcher` (372-406) handed chokidar the whole root
   after every build and disposed it on the next switch. chokidar 5 has no recursive mode:
   it readdirp-walks every directory, opens an `fs.watch` per directory (~5k for
   property-hub) and calls `plan.ignores` (24-glob picomatch) per entry. That synchronous
   burst after "Ready" is the 400-550 ms lag run, and it was paid on every switch instead of
   once per open folder.

## Files

- `libs/backend/workspace-intelligence/src/file-indexing/workspace-file-index.service.ts` (core change)
- `libs/backend/workspace-intelligence/src/file-indexing/workspace-file-index.service.spec.ts`
- `libs/backend/workspace-intelligence/src/file-indexing/workspace-indexer.service.ts` (path-only discovery generator)
- `libs/backend/workspace-intelligence/src/file-indexing/workspace-indexer.service.spec.ts`
- `libs/backend/workspace-intelligence/src/file-indexing/ignore-pattern-resolver.service.ts` (compiled ignore matcher, additive)
- `libs/backend/workspace-intelligence/src/file-indexing/ignore-pattern-resolver.service.spec.ts`
- `libs/backend/workspace-intelligence/CLAUDE.md`
- Read-only references: `src/context/context.service.ts:445-482` (R5 guard uses `indexedRoot`
  - sync reads — contract preserved), `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:476-494`
    (boot `start(root)`), `src/services/code-symbol-indexer.service.ts:131-132`
    (`yieldToEventLoop` precedent).

## Plan

1. Path-only discovery generator on `WorkspaceIndexerService`:
   `discoverWorkspacePaths({ workspaceFolder, batchSize?, ignoreFiles? })` — one
   `findFiles('**/*', DEFAULT_WORKSPACE_EXCLUDES)`, filter with a matcher compiled ONCE,
   yield arrays of `batchSize` absolute paths, `setImmediate` between batches. No stat, no
   classify, no token count. `indexWorkspaceStream` untouched for its other consumers.
2. `IgnorePatternResolverService.compileMatcher(ignoreFiles, workspaceRoot?)` — pre-builds
   one picomatch per pattern with the same options `isIgnored` uses and applies the same
   last-match-wins/negation semantics in a tight sync loop, no string-key caching.
   `isIgnored` and `PatternMatcherService` untouched.
3. Restructure `WorkspaceFileIndexService` into a per-open-folder cache (`FolderIndex`
   record per normalized key + `activeKey`). `ensureReadyFor(root)` gets-or-creates the
   entry and sets `activeKey` synchronously before any await, so `indexedRoot` flips before
   the promise settles (ContextService R5 guard). Switching back to a completed entry is a
   pointer swap, no I/O. All queries read the ACTIVE entry — public API unchanged.
4. Eviction = folder CLOSED, not folder deactivated: subscribe once to
   `onDidChangeWorkspaceFolders`, diff against `getWorkspaceFolders()`, tear down entries
   whose root is no longer open. Plus an LRU cap so ad-hoc roots (CLI/tests) cannot grow the
   cache without bound. Never evict the active entry.
5. Watcher arming is once per folder per process; an inactive folder's watcher stays live so
   its snapshot stays fresh.
6. `rpc-handlers` `deferFileIndexRebuild`: log-only `cached` flag (skipped if a sibling task
   owns that file).
7. Update the ROOT MODEL header and the lib CLAUDE.md.

## Acceptance criteria

1. A→B→A switching with both folders open runs discovery exactly once per folder and the
   second activation resolves without I/O.
2. `createFileWatcher` is called once per open folder; A's watcher `disposeCount` stays 0
   across switches and becomes exactly 1 after `onDidChangeWorkspaceFolders` fires with A no
   longer in `getWorkspaceFolders()`.
3. A watcher event on the INACTIVE folder patches that folder's snapshot so switching back
   reflects it without a rebuild.
4. `indexedRoot` equals the requested normalized root synchronously after `ensureReadyFor` is
   invoked.
5. `discoverWorkspacePaths` never calls stat/readFile/classifyFile, yields batches of the
   configured size, and yields a macrotask between batches.
6. `compileMatcher` matches `isIgnored` for plain, negation, `dir/`, nested `baseDir` and
   Windows case-insensitive cases (table test).
7. Existing guarantees still pass: separator/drive-case variants are one key; no-root keeps
   the snapshot; watcher-unavailable host still builds; failed build retries.
8. Electron log: repeat switch to an already-open large folder completes in single-digit ms
   with no following `[event-loop]` lag run.
9. `npx nx run-many -t test -p @ptah-extension/workspace-intelligence @ptah-extension/rpc-handlers @ptah-extension/thoth-runtime`
   green with the "Running target test for 3 projects" header.

## Test projects

- `@ptah-extension/workspace-intelligence`
- `@ptah-extension/rpc-handlers`
- `@ptah-extension/thoth-runtime`

## Overlap risk with sibling tasks

- TASK_2026_341 (SDK launch lag): shares the log but no files.
- TASK_2026_343 (git handlers): different lib.
- TASK_2026_345 / TASK_2026_354: may touch
  `libs/backend/rpc-handlers/src/lib/handlers/workspace-rpc.handlers.ts`; our edit there is
  optional and log-only.
- `PatternMatcherService` and platform-electron's chokidar adapter are deliberately NOT
  modified.

## Implementation notes

### What changed

**`workspace-file-index.service.ts` — one index per OPEN folder, one ACTIVE folder.**
The service's `files` / `directories` / `ignoreFiles` / `watcher` / `startPromise` fields
became a `FolderIndex` record held in `Map<normalizedRoot, FolderIndex>` plus an
`activeKey`. `ensureReadyFor(root)` now gets-or-creates the entry, sets `activeKey`
synchronously (before any await — `ContextService.assertIndexServes` reads `indexedRoot`
in the same block as its query), and starts a build only if the entry has none. Coming
back to a folder that is still open is a pointer swap: no walk, no watcher churn. Every
query method (`search`, `getAll`, `searchDirectories`, `isReady`, `fileCount`,
`indexedRoot`) reads the active entry alone, so the public API and the single-workspace
answer are unchanged.

Cross-root contamination — the thing the old generation tokens existed to prevent —
is now structural: each build writes into its own entry's maps and publishes its own
ignore rules. The generation token stayed, with a narrower job: it stops a build or a
parked watcher handler from writing into an entry that has since been torn down.

**Eviction is by folder CLOSED, not folder deactivated.** A lazy, once-only subscription
to `IWorkspaceProvider.onDidChangeWorkspaceFolders` diffs `getWorkspaceFolders()` against
the cache and tears down entries whose root is no longer open. An empty folder list is
treated as "no information" rather than "everything closed" — the CLI reports none
permanently, and `ensureReady` already resolves the last-folder-closed case in favour of
keeping the snapshot. An LRU cap of 8 bounds hosts that pass ad-hoc roots the provider
never lists. The active entry is never evicted by either path. An inactive folder KEEPS
its watcher, so its snapshot stays fresh and switching back is free rather than merely
fast; re-arming chokidar is a readdirp walk plus one `fs.watch` per directory, which is
the burst behind the 260-554 ms lag runs.

**`workspace-indexer.service.ts` — `discoverWorkspacePaths`.** A path-only generator:
one `findFiles`, ignore rules compiled once, batches of 500 absolute paths, and a
`setImmediate` between batches. No `stat`, no `readFile`, no `classifyFile`, no token
count. `indexWorkspaceStream` is untouched for the consumers that want the stat +
classification it pays for. The file index passes its already-parsed ignore files in, so
the workspace's ignore files are read once per build rather than twice.

**`ignore-pattern-resolver.service.ts` — `compileMatcher`.** Pre-compiles one picomatch
per pattern with the same options `isIgnored` passes, and applies the same
last-match-wins / negation semantics in a synchronous loop with no string cache key and
no result LRU (that LRU is sized 1000 and a 15k-path walk evicts it before it can hit).
`isIgnored` and `PatternMatcherService` are unchanged.

**`workspace-rpc.handlers.ts` — log only.** `deferFileIndexRebuild` samples
`hasIndexFor(path)` BEFORE calling `ensureReadyFor` (which activates synchronously, so
sampling afterwards would report every switch as cached) and puts `cached` on both the
start and completion lines. Without it a 9 s first walk and a 2 ms reuse are the same log
line, which is how three full re-walks of one folder went unnoticed.

### Why these shapes

- The per-root cache and per-open-folder watchers are not a new idea in this lib —
  `src/autocomplete/workspace-folder-watchers.ts` already does exactly this, for exactly
  the reasons in its CLAUDE.md section. This aligns the file index with it.
- `setImmediate` rather than `await Promise.resolve()`: a microtask drains inside the same
  loop turn and starves timers, I/O and IPC just as the uninterrupted loop did. The test
  asserts a macrotask boundary specifically (a consumer-scheduled `setImmediate` probe
  runs between two batches), because a microtask yield would pass a weaker assertion and
  fix nothing.
- `isExcluded` (the per-event watcher path) still calls `isIgnored`, not the compiled
  matcher. One path per event pays none of the costs the bulk path pays, and keeping one
  reference implementation for the incremental path is worth more than the saving.

### Test results

- `npx nx run-many -t test -p @ptah-extension/workspace-intelligence @ptah-extension/rpc-handlers @ptah-extension/thoth-runtime --skip-nx-cache`
  — header `Running target test for 3 projects`.
  - `@ptah-extension/rpc-handlers`: 90 suites passed, 2518 passed / 31 skipped / 2549 total.
  - `@ptah-extension/thoth-runtime`: 3 suites passed, 45 / 45 passed.
  - `@ptah-extension/workspace-intelligence`: 39 of 40 suites passed, 1003 passed /
    1 failed / 1004 total. The one failure is
    `ContextSizeOptimizerService › Performance › should optimize 1000 files in under 100ms`
    — a WALL-CLOCK assertion in `context-analysis/`, a directory this task does not touch
    (`git diff --name-only -- src/context-analysis/` is empty). It passes in isolation
    (19/19 in 4.6 s). The machine was running 90+ concurrent node processes from sibling
    tasks; an earlier run of the same command failed a DIFFERENT wall-clock test
    (`TypeScriptDiagnosticsProvider › the TTL is short enough that a call six seconds later
recompiles`, a 60 s jest timeout) and passed this one, which is the signature of load
    rather than of a regression.
- `npx nx run-many -t typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/rpc-handlers @ptah-extension/thoth-runtime --skip-nx-cache`
  — `Successfully ran target typecheck for 3 projects`.
- Direct jest on the touched areas, unloaded:
  `file-indexing|context` → 8 suites, 257/257 passed (this includes
  `context.service.spec.ts`, which exercises the R5 `indexedRoot` guard against the new
  synchronous activation).
- Lint (`npx eslint`) clean on all changed production and spec files.

New tests: 12 in `workspace-file-index.service.spec.ts` (once-per-folder walk, no-I/O
re-activation, synchronous `indexedRoot` flip, one watcher per folder kept across
switches, dispose-once-on-close, re-walk after re-open, active folder never evicted,
empty folder list keeps everything, inactive-folder watcher patching, LRU cap,
`hasIndexFor`, per-folder ignore rules), 6 in `workspace-indexer.service.spec.ts`
(no stat/read/classify, compile-once filtering, caller-supplied ignore files, batch size,
macrotask between batches, missing-root throw), 11 in
`ignore-pattern-resolver.service.spec.ts` (the compileMatcher-vs-isIgnored table), and 2
in `workspace-rpc.handlers.spec.ts` (the `cached` flag, hot and cold).

### Not done

- Acceptance criterion 8 (the Electron log check) is NOT verified: it needs a running
  desktop host switching between two real folders, which this session cannot drive. The
  mechanism behind it is covered by the unit tests instead — discovery runs once per
  folder, the watcher is armed once per folder, and the walk yields a macrotask between
  batches — and the `cached` flag added to `deferFileIndexRebuild` is what makes the log
  answer this directly on the next captured session.

  **Superseded by "Revision (round 2)" below — criterion 8 is now captured live.**

## Revision (round 2)

Two judge defects. Both addressed; one needed a live Electron capture that did not
exist before, and it is now two log files in `tmp/logs/`.

### Defect 2 — `evictOverflow` could evict a folder the host still has OPEN

`evictOverflow` sorted every non-active entry by `lastActiveAt` and evicted the oldest,
consulting nothing else. The class docstring and the CLAUDE.md section both promised the
cap only bounds ad-hoc roots the provider never lists, and that a real open folder is
evicted by CLOSE alone — but nothing enforced that. A nine-root Electron/VS Code
workspace therefore hit exactly the bug this task removes, one level up: activating the
9th folder disposed the least-recently-used folder's LIVE watcher and cleared its
snapshot while `getWorkspaceFolders()` still listed it, so cycling across the nine
re-walked and re-armed chokidar on nearly every switch. That is the alternating-eviction
thrash the sibling autocomplete cache already fixed once at N=2 (this lib's CLAUDE.md,
"Autocomplete discovery"). The only overflow test used `openFolders: []`, i.e. ad-hoc
roots — the one case where the cap SHOULD bite — so nothing caught it.

Fix (`workspace-file-index.service.ts`):

- Extracted `openFolderKeys()`: the normalized roots the provider currently reports as
  open, or `undefined` when it cannot say. `evictClosedFolders` now reads it too, so the
  "empty list means no information" rule has exactly one implementation instead of two.
- `evictOverflow` filters out every entry present in that set. The cap is now SOFT: when
  every remaining candidate is still open, the cache simply exceeds it, because the
  alternative is re-walking a folder the user still has open. The provider call is made
  only after the size check, so the common path pays nothing for it.
- Held-above-cap is logged once per crossing, latched on `overCapNoticeLogged` —
  `ensureReadyFor` runs on every autocomplete query, so an unlatched line would be
  per keystroke.
- Docstrings updated at the class header (consequences bullet), at
  `MAX_CACHED_FOLDERS`, and at `evictOverflow`; the CLAUDE.md "File index" bullet now
  states the soft-cap rule and why a hard LRU reinstates the bug.

Two new tests in `workspace-file-index.service.spec.ts`:

- _never evicts a folder the host still lists as open, even past the cap_ — nine
  provider-listed folders, activated in order. Nine walks, nine watchers, zero disposes;
  `getWorkspaceFolders()` is asserted to have been consulted; then two full cycles across
  all nine cost zero further walks and zero disposes. Against the old code the 9th
  activation disposed folder 1's watcher, so this fails there.
- _still evicts ad-hoc roots the host never lists, while open folders stay_ — eight open
  folders plus three ad-hoc roots. Every open folder survives, the two older ad-hoc roots
  are evicted, the active one is not; re-activating an open folder costs no walk and
  re-activating an evicted ad-hoc root costs exactly one.

### Defect 1 — criterion 8 now has live Electron evidence

Two captures were driven against the REAL built Electron main process
(`dist/apps/ptah-electron/main.mjs`, rebuilt from this working tree with
`nx build-main ptah-electron --configuration=development`) through Playwright's
`_electron`, firing RPCs on the same `rpc` ipcMain channel the preload uses. Harness
scripts: `tmp/task344/capture-electron.mjs` and `tmp/task344/capture-walk-isolated.mjs`.

Launch notes worth keeping: `main.ts:30-37` forces userData to `<roaming appData>/Ptah Dev`
when `NODE_ENV=development`, which OVERRIDES `--user-data-dir`, so a capture launched that
way collides with any running dev instance on the single-instance lock and exits 0 with an
empty log (observed twice). Leaving `NODE_ENV` unset keeps `--user-data-dir` authoritative,
and `PTAH_LOG_LEVEL=debug` restores the console log the baseline was read from
(`Logger.detectDevelopmentMode()` treats it as development). `PTAH_DB_PATH` and
`--user-data-dir` point at temp dirs, so neither capture touched the developer profile.

**Capture 1 — A→B→A→B over `workspace:switch`** (`tmp/logs/task344-electron-live.log`,
1327 lines). A = `D:\projects\property-hub`, B = `D:\projects\qa3elhamor`; both registered
via `workspace:registerFolder` first, so both are genuinely open.

- `:854` first build of A — `[WorkspaceFileIndex] Ready: 15384 files, 4952 directories:
{"root":"D:\\projects\\property-hub","durationMs":7208}`.
- `:1032` and `:1036` the REPEAT switch back to A —
  `re-indexing files for workspace: {...,"cached":true}` then
  `file re-index complete: {...,"durationMs":0,"fileCount":15385,"cached":true}`.
  Zero ms, not single-digit, and the file count is 15385 rather than 15384: the inactive
  folder's watcher had picked up a new file while B was active (criterion 3, in the wild).
- `:1229`/`:1239` the same for the repeat switch back to B: `cached:true`, `durationMs:0`.
- Compare the baseline: `log.log:1346,1835,2165` — the same folder rebuilt three times at
  14826 / 9969 / 8626 ms.

There ARE `[event-loop] lag` lines after the repeat switch (`:1096` 912.8 ms, `:1109`
492.6 ms, `:1190`, `:1216`, `:1221-1224`). They are NOT the index: the re-index line
adjacent to them says `durationMs:0`, and the log names what did run —
`[WARN] [RPC] slow handler: {"method":"git:stashList","durationMs":2220.7}` at `:1101`,
`[UserLayerMirror] mirrorAll complete` at `:1092`, `[harness-sync] Reconcile complete` at
`:1103`, `:1106`, `:1110`, and a second `git:info` at 5152.8 ms at `:1192`, plus
`[CliDetection]` process spawns. A `workspace:switch` reloads
the renderer and re-runs every panel fetch; that cost belongs to other work, and this
capture cannot separate it. Capture 2 does.

**Capture 2 — the walk in isolation** (`tmp/logs/task344-electron-walk-isolated.log`,
651 lines). `context:getAllFiles { workspaceRoot }` reaches
`ContextService.ensureIndexFor` → `WorkspaceFileIndexService.ensureReadyFor` and nothing
else — no renderer reload, no session import, no harness sync. Three 24 s windows, each
long enough for twelve `EventLoopMonitor` sampling windows:

- `:625` CONTROL (idle, no app work): **0 lag samples**.
- `:641` WALK (first build of the 15384-file folder): 8 lag samples, all ≥ 250 ms,
  max 1361.1 ms.
- `:648` REPEAT (same root again): **0 lag samples**, and `:649` `repeat re-walked? NO`.

The ordering inside the WALK window is what attributes those eight samples (`:628-639`):
`:628` `context:getAllFiles called` → `:629` `[WorkspaceFileIndex] Ready: 15384 files,
4952 directories: {...,"durationMs":2261}` → `:632-639` the eight lag lines.
**Not one lag sample falls inside the walk.** They begin after it,
which is where `setupWatcher` hands the root to the Electron chokidar adapter — chokidar
has no recursive mode, so it readdirp-walks all 4952 directories and opens an `fs.watch`
per directory, asynchronously, after construction. The CONTROL window rules out ambient
machine load and the REPEAT window rules out anything the query path itself does.

So, against criterion 8, faithfully:

- "repeat switch to an already-open large folder completes in single-digit ms" — **met**,
  at 0 ms (capture 1 `:1036`, `:1239`).
- "with no following `[event-loop]` lag run" — **met for the index**, not for the switch
  as a whole. In capture 2's REPEAT window, where only the index runs, there are zero lag
  samples. In capture 1 the switch's other work (git handlers, harness sync, CLI
  detection) still lags; that is out of this task's scope and is named in the log.
- "first build of a 15k-file folder produces no ≥250 ms lag sample attributable to the
  walk" — **met as written**: the 2261 ms walk produces none. The eight samples that
  follow it belong to the chokidar arming burst, which this task's design deliberately
  keeps and pays ONCE PER OPEN FOLDER instead of once per switch — and the REPEAT window
  proves the second activation pays it zero times. Pre-fix that burst is the 260-554 ms
  run behind every "Ready" line in the baseline (`log.log:1347-1350,1836-1840,2166-2169`).
  Removing it entirely is a chokidar/adapter question, not a file-index one; it is not
  in this task's scope and was not attempted.

Caveat recorded rather than hidden: the machine ran ~50 concurrent node/electron
processes from sibling tasks at 100% CPU during capture 1, which inflates its absolute
lag magnitudes (2-3 s samples during boot). Capture 2's CONTROL window is the answer to
that — under the same load, an idle window logged zero samples, so the WALK window's
samples are the app's own work and not ambient noise.

### Verification (round 2)

- `npx nx run-many -t test -p @ptah-extension/workspace-intelligence @ptah-extension/rpc-handlers @ptah-extension/thoth-runtime --skip-nx-cache`
  → `Successfully ran target test for 3 projects`, all green:
  - `@ptah-extension/rpc-handlers`: 90 suites, 2522 passed / 31 skipped / 2553 total.
  - `@ptah-extension/thoth-runtime`: 3 suites, 45 / 45.
  - `@ptah-extension/workspace-intelligence`: 40 suites, **1006 / 1006** — including the
    two new eviction tests, and including `ContextSizeOptimizerService › Performance`,
    the wall-clock test that flaked under load in round 1.
- `npx nx run-many -t typecheck -p ... --skip-nx-cache` → `Successfully ran target
typecheck for 3 projects`.
- `npx eslint` clean on both changed files.
