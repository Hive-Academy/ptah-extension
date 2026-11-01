# B5a fix round 2

| Fix                                                                                                                        | File:line                                                                                                                                                        | Covering spec names                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Persist onboarding only with a validated generation or guidance tab binding; preserve the previous route for unbound pages | `libs/frontend/core/src/lib/routing/surface-route-persistence.ts:75`; `libs/frontend/core/src/lib/routing/surface-route-persistence.spec.ts:104,174,187,208,241` | `keeps the last route when a generation tab no longer belongs to the workspace`; `keeps the last route when navigating to onboarding Home`; `keeps the last route when navigating to onboarding ready`; `persists a generation URL bound to a valid tab`; `keeps the last route for an invalid generation binding` |
| Cover in-flight pending-intent cancellation with a live source tab on a harness onboarding step                            | `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.spec.ts:196`                                                                    | `cancels a new request while a live pending source tab is on its onboarding flow`                                                                                                                                                                                                                                  |

## Decisions

- `onboardingGenerationBinding` checks the route and `tab` value; `GENERATION_ROUTE_TAB_VALIDATOR` must also accept the live tab before an onboarding URL is saved. Other onboarding URLs leave the prior saved route unchanged.
- The in-flight cancel spec confirms `cancelled`, retains the pending intent, and observes no extra navigation or start. The service behavior was correct, so `harness-workflow-request.service.ts` was not changed in this round.
- The B5a changes were already uncommitted in this worktree. This round edited only the two core files, the harness request spec, and this report; it did not alter the pre-existing service change.

## Not fixed (with reason)

- Harness proposal URLs under `/onboarding/(new-project|team-builder)/(workspace|review)?tab=...` remain unpersisted. The existing core routing code has no harness proposal identity binding validator, and this fix round is limited to four source/spec files.
- An additional agent review was not run because this task explicitly forbids spawning agents. I reviewed the scoped diff and the two required verify results.

## Verification

1. `npm run verify -- -t test -p @ptah-extension/core,@ptah-extension/harness-builder` — exit 0. Nx summary: `NX   2 tasks: 2 succeeded`.
2. `npm run verify -- -t lint,typecheck -p @ptah-extension/core,@ptah-extension/harness-builder` — exit 0. Nx summary: `NX   4 tasks: 4 succeeded`.
