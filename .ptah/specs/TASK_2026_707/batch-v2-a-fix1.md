# Batch A fix 1: shared plan limits deadline

## Budget design

`provider:getPlanLimits` has a 30,000 ms client timeout. Snapshot assembly starts one 24,000 ms server deadline, leaving 6,000 ms for transport and scheduling. Discovery gets that absolute deadline: detection has at most 12,000 ms; each subsequent source gets the lesser of its normal 3,000/12,000 ms allowance and the remaining shared time. Parallel owner reads use the same remaining time, capped by their normal 3,000/12,000 ms allowance. A read that times out returns the owner's existing `service-unavailable` snapshot with ledger evidence. Completed owners remain in the partial result. The single-provider account usage lookup keeps its existing behavior.

## Changes

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts:169,196,209-255,603-613`: accept the absolute deadline and cap detection and every source read by remaining time. Source timeouts still drop only that source; selected-provider and Ptah CLI results survive a hung detector.
- `libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.ts:84,147-150,163-166,182-209`: start the 24-second deadline before discovery, pass it to owner reads, abort a late read, and race the read against the timer so a reader that ignores abort cannot hold the snapshot.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.spec.ts:344,361`: cover a never-resolving detector and a slow detector followed by a hung Codex lane, including timer cleanup.
- `libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.spec.ts:132`: cover 11 seconds of discovery followed by a hung Codex owner read; the snapshot settles at 24 seconds with the completed owner and a timeout status for Codex. Existing mock expectations now include the deadline argument.

## Verification

- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.spec.ts --coverage=false --maxWorkers=1 --silent` — passed, 35 tests.
- `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.spec.ts --coverage=false --maxWorkers=1 --silent` — passed, 11 tests.
- `ptah_get_diagnostics` was requested for the changed source files after edits; its TypeScript compiler check remained unavailable after the 45-second service timeout. Jest compiled and ran both changed specs successfully.

## Decisions

- Keep the existing 30-second client timeout and use a 24-second backend ceiling. This is an additive internal deadline, leaves a six-second margin, and avoids changing the frontend RPC contract. Reversible by changing the two local budget constants.
- Keep the existing source-specific deadlines and owner fallback status. The shared deadline only shortens work when the whole call is running out of time; owner identity and evidence behavior remain unchanged. Reversible.

## Not done

- No frontend timeout change, DI registration change, or live cold-start run. The focused suites verify the bounded behavior with fake timers; the TypeScript diagnostic service did not complete.
