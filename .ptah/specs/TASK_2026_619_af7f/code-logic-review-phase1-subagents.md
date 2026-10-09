## Verdict

Score: 4/10 — REVISE. The implementation has strong fail-closed paths, but a guard failure can be discarded during lifecycle cleanup and a post-launch failure can orphan an isolated host. This is below 5 because the real-state safety result can become a normal scorecard failure; it is above 3 because the primary launcher and gate paths do deliberately classify failures and have targeted coverage.

## Defects

1. **Critical** — `tools/mcp-bench/src/lifecycle/lifecycle-scenarios.ts:405-408`: A lifecycle operation fails first (for example, `writeFile` throws after the host has opened the real database), then `session.stop()` detects `RealStateChangedError` or `BenchHeldRealStateError`. The cleanup uses `.catch(() => undefined)`, discards that guard failure, and rethrows only the original ordinary operation error. `main.ts:489-497` consequently records a non-voiding scenario failure and writes a scorecard/exit 2 instead of voiding the run. That can report benchmark evidence despite a run that touched the user's real Ptah state. Preserve and prioritize the `session.stop()`/guard error (or combine it with the operation error); do not suppress a guard exception.

2. **Serious** — `tools/mcp-bench/src/bench-hosts.ts:287-289`: A host can have launched successfully, then its second `client.listTools()` call can time out or receive a malformed response. `startHostOnce` throws without calling `stopHost`, and `startHost` only converts `HostLaunchError` to a retryable launch failure (`:181-195`), so the raw transport error escapes. The launched CLI/Electron process, HTTP client, temporary home, and real-state guard remain active; later runs can collide with it and process-watch coverage is lost. Wrap post-launch initialization in a cleanup path that closes the client and awaits `stopHost()` before rethrowing; preserve any guard failure over the discovery error.

## Verified correct

- The hash guard snapshots the database, WAL, and SHM before and after the host, and changes throw rather than becoming a pass: `tools/mcp-bench/src/transport/real-state-guard.ts:128-184,347-354`.
- Process-watch treats a probe sampling failure as a failed run rather than a partial/pass result: `tools/mcp-bench/src/transport/real-state-guard.ts:359-366,421-425`.
- The command gate rejects a non-zero benchmark exit before reading a scorecard: `tools/mcp-bench/src/gate/gate-command.ts:58-60`; CI captures the bench exit without masking it and passes it to that gate: `.github/workflows/mcp-bench.yml:114-122,139-140`.
- Recorded-baseline comparison treats an absent baseline row as out-of-date and an absent recorded row as failing (`new`/`missing`), rather than silently passing: `tools/mcp-bench/src/gate/baseline.ts:161-162,330-338`.

## Five logic questions

1. Silent success: confirmed in defect 1; a guard violation can be converted into an ordinary lifecycle failure and a scorecard is still written.
2. Unexpected user action: a transient HTTP failure immediately after a host reports ready produces the orphan described in defect 2.
3. Wrong input answer: inspected malformed JSON-RPC response handling in `tools/mcp-bench/src/transport/mcp-client.ts:227-270`; it produces a transport error, not a result.
4. Dependency failure/timeout: gate exit-code handling is fail-closed as verified above, but post-launch `tools/list` failure leaks the host (defect 2).
5. Missing requirement: lifecycle cleanup needs an explicit rule that safety/guard failures outrank the original scenario error; the current requirements say guard errors void a run, but the cleanup implementation does not uphold it.

## Not reviewed

- `metrics/`, `scorecard/`, `corpus/`, `ground-truth/`, and `baselines/`, per assigned scope.
- I did not execute benchmarks, Electron, `withPinnedCorpus`, Jest, or any host launcher because a benchmark is active on this machine.
- I examined the scoped transport, lifecycle/main orchestration, gate/workflow paths and available targeted diagnostics; remaining suite-adapter question correctness and platform-specific Electron runtime behavior require a non-overlapping benchmark run.

## Re-review (round 1)

Updated verdict: APPROVED. Scoped TypeScript diagnostics are clean. The two prior defects are fixed and the changed cleanup/retry paths preserve the required safety precedence; no new behavioral defect was found in the re-reviewed code.

1. **FIXED — previously Critical lifecycle cleanup swallowed a guard error.** `tools/mcp-bench/src/transport/guarded-stop.ts:30-45` recognizes all three guard failures and rethrows the guard error with the original operation failure as its cause. `tools/mcp-bench/src/lifecycle/lifecycle-scenarios.ts:409-412` delegates its cleanup catch to that rule. The main runner uses the same predicate before deciding whether to record a scenario error (`tools/mcp-bench/src/main.ts:486-493`), so the rethrown guard error now voids the run. The targeted specification asserts the guard error wins and retains the scenario error as cause: `tools/mcp-bench/src/lifecycle/lifecycle-scenarios.spec.ts:283-306`.

2. **FIXED — previously Serious post-launch `tools/list` failure orphaned a host.** `tools/mcp-bench/src/bench-hosts.ts:300-325` stops the successfully launched host before converting discovery failure to `HostDiscoveryError`; it records the stop exit/guard report and lets a guard failure take precedence. `tools/mcp-bench/src/bench-hosts.ts:193-209` retries that specific stopped discovery failure only once; because the cleanup is awaited before the error is thrown, the retry cannot overlap the first host. The host's `stop()` remains memoized (`tools/mcp-bench/src/bench-hosts.ts:338-350`), preventing a later caller from performing a second physical stop. Both normal-retry and guard-error/no-retry cases are specified at `tools/mcp-bench/src/bench-hosts.spec.ts:141-191`.

No new defect found. In particular, `runThenStop` now covers successful and failing main/polyglot host bodies (`tools/mcp-bench/src/transport/guarded-stop.ts:48-59`, `tools/mcp-bench/src/main.ts:444-497,516-520`); a guard failure from stop propagates rather than being classified as a suite result. I did not execute benchmarks, Electron, `withPinnedCorpus`, Jest, build, lint, or typecheck because the active-machine benchmark prohibition remains in force; the available scoped diagnostics reported zero errors and warnings.
