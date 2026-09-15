# Code Style Review — Batch 8 (TASK_2026_437_0778)

Electron watch host: `@parcel/watcher` behind `IWorkspaceWatcher`.

## Summary

| Metric          | Value                                 |
| --------------- | ------------------------------------- |
| Overall score   | 7/10                                  |
| Assessment      | APPROVE_WITH_FIXES                    |
| Blocking issues | 1                                     |
| Serious issues  | 2                                     |
| Minor issues    | 3                                     |
| Files reviewed  | 16 (10 modified, 6 created + 6 specs) |

## Five style questions

### 1. What breaks in six months?

`WorkspaceWatchHostCore` (`libs/backend/platform-core/src/workspace-watch/workspace-watch-host-core.ts`, 712 lines) owns root lifecycle, native-ignore computation, nested-repo detection and retry/backoff in one class. It is coherent today because one author wrote it in one pass, but the next change to any one of those four concerns (e.g. a new native-ignore rule) has to be made inside a 712-line file that already sits past the repo's 700-line soft ceiling (`CLAUDE.md` "File size"). The `computeNativeIgnore` block (host-core.ts:547-603) is the most extractable unit — pure, self-contained, testable in isolation — and is the piece a six-month-later change (a new exclusion channel) would touch first.

### 2. What would a new team member misread?

The port's own contract doc says a degraded adapter "emits `overflow` once" (`libs/backend/platform-core/src/interfaces/workspace-watcher.interface.ts:148-149`), but the shipped Electron adapter repeats it every 60 s indefinitely (`electron-workspace-watcher.ts:464-472`, `armDegradedRescan` re-arms itself on every fire). A reader who trusts the port doc — which explicitly claims "the guarantees below are implemented once" for every adapter (`workspace-watcher.interface.ts:24-26`) — will conclude a degraded consumer gets exactly one rescan signal and never polls again. That is wrong for the shipped behaviour and is the single blocking finding below.

### 3. What does this cost to maintain?

The three-transport branch in `workspace-watch-host.entry.ts` (Electron `parentPort` / `worker_threads` / `child_process` IPC) is unavoidable duplication cost, not avoidable cost: `@parcel/watcher`'s one-native-binding-per-process limitation and the platform-core "no Electron / Node-IPC imports" boundary (`platform-core/CLAUDE.md` Boundaries) together rule out sharing this code with the future CLI entry. The near-duplicate-by-design precedent already exists in this repo (`build-artifact-gate.ts`, cited in `implementation-plan.md:525-527`), so the cost is bounded and named, not open-ended.

### 4. Where is this inconsistent with the rest of the repository?

Two places, both flagged below: `platform-core/CLAUDE.md`'s Internal Structure section was not updated for the new `src/workspace-watch/` folder even though every sibling folder in that lib is documented there (Blocking-adjacent, listed as required by the task brief — see Minor-1, treated as a required fix per the brief's own item 4); and the port interface doc vs. the Electron adapter's actual degraded behaviour (Blocking-1).

### 5. What would you have done differently?

Split `WorkspaceWatchHostCore`'s native-ignore computation into a small collaborator (e.g. `NativeIgnoreSetPlanner`) taking `RootWatch`-shaped state and returning the ignore list, injected the way `WorkspaceChangeCoalescer` already is — the facade rule's "extracted concern becomes a collaborator" applied to the one part of this file with no state-machine coupling to the rest. I would also have updated `workspace-watcher.interface.ts`'s docstring in the same commit that changed the Electron adapter's degraded behaviour, since the interface is the one place all three adapters' authors will read before they implement C9.

## Blocking issues

### Port contract doc contradicts the shipped degraded-mode behaviour

- File: `libs/backend/platform-core/src/interfaces/workspace-watcher.interface.ts:148-149` vs. `libs/backend/platform-electron/src/workspace-watch/electron-workspace-watcher.ts:439-473`
- Problem: the port's documented guarantee is "a permanently failed adapter emits `overflow` **once** and reports a ... degradation." The shipped `ElectronWorkspaceWatcher.enterDegraded` → `armDegradedRescan` sends `overflow` to every subscription every `degradedRescanIntervalMs` (60 s) for as long as the adapter stays degraded — not once. `implementation-plan.md:475-476` and `platform-electron/CLAUDE.md:38` both describe the repeating behaviour, so the executor implemented the INTENDED design; the port interface (Batch 7, C7) is the document that fell out of date.
- Impact: this file is the one every future adapter author (Batch 9: CLI, VS Code) reads to learn what `IWorkspaceWatcher` promises. Whichever of the two documents is wrong, a reader who trusts either one alone will build the wrong consumer-side handling — either assuming a second rescan never comes (writing a one-shot handler that goes stale) or assuming every adapter repeats forever (when VS Code's `createFileSystemWatcher` has no such notion at all).
- Fix: update `workspace-watcher.interface.ts:148-149` (and the "one loss-of-events incident ... yields one `overflow` batch" line at 146-147, which is still correct for the non-degraded case but needs a companion sentence for the degraded case) to state the real contract: "a permanently failed adapter reports a `'workspace-watcher'` degradation once, and then emits `overflow` on the degraded-rescan cadence its documentation defines (Electron: every 60 s) until it recovers or is disposed." This is a documentation-only fix; the runtime behaviour itself is not this reviewer's call (route to code-logic-reviewer if the cadence itself is in question).

## Serious issues

### `platform-core/CLAUDE.md` omits the new `workspace-watch/` folder

- File: `libs/backend/platform-core/CLAUDE.md` (Internal Structure, after line 45; Key Files, after line 67)
- Problem: `src/workspace-watch/workspace-watch-host-core.ts` and `workspace-watch-protocol.ts` are new top-level modules in this lib (712 + 272 lines) with no entry in Internal Structure, unlike every existing sibling (`src/interfaces/`, `src/utils/event-storm-breaker.ts`, `src/utils/workspace-change-coalescer.ts` are all listed individually). The `Public API` and `DI Tokens` sections were updated (lines 32, 110-115) but the structural map was not.
- Tradeoff: `platform-electron/CLAUDE.md` got the equivalent update in the same batch (compare its new `src/workspace-watch/` bullet list) — the omission is asymmetric across the two libs this batch touched, which is itself evidence it was missed rather than deliberately deferred.
- Recommendation: add a `src/workspace-watch/` bullet to Internal Structure mirroring `platform-electron/CLAUDE.md`'s style — one line per file (`workspace-watch-host-core.ts`, `workspace-watch-protocol.ts`) — and a Key Files line for `workspace-watch-host-core.ts` alongside the existing `workspace-watcher.interface.ts` entry (line 67). Required fix per the review brief's item 4.

### `WorkspaceWatchHostCore` exceeds the 700-line soft ceiling with an extractable concern inside it

- File: `libs/backend/platform-core/src/workspace-watch/workspace-watch-host-core.ts` (712 lines)
- Problem: `computeNativeIgnore` and its three private helpers (`isSafeGlobName`, `caseInsensitiveGlobName`, `compilesAsGlob`, lines 547-603 plus 682-712) form a pure, stateless computation over `RootWatch` data with no dependency on the class's timers, retry state or engine handle. It is the one piece of this file that passes the facade rule's nameability test (`NativeIgnoreSetPlanner` or similar — not `helpers`/`utils`) without dropping below the ~150-line floor once its four supporting functions move with it.
- Tradeoff: this is a soft-ceiling warning (712 vs. 700), and the file is a single, deliberate design under one class, not size-driven fragment sprawl — CLAUDE.md is explicit that "line count alone is not the signal." Leaving it as one file is defensible; the class's internal cohesion (one `RootWatch` state machine covering subscribe/resubscribe/retry/nested-detection) is real and splitting it purely by length would scatter that state machine across files.
- Recommendation: no action required at 712 lines under this repo's own "past 1000 means a deliberate look, not an alarm" rule. Flagged so the next addition to this file (a new native-ignore channel, a new retry policy) is a trigger to extract `computeNativeIgnore`'s block rather than growing the class further in place.

## Minor issues

- `libs/backend/platform-electron/src/workspace-watch/electron-workspace-watcher.ts` (678 lines) is close to the ceiling but already follows the facade rule: `BatchRelay` (lines 552-678) is a genuine extracted collaborator with its own state, not a fragment. No action.
- `apps/ptah-electron/src/activation/wire-runtime.ts:559-566` adds a `container.isRegistered` guard that the two sibling capture blocks (`cliRegistry`, `agentProcessManager`, lines 526-536, 542-553) do not use. This is a deliberate, correct difference — `WORKSPACE_WATCHER` is conditionally registered (`registerPlatformElectronServices` only registers it when `options.workspaceWatchHost` is supplied; `registration.ts:189-194`) while the other two tokens are always registered — but the asymmetry is worth a one-line comment noting _why_ this block alone needs the guard, since a future edit to the sibling blocks might copy this one without understanding the reason.
- `libs/backend/platform-core/src/workspace-watch/workspace-watch-protocol.ts` and `workspace-watch-host-core.ts` both hand-roll heartbeat/error/notice dispatch with no shared base — acceptable given each protocol message type has a distinct shape, but worth a second look once Batch 9's CLI host reuses this file: if CLI needs a different notice code set, the current `WORKSPACE_WATCH_NOTICE_CODES` union (protocol.ts:148-153) would need widening rather than adapter-specific extension, which is fine as long as both adapters keep the same protocol version.

## File-by-file

### `libs/backend/platform-core/src/workspace-watch/workspace-watch-host-core.ts`

Score 7/10 — 0 blocking, 1 serious (size/extraction), 0 minor. Sound state machine, correctly kept free of Electron/Node-IPC imports per the lib's boundary rule; the native-ignore computation is the one piece that would benefit from extraction (Serious-2).

### `libs/backend/platform-core/src/workspace-watch/workspace-watch-protocol.ts`

Score 9/10 — clean Zod `strictObject` schemas both directions, size limits enforced (`WORKSPACE_WATCH_PROTOCOL_LIMITS`), correct `export type` vs. value exports.

### `libs/backend/platform-electron/src/workspace-watch/electron-workspace-watcher.ts`

Score 7/10 — 1 blocking (doc/behaviour mismatch, shared with the interface file), otherwise well-structured: no `electron` import, injected fork shim, `BatchRelay` correctly extracted, `catch (error: unknown)` throughout.

### `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.entry.ts`

Score 9/10 — matches the `integrity-worker.ts:65-114` transport-detection precedent exactly for the first two branches and extends it with a documented third (`child_process`) for the reason stated in its own header comment and confirmed by `workspace-watch-host.entry.spec.ts:1-21`. Correctly placed in platform-electron, not platform-core (see Deviation verdicts, Q1).

### `libs/backend/platform-electron/src/workspace-watch/parcel-watcher-engine.ts`

Score 9/10 — one `require`, well-documented reason for avoiding a static import, shared verbatim between the entry and the in-process hatch.

### `libs/backend/platform-electron/src/workspace-watch/in-process-workspace-watch-host.ts`

Score 8/10 — the `PTAH_WATCH_HOST=0` hatch is recorded at the flag site (`electron-workspace-watch-host-factory.ts:70-76`) with consumer and deletion condition named, satisfying the review brief's requirement.

### `apps/ptah-electron/src/services/platform/electron-workspace-watch-host-factory.ts`

Score 8/10 — follows the `electron-integrity-worker-factory.ts` pattern; `isRegistered` guards on both `TOKENS.LOGGER` and `TOKENS.DEGRADATION_REPORTER` before resolving, matching the file's own stated rationale (phase-0 registers before either service exists).

### `apps/ptah-electron/src/activation/{boot-coordinator,shutdown,wire-runtime}.ts`, `di/{container.smoke.spec,phase-0-platform}.ts`, `main.quit-path.spec.ts`

Score 8/10 — all five edits follow the exact `BootRefs` / `disposeAfterPersistence` / `captureShutdownHandles` conventions their siblings (`cliRegistry`, `agentProcessManager`, `integrityService`) already established. `container.smoke.spec.ts` pinning `WORKSPACE_WATCHER` resolution (rather than adding it to `expected-resolvable.ts`) is explicitly justified in-comment as plan defect D2 — correct call, since `expected-resolvable.ts` is a list of RPC handler classes, not platform tokens.

### `libs/backend/platform-core/src/index.ts`, `libs/backend/platform-electron/src/index.ts`, `libs/backend/platform-electron/src/registration.ts`

Score 8/10 — correct `export type` for type-only re-exports throughout both barrels; `registration.ts` only registers `WORKSPACE_WATCHER` when `options.workspaceWatchHost` is supplied, keeping the "resolving forks nothing" invariant intact at the DI layer too.

## Pattern compliance

| Repository rule or nearby convention                                  | Status  | Evidence                                                                                                             |
| --------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| platform-core: no Electron / Node-IPC imports                         | PASS    | `workspace-watch-host-core.ts`, `workspace-watch-protocol.ts` import only `picomatch`, `zod`, local types            |
| platform-electron: no `vscode` or sibling-adapter imports             | PASS    | `electron-workspace-watcher.ts` imports only `@ptah-extension/platform-core`                                         |
| Constructors take injected API shims, not global `electron`           | PASS    | `ElectronWorkspaceWatcherOptions.host: WorkspaceWatchHostForker` (electron-workspace-watcher.ts:109-116)             |
| Zod at the IPC boundary, trusted types past it                        | PASS    | `parseWorkspaceWatchHostInbound`/`Outbound`, both `strictObject`, both sides parse (protocol.ts)                     |
| `catch (error: unknown)`                                              | PASS    | every catch block sampled across all 6 new/modified source files                                                     |
| No `@ts-ignore`                                                       | PASS    | none found in changed files                                                                                          |
| DI token naming (`Symbol.for`, UPPER_SNAKE)                           | PASS    | `WORKSPACE_WATCHER` already existed in `tokens.ts` from Batch 7; unchanged here                                      |
| Registration in `registration.ts`, phase-0 placement                  | PASS    | `registerPlatformElectronServices` (registration.ts:189-194); `registerPhase0Platform` (phase-0-platform.ts)         |
| `container.smoke.spec.ts` pins `WORKSPACE_WATCHER` (plan defect D2)   | PASS    | container.smoke.spec.ts:318-378, with an in-comment citation of the defect                                           |
| Adapter naming `{platform}-{capability}.ts`                           | PASS    | `electron-workspace-watcher.ts`, `electron-workspace-watch-host-factory.ts`                                          |
| `PTAH_WATCH_HOST=0` hatch recorded with consumer + deletion condition | PASS    | `electron-workspace-watch-host-factory.ts:67-76`                                                                     |
| File size vs. 700-line soft ceiling                                   | PARTIAL | `workspace-watch-host-core.ts` at 712 lines (Serious-2); `electron-workspace-watcher.ts` at 678 lines, under ceiling |
| `platform-core/CLAUDE.md` documents every top-level `src/` folder     | FAIL    | `src/workspace-watch/` undocumented (Serious-1)                                                                      |
| Port interface doc matches implemented adapter behaviour              | FAIL    | overflow-cadence mismatch (Blocking-1)                                                                               |

## Maintenance debt

- Introduced: one new port implementation surface (`WorkspaceWatchHostCore` + protocol + `ElectronWorkspaceWatcher`, ~2,900 lines of source across 8 files) replacing nothing — this is new capability, not a refactor.
- Retired: nothing in this batch (the git watcher / file index migration onto this port is Batch 11, not yet done).
- Net: additive. The debt this batch itself creates is documentation drift (two CLAUDE.md/interface-doc gaps) rather than code debt; the code is well-tested (per the handoff: platform-core 685, platform-electron 634, ptah-electron 609, contract suite 8/8) and follows established repo patterns closely.

## Verdict

- Recommendation: REVISE (documentation-only fixes; no source-code change required for this reviewer's findings)
- Confidence: HIGH
- Key concern: the port interface's "`overflow` once" guarantee is the one document every Batch 9 adapter author will read before writing the CLI and VS Code watchers, and it currently describes behaviour the shipped Electron adapter does not have.
- What a 10/10 version would do differently:
  1. Fix `workspace-watcher.interface.ts:148-149` to state the real degraded-mode contract (Blocking-1).
  2. Add the `src/workspace-watch/` entry to `platform-core/CLAUDE.md` Internal Structure and Key Files (Serious-1).
  3. Extract `computeNativeIgnore` into a named collaborator before the file grows past this batch's 712 lines (Serious-2, non-blocking here).
  4. Add a one-line comment at `wire-runtime.ts:559-561` explaining why this capture alone needs `isRegistered` (Minor-2).

## Deviation verdicts

### Deviation 1 — third (`child_process`) transport added to the host entry, for a contract suite run over a forked host

**ACCEPT.** The transport-detection stanza in `workspace-watch-host.entry.ts` (lines 48-79) belongs in `platform-electron`, not `platform-core`: `platform-core/CLAUDE.md`'s Boundaries section explicitly bars Electron and Node-IPC imports from that lib ("Does NOT belong: ... VS Code, Electron, or Node-IPC imports"), and `implementation-plan.md:457-459` states the C8 split was designed specifically to keep that rule — `WorkspaceWatchHostCore` (the pure logic) in platform-core, the thin transport-detecting entry in platform-electron. Moving the `child_process`/`worker_threads`/Electron-`parentPort` branch into platform-core would violate that boundary for no benefit, since the branch is pure transport plumbing with no logic to share.

The third branch itself is well-justified: `@parcel/watcher`'s one-binding-per-process limitation (documented in both the entry's header comment and `platform-electron/CLAUDE.md`'s new Guidelines bullet) means the contract suite cannot run a second `worker_threads` Worker in the same Jest process once one has already loaded the native binding — `workspace-watch-host.entry.spec.ts:1-21` states this was measured, not assumed, and the file's own docstring explains the child_process branch is specifically what lets `runWorkspaceWatcherContract` drive a real, restart-capable host. This is a legitimate technical need, not scope creep.

On the "reusable for Batch 9's CLI host" question: `platform-cli` must not import `platform-electron` (hexagonal rule, restated for this exact case in `implementation-plan.md:526-527`: "platform-cli must not import platform-electron"), so no import-level sharing is possible regardless of which lib the code lives in — only pattern-level reuse is available, and that is what the current placement gives. Note, however, that `batches.md:523-526` and `implementation-plan.md:519-527` both describe the CLI adapter (Batch 9) as running over `worker_threads` only, with no mention of `child_process.fork`; the review brief for this task states Batch 9 "MUST use `child_process.fork`." That is a discrepancy between the two plan documents and this task's brief that this reviewer cannot resolve from Batch 8's files alone — flag it to the team-leader before Batch 9 starts, so whichever document is stale gets corrected before an executor duplicates the wrong transport.

Naming (`workspace-watch-host.entry.ts`) matches the existing `integrity-worker.ts` entry-point convention, not the `{platform}-{capability}.ts` adapter convention — correctly so, since it is not an `Electron*` adapter class but a bundled worker entry point, the same category as `integrity-worker.ts` itself.

### Deviation 2 — `wire-runtime.ts` edited to set `refs.workspaceWatcher`

**ACCEPT.** `batches.md`'s Task 8.3 file list (lines 527-532) does not name `wire-runtime.ts`, but the capture this batch needed — resolving a disposal handle eagerly, pre-window, so `will-quit` never triggers a first-time lazy build mid-teardown — has exactly one established site in this app: `captureShutdownHandles` in `wire-runtime.ts`, which already does this for `cliRegistry` and `agentProcessManager` (lines 521-554, both predating this batch). The new block (lines 556-575) matches that function's existing shape line-for-line: same try/catch, same `console.warn` message format (`'[Ptah Electron] <Name> eager resolve failed (non-fatal):'`), same null-on-failure fallback. This reads as a gap in `batches.md`'s file list rather than a deviation from architecture — the alternative (inventing a second capture site, or capturing inside `boot-coordinator.ts`, which the app's own CLAUDE.md says "imports nothing at runtime by design") would have been the actual inconsistency.

### Deviation 3 — degraded mode repeats `overflow` every 60 s; port doc says "once"

**Doc must change, not the code** (structure/consistency view; the runtime correctness of a 60 s repeat vs. a single overflow is for code-logic-reviewer to judge). `implementation-plan.md:475-476` (Batch 8, Electron-specific) and `platform-electron/CLAUDE.md:38` both specify the repeating rescan as the intended design, and the code matches both. `workspace-watcher.interface.ts:148-149` is the document that is now wrong — it was written in Batch 7 (C7, the generic port contract) before Batch 8 decided what a permanently-degraded adapter does, and nobody circled back to update it. See Blocking-1 for the exact wording fix.

### Deviation 4 — `platform-core/CLAUDE.md` not updated for `workspace-watch/`

**Confirmed required fix**, already scored above (Serious-1). No further verdict needed beyond the fix given there.

## Delta review (review fixes)

Scope: verification of the three required fixes from this review, plus a structural read of everything Batch 8's review-fix pass touched or grew. Read on disk in `D:\projects\ptah-437` (uncommitted); no source edited, no tests run.

### Required fixes — verified

- **Blocking-1 (port doc)** — `libs/backend/platform-core/src/interfaces/workspace-watcher.interface.ts:149-154` now reads: "a DEGRADED adapter (its restart budget is spent) reports one `'workspace-watcher'` degradation per degraded episode, emits `overflow` immediately, and then repeats `overflow` on a fixed rescan cadence until it recovers or is disposed. Electron uses 60 s, and the Batch 9 CLI and VS Code adapters must use the same cadence." This states the real contract (repeat, not once), names the cadence owner, and binds Batch 9 to match it — exactly the fix this review asked for. It also already accounts for the recovery path this same fix-round added to the adapter (`attemptRecovery`/`confirmRecovery`, see below): "until it recovers or is disposed" was not stale the day it was written. **FIXED.**
- **Serious-1 (`platform-core/CLAUDE.md`)** — Internal Structure now lists `src/workspace-watch/` with both files described (`workspace-watch-host-core.ts:59-70`), and Key Files has its own `src/workspace-watch/workspace-watch-host-core.ts` line (`platform-core/CLAUDE.md:80`) alongside the port interface entry (`:79`, which now also states the degraded-cadence contract inline — a second, welcome place a reader gets the right answer). Mirrors `platform-electron/CLAUDE.md`'s existing style. **FIXED.**
- **Minor (`wire-runtime.ts` guard comment)** — `apps/ptah-electron/src/activation/wire-runtime.ts:559-560` now reads: "Guarded unlike the two above: platform-electron registers WORKSPACE_WATCHER only when phase 0 passes `workspaceWatchHost`; the others always exist." Names the asymmetry and its cause at the exact site a future edit would copy from. **FIXED.**

### New code this round

**`electron-workspace-watcher.ts` growth to 779 lines (watchdog stall-tolerance + degraded recovery) — ACCEPT, no split required.** The new watchdog logic (`armWatchdog`, :374-414) and the degraded-recovery machinery (`enterDegraded`/`armDegradedTimers`/`armDegradedRescan`/`attemptRecovery`/`confirmRecovery`, :495-567) both read and write the same fields as the rest of the class's state machine — `this.host`, `this.state`, `this.subscriptions`, `this.failureTimes`, five named timers. That is the opposite shape from `computeNativeIgnore` in `workspace-watch-host-core.ts` (Serious-2 above), which this review already named as the one piece of that file with "no dependency on the class's timers, retry state or engine handle" — the actual test for whether a facade-rule extraction pays for itself. Here it would not: a `WatchSupervisionPolicy` collaborator would need the live host handle, the subscription map, and every timer handle passed in or held by reference, which is delegation in name only — it fragments one state machine across two files without reducing coupling between the pieces. The candidate the executor already rejected (`BatchRelay` growing further) was the right thing to reject for the same reason it was already extracted correctly in Batch 8: `BatchRelay` (:653-779, ~126 lines) has its own private state (`pending`, `droppedCount`, `overflowOwed`) untouched by the supervision fields, which is exactly what earned it collaborator status in the base review. No other slice of the new code clears the ~150-line floor on its own: the recovery block alone is ~72 lines (:495-567), too small per the repo's own guardrail against splits that "push a constructor past ~8 injected deps" or create sub-150-line fragments — a stand-alone `DegradedRecoveryPolicy` would be exactly such a fragment. 779 lines is past the 700-line soft ceiling but nowhere near "1000 means a deliberate look" — flagged here, as Serious-2 flagged `workspace-watch-host-core.ts` at 712, as a marker for the _next_ addition to this file to trigger extraction, not this one.

Compound state worth a one-line comment, not a blocking finding: `recovering` (:174) is a boolean riding on top of `state === 'degraded'`, giving the class five _named_ states but six _effective_ ones (`degraded` alone vs. `degraded` + `recovering`). `armDegradedRescan`'s guard (`if (this.state !== 'degraded' && !this.recovering) return;`, :534) is the one place that distinction is load-bearing, and it is correct, but a reader diagramming the state machine from `AdapterState` alone (:127) would miss it. A one-line comment on the `recovering` field pointing at that guard would close the gap; not required for this batch.

**`workspace-watch-host-core.ts` at 718 lines (was 712) — still acceptable.** Confirmed by direct line count. The +6 lines are consistent with the docstring/contract wording this fix round touched elsewhere in the same batch; no new structural concern, same verdict as the base review's Serious-2 (soft-ceiling warning only, `computeNativeIgnore` remains the one extractable piece if this file grows again).

**`electron-workspace-watch-host-factory.ts:107-140` (`onDiagnostic` param, `logDiagnostic`) — consistent with phase-0 precedent.** `logDiagnostic` (:121-140) guards `TOKENS.LOGGER` behind `container.isRegistered` and falls back to `console.error`/`console.warn`/`console.log` chosen by level, exactly the pattern the base review already scored 8/10 for this file's `TOKENS.DEGRADATION_REPORTER` guard (`reportDegradation`, :142-156) and the same shape `electron-integrity-worker-factory.ts` uses elsewhere in this app for the identical "phase 0 registers before the logger exists" problem. No naked `console.log` call exists outside that guarded fallback branch — checked `phase-0-platform.ts`, which wires this factory in, and it contains no `console.*` call itself. **No finding.**

**Fake-clock helpers (`stall`, `runDueTimers`) — reasonable, correctly scoped.** Both live on the spec-local `ManualClock` in `libs/backend/platform-electron/src/workspace-watch/electron-workspace-watcher.spec.ts:21-86`, not in a shared testing utility — appropriate, since nothing outside this spec file uses this clock. `stall(ms)` (:48-50) only advances the clock's `now()` without firing timers, modelling "time passes, event loop blocked"; `runDueTimers()` (:57-65) fires only what is due _now_, explicitly not the timers those callbacks in turn schedule — the comment at :52-56 states the semantic difference from the pre-existing `advance()` (which drains everything up to a horizon, callbacks and all). That distinction is exactly what the watchdog's queued-heartbeat-after-stall test needs (:522-543, :557-576) and `advance()` cannot express it alone. Two small, well-named, well-commented additions to a test-only class. **No finding.**

**`git-watcher.stress.harness.ts:47-66` (`resolveGitExecutable`, `runGit`) — Sonar S4036 fix is correct but duplicates an existing solution to the same problem.** `libs/backend/vscode-core/src/utils/exec-git.ts:364-375` already solves "don't hand a bare `git` name to a spawn call" with `gitCommand()`, a memoize-once wrapper over `which.sync('git', { nothrow: true })` — the same CWE-78/S4036 concern, in the same codebase, reached from the same app (the harness already imports `GitInfoService` from `@ptah-extension/vscode-core` two lines above its own resolver, :21). The harness's `resolveGitExecutable()` (:47-61) instead hand-rolls a `PATH`-entry walk with `fs.statSync`, filtering to absolute entries only — a different, marginally stricter algorithm (it refuses relative/writable `PATH` entries outright rather than accepting whatever `which` resolves) but solving the identical problem a second, independent way. `gitCommand()` is not exported from `exec-git.ts`, so the harness could not have imported it directly without a lib-boundary change, and the executor's own search (`tools/degradation-audit/run-self-test.js`, a different S4036 fix for `ts-node`, not git) found no shared helper to reuse — so this is not a case of the executor missing an available import. Naming and placement are both sound: `resolveGitExecutable`/`runGit` read as domain verbs, not mechanism, and the file is test-support code colocated with its only two consumers (`git-watcher.stress.spec.ts`, `git-watcher.stress.perf.spec.ts`), matching the file's own stated scope. **Minor**, not blocking: if a third caller ever needs "resolve git's absolute path safely," extract `gitCommand()`'s logic (or this harness's stricter variant) into an exported helper both sides call, rather than letting a third implementation appear. Not worth a rework for two call sites today.

**`platform-electron/CLAUDE.md` recovery update — present.** Lines 42-45 describe the 10-minute degraded-recovery attempt, the reset budget, the one-info-line/one-rescan success path, and the no-second-report failure path, matching the code in `enterDegraded`/`attemptRecovery`/`confirmRecovery`. **No finding.**

**Open planning conflict (`worker_threads` vs `child_process.fork` for the Batch 9 CLI host) — still unresolved, and it is a Batch 9 problem, not a Batch 8 one.** `implementation-plan.md:523` and `batches.md:523` both still describe `CliWorkspaceWatcher` running the host on a `worker_threads` Worker; neither was edited this fix round. `platform-electron/CLAUDE.md:68-73` (itself part of Batch 8) already states the fact that makes that wording wrong: `@parcel/watcher`'s binding loads into one thread per process, "measured, TASK_2026_437 Batch 8," and "a host that must restart needs its own process." A `worker_threads` Worker cannot satisfy that for a host that must survive a restart (the exact reason `workspace-watch-host.entry.ts` grew its third, `child_process`-IPC transport branch in this same batch — Deviation verdict 1 above). Recommendation unchanged from the base review: this is a planning-document defect, not a Batch 8 source defect, and `batches.md`/`implementation-plan.md` are not in Batch 8's file list — fix it as the first thing Batch 9 does (or as a team-leader planning update immediately before Batch 9 starts), not by editing plan prose inside this batch's diff. Do not let a Batch 9 executor build `CliWorkspaceWatcher` against the stale `worker_threads`-only line.

### Delta verdict

- **Recommendation: APPROVE.** All three required fixes are verified correct and complete on disk. No blocking or serious issues found in the new watchdog/recovery code, the factory logging, the fake-clock helpers, or the CLAUDE.md updates.
- **Confidence: HIGH.**
- **Remaining fixes** (both non-blocking, neither required before this batch commits):
  1. Minor — `git-watcher.stress.harness.ts:47-61`: note the duplication with `exec-git.ts`'s `gitCommand()` (a one-line comment pointing at it is enough); extract a shared helper only if a third caller appears.
  2. Minor — `electron-workspace-watcher.ts:174`: a one-line comment on the `recovering` field noting it composes with `state === 'degraded'` to form a sixth effective state, so the reader diagramming `AdapterState` does not miss it.
- **Process action item, not a code fix**: `implementation-plan.md:523` / `batches.md:523` still say the CLI host runs on `worker_threads`; this contradicts the `child_process.fork` requirement this review's own C8 findings establish. Raise to the team-leader before Batch 9 is decomposed.
