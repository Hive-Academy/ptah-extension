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
