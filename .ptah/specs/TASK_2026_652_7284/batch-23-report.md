# Batch 23 report

## Files changed

- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts`: lines 158-160 update the concurrency comment; 181 adds the private reservation; 240-251 guard and take it; 291-292 log the content-free freshness cause; 356-365 guard the prepared checkpoint and defer last-run state; 373-411 observe launch rejection, report it, finalize the checkpoint, and absorb secondary handler rejection; 430-431 release the reservation in `finally`; 802 makes retry respect it.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts`: lines 398 and 494 expose the harness supervisor; 880, 917, 937, and 963 add regression cases.

## Required fix

1. Submit takes `submitReserved` synchronously before any await and releases it through the outer `finally`, including early return and throw paths. The existing in-progress response applies to active or reserved runs.
2. Retry uses the same reservation guard and its existing in-progress response.
3. After preparation and before launch, a still-active supervisor causes the prepared checkpoint to finalize as `failed` and returns the existing in-progress error. Last-run options and checkpoint are assigned only after this guard.
4. Launch has a rejection handler that logs a fixed message, captures the exception with `WizardGenerationRpcHandlers.registerSubmitSelection`, and finalizes that run's checkpoint as `failed`. A terminal catch absorbs secondary reporting failure. The existing `onSettled` wiring and launched-run success response remain.
5. Freshness lookup catches the error and logs only its name or type as `cause`.

## New specs

- Line 880, `reserves the submit slot while freshness is pending`: two overlapping submits produce one success, one in-progress refusal, one checkpoint write, and one orchestrator call.
- Line 917, `releases the submit slot after a missing resume checkpoint`: a later submit succeeds after an early return.
- Line 937, `finalizes the checkpoint and reports a rejected launch`: supervisor rejection results in a failed lifecycle, logger call, and Sentry capture; the focused Jest run reports no unhandled rejection.
- Line 963, `refuses retry while a submit is preparing`: retry gets the existing in-progress response.

## Verification output tails

`npx prettier --write libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts` — PASS (exit 0):

```text
wizard-generation-rpc.handlers.ts 216ms (unchanged)
wizard-generation-rpc.handlers.spec.ts 253ms (unchanged)
```

`npx nx run-many -t typecheck,lint -p @ptah-extension/rpc-handlers --parallel=1` — PASS (exit 0):

```text
√ nx run @ptah-extension/rpc-handlers:typecheck
√ nx run @ptah-extension/rpc-handlers:lint
NX Successfully ran targets typecheck, lint for project @ptah-extension/rpc-handlers
NX Nx Cloud encountered some problems
This Nx Cloud organization has been disabled due to exceeding the FREE plan. (code: 401)
```

`npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts --coverage=false --maxWorkers=2` — PASS (exit 0):

```text
Warning: Failed to load the ES module: .../jest.config.ts
Test Suites: 1 passed, 1 total
Tests:       65 passed, 65 total
Snapshots:   0 total
Time:        15.254 s
Ran all test suites matching wizard-generation-rpc.handlers.spec.ts.
```

Scoped `ptah_get_diagnostics` after the final edit was unavailable because its TypeScript check exceeded 45 seconds; the project typecheck above passed.

## Follow-up: degradation-audit marker

- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:408`: replaced the secondary `.catch` comment with a leading `degradation-audit: reported` marker and its explanation.

`npx prettier --write libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts` — PASS (exit 0):

```text
libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts 383ms (unchanged)
```

`npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1 2>&1 | Select-String -Pattern 'rpc-handlers|TOTAL|FAIL'` — PASS (audit exit 0):

```text
libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1316 [catch-return-sentinel] catch swallows error and returns a literal
degradation-audit: per-directory totals
libs/backend/rpc-handlers: 1 ok (baseline 1)
degradation-audit: TOTAL 293 unsuppressed site(s)
audit_exit=0
```

`npx nx run-many -t typecheck,lint -p @ptah-extension/rpc-handlers --parallel=1 2>&1 | Select-Object -Last 8` — PASS (exit 0); output tail:

```text
Your organization can be re-enabled immediately by an organization admin upgrading to the Team plan at
https://cloud.nx.app/orgs/68b4af751a4191272698bd6c/plans. (code: 401)
Run duration:      50.3s
Cache:             0/2 hit (0%)
Critical path:     34.8s (1 task)
Recoverable time:  15.4s (31% of the run)
Recommendation: Increase parallelism to recover up to 15.4s
nx_exit=0
```

Scoped `ptah_get_diagnostics` after this edit: 0 errors, 0 warnings.
