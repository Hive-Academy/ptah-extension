# CI investigation: better-sqlite3 native abort in run 34860866947 (PR #510)

## Verdict

**Pre-existing, environment-level flake — not caused by this branch's diff.** Root
cause: Node.js 24.19+ regression (`nodejs/node#65446`) combined with `better-sqlite3
<13.x`. CI runs on Node `24.20.0` (`.github/workflows/ci.yml` `NODE_VERSION: 24`) with
`better-sqlite3@^12.9.0` pinned (`package.json:137`). Not a fix that belongs in this PR.

## 1. Pre-existing flake search

Scanned `gh run list --workflow CI --limit 60` and 20 recent CLI E2E runs (branches:
`main`, `feat/agent-two-way-messaging`, `fix/task-411-profile-performance`,
`fix/compaction-ui-consistency`, `skills-tab-clone-management`, etc., 2026-09-09
through 2026-09-13) plus the persistence-sqlite-heavy failed CI runs in that window.
`grep "env) != nullptr"` against every one of those `--log-failed` logs returned
**zero matches**. This exact abort has not appeared in any other run I could inspect
in the last several days — it looks newly triggered rather than a long-running known
flake in this repo, most plausibly because the GitHub-hosted `ubuntu-latest` runner
image only recently rolled to a Node 24.19+/24.20 patch that carries the regression
(the backport landed in Node 24.19, per the GitHub issues found below; it is an image
rollout, not a repo change).

## 2. What changed on this branch — ruled out as cause

- `persistence-sqlite` **does** import from `@ptah-extension/vscode-core` (confirmed:
  `libs/backend/persistence-sqlite/src/lib/{sqlite-connection.service.ts,
migration-runner.ts, slow-statement-timing.ts, vec-status.service.ts,
integrity/*.ts, backup.service.ts, di/register.ts}` all import `TOKENS`/`Logger`/
  `roundMs` from vscode-core). That import relationship is why Nx's `affected`
  algorithm pulled `persistence-sqlite` into this run at all — it is legitimately
  affected by the branch's vscode-core changes, not a false positive.
- However, none of those persistence-sqlite files or specs import or call
  `armDiagnostics` or `MainLoopWatchdog` directly — only type-level `Logger`/`TOKENS`
  imports. `MainLoopWatchdog` (`libs/backend/vscode-core/src/diagnostics/
main-loop-watchdog.ts`) is registered as a DI singleton in
  `register-platform-agnostic.ts:103` but is inert until a host explicitly calls
  `armDiagnostics({ container, logsPath })`. No persistence-sqlite spec does that, so
  the new worker_threads watchdog is not started inside these Jest processes.
- CI's own test invocation (`ci.yml:172`, `node node_modules/nx/bin/nx.js affected -t
test --coverage --parallel=3 --maxWorkers=2`) runs each Nx project's `test` target
  as its **own OS process** (`@nx/jest:jest` executor per project,
  `persistence-sqlite/project.json`); `--parallel=3` bounds how many _projects_ run
  concurrently, `--maxWorkers=2` bounds Jest's internal worker pool _within_ each
  project's process. So `persistence-sqlite`'s Jest workers never share a process or
  worker pool with `vscode-core`'s specs — only OS-level resource contention (CPU/
  memory) is shared, which is unrelated to the abort's mechanism (see §3).
- Conclusion: the branch's `MainLoopWatchdog`/worker-thread work is not the trigger.

## 3. Mechanism

From the attempt-1 logs of both failing runs:

- CLI E2E (`34860866883` attempt 1, job "CLI E2E (ubuntu-latest)", step "Run CLI e2e
  harness"): the abort happens **after all e2e specs already passed**
  (`skill-synthesis.e2e.spec.ts` finished, then immediately: `node[3334]:
RemoveEnvironmentCleanupHook ... Assertion failed: (env) != nullptr`, with
  `Statement::~Statement()` in `better_sqlite3.node` on the native stack). This is at
  **process exit**, not inside Jest worker teardown — a `Statement` object is being
  garbage-collected by V8 after the Node Environment has already begun destruction,
  and the object's destructor tries to `RemoveEnvironmentCleanupHook` against a
  now-null `env`.
- CI run (`34860866947` attempt 1, job `main`, step "Run affected tests with
  coverage"): the same assertion fires repeatedly right after Jest's own
  `A worker process has failed to exit gracefully and has been force exited` warning,
  taking out ~9 persistence-sqlite suites at once (`migration-runner.spec.ts`,
  `sqlite-connection.service.spec.ts`, and several `migrations/00xx_*.spec.ts`) with
  "Test suite failed to run" — because when one native process aborts mid-flight
  inside a shared Jest worker, every suite queued to run in that worker reports the
  same generic failure.

Root cause (confirmed via web research): this is Node 24.19+'s backport of cleanup
hooks into `node::ObjectWrap` (header-only `node_object_wrap.h`) **without**
backporting the matching global addon cleanup-hook registry that makes hook removal
safe without a live `Environment`. When V8 finalizes a wrapped native object (here, a
`better-sqlite3` `Statement`) with no entered context — e.g., during/after process or
worker teardown — `Environment::GetCurrent()` is null and the `CHECK((env) !=
nullptr)` in `node::RemoveEnvironmentCleanupHook` (`src/api/hooks.cc:142`) aborts the
process. Tracked upstream as `nodejs/node#65446`. Multiple other projects hit the
identical signature on Node 24 with `better-sqlite3` <13, e.g. "doctor: SIGABRT at
teardown on Node 24 — better-sqlite3 Database::~Database asserts (env) != nullptr" and
"Bug: Console crashes with SIGABRT (RemoveEnvironmentCleanupHook assertion) on Node.js
24 — better-sqlite3 Statement finalizer race". The fix landed in `better-sqlite3`
`^13.0.3`, which requires Node `>=22` (this repo already runs Node 24, so no floor
conflict).

## 4. Recommended fix

**Smallest robust fix: bump `better-sqlite3` from `^12.9.0` to `^13.0.3`+ in
`package.json` (repo root — `sqlite-vec` and any native rebuild steps should be
re-verified after the bump), then re-run `npm install` so `package-lock.json`
regenerates and the native module gets rebuilt for the pinned Node ABI (CI already
has an "Install Linux platform binaries" / "Rebuild native modules for runner Node
ABI" step in `ci.yml`).** This removes the abort at its source instead of papering
over it with `--runInBand`, `--detectOpenHandles`, or `workerIdleMemoryLimit` tuning
— none of those change whether a `Statement` finalizer runs after `Environment`
teardown; they only change how often the timing window is hit.

Secondary, lower-priority hardening (not required, but worth a follow-up): several
persistence-sqlite specs do call `.close()`/`afterEach` cleanup already (confirmed in
`migration-runner.spec.ts` and `sqlite-connection.service.spec.ts`), which is good
practice regardless of the Node/better-sqlite3 bug, but it does not fully prevent this
class of abort because the crash is a GC-timing race with process/worker teardown, not
a leaked-handle problem Jest's `--detectOpenHandles` would catch.

**Does it belong in this PR?** No. This is an environment/dependency-version bug
independent of anything this branch changed (§2 rules out `MainLoopWatchdog` and any
other branch commit as the trigger), and it will recur on `main` and every other PR
the moment their CI run lands on the same Node 24.20 runner image, regardless of
which files changed. It should be a separate, small dependency-bump PR/task so it is
easy to revert independently and its own CI run is the proof, rather than being buried
in TASK_2026_437's diff.

## Re-run outcome (34860866947, attempt 2)

Still `in_progress` as of this report. Per instructions, no further action was taken
(no additional re-run requested); the user should check
`gh run view 34860866947` for the final result once it completes.

## Sources

- [doctor: SIGABRT at teardown on Node 24 — better-sqlite3 Database::~Database asserts (env) != nullptr, exit 134 · Issue #471 · Drakon-Systems-Ltd/ShieldCortex](https://github.com/Drakon-Systems-Ltd/ShieldCortex/issues/471)
- [stop hook aborts at teardown: better_sqlite3 Statement finalized after Environment is gone (env != nullptr CHECK) · Issue #70 · JuliusBrussee/cavemem](https://github.com/JuliusBrussee/cavemem/issues/70)
- [Bug: Console crashes with SIGABRT (RemoveEnvironmentCleanupHook assertion) on Node.js 24 — better-sqlite3 Statement finalizer race · Issue #377 · UNITRONIX/BetterDesk](https://github.com/UNITRONIX/BetterDesk/issues/377)
- [ci: Node 22/24 test workflow; better-sqlite3 13 to stop the Node 24.19 ObjectWrap abort · PR #9 · Freshair129/Genesis-Knowledge-System](https://github.com/Freshair129/Genesis-Knowledge-System/pull/9)
- nodejs/node#65446 (tracked upstream issue referenced by the above)
