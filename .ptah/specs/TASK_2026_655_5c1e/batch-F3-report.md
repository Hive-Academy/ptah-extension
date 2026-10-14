# Batch F3 — webview caller wiring

## Files changed

- `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts`: routes filtered deferred events to each eligible tab once; carries snapshot seed events and block counts into resync; validates snapshot metadata.
- `libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts`: covers seed forwarding, malformed metadata, and excluded-tab delivery.
- `libs/frontend/chat/src/lib/services/chat.store.ts`: passes seed and per-tab delivery options through to the loader and streaming handler.
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`: adds early claims, resync generations and reservations, metadata validation, filter inputs, overflow recovery, and compaction status recovery.
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`: covers resync ordering, supersession, metadata validation, overflow, and real-pipeline R-A1/R-A2 regressions.
- `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts`: marks the three delayed compaction reload paths.
- `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.spec.ts`: expects the delayed marker at those call sites.

## Rule → code → test

| Rule | Code | Test |
| --- | --- | --- |
| Component 5: snapshot seed and filtered deferred tab fan-out | `chat-message-handler.service.ts:518-557` | `chat-message-handler.service.spec.ts:772` “delivers a filtered live event to sibling tabs once”; `:1052` “passes the resync seed and applies only the events kept by the fence” |
| B.2.3(c): validate `liveSeedBlocks` and keep the rest of a malformed snapshot | `chat-message-handler.service.ts:576-609` | `chat-message-handler.service.spec.ts:1074`, `:1086`, `:1098` |
| Component 6: store seed and delivery passthrough | `chat.store.ts:228-240`, `:440-454` | handler seed and filtered delivery tests above; loader seed ordering test below |
| Component 7: latest resync wins; waiting resync holds a reservation; early claim; fence overflow requests another resync | `session-loader.service.ts:837-903`, `:915-921`, `:1117-1145` | `session-loader.service.spec.ts:2495` “claims a resync before session:load”; `:2522` “lets a newer resync finish first”; `:2552` “keeps only the newest waiting resync”; `:2586` “requests one fresh resync after a compaction fence overflows” |
| B.2.3(d): arrival prefix mark and filter retirement; owner and synthetic-result validation; opt-in ownership request; filter inputs before replay | `session-loader.service.ts:133-174`, `:840-841`, `:977-993`, `:1065-1079` | `session-loader.service.spec.ts:2495`, `:2612` “discards malformed ownership and synthetic indexes”, `:2639` “maps verified history ownership to the exact replay event objects” |
| RA-1: compaction claim before first await, then reuse that claim | `session-loader.service.ts:895-899`, `:915-946` | `session-loader.service.spec.ts:3689` “R-A1 keeps a live message started during compaction session:load through the reset” |
| RA-3: request fresh resync after a current compaction claim overflowed and reset was reached | `session-loader.service.ts:1117-1145` | `session-loader.service.spec.ts:2586` “requests one fresh resync after a compaction fence overflows” |
| RA-4: status reconciliation after a current compaction stale reply or reset | `session-loader.service.ts:1023-1035`, `:1146-1150` | `session-loader.service.spec.ts:2586` checks the probe after overflow; pre-existing loader stale compaction cases remain applicable |
| RA-5: mark only delayed calls; one resync after delayed reset; preserve compaction context seed | `compaction-lifecycle.service.ts:562`, `:703`, `:727`; `session-loader.service.ts:842-843`, `:1048-1054`, `:1135-1145` | `compaction-lifecycle.service.spec.ts:1062`, `:1480`, `:1509`, `:1544`, `:1577`; `session-loader.service.spec.ts:3725` “R-A2 requests one resync after a delayed compaction and restores the gap once” |
| Component 7 status fallback for seedless resync | `session-loader.service.ts:1146-1150` | covered indirectly by loader resync cases; a dedicated status assertion remains open |

## Decisions

- A resync seed callback applies exactly the event list supplied by the replayer. This lets its persisted-content filter remove duplicates without losing a surviving suffix.
- Missing or malformed ownership metadata passes `null` into the replayer. Missing or malformed synthetic-result metadata also passes `null`, preserving the no-loss fallback.
- A resync with only `liveSeedBlocks` still creates an empty seed object, so the prefix mark is valid for that host projection.
- Resync replies can overtake older resync loads. Generation and claim guards keep stale replies from writing into the tab.
- A resync waiting behind compaction holds a reservation until it owns a claim. The loader checks overflow before releasing either holder.

## Open

- Jest, Nx, typecheck, lint, build, and e2e were not run, per the task's explicit machine rule. AST parsing of the three edited spec files found no parse errors. Scoped diagnostics attempts were inconclusive: the tool returned a large set of existing project diagnostics and later timed out; compilation is unverified.
- The complete plan matrix includes more variants than the focused F3 cases here, especially a dedicated seedless status probe assertion and separate stale-branch/overflow/supersession permutations. The orchestrator should review coverage after running the listed specs.
- The F2 report lists remaining replayer-level regression coverage (R-B2c, R-B3b, R-B3d, R-B6, R-B7 and full R-B1s variants); F2 files were outside this batch's edit scope.

## Jest files for orchestrator

Run these three spec files with at most two Jest workers:

1. `libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts`
2. `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`
3. `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.spec.ts`
