# Handoff — TASK_2026_437_0778 (session ended 2026-09-14)

Electron main process freezes under heavy file-system and process load. This file is the entry
point for the next session. Read it first, then `batches.md` (authoritative batch state),
`implementation-plan.md`, and `context.md`.

## 1. Where the work lives

| Item          | Value                                                                                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worktree      | `D:\projects\ptah-437` (outside the repo root on purpose — never use `.claude-worktrees\`)                                                                                                         |
| Branch        | `fix/task-437-main-loop-isolation` (tracks origin, all commits pushed)                                                                                                                             |
| PR            | #510 (draft) — https://github.com/Hive-Academy/ptah-extension/pull/510                                                                                                                             |
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

## 3. Done — committed (12 of 22 batches; Batches 8 and 9 in section 4)

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

## 4. Batch 9 — COMMITTED (resume at Batch 10)

**Update 2026-09-14 (Batch 9):** Batch 9 passed both reviews (logic delta APPROVE_WITH_FIXES HIGH,
both Moderate items fixed before commit; style delta APPROVE HIGH) and is committed as
`feat(platform-cli): watch CLI and VS Code workspaces through the shared supervised watcher`.
The watch supervisor and batch relay now live in `platform-core/src/workspace-watch/`; the Electron
and CLI adapters are facades over it. The CLI host runs under `child_process.fork`. VS Code uses
`createFileSystemWatcher` with the coalescer and never writes `files.watcherExclude`. Outcome,
evidence, deviations 1–9 and follow-ups FU-9a..f are in `batches.md` "Batch 9 outcome".

**Next: Batch 10** (build/packaging). Run it ALONE in the worktree and run `npx nx reset` before its
first command. In addition to the Electron items below, it must build the CLI host bundle: entry
`libs/backend/platform-cli/src/workspace-watch/workspace-watch-host.entry.ts` → `workspace-watch-host.mjs`
in `dist/apps/ptah-cli`, ESM with the `createRequire` banner, `@parcel/watcher` external, bare-run
guard string `must be run by child_process.fork` (Task 10.4).

Pre-existing, not caused by this branch: `ptah-tui:typecheck` fails with 6 "Cannot find name
'jest'/'describe'" errors in `apps/ptah-tui/src/build-artifact-gate.ts`.

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

## 5. Remaining batches (10 of 22)

Order and dependencies are in `batches.md`. Summary:

- **P2:** 10 (build/packaging for the Electron AND CLI watch hosts — run ALONE, edits
  `project.json`, needs `npx nx reset` before first command) → 11 (migrate git watcher + file index onto the port, delete both storm-exit loops
  (FU-4a), port FU-4d filters, exclude nested repos in the initial `@` scan (D4), ESLint rule) →
  15 (ST-2 stress + host-kill test AC-7).
- **P3:** 16 (`BackgroundWorkGovernor` core) → 17 (adopters) and 18 (network back-off).
- **P4:** 19 (O(E+M) finalization + tab-save quota back-off), 20 (drop duplicate `messages` from
  `chat:resume`, chunked replay; after 14), 21 (inbound burst coalescing), 22 (AC-11 tile-open perf e2e).

## 6. Open follow-ups (recorded in batches.md)

- FU-3a/b: extract git-info single-flight into a collaborator.
- FU-4a: Batch 11 must delete the duplicated storm-exit loops.
- FU-4b: `diff-tabs.service.ts` > 700 lines. FU-4c: direct `search()` before first index build is empty.
- FU-4d: Batch 11 must port/replace the unattributed-change and own-refresh echo filters; ST-1b is the acceptance check.
- FU-4e: `isGitRepo` treats a transient `rev-parse` failure as "not a repo" → git decorations blank for one cycle under load.
- FU-5a/b/c: RPC in-flight breadcrumb hook; CLI arms watchdog only with `--verbose`; concurrent hang-log rotation may clobber `.1`.
- Batch 7: spec for excluded-only churn extending a storm (bounded by `maxStormMs`).
- Batch 12: move `GitProcessGate` out of `exec-git.ts` (755 lines); `GitReviewReaderService` `git show` still capped at 64 MiB.
- Batch 13: shared off-main-thread Windows tree-kill helper.
- Batch 14: manual Electron check — break out of `iterate()` early, then exit, with the real native module.
- **75k-file `PTAH_PERF_SPECS=1` perf budgets (AC-1/AC-2) not yet measured on an idle machine.**
- Phase 1 gate commands not re-run: `lint:all`, `typecheck:all`, `nx build ptah-electron`, `degradation-audit:lint`.

## 7. CI and external review state

- PR #510: CI, Electron/VS Code/Webview/CLI E2E green on earlier pushes. Latest push
  (`321506385`) had no checks reported at handoff time — check `gh pr checks 510`.
- SonarCloud: quality gate failed on Reliability before `f96841cdd`; re-check after the latest push.
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
