# PR 686 CI and SonarCloud fixes

## Fix 1 — DI lint

- Root cause: `SdkQueryRunner` decorates `MODEL_DISPATCH_PROVENANCE_TAP` as an
  optional injection, but `di-lint` deliberately requires every decorated token
  to be registered. Record mode installs a collector only after host boot, so
  ordinary product containers had no registration.
- Changed `libs/backend/agent-sdk/src/lib/di/register.ts`: registers one inert
  provenance tap. The mcp-bench record-mode registration still replaces it.
- Verified:
  - `npx nx lint di-lint --parallel=1` — pass; 1,814 injection sites resolve
    against 787 registered tokens.
  - `npx jest -c libs/backend/agent-sdk/jest.config.ts ...sdk-query-runner.service.spec.ts ...register.compaction-boundary-registry.smoke.spec.ts --coverage=false --maxWorkers=2` — pass; 2 suites, 56 tests.

## Fix 2 — focused mcp-bench CI regressions

- `sample-sessions`: Linux treats `C:\\Temp` as a relative POSIX string and
  `copyFile` gives the copy a new mtime. The former failed the temporary-home
  check; the latter made every copied session appear to have changed after the
  freeze. `sample-sessions.ts` now applies `path.win32` containment for
  drive-qualified paths on every host and classifies the re-read copy with the
  source file's freeze-relevant mtime.
- `liveness`: the merged curator behaviour reports throw/timeout as `failed`,
  preserves unprocessed observations, and stops the boot-scan watermark at the
  failing input. The benchmark spec still asserted the old `ran`/advance
  behaviour and frozen deltas. `liveness.suite.spec.ts` now matches the current
  outcomes (three passing fault observations, one failing zero-draft case).
- `funnel-lifecycle`: the simulated scheduler includes the end-of-window
  daily-tier drain, so the exact tick total is 195 rather than 194. The focused
  assertion now documents and expects that boundary tick.
- Changed: `sample-sessions.ts`, `liveness.suite.spec.ts`, and
  `funnel-lifecycle.spec.ts`.
- Verified:
  - `sample-sessions.spec.ts` — pass; 1 suite, 12 tests.
  - focused combined run of sample-sessions, liveness, and funnel-lifecycle —
    2 suites passed; the liveness stale assertions failed (1 failed, 28 passed
    of 29) before their follow-up update.
  - `liveness.suite.spec.ts` after the update — pass; 1 suite, 10 tests.

## Fix 3 — SonarCloud reliability and security findings

- Root cause: the reported default string sorts are locale-dependent; each now
  uses the repository's `compareCodeUnits` comparator, preserving JavaScript's
  former code-unit order. This covers all 22 S2871 findings in
  `memory-skills/**`.
- Root cause: three `execFile`/`execFileSync` calls delegated lookup of `git` to
  `PATH`. `run-memory-skills.entry.ts`, `scope-write.suite.ts`, and
  `select-rubric-sample.ts` now use `getGitExecutable()`, the existing validated
  absolute resolver. Argument arrays, timeouts, and command behaviour are
  unchanged.
- Changed the 19 files named by Sonar under `tools/mcp-bench/src/memory-skills`;
  no 619-owned `scorecard`, `transport`, `corpus`, `question-sets.ts`, or
  `bench-data.ts` path was modified.
- Verification pending: the adjacent-spec batch (12 focused spec files,
  `--maxWorkers=2`) remained active after the command bridge's 30-second output
  capture ended, with no completion handle. It must be allowed to finish or be
  rerun once by the orchestrator before accepting this check. The required
  `npx nx typecheck mcp-bench --parallel=1` was attempted but yielded no result
  through that bridge; `npx nx lint mcp-bench --parallel=1` was not started to
  avoid overlapping the active Jest check.

## Fix 4 — Electron e2e analysis only

No Electron e2e was run. This failure is not plausibly caused by the task 620
pause-switch/runtime changes: they do not modify gateway message routing. The
assertion conflicts with the current `ThothStatusService` contract, whose
documentation states that a tab switch calls `refresh()`; reopening `gateway`
therefore refetches the mocked baseline (`0`) and can overwrite the earlier
push (`2`). The service itself still handles `gateway:statusChanged` eagerly.
Treat this as a stale/timing-sensitive e2e expectation outside the clear 620
scope; no product or e2e change was made.

## Outstanding verification

- `npx nx typecheck mcp-bench --parallel=1` and `npx nx lint mcp-bench --parallel=1`
  still need clean, sequential completion after the active focused Jest process
  ends. No workspace-wide, e2e, build, benchmark, or package target was run.
