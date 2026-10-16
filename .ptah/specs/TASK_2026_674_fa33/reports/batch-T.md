# Batch T — transcript resync follow-ups

## 674 — nested and multiple Task owners
- Root cause: `session-history-replayer.service.ts:336-351` selected only the first seeded agent and treated its immediate parent message as a materialized row. Parented starts do not create rows (`history-message-builder.service.ts:167`).
- Change: `session-history-replayer.service.ts:337-418` resolves each seed through tool/message ancestry to a materialized root, then builds the live state from the union of those roots and their tool closures. It warns only when no owner can be resolved.
- Specs: `resync renders a nested Task seed once beneath its materialized root` (:341); `resync keeps two seeded Task owners live and renders each tail once` (:381). The real tree builder is used in both.
- Jest: focused chat spec, 7 passed / 0 failed, including A-2.

## 675 — finalization order
- Root cause: `message-finalization.service.ts:69-80` appended finalized owners when the filtered live state held no user anchor, despite later frozen rows.
- Change: `message-finalization.service.ts:80-88` inserts each finalized message ahead of the first frozen row with a later timestamp.
- Spec: `finalizes a non-last Task owner before later frozen rows` (:417), checking `[user-1, O, user-2, assistant-2]` and O exactly once.
- Jest: focused chat spec, 7 passed / 0 failed, including A-2.

## 676 — stale TodoWrite marker
- Root cause: `session-history-replayer.service.ts:374-388` copied `latestTodoWrite` from full history while filtering its events to the Task owner's closure. `summarizeTodos` therefore saw a marker with no matching tool start (`compact-session-metrics.ts:110-126`).
- Change: `session-history-replayer.service.ts:389-402` recomputes the latest top-level TodoWrite marker from filtered events, clearing it when no such event remains.
- Spec: `keeps earlier finalized TodoWrite visible while a later Task owner streams` (:456), exercising `summarizeTodos` during streaming.
- Jest: focused chat spec, 7 passed / 0 failed.

## Decisions
- Resolved all seed owners via tool/message ancestry rather than the immediate parent only. Options: ancestry walk or retain parented history rows. Evidence: history builder deliberately skips parented starts; the existing tree builder expects one materialized root. Reversible: yes.
- Used finalized message timestamps for placement when the state has no user anchor. Options: store frozen index in streaming state or use existing timestamps. Evidence: finalized messages and history rows already carry root start timestamps (`message-finalization.service.ts:98-115`). Reversible: yes.
- Recomputed the TodoWrite marker from filtered events rather than retaining a stale marker. Options: clear unconditionally or recompute. Evidence: `StreamingState.latestTodoWrite` tracks the latest top-level TodoWrite (`chat-types.ts:303-328`). Reversible: yes.

## Open
- Scoped `ptah_get_diagnostics` did not return compiler diagnostics within its 45-second limit on two attempts. The focused Jest run passed; no Nx target was run.

## Fix round 1

- **B1:** `session-history-replayer.service.spec.ts:880-890` spies on the injected `LoggingService.warn` and checks the unresolved seed's parent tool ID. The owner-missing spec passes.
- **M1:** `session-history-replayer.service.ts:379-386` retains intervening frozen user roots in the live event set, keeping the tree builder from merging separate owners. `session-loader.resync-live-seed.spec.ts:381-419` asserts root order and finalized transcript order `[first, between-users, second]`.
- **M2:** `message-finalization.service.ts:80-82` restores plain append for ordinary no-anchor turns. `message-finalization.service.spec.ts:341-351` checks append even with a later frozen timestamp. This supersedes the timestamp placement decision recorded above.
- **M3:** `chat-types.ts:66` adds an optional readonly owner-to-frozen-predecessor map. The replayer records it at `session-history-replayer.service.ts:387-392`; finalization copies it at `message-finalization.service.ts:353-354` and applies it in both anchor branches at `:99-115`. `message-finalization.service.spec.ts:352-385` checks both branches. This supersedes the earlier timestamp-based placement decision.
- **M4:** `session-history-replayer.service.ts:351-370` logs each unresolved seed with `parentToolUseId`, including when another seed resolves.
- **Minor:** `message-finalization.service.ts:50-54` updates the placement comment. `session-history-replayer.service.ts:414-431` picks the last TodoWrite on timestamp ties and omits empty input; `:423-443` selects the latest owner by history order; `:377-378,445` uses a set for owner row filtering.
- **Jest:** chat replayer + resync specs: 2 suites, 67 passed, 0 failed. Chat-streaming message-finalization specs: 4 suites, 53 passed, 0 failed. No Nx target was run.

### Open after fix round 1

- The eight pre-existing `console.warn`/`console.error` calls in `session-history-replayer.service.ts:569,717,802,830,840,900,942,967` remain. Their existing specs spy on console output; migrating those paths and assertions was outside this focused review repair.
