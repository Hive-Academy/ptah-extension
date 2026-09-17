# Code Style Review — Batch 9 (TASK_2026_437_0778)

CLI and VS Code `IWorkspaceWatcher` adapters, plus the move of the watch supervisor from
platform-electron into platform-core.

Reviewed uncommitted on disk in `D:\projects\ptah-437` (branch `fix/task-437-main-loop-isolation`),
base commit `13ff6045b`. No source edited, no tests run (`npx eslint` only).

## Summary

| Metric          | Value                                       |
| --------------- | ------------------------------------------- |
| Overall score   | 8/10                                        |
| Assessment      | APPROVE_WITH_FIXES                          |
| Blocking issues | 0                                           |
| Serious issues  | 2                                           |
| Minor issues    | 3                                           |
| Files reviewed  | 24 (13 modified, 11 created, incl. 6 specs) |

## Five style questions

### 1. What breaks in six months?

`WorkspaceWatchSupervisor` (`libs/backend/platform-core/src/workspace-watch/workspace-watch-supervisor.ts`,
692 lines) is now the one state machine both `ElectronWorkspaceWatcher` and `CliWorkspaceWatcher`
wrap unchanged. That is the correct place for it — a third host-based adapter (there is no
plan for one, but the hexagonal rule anticipates it: "add a runtime by adding a fourth adapter
family") gets supervision for free. What breaks first is the same thing the Batch 8 review
already flagged for `workspace-watch-host-core.ts`: this file is one class covering fork
lifecycle, watchdog, restart budget, degraded mode and recovery, and the next change to any one
of those (e.g. a per-root recovery instead of an all-or-nothing one, already named as FU-8b) has
to be made inside a class with five state-transition methods (`onHostFailure`, `enterDegraded`,
`attemptRecovery`, `confirmRecoveryIfAcked`, `armDegradedRescan`) that all read and write the same
six fields. No part of it clears the facade rule's extraction bar today (all of it is
state-coupled, confirmed by the Batch 8 delta review reaching the same conclusion for the
electron-hosted precursor of this exact code) — that verdict carries over unchanged now that the
code has moved.

### 2. What would a new team member misread?

A reader who opens `libs/backend/cli-engine/src/lib/container.ts:150` and sees
`import { createCliWorkspaceWatcherOptions } from './platform/cli-workspace-watcher-options';`
would reasonably expect this file to also appear in `libs/backend/cli-engine/src/lib/platform/index.ts`,
next to `CliPlatformCommands`, `CliPlatformAuth`, `CliSaveDialog`, `CliModelDiscovery` — every other
export of that folder is funneled through that internal barrel (`platform/index.ts:8-11`), and
`container.ts` imports those four through it (`from './platform'`, `container.ts:147`). This file
is imported two different ways from the same lib: `container.ts` bypasses both barrels with a
relative path, while `apps/ptah-cli/src/di/container.smoke.spec.ts` reaches the same function
through the _outer_ `src/index.ts` barrel (`index.ts:56`) that skips the inner one entirely. A
reader tracing "how does this module become reachable" gets two different, both-correct-but-
inconsistent answers. See Serious-1.

### 3. What does this cost to maintain?

The Electron/CLI/VS Code duplication that remains (`workspace-watch-host.entry.ts` in each of
platform-electron and platform-cli; `logDiagnostic`/`reportDegradation` shaped almost identically
in `electron-workspace-watch-host-factory.ts` and the new `cli-workspace-watcher-options.ts`) is
the same accepted, bounded cost the Batch 8 review already named ("near-duplicate-by-design"; see
Deviation verdicts there) — `platform-cli` cannot import `platform-electron` and `platform-core`
cannot take a Node-IPC or Electron import, so no third location exists to hold it. Nothing new
here raises that cost; the CLI entry (39 lines) and the Electron entry (85 lines, three transports
vs. one) diverge exactly at the transport-detection branch, which is the one part that cannot be
shared.

### 4. Where is this inconsistent with the rest of the repository?

Two places: the naming of `cli-workspace-watcher-options.ts` against the established
`apps/ptah-electron/src/services/platform/*-factory.ts` convention for the identical role
(bundle path + log/degradation sink wiring for a worker/host DI consumes) — see Serious-2 — and
the internal-barrel bypass described in Q2/Serious-1. Everything else checked (facade rule on
both new adapter classes, `catch (error: unknown)`, `export type` discipline, Zod only at the
protocol boundary, DI registration conventions, the D2 smoke-spec pin) matches sibling code
exactly; see Pattern compliance below.

### 5. What would you have done differently?

I would have added `cli-workspace-watcher-options.ts` to `lib/platform/index.ts` alongside its
three siblings and had `container.ts` import it through `from './platform'` like every other
class in that folder, instead of a fourth, unique import path. I would also have named it to
match the four existing `*-factory.ts` files in `apps/ptah-electron/src/services/platform/` —
`cli-workspace-watcher-factory.ts` reads as the same kind of thing a reader already knows how to
find, whereas "options" undersells that the file also owns the logger/degradation-reporter wiring,
not just a data shape.

## Serious issues

### `cli-workspace-watcher-options.ts` is wired differently from every sibling in its own folder

- File: `libs/backend/cli-engine/src/lib/platform/cli-workspace-watcher-options.ts`;
  `libs/backend/cli-engine/src/lib/container.ts:150`; `libs/backend/cli-engine/src/lib/platform/index.ts`;
  `libs/backend/cli-engine/src/index.ts:56`
- Problem: `lib/platform/` has one established reachability path — export from `platform/index.ts`,
  consume in `container.ts` via `from './platform'` (`container.ts:147`, unchanged by this batch).
  This file skips that barrel on both ends: `container.ts` imports it with a direct relative path
  (`container.ts:150`), and the only other consumer, `apps/ptah-cli/src/di/container.smoke.spec.ts`,
  reaches it through the _outer_ `src/index.ts` barrel instead (`cli-engine/src/index.ts:56`,
  the barrel line added by this batch). Three reachability paths exist for one new file where
  every sibling has one.
- Tradeoff: nothing about this file's shape argues for skipping `platform/index.ts` — it is the
  same kind of export (`export { X } from './platform/x'`) the other four already use — and the
  outer-barrel export exists only so a smoke spec outside this lib can reach it, which is a
  legitimate need (matched by other `cli-engine` barrel exports app code consumes directly) but
  does not explain why the inner barrel was skipped too.
- Recommendation: add `export { createCliWorkspaceWatcherOptions } from './cli-workspace-watcher-options';`
  to `lib/platform/index.ts`, and change `container.ts:150` to import it from `'./platform'` with
  the other three. Keep the outer `src/index.ts` export for the smoke spec as-is.

### `cli-workspace-watcher-options.ts` breaks the established `*-factory.ts` naming for the same role

- File: `libs/backend/cli-engine/src/lib/platform/cli-workspace-watcher-options.ts` vs.
  `apps/ptah-electron/src/services/platform/electron-workspace-watch-host-factory.ts`,
  `electron-integrity-worker-factory.ts`, `electron-embedder-worker-factory.ts`,
  `electron-voice-worker-factory.ts`
- Problem: all four existing files in this repo that do "resolve a bundled worker's path, then
  wire its diagnostic/degradation callbacks to the container's logger and degradation reporter"
  are named `{platform}-{worker}-factory.ts`. This new file does exactly that job for the CLI's
  watch host — `createCliWorkspaceWatcherOptions` (:32-41) resolves `hostPath` and binds
  `onDiagnostic`/`onDegraded` to `TOKENS.LOGGER`/`TOKENS.DEGRADATION_REPORTER` behind
  `isRegistered` guards, the identical shape `electron-workspace-watch-host-factory.ts` uses for
  the same two tokens (confirmed by the Batch 8 review scoring that file 8/10 for exactly this
  pattern) — but is named after the return type instead of the role, and the exported function is
  a verb-noun `create*Options` rather than the sibling files' `create*Factory` shape.
- Tradeoff: the name is not wrong on its own terms (it does return an options object, and this
  file has no app-level home the way the Electron factories do — `apps/ptah-cli` has no
  `services/platform/` directory, so `cli-engine` is the right lib but not the same directory
  shape). The mismatch is real but low-cost: nothing about the current name misleads a reader
  once they open the file.
- Recommendation: rename to `cli-workspace-watcher-factory.ts` (file, not necessarily the export
  name) to match the pattern a reader coming from the Electron side would already recognize.
  Not required before commit; low cost to defer.

## Minor issues

- `libs/backend/platform-core/src/workspace-watch/workspace-watch-supervisor.ts` (692 lines,
  same file class that lived at `electron-workspace-watcher.ts` in Batch 8, there 779 lines
  after that review's delta round) crosses the 700-line soft ceiling on the boundary — currently
  under it here only because the Electron- and CLI-specific code (unref'd timers, stdio, fork
  shims) split out into the two facades. No action: this is the same "state-coupled, no
  nameable independent slice" verdict Batch 8's delta review already reached for the equivalent
  code, restated because the file moved, not because anything changed inside it.
- `libs/backend/cli-engine/src/lib/container.ts` was already at 874 lines before this batch
  (over the ceiling pre-existing) and grows to 882. The executor's own choice to extract
  `createCliWorkspaceWatcherOptions` into its own file rather than inlining ~40 lines of
  logger/degradation wiring directly in `container.ts` is the right call given that pre-existing
  size — flagged only so the next addition to `container.ts` does not treat 882 as room to grow.
- `libs/backend/platform-cli/src/implementations/cli-workspace-watcher.spec.ts` builds the real
  host entry with esbuild into the repository's gitignored `tmp/` rather than the OS temp
  directory `workspace-watch-host.entry.spec.ts` (platform-electron) uses. This is not an
  inconsistency to fix: `@parcel/watcher` is an esbuild external resolved by Node's own
  `node_modules` upward walk from the bundle's directory, and only a location under the repo tree
  reaches the repo's `node_modules` that way — `os.tmpdir()` would not, on Windows least of all
  (different drive letter is common). The difference is a correct response to a real constraint,
  not drift; noted so a future reviewer does not "fix" it by moving the bundle to `os.tmpdir()`.

## File-by-file

### `libs/backend/platform-core/src/workspace-watch/workspace-watch-supervisor.ts`

Score 8/10 — 0 blocking, 0 serious, 1 minor (soft-ceiling note above, carried over from Batch 8's
verdict on the same code). Only injected timers (`WorkspaceChangeCoalescerClock`) and typed host
ports (`WorkspaceWatchHostForker`/`WorkspaceWatchHostProcess`) cross its boundary — no
`child_process`, no `process`, no global `setTimeout` reference outside the `DEFAULT_CLOCK`
constant, which is exactly the pattern `WorkspaceChangeCoalescer` already established. Clean
`export type` vs. value-export split throughout.

### `libs/backend/platform-core/src/workspace-watch/workspace-watch-batch-relay.ts`

Score 9/10 — genuinely internal (not in the public barrel; `CLAUDE.md` calls it out as such),
own private state (`pending`, `droppedCount`, `overflowOwed`) untouched by the supervisor's fields
— the same "own state, not a fragment" test the Batch 8 review used to justify extracting
`BatchRelay` in the first place, now correctly relocated as the standalone collaborator it always
structurally was.

### `libs/backend/platform-core/src/workspace-watch/workspace-watch-host-boot.ts`

Score 9/10 — exactly what its own docstring promises: engine load, `fatal` on failure, core
construction, nothing platform-specific. No Node-IPC or native `require` in this file, matching
the lib's boundary rule.

### `libs/backend/platform-electron/src/workspace-watch/electron-workspace-watcher.ts`

Score 9/10 — 53-line facade, exact class name and DI-relevant surface preserved
(`watch`/`dispose`/`isDegraded`), the textbook case the repo's facade rule describes: "the public
class keeps its name, DI token and method signatures; the extracted concern becomes a collaborator
injected into it."

### `libs/backend/platform-cli/src/implementations/cli-workspace-watcher.ts`

Score 8/10 — same facade shape as the Electron adapter, plus the CLI-only choices (unref'd
timers/channel, ignored stdio, no inherited `execArgv`) each explained in the file's own header
comment at the exact point they appear in the code. `CliWorkspaceWatchHostProcess`'s `on('error')`
handler correctly distinguishes "never spawned" (`pid === undefined`) from "spawned then died"
so the supervisor gets exactly one `exit` notification either way (:93-96).

### `libs/backend/platform-vscode/src/implementations/vscode-workspace-watcher.ts`

Score 9/10 — no native dependency, no host; reuses `WorkspaceChangeCoalescer` and
`WORKSPACE_WATCH_SUPERVISION_DEFAULTS.degradedRescanIntervalMs` from platform-core rather than
hand-rolling a second 60 s constant. `WatchSubscription.start()`'s retry-on-throw path correctly
treats "recovered" as its own `overflow` (:190-198), matching the port doc's degraded-mode
contract even though this adapter has no process to restart.

### `libs/backend/cli-engine/src/lib/platform/cli-workspace-watcher-options.ts`

Score 6/10 — 0 blocking, 2 serious (naming + wiring path, above), 0 minor. The logic itself
(`isRegistered` guards before resolving `TOKENS.LOGGER`/`TOKENS.DEGRADATION_REPORTER`) is correct
and matches the Electron factory's already-reviewed pattern; the score reflects the wiring and
naming findings, not a defect in behaviour.

### `apps/ptah-electron/src/services/platform/electron-workspace-watch-host-factory.ts`

Score 9/10 — updated cleanly to import the four relocated types from `@ptah-extension/platform-core`
instead of `@ptah-extension/platform-electron`; this is the one in-worktree consumer of the types
that platform-electron's barrel used to re-export, and it is the only one (confirmed by search),
so the barrel narrowing described below broke nothing.

### `libs/backend/platform-electron/src/index.ts`, `libs/backend/platform-core/src/index.ts`, `libs/backend/platform-cli/src/index.ts`, `libs/backend/platform-vscode/src/index.ts`

Score 8/10 — `platform-electron/src/index.ts` stopped re-exporting `WorkspaceWatchHostForker`,
`WorkspaceWatchHostProcess`, `WorkspaceWatchSupervision`, `WorkspaceWatcherDegradation`,
`WorkspaceWatcherDiagnostic` (they now live only in `platform-core`, their correct home under the
hexagonal rule — they were never Electron-specific). This is a public-API narrowing worth naming
even though it broke no in-worktree consumer: any out-of-tree code importing those types from
`@ptah-extension/platform-electron` would need to switch to `@ptah-extension/platform-core`. Given
this is a monorepo with no external package consumers of these internal libs, this is a
correction, not a regression — flagged for completeness, not as a fix to make.

## Pattern compliance

| Repository rule or nearby convention                                         | Status  | Evidence                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| platform-core: no Electron / Node-IPC / native `require` import              | PASS    | `workspace-watch-supervisor.ts`, `workspace-watch-batch-relay.ts`, `workspace-watch-host-boot.ts` import only local types, `WorkspaceChangeCoalescer`, `event-storm-breaker`                                     |
| platform-cli / platform-electron do not import each other                    | PASS    | `cli-workspace-watcher.ts` imports only `@ptah-extension/platform-core`; grep for cross-imports empty                                                                                                            |
| platform-vscode never imports `@parcel/watcher` or a sibling adapter lib     | PASS    | `vscode-workspace-watcher.ts` imports `vscode` + `@ptah-extension/platform-core` only                                                                                                                            |
| cli-engine may depend on `scope:cli` + `scope:extension` backend libs        | PASS    | `container.ts` imports `@ptah-extension/platform-cli`, `@ptah-extension/platform-core`, `@ptah-extension/vscode-core` — all `scope:extension`/leaf                                                               |
| Facade rule: class name/DI token/signatures preserved on extraction          | PASS    | `ElectronWorkspaceWatcher` unchanged surface (53 lines); `CliWorkspaceWatcher` new but matches the same shape                                                                                                    |
| `export type` for type-only re-exports                                       | PASS    | all four touched barrels (`platform-core`, `platform-cli`, `platform-electron`, `platform-vscode` `index.ts`)                                                                                                    |
| `catch (error: unknown)`                                                     | PASS    | every catch sampled across all seven new/modified source files                                                                                                                                                   |
| Zod only at the IPC/wire boundary                                            | PASS    | `workspace-watch-protocol.ts` unchanged this batch; supervisor/relay/facades trust the parsed types past it                                                                                                      |
| DI token / registration conventions (`Symbol.for`, conditional registration) | PASS    | `WORKSPACE_WATCHER` unchanged token; CLI registers conditionally on `options.workspaceWatchHost` (`registration.ts:111-116`), VS Code registers unconditionally, matching that adapter having no optional wiring |
| Smoke specs pin `WORKSPACE_WATCHER` (plan defect D2)                         | PASS    | `apps/ptah-cli/.../container.smoke.spec.ts:220-269`, `apps/ptah-extension-vscode/.../container.smoke.spec.ts:264-327`                                                                                            |
| New unit reachable the same way as its nearest siblings                      | FAIL    | `cli-workspace-watcher-options.ts` (Serious-1)                                                                                                                                                                   |
| Naming matches the established convention for the same role                  | FAIL    | `cli-workspace-watcher-options.ts` vs. sibling `*-factory.ts` files (Serious-2)                                                                                                                                  |
| File size vs. 700-line soft ceiling                                          | PARTIAL | `workspace-watch-supervisor.ts` 692 (under, carried-over note); `container.ts` 882 (pre-existing, +8)                                                                                                            |
| Port interface doc matches every adapter's implemented cadence               | PASS    | `workspace-watcher.interface.ts:153-155` states "every adapter uses 60 s"; VS Code, CLI and Electron code all use `WORKSPACE_WATCH_SUPERVISION_DEFAULTS.degradedRescanIntervalMs` or the literal 60 s it equals  |
| CLAUDE.md accuracy for all four touched libs                                 | PASS    | platform-core, platform-cli, platform-electron, platform-vscode all read consistent with the code (verified file-by-file above)                                                                                  |

## Maintenance debt

- Introduced: two new port implementations (`CliWorkspaceWatcher`, `VscodeWorkspaceWatcher`, ~380
  lines of source across 4 files) plus a structural relocation (`WorkspaceWatchSupervisor` +
  `WorkspaceWatchBatchRelay`, ~850 lines, moved from platform-electron to platform-core with no
  behavioural change — confirmed by the deleted `electron-workspace-watcher.spec.ts` reappearing
  as `workspace-watch-supervisor.spec.ts` at the same line count).
- Retired: the duplicate type re-exports platform-electron's barrel used to carry for types that
  were never Electron-specific.
- Net: additive capability (CLI and VS Code watchers now exist), neutral on code volume for the
  relocation (moved, not grown), and a small new wiring inconsistency (Serious-1) that costs one
  file, not a pattern — worth fixing before this lands so it is not copied by whatever adapter
  Batch 10+ or a future lib adds to `cli-engine/src/lib/platform/`.

## Verdict

- Recommendation: APPROVE_WITH_FIXES
- Confidence: HIGH
- Key concern: `cli-workspace-watcher-options.ts` is reachable by three different paths where
  every sibling in its folder has one; nothing here is wrong at runtime, but it is the one place
  in this batch a future editor would copy the wrong pattern from.
- What a 10/10 version would do differently:
  1. Route `cli-workspace-watcher-options.ts` through `lib/platform/index.ts` like its three
     siblings, and have `container.ts` import it from `'./platform'` (Serious-1).
  2. Name the file to match the four existing `*-factory.ts` files that do the identical job for
     Electron's other bundled workers (Serious-2, non-blocking).
  3. Nothing else — the supervisor relocation itself, both new adapters, the four CLAUDE.md
     updates and the port-doc cadence line are all correct and internally consistent.

## Deviation verdicts

### Deviation 1 — the watch supervisor and batch relay move from platform-electron into platform-core, not named in Batch 9's file list

**ACCEPT.** `batches.md` Task 9.1 (lines 578-583) lists only CLI-side files and does not mention
touching `electron-workspace-watcher.ts` or moving anything out of platform-electron. The move is
nonetheless the correct decomposition once a second host-based adapter (`CliWorkspaceWatcher`)
exists: `platform-core/CLAUDE.md`'s own Guidelines section states the rule this move satisfies —
"Transport-agnostic logic two or more adapters share ... belongs here with its I/O injected, not
copied into each adapter lib" — and that line is itself part of this batch's CLAUDE.md edit,
i.e. the executor updated the rule and followed it in the same diff. The alternative the plan's
file list implicitly assumed (`CliWorkspaceWatcher` re-implementing supervision, or importing
`@ptah-extension/platform-electron`) is barred twice over: by the hexagonal "adapters are mutually
exclusive" rule, and by `platform-electron/CLAUDE.md`'s own pre-existing line "Never re-implement
supervision here" is not present until this batch — but the Batch 8 CLAUDE.md already stated
`ElectronWorkspaceWatcher` "shares" nothing importable with a sibling adapter, since platform-cli
must not import platform-electron (restated in Batch 8's own Deviation verdict 1). Moving the
shared class to the one lib both adapters may import is the only structurally sound option.
Confirmed no behavioural change: the deleted 988-line `electron-workspace-watcher.spec.ts`
reappears, same size and same assertions in substance, as `workspace-watch-supervisor.spec.ts` —
this is a relocation, not a rewrite.

Not flagged as a planning-document defect requiring escalation (unlike Batch 8's `worker_threads`
vs `child_process.fork` discrepancy, which was raised to the team-leader before Batch 9 started):
`implementation-plan.md`'s C9 section predates the decision to build two host-based adapters
side by side and could not have anticipated the exact refactor this enables. The batches.md gap is
worth a note for whoever writes the next batch of this task, so the actual owner of
`WorkspaceWatchSupervisor` is not searched for in platform-electron by habit.

### Deviation 2 — `cli-workspace-watcher-options.ts` created in `cli-engine`, out of Task 9.1's file list

**ACCEPT, with the Serious-1 wiring fix requested above.** Task 9.1 lists only
`libs/backend/cli-engine/src/lib/container.ts` as a MODIFY target, not a new file under
`lib/platform/`. The reason given in the batch description — keeping `container.ts`'s diff to
+8 lines against a file already at 874/700 lines before this batch — is sound and matches the
CLAUDE.md file-size guidance's own spirit ("no file under ~150 lines created just to satisfy the
cap" cuts the other way here: extracting ~40 lines of logger/degradation wiring into a named,
single-purpose file is exactly what that guidance rewards, not a fragment). The placement inside
`lib/platform/` is right — it is CLI-specific glue for a `Cli*`-shaped concern, the same category
as its three siblings. The only defect is that it does not use the folder's own barrel, per
Serious-1.

## Delta review (review fixes)

Scope: the two Serious findings from the base review, plus a structural read of every other
change in this round. Read on disk in `D:\projects\ptah-437` (uncommitted); no source edited, no
tests run (`npx eslint` only, clean on every file below; `npx prettier --check` run on the two
review markdown files per the coordinator's note).

### Required fixes — verified

- **Serious-1 (wiring path)** — `cli-workspace-watcher-options.ts` is renamed to
  `libs/backend/cli-engine/src/lib/platform/cli-workspace-watcher-factory.ts` (+ its spec,
  renamed to match). It is now exported from `lib/platform/index.ts:12` alongside
  `CliPlatformCommands`/`CliPlatformAuth`/`CliSaveDialog`/`CliModelDiscovery`, and
  `container.ts:149` imports `createCliWorkspaceWatcherOptions` from `'./platform'` in the same
  destructured import as those four (`container.ts:144-150`) — one reachability path now, matching
  every sibling. The outer `src/index.ts:56` export is kept, still the only import
  `apps/ptah-cli/src/di/container.smoke.spec.ts` uses, and still correct for that reason
  (production code never uses it). **FIXED.**
- **Serious-2 (naming)** — the file is renamed to `cli-workspace-watcher-factory.ts`, matching the
  four existing `apps/ptah-electron/src/services/platform/*-factory.ts` files that do the
  identical job for Electron's other bundled workers. The function itself stays
  `createCliWorkspaceWatcherOptions` (not renamed to `...Factory`), which the coordinator states
  is deliberate to mirror `createElectronWorkspaceWatcherOptions` in
  `electron-workspace-watch-host-factory.ts` — confirmed: that file (unchanged this round) is
  itself named `*-factory.ts` while exporting a function named `create*Options`, so the CLI side
  now matches that existing split (file named for the role, function named for what it returns)
  exactly rather than introducing a new convention. **FIXED**, and more precisely aligned with the
  precedent than my own suggested name would have been.

### New code this round

**Optional `readStderrTail?()` on `WorkspaceWatchHostProcess` — the right seam.**
`workspace-watch-supervisor.ts:71-82` adds one optional method to the port every host-based
adapter's process already implements, called from exactly one place
(`withStderrTail`, :87-98) at exactly one moment (`onHostFailure`, :471-473) to append a bounded,
trimmed tail to that failure's single diagnostic line. This is the correct home for it, not an
adapter concern, for the same reason the rest of this file's supervision logic lives here: the
_consumption_ of a stderr tail (bound it, trim it, fold it into one line, never log it standalone)
is identical regardless of which adapter's process supplies it, and platform-core is the one lib
every host-based adapter may import. Making it optional (`?()`, plus `process?.readStderrTail?.()`
at :91) is exactly right for a port two implementers do not yet satisfy:
`ElectronUtilityWorkerProcess` (the Electron forker) and `InProcessWorkspaceWatchHostProcess` (the
`PTAH_WATCH_HOST=0` hatch) both compile and run unchanged, confirmed by grep — `readStderrTail` is
implemented only in `CliWorkspaceWatchHostProcess` (:141-143) and referenced only in the supervisor
and its own spec. The interface stays generic (no Node `child_process` type appears in
`workspace-watch-supervisor.ts`), so this does not leak a Node-specific shape into the port the way
a `stderr: Readable` field would have. Follow-up worth naming, not required: `ElectronUtilityWorkerProcess`
could implement the same optional method for parity — utility processes have stderr too — but
nothing regresses by its absence, since the method is optional exactly for this reason.

**`shutdown-host-runtime.ts`'s `TeardownVerb` — typed precisely.** `type TeardownVerb = 'disposeAll'
| 'dispose'` (:60) is a two-member string-literal union, not `string`, and `disposeSubsystem`'s
`verb: TeardownVerb = 'disposeAll'` parameter (:75) is checked against it at every call site:
`shutdownAgentProcesses`/`shutdownPtahCliProxies` take the default, `shutdownWorkspaceWatcher`
passes the literal `'dispose'` explicitly (:139) because `CliWorkspaceWatcher.dispose()` is the
actual method name (confirmed: `cli-workspace-watcher.ts:192-194`), not `disposeAll`. A typo in
either literal is a compile error, not a silent no-op at 2 a.m. during teardown. **No finding.**

**`workspace-watch-host.bundle.harness.ts` — naming and placement both consistent, one
non-blocking note on build scope.** `<subject>.<qualifier>.harness.ts` matches
`git-watcher.stress.harness.ts`'s own `<subject>.<qualifier>.harness.ts` shape exactly. Colocated
in `src/workspace-watch/` next to its only two consumers
(`cli-workspace-watcher.spec.ts`, `workspace-watch-host.entry.spec.ts`, both confirmed by grep) —
matching the repo's stated rule for test-support code ("colocated with its only ... consumers",
the same justification the Batch 8 delta review used for the git harness). One difference from
`platform-core`'s equivalent test-support code: `platform-core/CLAUDE.md` documents a dedicated
`src/testing/` folder excluded from `tsconfig.lib.json` (`vscode-core/tsconfig.lib.json` excludes
`src/testing/**/*` the same way), while this harness sits in `src/workspace-watch/` — a production
folder — and `platform-cli/tsconfig.lib.json`'s exclude list only covers `*.spec.ts`/`*.test.ts`,
not `*.harness.ts`. In a lib that ships a packaged build this would matter (a non-shipped test
helper compiled into `dist/`); it does not here, because `platform-cli` has no `build` target at
all (checked `project.json`: `test`, `lint`, `typecheck` only, the same "consumed as source,
bundled by the app" shape as `cli-engine`) — so there is no packaging step for the harness to leak
into. **Minor, not required**: if `platform-cli` ever gains a `build` target, move
`*.harness.ts` files under a `testing/`-style excluded folder or add `src/**/*.harness.ts` to
`tsconfig.lib.json`'s exclude list first.

**`workspace-watch-host.entry.spec.ts` and `cli-workspace-watcher.spec.ts` — build on the shared
harness correctly, no duplication reintroduced.** Both import
`buildCliWatchHostBundle`/`CliWatchHostBundle` from the harness instead of re-inlining the esbuild
invocation Batch 8's electron equivalent already established as the right pattern for this
problem (real host, real esbuild, gitignored `tmp/`). No new copy of the esbuild command exists.

**`VscodeWorkspaceWatcher.warnIfOutsideWorkspace` — correctly reuses, does not reinvent,
containment.** Uses `isPathWithinRoots` from `@ptah-extension/platform-core` (:46, :156) — the
same function `WorkspaceWatchBatchRelay` uses for the identical "is this root inside that set of
folders" check — rather than a second path-prefix comparison. Warns once per root
(`warnedOutsideRoots`, :88, :152) and does not treat the condition as a degraded state, matching
its own doc comment and the port contract (which reserves `overflow`/degradation for actual
failures, not an unverifiable-but-not-failed condition). No finding.

**CLAUDE.md updates (platform-core, platform-cli, platform-vscode) — accurate against the code
read above.** The stderr-tail line in `platform-core/CLAUDE.md`'s `workspace-watch-supervisor.ts`
bullet, the CLI CLAUDE.md's stdin/stdout/stderr/unref bullet list, and the VS Code CLAUDE.md's new
"Exclusion is two layers" / "Roots outside every workspace folder" bullets all match the source
files verified above line-for-line. No finding.

**Supervisor file size — 714 lines (was 692), still the same verdict.** Confirmed by direct count.
The +22 lines are the `readStderrTail` port addition, `withStderrTail`, and its call site — new
lines fold into the existing state machine's failure path (`onHostFailure`), not a new
independent concern, so this does not change the base review's "state-coupled, no nameable
independent slice" conclusion (Q1 above). Crosses the 700-line soft ceiling by 14 lines; still far
from "1000 means a deliberate look."

**Prettier — both review markdown files fail `--check`, as the coordinator reported.** Confirmed:
`npx prettier --check b9-code-style-review.md b9-code-logic-review.md` reports both as needing
`--write`. Per this repo's own release-branch rationale (`.lintstagedrc.mjs` runs `nx format:write`
on staged `*.md` at commit time), this is expected for any freshly written markdown and is the
team-leader's concern at commit, not a fix for this reviewer to make — noted here only so it is
not mistaken for a source-code finding.

### Delta verdict

- **Recommendation: APPROVE.** Both Serious findings are verified fixed on disk, and the new
  stderr-tail capability, the renamed CLI factory, the shutdown teardown typing, the new harness
  and specs, the VS Code `warnIfOutsideWorkspace` addition, and every touched CLAUDE.md are all
  structurally sound — no blocking or serious issues in this round.
- **Confidence: HIGH.**
- **Remaining, both non-blocking and neither required before this batch commits:**
  1. Minor — if `platform-cli` ever gains a `build` target, move `*.harness.ts` files under a
     `testing/`-style excluded folder or extend `tsconfig.lib.json`'s exclude list first; today it
     has no build target, so nothing ships.
  2. Follow-up, not a defect — `ElectronUtilityWorkerProcess` could implement the same optional
     `readStderrTail()` for parity with the CLI adapter; its absence changes nothing today because
     the port method is optional for exactly this reason.
- **Process note, not a code fix**: both review markdown files fail `npx prettier --check`; the
  team-leader's format-at-commit step (`.lintstagedrc.mjs` / `nx format:write` on staged
  `*.md`) already covers this.

### Deviation 3 — platform-electron's barrel narrows: four types no longer re-exported

**ACCEPT.** `WorkspaceWatchHostForker`, `WorkspaceWatchHostProcess`, `WorkspaceWatcherDegradation`
and `WorkspaceWatcherDiagnostic` move to being platform-core-only exports. Searched the whole
worktree (`apps/`, `libs/`) for any import of these four names from `@ptah-extension/platform-electron`
after this batch: none remain, and the one call site that used them
(`electron-workspace-watch-host-factory.ts`) was updated in the same diff to import from
`@ptah-extension/platform-core` instead. This is a correction of the Batch 8 barrel (those types
were never Electron-specific — they describe the supervisor's ports, not anything Electron does)
rather than a break, and it is the same principle the hexagonal rule states for interfaces
generally: platform-agnostic contracts belong in the leaf lib every adapter may import, not in one
adapter's barrel.
