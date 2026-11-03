# CI fixes report

## Failures and fixes

1. **agent-sdk — accepted cost decrease test** (`libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.spec.ts:226-241`). The fixture marked both results `reported`, so the owner's existing reported-dollar monotonicity guard correctly rejected the lower SDK total. The review finding concerns an **unreported** run repriced after a rate change. The fixture now supplies two unreported cumulative results with growing input tokens and lower pricing, and asserts acceptance, an unknown turn cost, and an absolute run cost snapshot. The existing reported-dollar and token-regression rejection tests remain intact.
2. **cli-engine — shutdown resolve failure** (`libs/backend/cli-engine/src/lib/bootstrap/shutdown-host-runtime.spec.ts:262-282`). The usage sink drain added a fifth resolution attempt, while the test still expected four. The test now asserts the exact order of all five tokens, including `SESSION_USAGE_SINK`, and checks its resolution error is reported while the later workspace watcher is still attempted.
3. **ptah-electron — updater alias smoke test** (`apps/ptah-electron/src/di/expected-resolvable.ts:42-43`). Adding the usage sink at index zero changed the token the phase-4 updater test checks. The existing host routing token is again first; the sink remains in the resolvability census immediately after it.

## Decisions

- Kept reported SDK dollar decreases rejected and accepted only unreported rate changes with nondecreasing token counters. This follows the review's rate-change finding and existing owner tests at `session-stats-owner.service.spec.ts:1419-1459`. Reversible by changing the policy and tests together if the product contract changes.

## Verification

- Ran exactly once: `npm run verify -- -t test -p @ptah-extension/agent-sdk,@ptah-extension/cli-engine,ptah-electron -- --testPathPatterns="session-stats-owner|shutdown-host-runtime|container.smoke"`. Nx exited with code 1 before Jest ran: its default Nx and Jest/ESLint plugins failed to load with `spawn EPERM`. Per instruction, no retry was made.
- Scoped `ptah_get_diagnostics` was unavailable: the TypeScript check was still running after 45 seconds, leaving the three edited TypeScript files unchecked.
- The reported `platform-core` race-test timeout at `agent-pack-download.service.spec.ts:816` is unrelated and was left untouched.
