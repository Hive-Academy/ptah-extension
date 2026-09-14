# Code Logic Review — `TASK_2026_437_0778` Batch 9

Scope: the move of the Batch 8 Electron adapter's supervision logic into
`WorkspaceWatchSupervisor` + `WorkspaceWatchBatchRelay` (platform-core),
`ElectronWorkspaceWatcher` reduced to a facade, `bootWorkspaceWatchHost` /
`toWorkspaceWatchEngine` (platform-core, `workspace-watch-host-boot.ts`),
`CliWorkspaceWatcher` + its `child_process.fork` host process + entry
(platform-cli), `VscodeWorkspaceWatcher` (platform-vscode), the CLI
`cli-workspace-watcher-options.ts` wiring (cli-engine), and every registration
and DI-smoke-spec touchpoint in the diff against `13ff6045b`. Read in full, not
by diff hunk, including the pre-move `electron-workspace-watcher.ts`/`.spec.ts`
as they existed at `13ff6045b` for the behaviour-preservation check. No source
edited; no full suite run (per instructions, single-spec `jest -c` only, and
none was needed beyond what is cited below since the executor's own evidence
already exercises the changed files).

## Summary

| Metric              | Value              |
| ------------------- | ------------------ |
| Overall score       | 7/10               |
| Assessment          | APPROVE_WITH_FIXES |
| Blocking issues     | 0                  |
| Serious issues      | 2                  |
| Moderate issues     | 5                  |
| Failure modes found | 6                  |

The supervisor move is clean: `WorkspaceWatchSupervisor` is the Batch 8
adapter's logic verbatim (confirmed by a normalized diff below — only
comments, type-import paths and the `BatchRelay` extraction changed; every
assertion in the moved spec is byte-identical), so the three rounds of
already-approved Batch 8 review evidence (stall-aware watchdog, degraded
recovery with `subscribed` acks, invalid-message cap) carry forward unchanged
and are not re-litigated here except where the new facades interact with them.
The CLI facade's unref/stdio-ignored/missing-bundle design is sound and
matches its own documented intent. The two Serious findings are new to this
batch: the VS Code adapter's exclusion model is weaker than the two host-based
adapters' (per-adapter cost, not per-native-subscription), and it can silently
under-deliver for an out-of-workspace root with zero adapter-visible signal —
both directly bear on the D4 "nested repos/worktrees excluded everywhere"
decision and the freeze-prevention goal this whole task exists for.

## Five logic questions

### 1. How does this fail silently?

- `libs/backend/platform-vscode/src/implementations/vscode-workspace-watcher.ts:151-199` —
  `createFileSystemWatcher` succeeding is treated as full success (the `else`
  branch after the `try`), but VS Code's own file-watcher documentation and
  behaviour only guarantee **recursive** watching for a path that resolves
  inside one of `vscode.workspace.workspaceFolders`; a root outside every
  workspace folder either falls back to non-recursive watching or watches
  nothing, with no exception and no error event — the adapter's own header
  comment ("the one failure this adapter can see is `createFileSystemWatcher`
  throwing") is therefore incomplete. A consumer subscribing to a nested
  repo/worktree root or an attached external folder that is not itself an
  open workspace folder gets a `watch()` call that returns a live-looking
  `IDisposable`, never an `overflow`, and simply never delivers most events —
  worse than a `create` throw, because nothing here treats it as degraded.
- `libs/backend/platform-vscode/src/implementations/vscode-workspace-watcher.ts:5,155-157` —
  the file's own docstring asserts VS Code "already watches out of process and
  applies `files.watcherExclude`", but nothing in this diff (or anywhere in
  `platform-vscode`/`apps/ptah-extension-vscode`, confirmed by grep) reads or
  sets `files.watcherExclude`. The claim is aspirational, not implemented: a
  user without that setting configured for `.claude-worktrees`/nested repos
  gets full-tree native OS watching and per-event extension-host IPC delivery
  for excluded paths, with the coalescer's exclusion (`isExcluded`,
  `workspace-change-coalescer.ts:231`) only discarding the event AFTER the
  native watch + IPC hop already paid for it. This masks the true state of D4
  ("nested repos/worktrees excluded from every consumer") for the one host
  most contributors run day to day.
- `libs/backend/cli-engine/src/lib/platform/cli-workspace-watcher-options.ts:50` —
  `logDiagnostic` drops every diagnostic before `TOKENS.LOGGER` is registered,
  with no queue and no fallback (confirmed intentional and pinned by
  `cli-workspace-watcher-options.spec.ts:23-46`, "logs... and never to the
  console before"). Currently harmless because nothing calls `.watch()` before
  Phase 1 registers the logger, but the moment any future caller (a Phase-0
  consumer, or a very early smoke check) triggers a fork failure before the
  logger exists, that diagnostic is gone forever — no queue, no stderr
  fallback the way `shutdown-host-runtime.ts` uses for its own signal-handler
  teardown.

### 2. What user action produces unexpected behaviour?

- A CLI user who runs a long-lived `ptah interact`/`ptah tui` session that also
  happens to have **zero** other ref'd handles at some quiet moment (unlikely
  today because stdin reading keeps the loop alive, verified by grep of
  `process.stdin` in `interact.ts`/`tui.ts`, but worth naming since nothing in
  this file enforces that invariant) would see the process exit while the
  watch host is still degrading/restarting — not a defect in what shipped, but
  an implicit cross-file dependency: `CliWorkspaceWatcher`'s liveness depends
  on some OTHER part of the CLI keeping the event loop alive, and nothing here
  documents or asserts that dependency close to the unref'd clock
  (`cli-workspace-watcher.ts:64-68`).
- A user on a workspace with a permission-denied or otherwise permanently
  unwatchable nested root, once Batch 11 wires real consumers, inherits the
  Batch-8-documented "one bad root blocks recovery for every root" limitation
  identically on the CLI (same `WorkspaceWatchSupervisor`) — already accepted
  in the Batch 8 delta review as a named, non-blocking residual; noted again
  here only because C9 is the first place a second production adapter
  (`CliWorkspaceWatcher`) inherits it verbatim, which the task asked to
  confirm.
- A VS Code user working in a workspace with several worktrees under one open
  folder pays for N independent native recursive watchers the moment N
  subscribers (Batch 11: `GitWatcherService` and `WorkspaceFileIndexService`)
  watch overlapping or identical roots — see Moderate finding below. Nothing
  the user does surfaces this; it is purely a background resource cost.

### 3. What input data produces a wrong answer?

- `libs/backend/platform-cli/src/implementations/cli-workspace-watcher.ts:78-96` —
  `CliWorkspaceWatchHostProcess`'s constructor throws synchronously
  (`fs.existsSync` check) for a missing bundle, which the supervisor correctly
  treats as `fork-failed`. But a bundle that EXISTS yet is not the expected
  ESM/`createRequire` shape (e.g., a stale CJS build left from a prior Task 10
  iteration, or a partially-written file from a build that crashed
  mid-`outfile` write) is not checked at all — `fork()` succeeds, the child
  process starts, and only later — when it fails to `require('@parcel/watcher')`
  or throws on a syntax error — does the supervisor see an `exit`/`fatal`. This
  is handled correctly as a failure (same budget, same degrade path), just
  slower to surface (one full fork+boot instead of an instant `fork-failed`);
  not a defect, but worth naming since Task 10.4's mandatory build order
  (`ptah-cli` → `ptah-tui` → `restore-cli-manifest`) is precisely the kind of
  multi-step build where a partial artifact could exist transiently.
- `libs/backend/platform-vscode/src/implementations/vscode-workspace-watcher.ts:183-184` —
  `uri.fsPath` is passed straight to `coalescer.push` with no path
  normalization against the adapter's own `root` string's separator style; on
  Windows, VS Code URIs normally use backslash-free `fsPath` forms consistent
  with the workspace, and the exclusion predicate is documented elsewhere in
  this task (Batch 2) as separator-tolerant, so this is very likely fine —
  flagged only because no spec in this batch drives a mixed-separator VS Code
  path the way Batch 2's own spec table did for the shared predicate.

### 4. What happens when a dependency fails?

- `@parcel/watcher` missing/broken for the CLI host: identical to Batch 8's
  Electron path via the shared `bootWorkspaceWatchHost` — `fatal` posted,
  adapter restarts within budget, degrades on the sixth failure
  (`workspace-watch-supervisor.ts:491-524`, `restartBudget: 5`,
  `restartDelayMs: 250` — confirmed by reading
  `WORKSPACE_WATCH_SUPERVISION_DEFAULTS`, `workspace-watch-supervisor.ts:113-121`).
  Six failures cost ≈5×250 ms ≈ 1.25 s wall-clock via `setTimer`, never
  synchronously looping (each retry is scheduled, not called inline — traced
  through `onHostFailure` → `restartTimer = this.clock.setTimer(...)` at
  `workspace-watch-supervisor.ts:515-523`) and each failure logs exactly one
  bounded diagnostic, not a stream — closes task item 3 (no tight loop, no log
  spam, delay is applied).
- The CLI host process itself dies with a native crash before it can `post()`
  anything (e.g., a `@parcel/watcher` native-binding segfault): the child's
  stdio is `ignore` for stdout/stderr (`cli-workspace-watcher.ts:82`), so
  whatever the crash would have printed is unrecoverable — the supervisor only
  learns `exited` with the raw exit code (`workspace-watch-supervisor.ts:322-325`),
  no stderr text. `fatal` messages that ARE posted before a crash (the
  guarded path through `bootWorkspaceWatchHost`) survive over IPC regardless
  of stdio — this closes half of task item 5, but a genuine unhandled native
  crash outside that guarded path is diagnostically invisible beyond an exit
  code. See Moderate finding below.
- VS Code's own watcher subsystem: a `createFileSystemWatcher` throw is
  handled (retry + overflow, well tested,
  `vscode-workspace-watcher.spec.ts:212-258`); a watcher that is created but
  degrades silently for an out-of-workspace root is NOT (Serious-1).

### 5. What is missing that the requirements never mentioned?

- No test drives `files.watcherExclude` interaction, multi-root workspaces, or
  a root outside every `vscode.workspace.workspaceFolders` entry — confirmed
  by reading the full `vscode-workspace-watcher.spec.ts` (315 lines): every
  case uses a synthetic watcher-double bus keyed only on `RelativePattern`
  base/pattern matching, never VS Code's actual folder-membership semantics.
- No integration test proves the CLI child actually exits when the parent
  disconnects (the `process.on('disconnect', () => process.exit(0))` line in
  `workspace-watch-host.entry.ts:36` is exercised only by the contract
  suite's own explicit `kill()` calls, never by letting a real parent process
  exit and observing the child die) — the orphan-prevention claim rests on
  Node's documented IPC-channel-close semantics, not on a repo-local proof, the
  same residual the Batch 8 delta review already flagged for the identical
  Electron-side line (`workspace-watch-host.entry.ts:76`, deviation-1 verdict,
  "worth a note for whoever eventually adds an integration test").
- Nothing measures or asserts host RSS/CPU for the CLI child the way the plan
  asks for the Electron host (C8: "host RSS target < 150 MB") — not called out
  in C9's file list either, so likely out of scope, but worth naming since a
  `ptah` one-shot command now always risks forking a Node child process with
  its own `@parcel/watcher` native binding the moment any future consumer
  calls `.watch()`.

## Failure modes

### VS Code adapter cannot see partial/degraded native watching outside the workspace

- Trigger: a consumer calls `VscodeWorkspaceWatcher.watch(root, ...)` for a
  `root` that is not inside any `vscode.workspace.workspaceFolders` entry
  (e.g., a linked external repo, or — once Batch 11 wires nested-root
  detection — a nested repo whose containing folder was itself added to the
  workspace only via a symlink VS Code does not resolve into its folder list).
- Symptom: `createFileSystemWatcher` returns a live-looking watcher object; no
  exception, no `overflow`, no diagnostic. Depending on the VS Code build and
  platform, the watcher either does not fire at all or only fires for direct
  children (non-recursive) — the consumer silently sees a stale or partial
  tree with the adapter reporting nothing wrong.
- Evidence: `vscode-workspace-watcher.ts:151-199` (no folder-membership check
  before or after `createFileSystemWatcher`); no spec exercises this path
  (`vscode-workspace-watcher.spec.ts` full read, no `workspaceFolders` mock is
  ever installed).
- Current handling: none.
- Recommendation: before creating the watcher, check
  `vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root))`; when
  undefined, either emit one `warn` diagnostic ("recursive watching for a path
  outside every workspace folder is not guaranteed") so operators can
  correlate a "stale tree" report with this specific cause, or (stronger) treat
  it the same as a create failure and put the subscriber on the rescan
  cadence. Either needs a regression test that mocks
  `vscode.workspace.getWorkspaceFolder` to return `undefined` and asserts the
  chosen behaviour.

### VS Code adapter pays native + IPC cost for excluded paths before the coalescer ever runs

- Trigger: any subscriber whose `options.excludeGlobs`/`excludeDirNames`/
  `excludeSegmentRules` would exclude a directory under `root` (nested repos,
  `.claude-worktrees`, `node_modules`, etc.) — the D4 scenario this whole task
  exists to close.
- Symptom: the Electron and CLI adapters pass the intersection of subscriber
  excludes as `ignore` to the native `@parcel/watcher.subscribe` call
  (`workspace-watch-host-core.ts`, `computeNativeIgnore`, unchanged from
  Batch 8), so excluded paths never cross into JS at all. The VS Code adapter
  has no equivalent: `createFileSystemWatcher(new RelativePattern(root,
'**/*'))` takes only a positive include glob, so VS Code's own watcher
  process (out of the extension host, but still real OS + IPC work) observes
  and forwards EVERY change under `root`, including inside a nested repo or
  worktree, and only `WorkspaceChangeCoalescer.push`'s `isExcluded` check
  (`workspace-change-coalescer.ts:231`) — running after the IPC hop — discards
  it.
- Evidence: `vscode-workspace-watcher.ts:151-157` (no exclude passed to VS
  Code); `workspace-change-coalescer.ts:231` (exclusion is post-delivery);
  contrast with `workspace-watch-host-core.ts`'s native-level `ignore` (Batch
  8, unchanged).
- Current handling: none; the file's own docstring asserts `files.watcherExclude`
  is what closes this gap, but nothing in this diff configures it.
- Recommendation: either (a) have the extension proactively merge
  `DEFAULT_WORKSPACE_EXCLUDES`-derived globs into the user's
  `files.watcherExclude` at activation (a workspace-level `vscode.workspace
.getConfiguration('files').update('watcherExclude', ..., ConfigurationTarget
.Workspace)`, which is a legitimate write of a NON-trademarked, non-provider
  setting and does not conflict with the marketplace-scanner rule in
  `CLAUDE.md`, which is only about trademarked provider keys in
  `contributes.configuration`), or (b) accept the gap explicitly as a
  documented, lower-priority-than-native-hosts trade-off and correct the
  docstring so it does not claim protection that does not exist. Either way
  this should be resolved before Batch 11 wires `GitWatcherService`/the file
  index onto this adapter for VS Code users, since silent per-event cost on
  excluded trees is exactly the class of problem P1 already fixed for the
  git watcher and file index's OWN watchers.

### CLI host stderr is unrecoverable on an unguarded native crash

- Trigger: `@parcel/watcher`'s native binding crashes the forked host process
  outside the `bootWorkspaceWatchHost`-guarded path (e.g., a hard native
  fault during an active `subscribe` callback, not during load).
- Symptom: the child's stdout/stderr are `ignore` (`cli-workspace-watcher.ts:82`),
  so whatever Node or the native addon would have printed about the crash is
  discarded. The supervisor observes only `exited` with a numeric/`null` exit
  code (`workspace-watch-supervisor.ts:322-325`) — enough to restart and
  eventually degrade correctly, but nothing a support engineer can use to
  diagnose WHY, unlike a fork failure or a graceful `fatal`, both of which
  carry a message.
- Evidence: `cli-workspace-watcher.ts:16-17,82` (documented, deliberate
  trade-off: "The child's stdio is ignored... a host line on either would
  corrupt them"); `workspace-watch-supervisor.ts:322-325` (`exit code
${String(code)}` only).
- Current handling: accepted trade-off, documented in the file's own header.
- Recommendation: Moderate, not blocking — the design correctly protects
  JSON-RPC/TUI stdout integrity, which is the higher-priority invariant, but
  consider piping the child's stderr to a small in-memory ring buffer (last
  N KB) that is attached to the diagnostic only when the host exits abnormally
  (non-zero, non-`SIGTERM` code), so an operator debugging a crash loop is not
  limited to "exit code null" — the CLI logs to a file already
  (`logsPath`/`ptah-hang.log` precedent from Batch 5), so this has a natural
  home.

### CLI early-diagnostic loss window (named above, Q1) is real but currently unreachable

- Trigger: a diagnostic fires before `TOKENS.LOGGER` is registered.
- Symptom: silently dropped, no queue, no fallback.
- Evidence: `cli-workspace-watcher-options.ts:43-50`;
  `cli-workspace-watcher-options.spec.ts:23-31` (explicitly asserts this).
- Current handling: intentional, tested, documented ("No console fallback").
- Recommendation: acceptable as shipped, since nothing calls `.watch()` before
  Phase 1 completes (registration only constructs the watcher; the fork
  happens lazily on first `watch()`, and Batch 11 will be the first caller,
  landing well after the logger exists). List as a residual only in case a
  future Phase-0 consumer changes that invariant.

### VS Code adapter does not multiplex identical roots across subscribers

- Trigger: two or more `IWorkspaceWatcher.watch()` calls for the same or an
  overlapping `root` (the expected Batch 11 shape: `GitWatcherService` and
  `WorkspaceFileIndexService` both watching the workspace root).
- Symptom: each call creates its OWN `createFileSystemWatcher`, i.e., N
  independent native recursive watchers over the same tree, each generating
  its own IPC traffic into the extension host — unlike the Electron/CLI
  adapters, which intersect subscriber excludes onto ONE native
  `@parcel/watcher.subscribe` per root (`workspace-watch-host-core.ts`,
  unchanged Batch 8 design).
- Evidence: `vscode-workspace-watcher.ts:87-124` (`watch()` always constructs a
  fresh `WatchSubscription`/coalescer/watcher, no de-duplication by root).
- Current handling: none; not worse than the pre-fix status quo (each service
  already ran its own `fs.watch`), so not a regression, but a missed
  optimisation relative to the two other adapters built in this same task.
- Recommendation: Moderate, non-blocking for C9; worth a follow-up once Batch
  11's actual subscriber count against the same root is known — a
  reference-counted watcher-per-root cache in `VscodeWorkspaceWatcher` would
  close the gap without touching the port contract.

### Behaviour-preservation of the moved supervisor (executor's claim) — CONFIRMED

- Trigger: N/A — this is the verification the task specifically asked for.
- Method: `git show 13ff6045b:.../electron-workspace-watcher.ts` and its spec,
  normalized (`ElectronWorkspaceWatcher` → `WorkspaceWatchSupervisor`,
  `electron-workspace-watcher` → `workspace-watch-supervisor` path
  literals), diffed against the new
  `libs/backend/platform-core/src/workspace-watch/workspace-watch-supervisor.ts`
  and `.spec.ts`.
- Result: the production-code diff is 334 lines, entirely import paths, JSDoc
  wording ("MAIN" → "the calling process", "Electron" → "transport-agnostic"),
  the interface/type renames (`AdapterState`→`SupervisorState`,
  `AdapterSubscription`→`SupervisedSubscription`), and the extraction of the
  private `BatchRelay` class into its own file — its body is byte-identical
  once `BatchRelay`→`WorkspaceWatchBatchRelay` is normalized, confirmed by a
  second diff limited to that class showing only added imports/exports/doc,
  zero logic changes. The spec diff is 24 lines, all in the header comment and
  import paths — every `it`/`expect` assertion is untouched. `ElectronWorkspaceWatcher`
  is now a 53-line pass-through facade with no added or removed behaviour
  (`electron-workspace-watcher.ts:29-53`).
- Current handling: N/A.
- Recommendation: none — the move is exactly what the executor and the task
  claimed. The three approved Batch 8 review rounds (stall-aware watchdog,
  degraded recovery `subscribed`-ack tightening, invalid-message cap) apply to
  the moved code unchanged and do not need re-review.

## Blocking issues

None found.

## Serious issues

### S1 — VS Code adapter has no signal for degraded/silent recursive watching outside a workspace folder

- File: `libs/backend/platform-vscode/src/implementations/vscode-workspace-watcher.ts:151-199`
- Scenario: a consumer watches a root VS Code will not reliably watch
  recursively (outside every `workspace.workspaceFolders` entry).
- Impact: silent, permanent staleness for that root with zero adapter-visible
  failure — worse than the create-throw path this file already handles,
  because nothing here treats "watcher object exists but events never/rarely
  arrive" as a failure. Directly undermines D4's "excluded/handled everywhere"
  guarantee for whichever roots end up outside a workspace folder.
- Fix: see the matching failure mode above — check workspace-folder membership
  before/after creation and degrade explicitly (diagnostic at minimum, overflow
  - rescan cadence at best) rather than treating success-with-no-exception as
    full success.

### S2 — VS Code adapter has no native-level exclusion, unlike its two sibling adapters

- File: `libs/backend/platform-vscode/src/implementations/vscode-workspace-watcher.ts:151-157`
  vs. `libs/backend/platform-core/src/workspace-watch/workspace-watch-host-core.ts`
  (`computeNativeIgnore`, unchanged Batch 8 behaviour)
- Scenario: a workspace with nested repos/agent worktrees under an open
  folder, once Batch 11 wires `GitWatcherService`/the file index onto this
  port for VS Code users.
- Impact: the exact per-event cost this task exists to eliminate (INV-1) is
  paid for excluded paths at the native-watcher + extension-host-IPC layer
  before the coalescer's exclusion ever runs — a materially weaker guarantee
  than the Electron/CLI adapters give for the identical port contract, on the
  host the majority of users run day to day, and inconsistent with the file's
  own docstring claim that `files.watcherExclude` closes this gap (nothing
  configures that setting).
- Fix: proactively merge the same excludes into `files.watcherExclude` at
  activation, or explicitly document and accept the gap and correct the
  docstring; resolve one way or the other before Batch 11 lands real
  consumers on this adapter.

## Moderate and minor issues

- Moderate: CLI host stderr is discarded on an unguarded native crash, leaving
  only a bare exit code for diagnosis (`cli-workspace-watcher.ts:82`,
  `workspace-watch-supervisor.ts:322-325`) — see failure mode above.
- Moderate: VS Code adapter creates one independent native watcher per
  subscriber even for the same root, unlike the host-based adapters'
  one-native-subscription-per-root design (`vscode-workspace-watcher.ts:87-124`)
  — see failure mode above.
- Moderate: no integration test proves the CLI child actually exits when its
  parent disconnects/exits — same residual the Batch 8 review already named
  for the Electron entry's identical line; now present twice
  (`workspace-watch-host.entry.ts:36` in platform-cli).
- Minor: CLI diagnostics before `TOKENS.LOGGER` exists are silently and
  permanently dropped with no queue (`cli-workspace-watcher-options.ts:43-50`)
  — currently unreachable in practice; see failure mode above.
- Minor: no spec drives a mixed-separator (`\\`/`/`) path through the VS Code
  adapter's `uri.fsPath` → coalescer hand-off, unlike Batch 2's exhaustive
  separator table for the shared predicate.

## Data flow

1. `CliWorkspaceWatcher`/`ElectronWorkspaceWatcher.watch()` → validated and
   delegated straight to `WorkspaceWatchSupervisor` — OK, both facades are
   pure pass-throughs (`electron-workspace-watcher.ts:41-47`,
   `cli-workspace-watcher.ts:157-163`), confirmed by reading both in full.
2. Supervisor lazily forks (or reuses) the host via the injected
   `WorkspaceWatchHostForker` — for CLI, `CliWorkspaceWatchHostForker.fork()`
   → `CliWorkspaceWatchHostProcess` — OK, a missing bundle throws before any
   process spawns (`cli-workspace-watcher.ts:78-80`), charged as `fork-failed`.
3. Host entry (`platform-cli/src/workspace-watch/workspace-watch-host.entry.ts`)
   guards for a real IPC channel, then calls the shared
   `bootWorkspaceWatchHost` (platform-core) — OK, identical boot sequence to
   the Electron entry (`toWorkspaceWatchEngine`, `fatal` on load failure,
   `WorkspaceWatchHostCore.start()`), confirmed byte-level identical logic via
   the earlier refactor diff.
4. Host posts `batch`/`heartbeat`/`error`/`notice`/`fatal` over the forked
   IPC channel — OK, same Zod-validated protocol as Batch 8, unchanged.
5. `CliWorkspaceWatchHostProcess` relays `message`/`exit` to the supervisor,
   which processes them through the SAME state machine Batch 8 already proved
   (watchdog, restart budget, degraded rescan, `subscribed`-ack recovery) — OK,
   confirmed by the normalized diff showing zero logic change.
6. Dispose: `CliWorkspaceWatcher.dispose()` → supervisor `dispose()` → host
   killed, every timer cleared (inherited, unchanged) — OK for the supervisor
   side. `shutdownHostRuntime` (cli-engine) does NOT call this — GAP, see
   below.
7. VS Code path: `VscodeWorkspaceWatcher.watch()` → `createFileSystemWatcher`
   (no exclude) → three per-kind listeners → `WorkspaceChangeCoalescer.push`,
   which is where exclusion, storm-breaking and batching actually happen — GAP
   for excluded paths and for out-of-workspace roots, see S1/S2.
8. VS Code dispose: `context.subscriptions.push(workspaceWatcher)`
   (`platform-vscode/src/registration.ts`) — OK, proven by the new
   `container.smoke.spec.ts` case, deactivation disposes it.

## Requirements fulfilment

| Requirement                                                                                      | Status   | Gap                                                                                                                                    |
| ------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| CLI host runs via `child_process.fork`, never `worker_threads`                                   | COMPLETE | `cli-workspace-watcher.ts:26,81-85`; matches the Batch 8 correction                                                                    |
| CLI adapter reuses `WorkspaceWatchSupervisor`, no re-implemented supervision                     | COMPLETE | facade is a pure delegate                                                                                                              |
| Stdio ignored, JSON-RPC/TUI stdout protected                                                     | COMPLETE | `cli-workspace-watcher.ts:82`; but see stderr-loss Moderate finding                                                                    |
| Child, IPC channel and timers unref'd so a one-shot command exits                                | COMPLETE | `.unref()` calls verified at `:66-67,86-89`; Node semantics mean functionality is unaffected, only keep-alive accounting               |
| Missing bundle is a failed fork, not a spawned-then-dying process                                | COMPLETE | `fs.existsSync` check throws before `fork()`, verified by spec                                                                         |
| Host path resolves for both `main.mjs` and `tui.mjs` (D7)                                        | COMPLETE | one join expression, both callers share `dist/apps/ptah-cli`; pinned by spec and the pre-existing `__dirname` banner in `project.json` |
| VS Code: one `createFileSystemWatcher` per subscription feeding one coalescer                    | COMPLETE | as specified; see S2 for the cost implication of "per subscription" rather than "per root"                                             |
| VS Code: create-throw → overflow now, retry + overflow every 60 s, one more overflow on recovery | COMPLETE | pinned by `vscode-workspace-watcher.spec.ts:212-258`, matches the task's own description exactly                                       |
| VS Code: no DegradationReporter (not reachable from platform-vscode)                             | COMPLETE | confirmed no such wiring exists; diagnostics go only to the output channel                                                             |
| DI registration + real resolution proof in both hosts                                            | COMPLETE | both `container.smoke.spec.ts` additions resolve through the real phase-0 registration path, not a stub                                |
| Supervisor move preserves Batch 8 behaviour                                                      | COMPLETE | see verification failure mode above                                                                                                    |
| CLI `shutdownHostRuntime` disposes the watcher                                                   | MISSING  | not wired; host exits on IPC close instead — see open item 7 below                                                                     |

Implicit requirements not addressed: VS Code out-of-workspace-root detection;
VS Code native-level exclusion; CLI host crash diagnostics beyond a bare exit
code.

## Edge cases

| Case                                                                      | Handled | How                                                                                                                                             | Concern                                        |
| ------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| CLI: missing host bundle                                                  | YES     | `fs.existsSync` throws before fork; degrades in ~1.25 s, no spawn                                                                               | none                                           |
| CLI: host killed mid-subscription (overflow contract case)                | YES     | `runWorkspaceWatcherContract`'s `triggerOverflow` kills the real forked host and asserts restart+resubscribe                                    | none — a genuine integration proof, not a fake |
| CLI: double `dispose()`                                                   | YES     | `constructing and disposing forks nothing` spec, idempotent guard inherited from the supervisor                                                 | none                                           |
| CLI: parent process exits/disconnects while host is running               | PARTIAL | `process.on('disconnect', () => process.exit(0))`; reasoned from Node IPC semantics, not proven by an integration test                          | see Moderate finding                           |
| CLI: process has no other keep-alive handle while watching                | PARTIAL | unref'd timers/channel let the process exit; correct for one-shot commands, relies on other subsystems (stdin) to keep long-running modes alive | documented nowhere near the clock itself       |
| VS Code: `createFileSystemWatcher` throws                                 | YES     | retry + overflow + recovery cadence, well specced                                                                                               | none                                           |
| VS Code: root outside every workspace folder                              | NO      | none                                                                                                                                            | S1                                             |
| VS Code: nested repo/worktree under an open folder, no watcherExclude set | NO      | native watch + IPC still pays full cost; coalescer excludes only after                                                                          | S2                                             |
| VS Code: two subscribers on the same root                                 | PARTIAL | each gets its own correct, independent watcher; correctness holds, cost does not multiplex                                                      | Moderate                                       |
| VS Code: dispose ordering (listeners → watcher → coalescer)               | YES     | `WatchSubscription.dispose()`, `:201-211`                                                                                                       | none                                           |
| Both new adapters: DI resolution forks/creates nothing eagerly            | YES     | both smoke specs assert `fork`/`createFileSystemWatcher` not called merely by resolving                                                         | none                                           |

## Verdict

- Recommendation: APPROVE_WITH_FIXES
- Confidence: HIGH
- Top risk: the VS Code adapter — the host most contributors run day to day —
  has a materially weaker exclusion and failure-visibility story than the two
  native-host adapters built in the same batch, for the exact requirement
  (D4/INV-1) this task exists to satisfy; it will look correct in every test
  here (all of which use a same-process watcher double) and only show the gap
  against a real large workspace with nested worktrees or an out-of-workspace
  root.
- What a robust implementation would add:
  1. VS Code: detect and signal (at minimum) a root outside every workspace
     folder, rather than treating a non-throwing `createFileSystemWatcher` as
     full success (S1).
  2. VS Code: push the same exclusion set into `files.watcherExclude` at
     activation, or explicitly document (and correct the docstring for) the
     accepted gap versus the host-based adapters (S2).
  3. CLI: capture a bounded tail of the host child's stderr for diagnosis on
     an unguarded native crash, without touching the stdout contract.
  4. Wire `PLATFORM_TOKENS.WORKSPACE_WATCHER` into `shutdownHostRuntime` (or
     confirm in writing that IPC-close-triggered exit is sufficient and add
     the integration test that proves it) so the "not disposed" open item is
     a closed decision rather than an open one.
  5. One integration-level proof (not just architectural reasoning) that a
     forked host actually exits when its parent process exits normally, via
     `process.exit`, or is killed — on both Windows and Linux.

None of these require re-architecting the batch; the supervisor move itself is
verified behavior-preserving, and the CLI adapter's design (unref, stdio,
missing-bundle handling) is sound as built.

## Delta review (review fixes)

Re-read in full on disk in the worktree: `vscode-workspace-watcher.ts` (253
lines, header + `warnIfOutsideWorkspace`), `workspace-change-coalescer.ts`
`push`/`toRelativeSegments`/`normalizeAbsolute` (`:211-260,405-426`),
`cli-workspace-watcher.ts` (196 lines), `workspace-watch-supervisor.ts`
`:67-98,297-360,471-475` (the stderr-tail plumbing), `shutdown-host-runtime.ts`
(159 lines) + its spec, `workspace-watch-host-factory.ts` (post-rename),
`workspace-watch-host.entry.spec.ts` + `workspace-watch-host.bundle.harness.ts`.
Ran, on this Windows worktree, with no other Jest workers active (checked
first):

- `npx jest -c libs/backend/platform-cli/jest.config.ts libs/backend/platform-cli/src/workspace-watch/workspace-watch-host.entry.spec.ts --maxWorkers=2` — 2/2 pass (~4.8 s): both "a parent that ends normally takes the host with it" and "a parent that is killed takes the host with it" passed, hostPid gone within the 10 s deadline both times, on real forked processes.
- `npx jest -c libs/backend/platform-cli/jest.config.ts libs/backend/platform-cli/src/implementations/cli-workspace-watcher.spec.ts --maxWorkers=2` — 13/13 pass (~29 s), including the real-forked-host contract suite.
- `npx jest -c libs/backend/platform-core/jest.config.ts libs/backend/platform-core/src/workspace-watch/workspace-watch-supervisor.spec.ts --maxWorkers=2` — 32/32 pass, including the two new stderr-tail cases.

### Item-by-item

1. **S1 (VS Code out-of-workspace root) — CONFIRMED FIXED, and correctly
   scoped as a warning, not a degrade.** `warnIfOutsideWorkspace`
   (`vscode-workspace-watcher.ts:151-164`) checks `isPathWithinRoots(root,
folders)` once per distinct root (`warnedOutsideRoots` de-dupes repeat
   `watch()` calls on the same root) and emits one `warn` diagnostic naming
   the exact risk ("recursive watching may be partial"). The orchestrator's
   choice not to treat this as a failure (no `overflow`, no rescan cadence) is
   defensible: unlike a `createFileSystemWatcher` throw, there is no actual
   evidence of failure here — VS Code may well watch the root correctly, and
   forcing every out-of-workspace subscription onto a permanent 60 s poll
   would be a real behavioural cost paid on pure suspicion. A diagnostic that
   lets an operator correlate "the tree looks stale" with this specific,
   named cause is the proportionate fix. No new spec drives this exact case in
   `vscode-workspace-watcher.spec.ts` (the fix is small enough that direct
   inspection is sufficient: `isPathWithinRoots` is the same, already-tested
   predicate used by the batch relay for containment).

2. **S2 (VS Code native-level exclusion) — accepted as doc-only; the
   per-event allocation cost the executor flagged is real but bounded, not a
   new failure mode.** The updated docstring (`vscode-workspace-watcher.ts:12-24`)
   now correctly states the two-layer reality instead of assuming
   `files.watcherExclude` closes the gap — this resolves the factual error in
   the original text, which is the concrete, fixable part of S2; the
   underlying cost asymmetry versus the Electron/CLI adapters remains, as
   expected from a documentation-only fix, and is now accurately described
   rather than a stale claim.
   - Traced the flagged allocation: `WorkspaceChangeCoalescer.push`
     (`:211-260`) only reaches `toRelativeSegments`/`isExcluded` in the
     NON-storming branch (`:216-220` returns immediately, O(1), no allocation,
     the instant `this.breaker.isStorming` is true). `toRelativeSegments`
     (`:405-418`) does two regex `.replace()` calls plus `.split('/')` and
     `.filter(...)` (one array allocation), and `normalizeAbsolute`
     (`:420-426`) inside it does two more regex replaces plus a conditional
     `.toLowerCase()`. This is real per-event string/array allocation that
     happens BEFORE `isExcluded` can discard the event — for VS Code
     specifically, this runs for every native-watcher event including ones
     under an excluded directory (nested repo, `.claude-worktrees`, etc.),
     because nothing filters them out before they reach `push`.
   - Whether this "matters" depends entirely on the storm breaker's entry
     threshold, which is small (a handful of events in a short window,
     Batch 2 defaults) — so the FULL per-event cost is paid only during the
     ramp-up to a storm (bounded, on the order of the entry threshold) and in
     ordinary low-rate operation (where the absolute cost of a few regex
     replaces per event is immaterial). During a sustained storm (the actual
     freeze scenario this task exists to prevent), the `isStorming` fast path
     already short-circuits to O(1) before any of this runs. This bounds the
     worst case to "a burst just under the storm threshold, repeated
     indefinitely" — plausible for a churn source that stays just below the
     breaker's entry rate (e.g., a slow, steady `node_modules` reinstall) but
     not the catastrophic case (a worktree delete of tens of thousands of
     files) the task was built around.
   - Judgment: accept the orchestrator's doc-only decision for S2 itself. The
     per-event allocation is a genuine, quantifiable inefficiency worth a
     follow-up (a cheap segment/directory-name prefix check — reusing
     `excludeDirNames`/`excludeSegmentRules` before the full normalize+split+
     join — could reject an obviously-excluded path for a fraction of the
     cost), but it is bounded by the same storm breaker that already protects
     the catastrophic case, so it does not rise to a new Serious finding on
     its own. Recorded as a Moderate follow-up below, distinct from S2's
     already-open Serious status (native-level exclusion is still absent).

3. **CLI stderr tail — sound design; one real trade-off named, two raised
   concerns are non-issues.**
   - **`'close'` vs `'exit'` — the failure-detection floor does not depend on
     it.** Traced `onHostFailure`'s two triggers: the WATCHDOG
     (`armWatchdog`, `:425-465`) fires on its OWN timer purely from elapsed
     time since `host.lastMessageAt`, entirely independent of whether `'close'`
     (or `'exit'`) ever fires — it calls `onHostFailure('heartbeat-missed',
...)` and that call chain itself invokes `killHost()`. So even in the
     pathological case named by the task (a grandchild process inheriting and
     holding the stderr pipe's write end open, so `'close'` never fires),
     failure is still detected within one heartbeat window (≤ 6 s by
     default) — the ONLY thing that changes is the FAST path: previously a
     quick, clean host crash was detected the instant `'exit'` fired
     (near-instant); now it waits for `'close'`, which in the pathological
     inherited-fd case could stall until the watchdog's silence window
     elapses. This is a real, bounded degradation (added latency, not a
     missed detection), and it is currently UNREACHABLE in this codebase: the
     watch host entry (`workspace-watch-host.entry.ts`) never spawns a
     descendant process, so nothing can inherit its stderr fd. Confirmed by
     reading the entry file in full — its only I/O is `require('@parcel/watcher')`
     and the IPC `post`/`handleMessage` calls.
   - **Killed host: verified live, not just reasoned.** The two new
     integration tests (run above, both passing on this Windows worktree)
     prove a `child_process.fork`ed real host dies within 10 s of (a) a
     normal parent exit with everything unref'd, and (b) `SIGKILL` of the
     parent — covering exactly the "does a killed host's pipe ever fail to
     close" question for the two realistic termination paths. Neither test
     drives the specific "grandchild holds the pipe open" scenario (there is
     no grandchild to construct one with), so that residual is architectural
     reasoning, not measurement — correctly named as unreachable rather than
     proven safe in the abstract.
   - **Unref'd stderr stream blocking the child on a full pipe — NOT a
     defect.** `.unref()` only opts the underlying handle out of keeping the
     event loop alive; it does not pause or stop consumption. The stream is
     already in flowing mode (`stderr.on('data', ...)` is attached
     unconditionally, `cli-workspace-watcher.ts:101-108`), so libuv keeps
     draining the pipe on every loop turn regardless of `unref()`, and the
     child is never stalled by the parent falling behind under normal
     operation. The only behavioural consequence of `unref()` is that the
     PARENT may exit while data is still queued/arriving — which is the
     intended one-shot-command behaviour, not a bug.
   - **Multi-byte UTF-8 split across chunks — already handled by Node, not a
     gap.** `stderr.setEncoding('utf8')` (`:102`) installs Node's built-in
     `StringDecoder` inside the stream, which is documented to buffer an
     incomplete trailing multi-byte sequence until the next chunk completes
     it before emitting a `'data'` string — this is exactly the guarantee
     `setEncoding('utf8')` exists to provide; no additional decoder is needed
     and none is missing.
   - **"Tail attached to any failure, not just abnormal exits" (executor's
     skip) — ACCEPT.** `withStderrTail` (`:87-98`) is a no-op whenever the
     tail is empty after `.trim()` (`if (!stderr) return detail;`), and for
     reasons like `fork-failed` (no process exists yet) or `post-failed`/
     `heartbeat-missed` (the host normally writes nothing to stderr), the tail
     is empty in practice, so attaching it "to any failure" costs nothing
     extra and is occasionally a genuine bonus (a host that printed a warning
     to stderr moments before going silent). Verified by the two new
     supervisor spec cases (`:458-486`): one pins the tail riding on the
     detail string, the other pins a whitespace-only tail leaving the detail
     unchanged.

4. **CLI shutdown — CONFIRMED, correct order, correctly guarded.**
   `shutdown-host-runtime.ts` disposes the watcher LAST (after agents, then
   proxies — `:152-158`), through the same `isRegistered`-guarded,
   try/catch-wrapped `disposeSubsystem` helper used for the other two
   subsystems, now parameterized by verb (`'dispose'` vs `'disposeAll'`,
   `:56-58,72-97`). The `WORKSPACE_WATCHER_TOKEN` literal
   (`Symbol.for('PlatformWorkspaceWatcher')`, `:47`) matches
   `PLATFORM_TOKENS.WORKSPACE_WATCHER`'s actual definition
   (`libs/backend/platform-core/src/di/tokens.ts:126`), confirmed by direct
   grep — a mismatched `Symbol.for` string here would have made this whole fix
   a silent no-op, and it does not. `shutdown-host-runtime.spec.ts` pins the
   order, the "disposed exactly once", the "no-op when unregistered", and a
   throwing `dispose()` reported on stderr without disturbing the other two
   subsystems (`:275-304`) — genuine coverage, not restated assertions.

5. **Integration spec (host outlives nobody) — CONFIRMED via a real run on
   this platform; one real CI-masking risk found, inconsistent with the
   Batch 8 precedent.**
   - Ran both cases for real (above): a normally-exiting parent and a
     `SIGKILL`ed parent both reliably take the forked host down within the
     10 s deadline on Windows. This directly answers the task's "does SIGKILL
     of a parent reliably propagate to the child on Windows" question with a
     measurement, not just architectural reasoning.
   - **PID-reuse hazard in `isAlive`/cleanup, real but low-probability.**
     `isAlive` (`:67-75`) is `process.kill(pid, 0)`; `afterEach`
     (`:103-112`) calls `process.kill(pid)` (a real, non-zero-signal kill) on
     any `hostPids` entry still "alive" after a test. If the OS reuses a
     recently-freed pid for an unrelated process between the host's actual
     exit and this check — more likely on Linux under heavy parallel-CI fork
     churn than on Windows, where pid recycling is typically slower — the
     cleanup step could send a real kill signal to a process that is not the
     host. This is a test-infrastructure risk only (not a production code
     path), bounded to this spec's own cleanup, and the failure mode is
     "kills an unrelated process, not itself" rather than "hides a bug" — but
     worth a mitigation (e.g., track the parent PGID or use a marker file the
     host removes on exit, checked before killing) if this spec runs
     routinely on Linux CI with many parallel workers.
   - **`describe.skip` on a failed bundle build is a real, inconsistent
     CI-masking gap.** The sibling precedent from Batch 8,
     `platform-electron/src/workspace-watch/workspace-watch-host.entry.spec.ts`,
     builds its bundle in a plain `beforeAll`/module-level call with NO
     try/catch — a build failure there throws and fails the whole suite
     loudly. This new CLI spec instead wraps the build in try/catch at module
     scope, and on failure calls `describe.skip` with only a
     `console.warn(...)` (`:24-32,90`). A regression that breaks esbuild
     bundling of the CLI host entry specifically (a bad import, a tsconfig
     drift, an external-resolution break) would make this ENTIRE suite —
     including both orphan-cleanup proofs — silently report as "skipped" in
     CI, which typically shows as green/neutral, not red, unless something
     downstream specifically asserts "N suites ran." This is exactly the risk
     the task asked to check for, it is confirmed present, and it is an
     unexplained deviation from the pattern this same task already established
     in Batch 8. Recommend matching the Electron precedent: let a bundling
     failure fail the suite (throw, do not skip), or if a soft-skip is kept,
     have the _style_ or _CI_ layer additionally assert (e.g., in a top-level
     smoke check or CI script) that this suite name actually ran and reported
     ≥ 1 test, so a silent skip cannot hide behind a normal green pipeline.
   - Not exercised, and not asked to be: Linux/CI-parallel-worker behaviour
     itself (this review's tooling is Windows-only; the finding above is
     about the test's own skip/kill mechanics, not a platform gap).

6. **Factory rename (`cli-workspace-watcher-options.ts` →
   `cli-workspace-watcher-factory.ts`) — style-only, confirmed no behaviour
   change.** `createCliWorkspaceWatcherOptions`'s body, `container.ts`'s call
   site, and the barrel exports (`platform/index.ts:12`, `index.ts:56`) all
   still resolve to the same function; not re-reviewed for logic since it
   is an unchanged body under a new file name and new export path.

### Executor's skipped-items list — verdict on each

| Skip                                                  | Accept? | Reasoning                                                                                                                                                   |
| ----------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code: one native watcher per subscriber per root   | ACCEPT  | Real, already the open S2 cost asymmetry; not a regression from these fixes, a pre-existing design gap correctly left as a named follow-up.                 |
| CLI diagnostics before the logger exists are dropped  | ACCEPT  | Confirmed intentional and tested (`cli-workspace-watcher-options.spec.ts`); currently unreachable since nothing calls `.watch()` before Phase 1 completes.  |
| VS Code mixed-separator spec                          | ACCEPT  | Low risk; the underlying predicate is the same one Batch 2 exhaustively specced for separators, only the VS Code call site is untested with one.            |
| Stale CLI bundle shape check (exists but wrong shape) | ACCEPT  | Already handled correctly, just via the generic fork/exit failure path rather than a dedicated fast check — one extra restart cycle, not a correctness gap. |
| CLI host RSS                                          | ACCEPT  | Not in C9's scope per the plan; C8's RSS budget was Electron-specific.                                                                                      |
| Supervisor file size (now ~714 lines)                 | ACCEPT  | Style/soft-ceiling concern per `CLAUDE.md` (warn-level at 700, not an alarm short of ~1000); route to code-style-reviewer, not a logic finding.             |
| Tail attached to any failure, not just abnormal exits | ACCEPT  | Verified benign — the empty-tail guard makes this a no-op for reasons with no stderr output; see item 3 above.                                              |

All seven skips are accepted; none hides a correctness gap this review found.
The one NEW gap this delta surfaces — the `describe.skip`-on-build-failure
pattern in the integration spec — was not on the executor's own skip list and
is raised here as a fresh Moderate finding.

### New findings this delta

**Moderate — Integration spec silently skips (rather than fails) when the CLI
host bundle cannot be built, inconsistent with the Batch 8 precedent**

- Trigger: esbuild fails to bundle `workspace-watch-host.entry.ts` (bad
  import, tsconfig drift, external-resolution break).
- Symptom: `workspace-watch-host.entry.spec.ts` reports as skipped (with a
  `console.warn` easy to miss in CI output) instead of failing, hiding a
  regression in the exact bundle Task 10.4 depends on shipping correctly.
- Evidence: `workspace-watch-host.entry.spec.ts:23-32,90`; contrast with
  `platform-electron/src/workspace-watch/workspace-watch-host.entry.spec.ts`,
  whose `buildHostBundle()` has no try/catch and fails the suite outright.
- Current handling: soft skip, console warning only.
- Recommendation: match the Electron precedent (let the build failure throw
  and fail the suite), or add an explicit CI-level assertion that this suite
  ran and reported at least its two tests, so a build regression cannot read
  as a passing/neutral pipeline.

**Moderate — `isAlive`/cleanup PID check has a (low-probability) reuse hazard**

- Trigger: the OS reuses a just-freed host PID for an unrelated process
  before this spec's `afterEach` cleanup runs.
- Symptom: `process.kill(pid)` in cleanup could signal an unrelated process
  rather than the (already-gone) host. Test-infrastructure risk only.
- Evidence: `workspace-watch-host.entry.spec.ts:67-75,103-112`.
- Current handling: none.
- Recommendation: low priority given the observed pass on Windows and the
  short window involved; if this spec becomes routine on heavily parallel
  Linux CI, consider a liveness check that also validates process identity
  (e.g., a marker file written by the host and removed on exit) rather than a
  bare PID.

### Verdict (delta)

- Recommendation: **APPROVE_WITH_FIXES**
- Confidence: HIGH
- All five targeted fixes (S1, S2 doc, CLI stderr tail, CLI shutdown
  disposal, integration spec) are correctly implemented and, where testable
  without violating the read-only/single-spec-file constraint, verified by
  actually running the new specs on this Windows worktree (47 tests across
  three spec files, all green, including both real-process orphan-cleanup
  proofs). No prior finding was reopened. Two new Moderate findings surfaced,
  neither blocking:
  1. The integration spec's `describe.skip`-on-build-failure pattern can mask
     a real CI regression and is inconsistent with the Batch 8 sibling spec's
     hard-fail behaviour (`workspace-watch-host.entry.spec.ts:24-32,90`).
  2. A low-probability PID-reuse hazard in the same spec's cleanup path
     (`:67-75,103-112`).
- The two Serious findings from the base review (S1, S2) are resolved to the
  extent the orchestrator chose to resolve them: S1 is now a proportionate,
  well-scoped warning rather than a silent gap; S2 remains an accepted,
  now-accurately-documented cost asymmetry versus the Electron/CLI adapters,
  with its associated per-event allocation cost traced and found bounded by
  the existing storm breaker rather than a new, unbounded risk.
