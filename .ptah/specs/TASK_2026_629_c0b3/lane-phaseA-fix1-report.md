# Phase A fix round 1 report

## Summary

All six requested logic fixes are done. The B1 summary sampler and excluded files were untouched.

## Fixes

| Fix | Status | Source | Regression test |
| --- | --- | --- | --- |
| 1. Explicit deny tab fallback | Done | `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:422,455` | `permission-handler.service.spec.ts:204` — “buckets an unscoped deny under the explicit deciding tab instead of the active tab” |
| 2. Elapsed clock while streaming | Done | `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:286` | `compact-session-card.component.spec.ts:381` — “keeps the elapsed interval while streaming without a lane, then clears it”; existing lane and destroy timer test also passes |
| 3. Strict CLI permission ownership and one session agent lookup | Done | `compact-session-card.component.ts:136,158` | `compact-session-card.component.spec.ts:280` — “does not offer a CLI permission whose owner is unresolved” |
| 4. Honest subagent timing and mapped terminal status | Done | `compact-lane-rows.ts:54` | `compact-lane-rows.spec.ts:48` — “does not present last activity as a subagent start time” |
| 5. Double-answer guard, stale session no-op, deny reason | Done | `agent-permission-responder.ts:18,26`; `compact-session-card.component.ts:301,314` | `agent-permission-responder.spec.ts:63` — “posts and clears a lane request only once across repeated answers”; `compact-session-card.component.spec.ts:298` — “ignores a session permission that was resolved before its click”; existing responder-ID test now asserts “User denied” |
| 6. Exported session actions and lane-key parser | Done | `session-context.token.ts:47`; `compact-lane-rows.ts:21,31`; `libs/frontend/chat/src/index.ts:30` | `compact-lane-rows.spec.ts:39` — “round trips lane keys and rejects unknown or empty IDs” |

## Check results

- PASS — `npx nx test @ptah-extension/chat-streaming --testFile=permission-handler.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 58 passed, 1 skipped.
- PASS — `npx nx test @ptah-extension/chat --testFile=compact-session-card.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 29 passed.
- PASS — `npx nx test @ptah-extension/chat --testFile=compact-lane-rows.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 5 passed after updating the expected order for unavailable subagent start time. Its first run failed on that stale expectation.
- PASS — `npx nx test @ptah-extension/chat --testFile=agent-permission-responder.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 4 passed.
- PASS — `npx nx typecheck @ptah-extension/chat-streaming --parallel=1 --skip-nx-cache`.
- PASS — `npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`: one existing NG8107 warning outside changed files.
- PASS — `npx nx lint @ptah-extension/chat-streaming --parallel=1 --skip-nx-cache`: 0 errors, 2 warnings outside changed files.
- PASS — `npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`: 0 errors, 35 warnings.
- PASS — `npx prettier --write` on all changed source and spec files.

## Decisions

- `SubagentRecord` has `lastEventAt` but no start field (`agent-monitor.store.ts:526-605`). `startedAt` is null; terminal `endedAt` still uses `lastEventAt` for done, error and stopped states. Reversible if the store later supplies a start timestamp.
- The stale session permission click is a no-op. No Logger is used in the compact session component area, so no new logging dependency was added. Reversible.
- The responder retains answered request IDs for its service lifetime and removes an ID if posting or clearing throws, allowing a retry after failure. Session responses remain unchanged. Reversible.
- `agentsForSession` remains the tolerant source for lane summaries; actionable CLI permissions use strict `agentsOwnedBySession`. The excluded store and the separate lane visibility finding were not changed. Reversible.
- `ptah_get_diagnostics` was not listed as an available tool. Scoped Nx typechecks supplied compiler verification.
