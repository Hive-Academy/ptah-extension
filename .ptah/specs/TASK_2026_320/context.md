# Context — TASK_2026_320

## Where this came from

Hit repeatedly during TASK_2026_315, which ran six implementation batches with
concurrent verification. Recorded as F3 in
`.ptah/specs/TASK_2026_315/follow-ups.md`.

## The symptom

Launching `npx nx test rpc-handlers` concurrently with another Jest project
produces a batch of `Test suite failed to run` entries. Re-running sequentially
passes all 87 suites (2,433 tests). `rpc-allowlist.spec` passes in isolation.

The decisive detail: the output carries

```
A worker process has failed to exit gracefully and has been force exited.
This is likely caused by tests leaking due to improper teardown.
Try running with --detectOpenHandles to find leaks.
Active timers can also cause this, ensure that .unref() was called on them.
```

**and that warning appears on the passing runs too.** So the leak is always
there; parallel load only turns it from a warning into a failure.

## Why it is worth a task rather than a shrug

It makes concurrent verification untrustworthy. During TASK_2026_315 this cost
real time — every suspicious failure had to be re-run sequentially to tell a
genuine regression from contention noise, and a reviewer had to be told
explicitly to do so before reporting anything as real. A workflow that runs
batches in parallel cannot rely on a green tick that might be a scheduling
artefact.

It also cuts the other way, which is worse: a _real_ failure appearing during a
parallel run is easy to dismiss as "just the known flake".

## Where to start

`npx nx test rpc-handlers --detectOpenHandles` — that is what the warning itself
suggests and nobody has run it. Likely candidates in this repo:

- Timers not `.unref()`'d in a service constructed by a test double.
- SQLite handles: `persistence-sqlite` opens real connections, and
  `rpc-handlers` specs construct handlers that reach it.
- `chokidar` / file watchers started by a handler under test and never disposed.

## A second, related instance

During TASK_2026_315's final sweep, `npm run typecheck:all` failed on
`web-pricing` and `web-account` under concurrent load and passed cleanly in
isolation. Same class — resource contention producing a false negative — though
not necessarily the same root cause. Worth a look while in the area; not the
main target.

## A separate tooling trap, worth fixing or documenting here

Independently confirmed by two agents during TASK_2026_315:

```
npx nx test projA projB projC
```

silently runs **only the first project** and exits 0 — the trailing names are
parsed as Jest args, producing "No tests found, exiting with code 0" for the
rest. The working form is:

```
npx nx run-many -t test -p projA projB projC
```

This is arguably more dangerous than the flake, because it produces a confident
green tick for work that was never tested. Several batches in TASK_2026_315
used the broken form; their work was re-verified afterwards with `run-many` and
was in fact clean, but that was luck rather than process.

Consider whether this repo should carry a guard — a lint rule, a wrapper
script, or at minimum a line in the root `CLAUDE.md` under Development
Commands.

## Not in scope

Rewriting the affected specs to avoid the resource. Find the leak and close it
at its source.

## Outcome (2026-08-25, branch `fix/electron-update-check-timeout`)

### The leak: one timer, five handles

`npx nx test @ptah-extension/rpc-handlers --detectOpenHandles` named it on the
first run. All five open handles are the SAME `setTimeout` —
`wizard-generation-rpc.handlers.ts:539`, the 10-minute `GENERATION_TIMEOUT_MS`
watchdog in `runGenerationInBackground`. Not SQLite, not chokidar.

The `.finally()` at `:639` does clear it, so the timer is only leaked when that
`finally` never runs — and `registerSubmitSelection` returns `{ success: true }`
WITHOUT awaiting the generation. Four specs in
`wizard-generation-rpc.handlers.spec.ts` therefore leak one each by design:
their orchestrator never resolves, which is the point of the
`returns success immediately (fire-and-forget orchestration)` case. The suite
ends with a 10-minute armed timer, and an armed timer keeps Node's event loop
alive.

This is a PRODUCTION property, not a test artifact. A watchdog for work nobody
is awaiting must never be the reason a process stays up.

### The fix

`timer.unref()`, guarded by `typeof … === 'function'` — the shape already used
by `SessionRegistryService`, `CuratorProxyManager`, `CopilotAuthService` and
`CliPlatformCommands`, because `unref` is on Node's `Timeout` and not on the
DOM's numeric handle. The `clearTimeout` in `finally` is unchanged; `unref` only
removes the handle's claim on the loop.

Pinned by a new spec, `leaves no timer holding the event loop open when the
generation never settles`. It asserts `hasRef()` on every timer the RPC creates
rather than spying on `unref`, so the property stated is the one that matters —
does this handle hold the loop up — and any future timer added to this path is
caught by the same assertion. Verified red before the fix.

### Verification

- `--detectOpenHandles`: the `Jest has detected the following 5 open handles`
  block is gone. 88 suites, 2467 passed / 31 skipped.
- Concurrent load, the original repro:
  `nx run-many -t test -p rpc-handlers agent-sdk harness-sync --parallel=3`
  passes, and `rpc-handlers` no longer emits the worker warning.
- `lint`, `typecheck`, `test` green. The 20 remaining lint warnings in this
  project are pre-existing (including two in this file: an unused
  `CliDetectionService` import at `:44` and the empty arrow at `:652`).

### The `nx test projA projB` trap — documented, and worse than recorded

Now a block in the root `CLAUDE.md` under Development Commands. Measured here
rather than taken on trust, and the measurement was worse than the note above
said. `npx nx test @ptah-extension/thoth-shell @ptah-extension/markdown` does
not "run only the first project" — the trailing name becomes a Jest test-path
FILTER, so the first project ran with a filter matching nothing and printed
`No tests found, exiting with code 0` followed by `Successfully ran target
test`. ZERO tests ran, exit 0.

The block also records the adjacent trap hit in this session: a misspelled
project name is silently DROPPED from a `run-many` set. `-p a b c` with one bad
name ran two projects and exited 0, so the `Running target test for N projects`
header has to be read.

## Follow-up: `harness-sync` leaks a worker, but only under concurrent load

Found while verifying the fix above, and NOT the same defect. In isolation
`@ptah-extension/harness-sync` is clean (38 suites, 302 tests, no warning). In
the 3-project `--parallel=3` run it emits `A worker process has failed to exit
gracefully` on every attempt — reproduced twice, attributed to harness-sync by
position in the interleaved output.

Not chased here, because the obvious candidate is already correct: the preflight
budget timer at `preflight/harness-preflight.service.ts:212` calls `unref()`
right below itself. The two remaining `setTimeout` uses in the lib are both
awaited sleeps — `fs/windows-retry.ts:54` (the EBUSY/EPERM backoff) and
`lock/file-lock.ts:99` — which fits a load-only symptom, since retries fire under
contention and not in a quiet run. That is a hypothesis, not a finding: nothing
has been measured against it, and `unref`-ing a backoff sleep is a real change to
retry semantics rather than a drive-by. It needs its own task and its own
`--detectOpenHandles` run taken UNDER load.
