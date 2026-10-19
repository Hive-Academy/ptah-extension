# B02G revision 1 report

1. **Lock timeout recovery.** Each acquired lock now owns an internal AbortController and identity token. At five minutes the service aborts the run and calls the bound timeout hook; after a 30-second grace period it force releases only that owner. Both external and internal aborts reach the SDK stream and the run's active checks. The run's `finally` releases by owner identity, so a stale tabless or bound run cannot release a newer owner. Active checks prevent timeout success and trace or state writes after abort. Evidence: `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:229,249-253,315-376,508-532,658-726,761-763`; bound supervisor timeout classification and unknown commit state: `libs/backend/rpc-handlers/src/lib/handlers/guidance-generation-run.supervisor.ts:75-98`; lifecycle broadcast: `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts:747,779-807`. Regression specs: service spec lines 1671, 1738, 1808, 1848; supervisor spec line 83; handler spec line 470.
2. **Settled result lookup.** Exact `runId` lookup for the same tab now returns its settled run before a different active run or service busy state can block it. Other lookup paths retain their prior ordering. Evidence: `libs/backend/rpc-handlers/src/lib/handlers/guidance-generation-run.supervisor.ts:122-150`. Regression spec: `guidance-generation-run.supervisor.spec.ts:105`.
3. **Shared contract assertions.** Typed assertions now cover optional `committedState` on result facts and run state, and optional cancellation `outcome`; runtime fixtures show old shapes and new values compile. Evidence: `libs/shared/src/lib/types/rpc/rpc-setup-generation.contract.spec.ts:55-70,89-101,116-134`.

## Checks

- Focused agent-generation Jest: **pass**, 1 suite, 64 tests.
- Focused rpc-handlers Jest: **pass**, 2 suites, 38 tests.
- Focused shared Jest: **pass**, 1 suite, 2 tests.
- Nx typecheck and lint for shared, rpc-handlers, agent-generation: **pass**, 6 targets. Final agent-generation typecheck and lint after the last service edit: **pass**, 2 targets. Nx Cloud emitted a 401 plan warning after local targets passed.
- Scoped `ptah_get_diagnostics` after final service edit: **clean**, 0 errors, 0 warnings. Prettier `--write` ran on all seven edited files.

## Final line counts

| File | Lines |
| --- | ---: |
| `enhanced-prompts.service.ts` | 1471 |
| `enhanced-prompts.service.spec.ts` | 2071 |
| `guidance-generation-run.supervisor.ts` | 183 |
| `guidance-generation-run.supervisor.spec.ts` | 116 |
| `enhanced-prompts-rpc.handlers.ts` | 1124 |
| `enhanced-prompts-rpc.handlers.spec.ts` | 1053 |
| `rpc-setup-generation.contract.spec.ts` | 242 |

## Decisions

- **Decision:** Use a per-acquisition object as both owner token and bound reservation. **Options:** separate owner and reservation tokens, or share one. **Evidence:** the existing bound reservation identity guard and a single service lock (`enhanced-prompts.service.ts:249-253,375-384`). **Reversible:** Yes.
- **Decision:** Record timeout in the supervisor and abort its controller through a bound callback. **Options:** infer timeout from an aborted signal, or record its cause explicitly. **Evidence:** user cancellation and timeout both abort signals, while `SetupGenerationRunLifecycle` includes `timed-out` (`rpc-setup.types.ts:31-42`). **Reversible:** Yes.
- **Decision:** Retain a 30-second grace period before force release. **Options:** immediate release or delayed last resort. **Evidence:** the requested single-owner recovery and existing `finally` ownership path (`enhanced-prompts.service.ts:315-376,761-763`). **Reversible:** Yes.

## Proposed Removals

None.
