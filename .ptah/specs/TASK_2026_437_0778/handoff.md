# Handoff — TASK_2026_437_0778 (session ended 2026-09-14)

Electron main process freezes under heavy file-system and process load. This file is the entry
point for the next session. Read it first, then `batches.md` (authoritative batch state),
`implementation-plan.md`, and `context.md`.

## 1. Where the work lives

| Item          | Value                                                                                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worktree      | `D:\projects\ptah-437` (outside the repo root on purpose — never use `.claude-worktrees\`)                                                                                                         |
| Branch        | `fix/task-437-main-loop-isolation` (tracks origin, all commits pushed)                                                                                                                             |
| PR            | #510 MERGED (at `36a24f257`). Batches 20–22 are after it; no PR yet — user decision: open one new PR after the P4 gate                                                                             |
| Related PR    | #512 — `chore/bump-better-sqlite3-13` in worktree `D:\projects\ptah-sqlite-bump`                                                                                                                   |
| node_modules  | `D:\projects\ptah-437\node_modules` is a JUNCTION to `D:\projects\ptah-extension\node_modules`. Never delete it with a tool that follows junctions; remove the junction with `cmd /c rmdir` first. |
| Main checkout | `D:\projects\ptah-extension` is used by ANOTHER session (branch `feat/chat-composer-card`). Do not edit it or run tests there for this task.                                                       |

## 2. Root cause (confirmed)

On 2026-09-14 an agent Bash command removed 10 git worktrees (~74k files) inside the workspace.
Neither main-process watcher excluded `.claude-worktrees/` or `.claude/worktrees/`, so every delete
event ran JS on the Electron main loop; `GitWatcherService` also cleared the in-flight `git status`
before each refresh, so runs piled up. The app froze with no crash record (no crash/hang handlers,
no crashReporter). Evidence: `context.md`, research reports, `test-report-b6.md`.

User decisions (binding): all four phases; nested repos/worktrees excluded from every consumer
including the `@` picker; crashReporter local-only; SQLite measured before moving off main;
scroll-back history paging deferred; `better-sqlite3` upgrade in a separate PR (#512).

### User decisions (2026-09-14, on implementation-plan.md)

This section was in this branch's `context.md`. It moved here on 2026-09-15 so that `context.md`
matches the copy `main` received from PR #509, which removes the add/add conflict that blocked
PR #510 CI. Add it back to `context.md` after PR #510 merges.

- Scope: implement ALL four phases (P1 → P4), shipped in order.
- Nested git repositories and worktrees are excluded from every consumer, including the `@` picker.
- Electron `crashReporter` enabled with local dumps only, never uploaded.
- Defaults taken for the remaining plan questions: CLI uses `@parcel/watcher` only if it packages
  cleanly (else keep its current watcher behind the port); measure SQLite main-thread cost before
  moving it; scroll-back paging of old history is deferred.

## 3. Done — committed (24 of 24 batches; Batches 8, 9, 10, 11, 15, 16, 16b, 17, 17b, 18, 19, 20, 21 and 22 in section 4)

| Batch       | Commit                   | Summary                                                                                                                                               |
| ----------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| docs        | `1f58d1459`              | Task spec, research, plan, batches                                                                                                                    |
| 3           | `93c360572`              | git status single-flight + one trailing rerun                                                                                                         |
| 2           | `ed98e515a`              | Exclusion rules (worktrees, nested repos, case-insensitive), `NestedRepoRoots`, `EventStormBreaker`                                                   |
| 5           | `bf247ed3c`              | Crash/hang records: process-gone/unresponsive handlers, renderer console forwarding, main-loop watchdog worker + `ptah-hang.log`, local crashReporter |
| 4           | `2ae430160`, `0a34fea7b` | Git watcher hardening, batched `file:content-changed`, file-index storm breaker + atomic snapshot swap                                                |
| Sonar       | `f96841cdd`              | SonarCloud reliability/maintainability fixes                                                                                                          |
| 7           | `b9ac03426`              | `IWorkspaceWatcher` port, `WorkspaceChangeCoalescer`, contract suite, exclusion drift spec                                                            |
| 13          | `b288ffff0`              | Bounded reusable spawn worker pool (hard cap 64, Node exit-code semantics)                                                                            |
| 14          | `8d3f3745f`              | Slow SQLite statement + slow session-history read logging                                                                                             |
| 12          | `2f2416993`              | Git process gate (max 4, min 2, UI lane), output cap, `statusUnavailable` shown in git UI                                                             |
| 4 follow-up | `a659830bc`              | Unnamed `fs.watch` events + own-refresh NTFS echo filter, 30 s safety refresh                                                                         |
| 6           | `321506385`              | Real-watcher stress tests ST-1/ST-1b + perf spec + harness                                                                                            |

Phase 1 is CLOSED. Every batch passed a logic review and a style review (files `bN-*.md`).

Measured (idle machine, 8k-file stress tree): ST-1 (delete under `.claude-worktrees/`) → 0 git
refreshes, 0 renderer pushes, event loop p99 17 ms / max 67 ms. ST-1b (delete under `pkgs/big/`)
→ exactly 1 refresh + 1 truncated push, p99 33 ms / max 71 ms. Incident baseline: 265–615 ms lag
every 2 s.

## 4. Batch 11, the Linux CI fix, Batches 15, 16, 16b, 17, 17b, 18, 19, 20, 21 and 22 — COMMITTED (P3 gate passed; next the P4 gate)

**Batch 22 — COMMITTED 2026-09-15** as
`test(electron-e2e): measure tile-open long tasks for a 2,000-event session`.
NEW `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts` (skipped unless
`PTAH_PERF_SPECS=1`) measures `PerformanceObserver('longtask')` while 3 tiles of ~2,000-event
sessions open; NEW `src/support/perf-diagnostics.ts`; `ui-driver.ts` memoizes function-string mock
resolvers. **AC-11 NOT MET** on a valid measurement (Playwright work outside the window, idle
machine): dev cold 3 tiles max 1,493–1,864 ms, total 5,404–6,193 ms (3 runs); warm 1 tile 119 / 433
ms (passes); production cold 3 tiles max 973, total 4,657 ms (1 run). Budget 200 / 1,500 ms, not
loosened. The last-clicked tile carries 88–98 % of blocked time. One CDP profile (hypothesis):
finalization + replay + Angular CD < 2 %; cost in native DOM/animation work (`getAnimations` next to
`@formkit/auto-animate`) and `(program)`. Reviews: logic NEEDS_REVISION → delta APPROVE_WITH_FIXES;
style APPROVED → delta NEEDS_REVISION; all fixed, verified by the team-leader on the diff, no third
round. **Q6 DECIDED (user, 2026-09-15): attribution spike first** — FU-22d, next after the P4 gate,
in this worktree, report only, no product code; AC-11 stays NOT MET until then. Evidence:
`test-report-b22.md` "Verdict". FU-22a (single-slot `_canvasSessionRequest` loses rapid tile opens),
FU-22b (spec 923 lines), FU-22c (`ptah_agent_spawn` rejects external worktrees) are in `batches.md`
"Batch 22 outcome".

**Batch 20 — COMMITTED 2026-09-15** as
`perf(chat): replay resumed session history in chunks and drop the duplicate transcript from chat:resume`.
C15 (INV-9): `ChatResumeResult.messages` is deleted end to end (shared type with a compile-time spec,
`chat-session.service.ts`, `readHistoryAsMessages`); `events` is the one transcript. NEW
`SessionHistoryReplayer` collaborator of `SessionLoaderService`: `claim(tabId, sessionId)` before
`chat:resume`, `release` in `finally`; 250 events per chunk with `yieldToMacrotask`. A session-keyed
live-event fence opens at claim time (an `activate: true` resume starts the live query before the
reply); held `chat:chunk` events are delivered once, in order, capped at 2,000.
`TabManagerService.applyResumedHistory` deleted; `session:load` docs corrected (never carried a
transcript), including CLI `session.history` (`limit` accepted, no effect). Evidence: shared 1521,
agent-sdk 1948, chat-state 386, rpc-handlers 2999, chat 1212, ptah-cli 1015, ptah-tui 330;
typecheck,lint (8 projects) 0 errors; audit 303; e2e `compaction-duplicate-session.spec.ts` 1 passed.
Reviews: logic REVISE → APPROVE_WITH_FIXES → APPROVE_WITH_FIXES; style REVISE → APPROVED → APPROVED;
last three items verified by the team-leader, no third round. FU-20a..c in `batches.md` "Batch 20
outcome".

**Batch 21 — COMMITTED 2026-09-15** (ahead of Batch 20) as
`perf(core): coalesce inbound webview message bursts into one change-detection pass`.
C18 (AC-13, INV-11): `MessageRouterService` listens outside Angular and queues; one macrotask drains
the queue snapshot inside one `ngZone.run`, so 1,000 queued messages cost 1 zone entry, in order.
R-P8: an `rpc:response` (or a BATCH carrying one, reported once as a producer regression) flushes
synchronously; the capture-phase listener runs that flush before `rpc-call.util.ts`'s listener.
Per-message and per-BATCH-member errors go to `ErrorHandler`; a malformed BATCH is reported; a
failed drain post resets, reports and drains synchronously; teardown cancels. NEW shared
`scheduleMacrotask` / `yieldToMacrotask` in `@ptah-extension/core` (no-`MessageChannel` fallback for
jsdom only). Price: a burst with k responses costs up to k + 1 zone entries; a throwing BATCH member
no longer drops the rest of the batch. Evidence: core 717, webview 152, typecheck,lint 0 errors,
audit 303, reviewer re-ran 35/35. Reviews: logic APPROVED → delta APPROVE HIGH; style APPROVED 7/10
(serious items closed). FU-21a (route `rpc:response` through the router), FU-21b (log the fallback
outside tests) are in `batches.md` "Batch 21 outcome".

**Batch 19 — COMMITTED 2026-09-15** as
`perf(chat-streaming): finalize session history in one pass and back off tab saves after quota errors`.
C16: `finalizeSessionHistory` indexes message boundaries and root trees in one pass each (first match
wins, as the replaced `find` calls did), so opening a long session is O(E + M), not O(M × E). An
equivalence oracle (the old loop, verbatim) covers 4 fixtures, including a ~2,000-event session. A
counting proxy allows ≤ 2 × E event visits, and the legacy loop exceeds 10 × E. C17 (INV-10, AC-12):
a failed tab-state write records `{ key, failedAt, attempt, tabCount }`. Later saves skip
serialization for `min(5 s × 2^attempt, 5 min)`, unless the tab set shrank or teardown flushes. A
success resets the record. One warn per step, no timers. A first cut added a degradation-audit site
(304); it was fixed in the batch, and the audit is back to 303. Evidence: chat-state 387,
chat-streaming 501 (+1 skipped), typecheck,lint 0 errors. Reviews: logic APPROVED 8/10, style
APPROVED 7/10. Outcome, crash-window analysis and FU-19a..f are in `batches.md` "Batch 19 outcome".

**Batch 17b — COMMITTED 2026-09-15** as
`feat(skill-synthesis): defer background skill re-propagation while user clicks re-propagate at once`.
`SkillRepropagationPort.repropagate` takes `origin?: QueryOrigin`. The seven RPC click paths
(`promote`, `promoteBulk`, `enhanceNow`, manual `runCurator`, `applyProposal`, `revertEnhancement`,
`acceptSuggestion`) pass `userInitiated: true`; the curator interval pass passes nothing. harness-sync
gained `HarnessPropagateOptions.userLayerRefreshReason` and `IUserLayerRefresher.refresh(root, reason?)`.
Electron: a click uses the ungoverned `harness-propagation` reason and is awaited; background uses the
governed `skill-repropagation` reason, fire-and-forget (never rejects, one warn on failure), so a
curator pass no longer waits per candidate; a click joining a held batch releases it.
`acceptSuggestion` is now async and re-propagates (pre-existing gap). CLI ignores origin; VS Code keeps
the no-op port. Reviews: logic NEEDS_REVISION 7/10 → delta APPROVE HIGH; style NEEDS_REVISION 7/10,
fixed and verified in the logic delta. Outcome, evidence and FU-17b-a..c are in `batches.md`
"Batch 17b outcome".

**Batch 18 — COMMITTED 2026-09-15** as
`feat(agent-sdk): back off background curator and skill-synthesis calls when the provider is unreachable`.
A4 resolved: on 2026-09-14 the curator made 41 failed forwards to `chatgpt.com`
(`getaddrinfo ENOTFOUND`) in 5 min 52 s; the `claude` subprocess retried on its own ladder, Ptah
dispatched the next window 17 ms later, and the error text most likely parsed as zero drafts.
agent-sdk now classifies network-class failures (not auth/4xx/parse/abort) and keeps an in-memory
`NetworkBackoff` (30 s doubling, cap 15 min, ±20 % jitter, reset on the first answered call). The
curator adapter reports `stalled` + `provider-unreachable` (input kept); background curator passes
defer as `network-backoff` without spending the hourly budget (pre-check + refund); user-initiated
work is never deferred. Skill-synthesis: `network-unreachable` is exempt from `maxAttempts`, the
drain holds token-spending rows without claiming, back-off per lane provider
(`ProviderNetworkBackoffs`), the enhancer skips on `provider-unreachable`. FU-16b-a closed
(`CuratorPassAdmission.clearance`); FU-16b-b closed (`memory-curator.service.ts` 1,068 → 835 via
`CuratorActivityLog`). Reviews: logic and style both base NEEDS_REVISION → delta APPROVE HIGH.
Outcome, evidence and FU-18a..i are in `batches.md` "Batch 18 outcome".

**Batch 17 — COMMITTED 2026-09-15** as
`feat(workspace-intelligence): defer symbol indexing, file-index rebuilds and daily backups while the app is busy`.
Governor adopters (C14 b–e): the symbol indexer waits before each batch (`userInitiated` opt-out
for `ptah.code.reindex` and the thoth indexing clicks); the Electron user-layer coalescer governs
only `content-download-complete`; the file-index lost-event rebuild is deferred and coalesced
(previous snapshot served, `ensureReadyFor` expedites it); the `daily` SQLite backup waits;
editor probes run in a pool of 8 with a PATH-keyed cache. FU-11b done: the file index split into
`WorkspaceFileIndexService` + `FolderIndexLiveSync` + `folder-index-snapshot.ts`. One shared
`BackgroundWorkAdmission` type in vscode-core. Reviews: logic REVISE → delta APPROVE_WITH_FIXES
HIGH; style APPROVED 8/10. Orchestrator decisions (agent tool calls may expedite a rebuild;
skill re-propagation origin deferred to Batch 17b), AC-10 manual instructions and FU-17a..e are
in `batches.md` "Batch 17 outcome". **AC-10 still needs a manual boot log.**

**Update 2026-09-15 (Batch 11):** Batch 11 passed both reviews (logic base NEEDS_REVISION 5/10 →
delta APPROVE HIGH; style base NEEDS_REVISION 7/10 → delta APPROVE HIGH) and is committed as
`refactor(electron): watch the workspace through the out-of-process watcher port`.
`GitWatcherService` and `WorkspaceFileIndexService` now consume `IWorkspaceWatcher`; no recursive
`fs.watch` or per-event storm work remains on the Electron main loop. Both storm-exit loops (FU-4a)
and both FU-4d filters are deleted; `@parcel/watcher` reports 0 events for `git status`/`git diff`
(`b11-probe-parcel.log`). The initial walk (`discoverFiles`) skips nested repos and worktrees (D4).
An ESLint rule forbids recursive watching in main (best-effort: it cannot see options passed by
variable, FU-11d).

ST-1b decision (orchestrator, Option B): the coalescer holds the first batch after quiet for
`minBatchIntervalMs`; the git watcher subscribes with 1000 ms because the `@parcel/watcher`
Debounce MAX of 500 ms is shared across backends. AC-2 stays "exactly 1". Measured: ST-1b exactly 1
refresh (+5268/+5288 ms), 1 status push, 1 truncated push, p99 24.9/20.7 ms, max 40.0/33.4 ms; ST-1
0 batches/spawns/pushes, p99 21.0/23.2 ms, max 38.5/42.8 ms. Trade-off: worst-case git decoration
refresh ~3,000 ms (P1 ~2,000 ms), `file:content-changed` ~1,500 ms (P1 ~500 ms). Outcome, evidence,
deviations and FU-11..FU-11h are in `batches.md` "Batch 11 outcome".

**Linux CI fix — COMMITTED 2026-09-15** as
`fix(platform-core): recover lost inotify watches in the workspace watch host on Linux`. It fixes
the two Linux-only PR #510 CI failures, pending the next CI run (the first Linux run of these jest
specs): (A) `@parcel/watcher` 2.5.6 inotify does not list created directories (parcel#243), so
writes under new directories were silently lost — the host now reconciles created directories
(`CreatedDirectoryReconciler`) and does a full rebuild with `overflow` when a watch is lost;
(B) terminating a `worker_threads` Worker with a live subscription aborts the process — that
test-only transport is removed. Details, WSL2 evidence and FU-L1..FU-L5 are in `batches.md`
"PR #510 Linux CI fix".

**Linux CI follow-up — COMMITTED 2026-09-15** as
`fix(platform-core): serialize native watcher calls so a subscribe never races an unsubscribe`.
CI run 34913948101 confirmed the CLI contract suite on Linux, but the Electron host entry spec
"detects a nested .git" timed out and Sonar reported reliability D (S2871 in
`git-watcher.service.ts`). Cause: in parcel 2.5.6 a subscribe in flight while an unsubscribe drops
the last subscription resolves but never delivers events (a workspace-folder switch in the product).
Fix: all native calls serialized with per-call timeouts (subscribe 120 s, unsubscribe 10 s → `fatal`
→ supervisor restart); the spec awaits the `subscribed` ack; S2871 fixed with `compareCodeUnits`.
Logic follow-up review APPROVE HIGH. FU-L6 (extract `native-call-queue.ts`) and FU-L7 (120 s walk
ceiling) are in `batches.md` under "PR #510 Linux CI fix".

**Batches 16 and 16b — COMMITTED 2026-09-15** as one commit,
`feat(vscode-core): defer background LLM work while the main loop lags or a turn is generating`
(the two could not be split by file). Committed before Batch 15 by orchestrator decision (recorded
under Batch 7 in `batches.md`); release order is unchanged because everything ships in PR #510.
`BackgroundWorkGovernor` (states `clear | foreground-busy | lagging | disposed`; enter at p99 >
100 ms × 2 windows or one window max ≥ 1,000 ms; exit at max < 40 ms × 3; `whenClear` ceiling
600,000 ms) holds the `memory-curator` and `skill-synthesis` internal-query lanes while a turn is
generating or the main loop lags. RPC-driven clicks (7 paths) run on an ungoverned `user-action`
lane. The governor is disposed at shutdown in all three hosts. Reviews: 16 logic NEEDS_REVISION →
delta APPROVE HIGH, style APPROVED → delta APPROVE HIGH; 16b logic APPROVED, style NEEDS_REVISION →
fixed. Outcomes, evidence and FU-16a..d, FU-16b-a..c are in `batches.md`.

**Batch 15 — COMMITTED 2026-09-15** as
`test(platform-electron): stress the watch host with a 75,000-file storm and a host kill`. Real
bundled host + real `@parcel/watcher` + real supervisor. Idle machine: ST-2 at 75,000 files p99
18.55–19.58 ms, max 26.56–36.14 ms (budget ≤ 30 / ≤ 100); AC-7 restart 902–905 ms (≤ 3,000), exactly
one overflow per subscriber on a bare kill; degraded path (budget, cadence, recovery) on real
supervisor code; host RSS ~65 → 78 → 62 MB. The first AC-2 miss was the rig (in-process delete +
per-sample RSS `spawn`), fixed with a delete child and a persistent RSS monitor child, backported to
the git-watcher perf rig. A1: no real Windows buffer overflow up to 75,000 files (storm breaker
absorbs it). Orchestrator decisions: ST-1b in CI asserts the bounded mechanism (FU-11h materialized
on CI run 34922130353); strict "exactly one refresh" lives in the idle perf spec at 8,000 files; the
75,000-file case asserts a bounded shape because the breaker re-enters over quiet gaps > 2 s.
Reviews: logic and style both base NEEDS_REVISION → delta APPROVE HIGH. Outcome and FU-15a..d are in
`batches.md` "Batch 15 outcome".

**All P2 batches are COMPLETE.** The only open P2 gate is D10 (section 4a).

**P3 PHASE GATE PASSED 2026-09-15 — Phase 3 CLOSED.** `lint:all` 73 projects 0 errors;
`typecheck:all` 93 projects 0 errors (the first run failed only because this worktree lacked the
gitignored generated Prisma client, not branch code); `nx build ptah-electron` exit 0;
`degradation-audit:lint` TOTAL 303. Evidence in `batches.md` under Batch 18 verification. D10 is
still the only open P2 gate; AC-10 manual evidence is still pending.

**Next: P4 Batches 19, 20, 21, 22.**

## 4a. Batch 10 — COMMITTED

**Update 2026-09-15 (Batch 10):** Batch 10 passed both reviews (logic base NEEDS_REVISION 4/10 →
delta APPROVE HIGH; style base NEEDS_REVISION 7/10 → delta APPROVE) and is committed as
`build(electron): package the @parcel/watcher watch host for Electron and the CLI`. The host bundle
`workspace-watch-host.mjs` is built and packaged for Electron (asar-unpacked, gated by
`verify-packed-native.js` require + subscribe) and for the CLI npm package (`main.mjs` and `tui.mjs`
paths both proven from a clean tarball install). It also fixes a pre-existing bug: the published
CLI shipped without `integrity-worker.mjs`. The `ptah-tui` typecheck failure is fixed. Outcome,
evidence, deviations 1–8 and follow-ups FU-10a..c are in `batches.md` "Batch 10 outcome".

**OPEN proof for P2 (D10, corrected):** only win32-x64, darwin-arm64 (macos-latest) and linux-x64
are built by `publish-electron.yml` (no `arch` in `electron-builder.yml`, no arch flag in the
workflow); darwin-x64 and windows-arm64 are not built at all (FU-10b, product decision). P2 is not
done until that build matrix is green on all three OSes. It has not run on this branch; it runs on
a `release/electron` push or `workflow_dispatch`.

**PR #510 conflict (resolved 2026-09-15 without a merge commit):** `main` received its own
`context.md` from PR #509, which caused an add/add conflict, so no `pull_request` CI ran. The branch
now carries `main`'s exact `context.md`, and its "User decisions" section moved to section 2 above.
A local merge of `main` was avoided on purpose: the pre-commit hook runs `nx format:write` on every
staged incoming file and would have reformatted other work in PR #510's diff. Local
`node_modules` is shared with the main checkout, so local tests do not prove `better-sqlite3` 13;
the PR CI test merge does.

### Batch 9 (committed earlier, kept for context)

**Update 2026-09-14 (Batch 9):** Batch 9 passed both reviews (logic delta APPROVE_WITH_FIXES HIGH,
both Moderate items fixed before commit; style delta APPROVE HIGH) and is committed as
`feat(platform-cli): watch CLI and VS Code workspaces through the shared supervised watcher`.
The watch supervisor and batch relay now live in `platform-core/src/workspace-watch/`; the Electron
and CLI adapters are facades over it. The CLI host runs under `child_process.fork`. VS Code uses
`createFileSystemWatcher` with the coalescer and never writes `files.watcherExclude`. Outcome,
evidence, deviations 1–9 and follow-ups FU-9a..f are in `batches.md` "Batch 9 outcome".

Batch 10 then built the CLI host bundle (Task 10.4) and fixed the `ptah-tui:typecheck` failure.

### Batch 8 (committed earlier, kept for context)

**Update 2026-09-14:** Batch 8 passed both reviews (logic delta 2 APPROVE_WITH_FIXES, style delta
APPROVED) and is committed as `feat(platform-electron): run workspace watching in a supervised
@parcel/watcher host`. Outcome, evidence and follow-ups FU-8a..d are in `batches.md` "Batch 8
outcome". Batch 9 correction: the CLI host MUST use `child_process.fork`, not `worker_threads`.
The text below is the pre-review snapshot, kept for context.

**Batch 8 — Electron watch host (`utilityProcess`/child process + `@parcel/watcher`).**
Implemented by the executor, all tests green (platform-core 685, platform-electron 634,
ptah-electron 609; contract suite 8/8 against a real host; degradation-audit at baseline 303).

Files in the Batch 8 commit:

- M `apps/ptah-electron/src/activation/{boot-coordinator,shutdown,wire-runtime}.ts`
- M `apps/ptah-electron/src/di/{container.smoke.spec,phase-0-platform}.ts`, `apps/ptah-electron/src/main.quit-path.spec.ts`
- M `libs/backend/platform-core/src/index.ts`
- M `libs/backend/platform-electron/{CLAUDE.md,src/index.ts,src/registration.ts}`
- ?? `apps/ptah-electron/src/services/platform/electron-workspace-watch-host-factory{,.spec}.ts`
- ?? `libs/backend/platform-core/src/workspace-watch/` (protocol + host core + specs)
- ?? `libs/backend/platform-electron/src/workspace-watch/` (adapter, host entry, in-process host, parcel engine + specs)

Backup of this work: `D:\projects\ptah-437-backup\batch8-modified.patch` and `batch8-untracked.tar`.

Executor-reported deviations the reviewers must judge:

1. `@parcel/watcher` loads into only ONE thread per process ("Module did not self-register" in a
   second Worker) → the host entry also supports a `child_process` IPC transport; the contract
   suite runs over a forked host.
2. `wire-runtime.ts` edited (not in the file list) to set `refs.workspaceWatcher`.
3. Degraded mode (restart budget 5/10 min exhausted) sends `overflow` every 60 s; the port doc says
   "overflow once".
4. `platform-core/CLAUDE.md` does not yet list the new `workspace-watch/` folder.

Protocol (Zod-validated both ways): main→host `subscribe`/`unsubscribe`; host→main `batch` (≤500
changes, truncated/overflow/droppedCount), `heartbeat` every 2 s, `error`, `notice`, `fatal`.
Supervision: fork on first watch, stop 30 s after last unsubscribe; failure = no message 6 s /
exit / post or fork failure / fatal → kill, one `overflow` to every subscriber, restart after
250 ms with resubscribe; 6th failure in 10 min → degraded + `DegradationReporter`
(`electron.workspace-watcher.host-degraded`).

What Batch 10 must add (from the Batch 8 executor + `b1-spike-report.md`):

- `build-workspace-watch-host` target: entry `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.entry.ts`,
  output `workspace-watch-host.mjs`, ESM with the `createRequire` banner, external `@parcel/watcher`.
- Add it to `build.dependsOn`, `build-dev`, `serve:watch`, `test.dependsOn`; add `@parcel/watcher`
  external to `build-main`; add to `EXPECTED_ESM_TARGETS` (the bare-run check only matches
  `-worker` names — widen it or add by hand; guard string in the entry).
- `asarUnpack`: `@parcel/watcher/**`, `@parcel/watcher-*/**`, `picomatch/**`, `is-glob/**`,
  `is-extglob/**`, `detect-libc/**`. Direct dep `"@parcel/watcher": "2.5.6"` in root,
  `apps/ptah-electron` and `apps/ptah-cli` package.json; `verify-packed-native.js` subscribe smoke;
  CLI: build `ptah-tui` then `restore-cli-manifest` before pack; cross-platform CI smoke (only
  win32-x64 proven locally).

## 5. Remaining work (0 of 24 batches)

All 24 batches are committed. Next: the P4 phase gate, then the FU-22d attribution spike (Q6). Summary:

- **P2:** all batches committed. Only the OPEN D10 proof remains: `publish-electron.yml` build matrix
  green on Windows, macOS and Linux (section 4a) — needs a user decision to dispatch.
- **P3:** 16, 16b, 17, 17b and 18 are committed. AC-10 manual boot evidence is still open
  (instructions in `batches.md` Batch 17 outcome). The P3 phase gate PASSED 2026-09-15; Phase 3 is
  CLOSED.

### Open user decisions

1. D10: dispatch `publish-electron.yml` (`workflow_dispatch`) or wait for a release push.
2. FU-16b-c: background lanes can hold both global internal-query slots (options in `batches.md`
   Batch 16b outcome).
3. CI skip rule for `chore/bump-*` branches (PR #512 showed `main`, `electron-e2e`, `vscode-e2e`
   SKIPPED).
4. PR for this branch: PR #510 merged; open one new PR after the P4 gate (not opened yet).
5. Whether to write the property-hub load-test setup/cleanup scripts (section 9).
6. AC-10 manual boot evidence (Batch 17 outcome).

Decided: Q6 (2026-09-15) — attribution spike first (FU-22d), report only.

- **P4:** 19 COMMITTED (O(E+M) finalization + tab-save quota back-off), 20 COMMITTED (duplicate
  `messages` dropped from `chat:resume`, chunked replay with a session-keyed live-event fence), 21
  COMMITTED (inbound burst coalescing), 22 COMMITTED (AC-11 tile-open perf e2e; AC-11 NOT MET),
  then the P4 phase gate.
- **SonarCloud:** quality gate green after `36a24f257` (security findings S4036, S2245).

## 6. Open follow-ups (recorded in batches.md)

- FU-3a/b: extract git-info single-flight into a collaborator.
- FU-4a, FU-4c, FU-4d: closed in Batch 11.
- FU-4b: `diff-tabs.service.ts` > 700 lines.
- FU-11: rewrite or delete `apps/ptah-electron-e2e/src/specs/git-watcher.spec.ts`. FU-11b: CLOSED in Batch 17 (split into 717 + 561 + 249 lines). FU-11c: `git-watcher.service.ts` 951 lines.
- FU-11d: the recursive-watch ESLint rule cannot see options passed by variable or module aliases — INV-1 lint enforcement is best-effort; soften any "enforced by lint" wording.
- FU-11e: repeated directory-delete rebuilds above 5,000 entries during `nx run-many -t build` — confirm in the manual load test (section 9).
- FU-11f: spec literals `250`/`300` should reference `WORKSPACE_WATCH_LIMITS.minBatchIntervalMs`. FU-11g: document the content-push latency ratio at the hold constant. FU-11h: timed 1 s hold residual risk on very slow machines.
- FU-4e: `isGitRepo` treats a transient `rev-parse` failure as "not a repo" → git decorations blank for one cycle under load.
- FU-5a/b/c: RPC in-flight breadcrumb hook; CLI arms watchdog only with `--verbose`; concurrent hang-log rotation may clobber `.1`.
- Batch 7: spec for excluded-only churn extending a storm (bounded by `maxStormMs`).
- Batch 12: move `GitProcessGate` out of `exec-git.ts` (755 lines); `GitReviewReaderService` `git show` still capped at 64 MiB.
- Batch 13: shared off-main-thread Windows tree-kill helper.
- Batch 14: manual Electron check — break out of `iterate()` early, then exit, with the real native module.
- FU-10a: gate helper files (`build-artifact-gate.ts`) are typechecked by no project. FU-10b: darwin-x64 and windows-arm64 Electron builds do not exist (product decision). FU-10c: no per-OS CLI pack smoke for `@parcel/watcher`.
- FU-16a: `whenClear` ceiling is per waiter — all held waiters release together after 10 min of lag (bounded by gate limits). FU-16c: platform-core `internalQuery.maxConcurrent` default 1 vs agent-sdk 2. FU-16d: `internal-query.service.ts` / `skill-enhancer.service.ts` sizes.
- FU-16b-a: CLOSED in Batch 18 (`CuratorPassAdmission.clearance`). FU-16b-b: CLOSED in Batch 18 (`memory-curator.service.ts` 835 lines). **FU-16b-c (needs a user decision, pre-existing):** background lanes can hold both global internal-query slots, so a wizard/user-action call can time out at 60 s in the queue — options in `batches.md` Batch 16b outcome.
- 75k-file `PTAH_PERF_SPECS=1` perf budgets: measured in Batch 15 on an idle machine (git-watcher rig ST-1 p99 16.6 / max 24–25 ms, ST-1b p99 16.7 / max 33–34 ms; host ST-2 p99 18.55–19.58 / max 26.56–36.14 ms).
- FU-11h materialized on Linux CI (run 34922130353): ST-1b CI assertion is now the bounded form (Batch 15 decision).
- FU-15a: rig helpers duplicated between the git-watcher and watch-host stress harnesses; a `/testing` secondary entry point (precedent `@ptah-extension/platform-core/testing`) is the option, deferred. FU-15b: storm re-entry during very long deletes (2–3 refreshes at 75,000 files). FU-15c: host kill during an in-host rebuild untested. FU-15d: force a real native buffer overflow to observe A1 directly.
- FU-17a: CLOSED. FU-17b: CLOSED in Batch 17b. FU-17b-a: `plugin-activation.ts` 760 lines.
  FU-17b-b: `skill-curator.service.ts` 725 counted lines (max-lines warning). FU-17b-c: VS Code
  accept/promote/enhance do not re-propagate (pre-existing no-op port). FU-17c: editor
  target cache evicts the whole result on one flaky probe. FU-17d: CLI governor now created eagerly
  when an adopter resolves (disposed at shutdown). FU-17e: no end-to-end spec for `ensureReadyFor` →
  `expediteDeferredRebuild`.
- FU-18a: move the agent-sdk network files into a `network/` folder. FU-18b: `networkSignalForHttpStatus`
  double export. FU-18c: `cron:runNow` of a system drain job is still filtered by the network gate.
  FU-18d: file growth (`skill-drain.service.ts` 1,318, `memory-trigger.service.ts` 1,279,
  `skill-enhancer.service.ts` 1,125, `lane-runner.service.ts` 915) — network-gating collaborator
  candidate. FU-18e: `''` and an explicit id naming the active provider get separate back-off
  windows. FU-18f: `countEligibleByStage` unbounded `GROUP BY` cost on outage ticks. FU-18g: rename
  DI token `NETWORK_BACKOFF` (now resolves `ProviderNetworkBackoffs`). FU-18h: a background curator
  pass already in the queue, held at the internal-query gate, still blocks passes behind it.
  FU-18i: resolve-stage network failures do not feed the back-off (documented).
- FU-19a: extract `TabPersistenceCoordinator` from `tab-manager.service.ts` (2,628 lines). FU-19b: per-workspace
  failure map. FU-19c: payload-size shrink trigger. FU-19d: `extractTextForMessage` O(U×T). FU-19e:
  partition-service background writes lack back-off. FU-19f: pre-existing spec-tsconfig type errors in
  chat-streaming/chat-state specs (`typecheck` covers only `tsconfig.lib.json`).
- FU-20a: global `SessionManager` status/sessionId shared across concurrent resumes (review M3,
  pre-existing). FU-20b: inline the single-caller private `readHistoryMessages` extractor. FU-20c:
  load-flake candidates `skills-sh-legacy-adoption.spec.ts` and
  `electron-state-storage-worker-runtime.error-paths.spec.ts` (both pass alone).
- FU-22a: single-slot `_canvasSessionRequest` loses a tile open on rapid clicks (queue requests).
  FU-22b: perf spec 923 lines. FU-22c: `ptah_agent_spawn` rejects working directories outside
  `D:\projects\ptah-extension`. FU-22d: AC-11 attribution spike (Q6 decided; next).
- Phase gate commands (`lint:all`, `typecheck:all`, `nx build ptah-electron`, `degradation-audit:lint`) last ran at the P3 gate on 2026-09-15 — all green.

## 7. CI and external review state

- PR #510: CI, Electron/VS Code/Webview/CLI E2E green on earlier pushes. Latest push
  (`321506385`) had no checks reported at handoff time — check `gh pr checks 510`.
- SonarCloud: quality gate failed on Reliability before `f96841cdd`; green after `36a24f257`
  (security findings fixed). Re-check after the Batch 20 push.
- CodeRabbit skips drafts. Mark the PR ready (or trigger a manual review) when P2 is committed.
- Intermittent native abort `Assertion failed: (env) != nullptr` in `better-sqlite3`
  `Statement::~Statement()` at process/Jest-worker exit: Node 24.19+ regression
  (nodejs/node#65446), fixed by better-sqlite3 13.x (WiseLibs/better-sqlite3#1498). NOT caused by
  this branch (`ci-sqlite-abort-investigation.md`). Fix is PR #512. At handoff PR #512 showed
  `CLI E2E`, GitGuardian and SonarCloud green but `main`, `electron-e2e`, `vscode-e2e` SKIPPED —
  find out why before merging, and verify the packaged-installer native check on all OSes. After
  #512 merges, merge `main` into this branch.

## 8. Operating rules learned this session (follow them)

1. **Resources.** Parallel agents each spawning full Jest worker pools saturated the machine
   (86 node processes, 14 GB). At most 2 agents run tests at once; always `--maxWorkers=2` and
   `--parallel=1`. Read-only reviews may run in parallel.
2. **`--testPathPattern` does not filter under `nx test <project>`** in this repo — it runs the
   whole project. Budget time accordingly or call jest directly with the project config.
3. **Never `nx test projA projB`**; use `npx nx run-many -t test -p ...` and check the project count.
4. **Stress/perf specs** only when no other jest/nx test run is active:
   `powershell -NoProfile -c "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ? { $_.CommandLine -match 'jest-worker|run-executor' }).Count"` must be 0.
5. **Commit hygiene in a shared worktree.** Stage by explicit path, never `git add -A`, never
   stash. The pre-commit hook runs `nx format:write` + `nx affected -t lint` (for TS/JS) + `ptah-electron:validate-deps`.
   Run eslint/prettier on staged files first, and back up other batches' uncommitted work before committing.
6. **Review gate per batch:** executor → `code-logic-reviewer` + `code-style-reviewer` in parallel →
   fixes → delta review when fixes are non-trivial → team-leader verify-and-commit → push.
7. **Known load flakes** (pass when run alone): `file-settings-manager.bench.spec.ts`,
   `toolchain-probe.spec.ts`, `voice-rpc.handlers.spec.ts`, `main-loop-watchdog.spec.ts`,
   `git-info.service.review.spec.ts`.
8. **Fresh worktree before `typecheck:all`.** The Prisma client is gitignored, so a new worktree
   fails typecheck on every `api-*` project, `ptah-license-server` and `ptah-landing-page-e2e`.
   Run `npx nx run ptah-license-server:prisma:generate` first with a process-scoped placeholder
   `DATABASE_URL` (generate does not connect; do not create a `.env`).

## 9. Manual load test (to confirm the fix in the real app)

Use a CLONE, never the real repos: `git clone D:/projects/property-hub D:/projects/property-hub-loadtest`
(238k files on disk incl. 179k in `node_modules`), `npm ci`, then add ~16 worktrees under
`.claude-worktrees/`. Run the dev app from this worktree: `npx nx serve ptah-electron` with
`PTAH_PROFILE_ON_LAG_MS=500` (data in `%APPDATA%\Ptah Dev`). With 3 streaming tiles run:
B) agent removes all worktrees in one Bash command; C) `rm -rf node_modules && npm ci`;
D) `npx nx run-many -t build`; E) use the git panel during C/D. Check `Ptah Dev\logs\Ptah Electron-<date>.log`
(`[event-loop] lag`, `git status timed out`, storm lines, `[GitProcessGate] saturated`),
`ptah-hang.log`, and crash dumps. Reproduce first on the installed build for a baseline.
Setup/cleanup scripts were offered but not written.
