# TASK_2026_619 — S6 decisions

Delegated by the user to a codex lane (agent 28147698, 2026-10-08). Orchestrator adjustment: Decision 2 gates on the deciding baseline `error_rate` > `MAX_ERROR_RATE` (the tool-side threshold) instead of > 0.

13f should make the three-reason coverage rule precise, so the current mid-census response is not counted as a tool failure.
The benchmark must expose native-baseline failures and refuse to score a comparison whose deciding baseline failed.
Make ripgrep discovery independent of the launching shell, rather than relying on PowerShell or a manually set path.
Keep the proposed first PR focused on the benchmark and index freshness, then split later fixes by the stated groups.
Remove the obsolete, untracked Batch 13b backup patch after its retained history is confirmed.

## Decision 1

**Decision:** Adopt the refined cap rule. An explicit `?` reason remains unknown except `unrecognised?`; for exactly three complete reasons, treat it as unknown only when the last reason has a `COVERAGE_REASONS` priority before `resolution?`. Do not infer hidden reasons from arrays shorter than three.

**Reason:** Product output is priority ordered (`COVERAGE_REASONS`, language-coverage.interface.ts:215) and `withCoverageVerdict` returns only `slice(0, MAX_REPORTED_REASONS)` (language-coverage.interface.ts:354); the cap is three (:340). Thus `['updating','unrecognised?','unchecked']` cannot hide a later unknown and is known coverage, while `['updating','stale','truncated']` can hide `unchecked?` and stays unknown. `['census?','updating','stale']` is unknown explicitly; shorter arrays cannot be capped. Malformed/cut arrays stay conservatively unknown (call-recorder.ts:158).

**Risk:** Depends on the product keeping priority ordering and the cap of three; a change there must update the bench rule and tests.

**Scope:** `tools/mcp-bench/src/transport/call-recorder.ts` + spec. Cases: capped prior-to-resolution can hide unknown; capped resolution-or-later cannot; three reasons with explicit census unknown; short arrays imply no hidden unknown; unrecognised plus later observed reasons is known; cut reasons body remains unknown.

## Decision 2

**Decision:** Include native error text in JSON failure entries, render each baseline's `error_rate` in Markdown, and fail (not `na`) a suite when its deciding baseline error rate is over `MAX_ERROR_RATE`. On Windows, automatic resolution chooses a real `.exe` candidate; one `rg --version` preflight fails the run clearly if rg cannot spawn.

**Reason:** `NativeResult.error` is captured (native-baselines.ts:55) but `listFailures` skips native records (suite-runner.ts:485); the verdict reads native quality without checking its error rate (suite-runner.ts:574). `resolveRg` accepts the first `where` line (rg-runner.ts:145) and spawns it without a shell (rg-runner.ts:51).

**Risk:** A transient baseline failure fails the suite rather than producing a partial comparison (intended). Preflight must keep `RG_PATH` support.

**Scope:** rg-runner.ts + spec, main.ts, suites/suite-runner.ts + specs, scorecard types/writers/retrieval renderer + specs.

## Decision 3

**Decision:** Use the shell-independent code fix from Decision 2. `RG_PATH` stays the escape hatch for unusual installs.

**Reason:** The defect is executable discovery versus `spawn`, not benchmark semantics (rg-runner.ts:29). A code fix works from Bash, PowerShell, CI and agents.

**Risk:** Installs with no `.exe` on PATH fail early with a clear message.

## Decision 4

**Decision:** Approve the PR sequence with Decision 2 in PR 1: PR 1 = Phase 1 bench + Phase 2A index freshness through committed 13f, one smoke with a healthy native baseline, and the CI gate; then PRs for 18–26, 27–28, 29–33, 34, 36–37. TASK_2026_620 follows after PR 1 merges.

**Reason:** Benchmark-before-fixes strategy (context.md:21); Batch 36 depends on 35 and 37 on 36 (batches.md).

## Decision 5

**Decision:** Delete the untracked `b13b-pre-simplify.patch`; `ce290b460` holds the replacement design. Do not commit or move it.
