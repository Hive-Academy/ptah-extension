# Context — TASK_2026_427_f669

## How this was found

On 2026-09-12 a `backend-developer` subagent implementing Batch 5 of
TASK_2026_402_a5c7 appeared to go stale for about twenty minutes. It had not.

The measurement that settled it: `jest` PID 21320 sampled twice, twelve seconds
apart, reported `CPU 275.09375` both times. Zero CPU delta, 1.2 GB resident, 13
threads, **no child processes**. Alive, blocked, computing nothing.

Its own output showed the run had already finished:

```
Test Suites: 1 failed, 1 skipped, 65 passed, 66 of 67 total
Tests:       4 failed, 3 skipped, 981 passed, 988 total
Ran all test suites.
Jest did not exit one second after the test run has completed.
```

The process was terminated by hand to unblock the agent. Nothing else recovered
it, and nothing reported it.

**The watchdog was ruled out, not assumed innocent.** Today's Electron log
(`%APPDATA%\Ptah\logs\Ptah Electron-2026-09-12.log`) was searched for
`NoActivityWatchdog`, `no activity`, `forceIdle`, `Aborting session` and
`SessionNotActive`. Zero matches. `NoActivityWatchdog` governs Ptah SDK sessions
and had no part in this.

---

## Defect 1 — `copy-wasm` resolves `node_modules` against the worktree root

**This is the root cause and the cheapest fix. Do it first.**

`scripts/copy-wasm.js:22` computes its own root:

```js
const workspaceRoot = path.resolve(__dirname, '..');
```

In a worktree that resolves to the worktree, and a worktree created under the
main checkout has **no `node_modules` of its own** — Node's own resolution walks
UP to the parent checkout, but this script does not. Reproduced directly:

```
$ cd .claude-worktrees/agent-messaging && node scripts/copy-wasm.js dist/apps/ptah-cli
WASM file not found: D:\projects\ptah-extension\.claude-worktrees\agent-messaging\node_modules\web-tree-sitter\web-tree-sitter.wasm
```

`apps/ptah-cli/project.json` chains `test` → `build-esbuild`,
`build-embedder-worker`, `build-integrity-worker`, and `copy-wasm` →
`build-esbuild`. One failure takes the chain down:

```
NX  Running target test for project ptah-cli and 31 tasks it depends on failed
```

So **`nx test ptah-cli` cannot run in any worktree.** This is not specific to one
task. It affects every agent this repository runs in a worktree, which is the
normal operating mode here.

### Acceptance criteria

1. `npx nx test ptah-cli` completes in a worktree that has no `node_modules`.
2. The resolution walks up to the checkout that actually holds the package,
   rather than assuming a sibling layout. `require.resolve` answers this question
   correctly and a hand-built path does not.
3. A genuinely missing package still fails loudly. The fix must not turn a real
   absence into a silent skip.

---

## Defect 2 — the `ptah-cli` suite leaks handles, and `--runInBand` makes that fatal

With Defect 1 blocking the proper path, the agent fell back to running the jest
config directly. That path hangs.

Jest's own message names the class:

> This usually means that there are asynchronous operations that weren't stopped
> in your tests. Consider running Jest with `--detectOpenHandles`.

and elsewhere:

> Active timers can also cause this, ensure that `.unref()` was called on them.

**Why `--runInBand` is the difference.** In worker mode Jest force-exits the
leaking worker, and the run survives with a warning — observed in this same
session: _"A worker process has failed to exit gracefully and has been force
exited."_ In band mode there is no worker to kill, so the main process waits
forever. Same leak, two outcomes: a warning nobody reads, or a silent permanent
hang.

### Acceptance criteria

1. The leaking handle is NAMED, from a `--detectOpenHandles` run, not guessed.
2. It is released in teardown, and a test proves the process exits.
3. `jest --config apps/ptah-cli/jest.config.cjs --runInBand` exits on its own.
4. Whatever the cause, a hang is made diagnosable: a run that cannot exit must
   say what is holding it open rather than sitting at zero CPU in silence.

---

## Defect 3 — `withEngine` swallows three DI failures and keeps running

Printed on every `ptah-cli` test run, immediately before the hang:

```
[ptah] withEngine: Thoth activation failed (non-fatal): unexpected token: Symbol(Logger)
[ptah] withEngine: file-settings migration failed (non-fatal): unexpected token: Symbol(MigrationRunner)
[ptah] withEngine: failed to resolve SdkPermissionHandler for auto-approve: permissionHandler.setPermissionLevel is not a function
```

Three separate DI resolutions fail and the engine proceeds anyway. The first two
are `unexpected token: Symbol(...)`, which is tsyringe reporting an unregistered
token. The third resolves an object that is not the service it claims to be.

Two distinct problems live here, and they must not be conflated:

- **The registrations are wrong or missing** in whatever container the CLI test
  path builds.
- **`non-fatal` is a claim nobody checked.** Thoth activation and the migration
  runner both start work. An engine that failed to register them, then ran
  anyway, is the most likely owner of the handle in Defect 2 — `thoth-runtime`
  boots a cron loop and `cron-scheduler` is a SQLite-backed timer loop.

**That last sentence is a hypothesis, not a finding.** It is written down so the
investigation starts somewhere, and it must be proven or discarded against a
`--detectOpenHandles` run before any code changes.

### Acceptance criteria

1. Each of the three failures is either fixed at its registration, or shown to be
   genuinely harmless with the evidence recorded beside the `non-fatal` label.
2. `non-fatal` stops being a bare assertion. Where a failure really is tolerable,
   the log says what is lost by tolerating it.
3. Whether Defect 3 causes Defect 2 is answered, either way.

---

## Not a defect: the four failing `esm-bundle-gate` specs

For the next reader, so nobody re-investigates them.

The four failures in `apps/ptah-cli/src/test-utils/esm-bundle-gate.spec.ts` all
read `requires a build -- run nx run ptah-cli:build-embedder-worker`. They are
the build gate working correctly. They fire only because the raw-jest fallback
skips the `dependsOn` builds. Fix Defect 1 and they go away on their own.

---

## Why this is worth a task rather than a note

Three defects compose into one failure mode with no symptom. A worktree agent
cannot use the sanctioned command, falls back to one that hangs, and produces
nothing — no error, no timeout, no log line. The only way to see it is to sample
the process CPU by hand and find it flat.

Every agent this repository runs in a worktree is exposed to it.
