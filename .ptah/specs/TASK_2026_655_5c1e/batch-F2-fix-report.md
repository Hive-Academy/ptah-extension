# Batch F2 replayer fix report

## Failing tests

- **Yield lookup count** (`session-history-replayer.service.spec.ts:303`): F2 added an unconditional tab-binding lookup at fence close, after the existing three post-yield checks. A claim with neither seed nor filter inputs has no close-time work requiring that lookup. `session-history-replayer.service.ts:669-672` now reads the tab only when a seed or filter input needs the binding guard. The original expectation of three lookups is unchanged.
- **Terminal after close** (`session-history-replayer.service.spec.ts:834`): `PersistedContentFilter.decide` keeps a terminal and retires, leaving an empty exclusion set. The after-close route treated that empty set as unhandled and never invoked `deliver`. `session-history-replayer.service.ts:611-620,783-803` now records whether a bound filter was consulted; it delivers a kept event with no exclusions and returns `true`. A dropped or held event still delivers with the tab excluded. A stale binding remains unhandled and is discarded.

## Added replayer regressions

| Case | Spec line | Replayer path exercised |
| --- | ---: | --- |
| R-B2c | 887 | Reservation, superseding claim, arrival mark, seed, replay, held delivery |
| R-B3b | 907 | After-close prefix hold, changed complete block, release order, later pass |
| R-B3d | 929 | Early tool and text mismatch after close |
| R-B6 | 950, 973, 988 | Three-record complete batch; persisted prefix plus new block; changed first block |
| R-B7 | 1002, 1035 | Synthetic and persisted result index cases, real result delivery, `patchHistoryToolResult` via `setMessages`, duplicate result |
| R-B1s | 1056, 1088, 1099, 1118 | Seeded in-flight block, older-host seed, changed persisted block, pre-snapshot complete copy |
| R-B1s Revision 3 (a)-(e) | 1155 | Empty truncated seed with `liveSeedBlocks`, pre-snapshot buffering, `prefixMark`, replay, after-close events, terminal |

All added cases call the replayer's public claim, replay, defer, reservation or release methods. The R-B7 tests install finalized tab messages in the tab-manager double and observe the actual `setMessages` boundary.

## Checks

- No Jest, Nx, typecheck, lint, build or e2e command was run, as instructed by the orchestrator.
- `ptah_ast_analyze` parsed both edited TypeScript files with zero error nodes.
- Scoped `ptah_get_diagnostics` was attempted after edits, but the TypeScript service returned `Unavailable: TypeScript check still running after 45s` each time. It did not establish a typecheck result.

## Decisions

- Kept the existing yield-count assertion: no extra close-time lookup is required when the claim carries neither seed nor persisted-filter inputs.
- A consulted filter makes the after-close event handled even when it keeps the event. This covers terminal delivery and other kept live events without changing the no-filter return contract.
- Used the existing streaming-handler and tab-manager doubles to verify delivery, history reconciliation and event order inside the allowed replayer spec file.

## Open

- Runtime results for the new regressions remain unverified until the orchestrator runs the scoped Jest suite; scoped diagnostics did not complete. The pre-existing fixture-cast diagnostics reported in the earlier F2 report were not changed.
- R-B7's `AgentMonitorStore.onTaskToolResult` fan-out belongs to the chat message handler, which is outside this lane's allowed files. The replayer-level test verifies its kept delivery callback and finalized-tree patch, while the caller-level fan-out still needs the F3 check.
