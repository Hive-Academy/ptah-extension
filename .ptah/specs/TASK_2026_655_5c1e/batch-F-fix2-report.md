# Batch F bounded correction round

| Defect | Root cause | Fix (file:line) | Test (file:line + name) |
| --- | --- | --- | --- |
| 1. Seeded subagent tail invisible | The Task owner was frozen in history while its child continued in a streaming tree without a visible root. The old rebuild copied only the seed into the frozen message. | `session-history-replayer.service.ts:336-393` restores the Task owner's history state as the sole live root before fence release, removes that owner from frozen messages, and leaves seed/buffer/later deltas on that root. Missing owner warns and leaves the seed live. | `session-loader.resync-live-seed.spec.ts:278` — “A-2 keeps the Task owner live through a seeded subagent continuation”; `session-history-replayer.service.spec.ts:878` — “warns and leaves a seeded subagent live when its history owner is missing”. |
| 2. Overflow release onto old tab | The early overflow return bypassed the catch branch that reset the tab before claim release. | `session-loader.service.ts:926-931,1128-1129,1177-1185` calls one reset helper from both early overflow and failed-load paths before `release`. | `session-loader.service.spec.ts:2575` — “resets an overflowed resync before seed and buffered live release”. |
| 3. Retired rule T lost | Terminal delivery removed the persisted filter, so later results for historical tool ids could not reconcile. | `session-history-replayer.service.ts:173-175,902-918` retains the filter and consults a terminal filter only for known history tool results. Existing stale, closed, rebound, and replacement cleanup remains. | `session-history-replayer.service.spec.ts:850` — “keeps retired rule T for changed and repeated history tool results”. |

## Turn-end finalization evidence

`message-finalization.service.ts:125-139` reads the live state and builds its tree. Lines 176-251 compare root ids with existing frozen message ids, skip roots already present, and append new roots through `placeFinalizedTrees`. Removing owner O from frozen messages lets O be appended once at turn end; unrelated frozen messages remain in `existingMessages`. A-2 asserts O is absent from frozen messages while streaming, that the Task subtree contains the seed and later delta once each, and that finalization produces O once.

## Checks

`npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.spec.ts libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts libs/frontend/chat/src/lib/services/chat-store/session-loader.resync-live-seed.spec.ts --coverage=false --maxWorkers=2 2>&1 | Select-Object -Last 40` — 3 suites passed; 170 tests passed, 2 skipped. Jest printed a worker exit warning on some runs.

`ptah_get_diagnostics` scoped to the five changed files — 257 existing project errors, none reported in the changed implementation lines after fixes. No Nx, build, or workspace-wide check was run.

## Decisions

- The owner state contains O and history descendants reachable through its tool ids; other history roots stay frozen. The persisted content filter still receives O's seed events.
- Filter exceptions continue to fail open. A terminal retired filter stays registered for rule T and skips other event types in the replayer.
- The overflow regression forces the observed overflow condition while a live event remains buffered, then checks reset → seed → live order and removal of old visible content. Existing overflow-bound specs exercise the actual event limit.

## Open

- No outstanding work within the three requested defects. The scoped TypeScript diagnostic result includes pre-existing errors outside these edits; the full project gate remains with the orchestrator.
