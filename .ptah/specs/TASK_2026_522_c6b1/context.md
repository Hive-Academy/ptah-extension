# Context

## How it was found

This was found on 2026-09-21 while verifying `TASK_2026_491_e0da`, not by looking
for it. The full Electron e2e suite was run on the task branch and returned two
failures. One of them was this spec. To decide whether the change had caused
them, the same specs were run against `main` with no change applied.

| Run | Commit | Result |
| --- | --- | --- |
| Full suite on the 491 branch | `2ff900ad4` | 179 passed, 12 skipped, 2 failed |
| The two failing specs on `main` | `c02e02adf` | 14 passed, **1 failed — this one** |
| Continuous integration, `electron-e2e` job on PR #558 | `addbeb893` | **pass** |

The spec fails on `main` with no change applied, and passes on continuous
integration. That combination is the signature of a test that depends on the
machine rather than on the code.

## The failure

`apps/ptah-electron-e2e/src/specs/rpc-new-features.spec.ts:162`, the assertion at
`:175`:

```
  expect((data.servers as unknown[]).length).toBe(0);

  Expected: 0
  Received: 1
```

The test is named "returns an empty servers array on a fresh launch". "Fresh"
describes the launched application, not the profile it reads. The Electron app
under test resolves its profile from the real user directory, so an MCP server
that the developer connected through OAuth at any time in the past is still
connected when the spec runs. Continuous integration passes because that machine
has never connected one.

## Why it matters

1. **It costs an hour of the wrong investigation.** It presents as a failure of
   whatever change is being verified. Clearing it took a second full run against
   a baseline to prove the change was innocent.
2. **It hides real regressions.** A spec that is already red on a developer
   machine is discounted, so a genuine failure in the same file is discounted
   with it.
3. **It is not only this assertion.** Any other spec that reads the profile has
   the same exposure. The audit below is part of the work.

## Scope

1. Give the spec a profile directory of its own, so its result depends on the
   code under test. The launch harness in `apps/ptah-electron-e2e/src/support/`
   is the place to look first. `app.setPath('userData', …)` is already used by
   the Electron security fixture at
   `apps/ptah-electron/src/windows/fixtures/shell-security.cjs:14`, which is a
   working precedent for a per-run profile in this repository.
2. Audit every other spec under `apps/ptah-electron-e2e/src/specs/` for the same
   dependency: anything that asserts a count, an absence or an "empty" state
   that the real profile could populate. Record the list even where no change is
   needed.
3. Decide deliberately whether the isolated profile applies to the whole e2e
   suite or only to the specs that need it. A suite-wide change is cleaner, but
   any spec that deliberately depends on real state must be named.

## Out of scope

The MCP OAuth connection feature itself. Nothing here suggests the code under
test is wrong. The application reported one connected server because one is
genuinely connected on that machine.

## Acceptance criteria

1. The named spec passes on a machine that has an OAuth-connected MCP server in
   its real profile.
2. It still fails if the code under test genuinely reports a connected server on
   a clean profile. Prove this by seeding the isolated profile, not by trusting
   the assertion.
3. The audit from scope item 2 is recorded in this folder.
4. The full Electron e2e suite passes locally on a developer machine with a
   populated profile, apart from failures that have their own recorded cause.
