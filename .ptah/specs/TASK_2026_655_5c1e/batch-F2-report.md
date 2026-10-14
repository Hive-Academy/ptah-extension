# Batch F2 report

Implemented the three webview services and added focused specs. **Runtime verification is incomplete:** automatic command review rejected each required locked check before the command started (`blocked by policy`). Targeted compiler diagnostics reported no errors in the three changed service files; the new replayer spec had only two pre-existing fixture cast errors at lines 138 and 415.

## Public API for F3

| API | Meaning |
| --- | --- |
| `SessionHistoryReplayer.claim(tabId: string, sessionId: SessionId, liveSeed?: ReplayLiveSeed \| (() => void)): ReplayClaim` | Claims the tab and fences its session; legacy zero-argument callbacks remain accepted. For filtering, pass `ReplayLiveSeed = { events: readonly FlatStreamEventUnion[]; apply: (events: readonly FlatStreamEventUnion[]) => void; liveSeedBlocks?: Readonly<Record<string, number>> }`. The callback receives the kept seed events once after history finalization. |
| `reserveFence(sessionId: SessionId): FenceReservation` | Holds a session fence without superseding a tab claim. |
| `releaseReservation(reservation: FenceReservation): void` | Idempotently releases that hold. |
| `overflowedDuring(holder: ReplayClaim \| FenceReservation): boolean` | Reports whether the holder witnessed the 2000-entry bound; read it before release. |
| `liveArrivalMark(): number` | Captures the next buffered-event arrival number for a snapshot boundary. |
| `setPersistedFilterInputs(claim: ReplayClaim, inputs: PersistedFilterInputs): void` | Attaches `{ ownerByEvent, syntheticResults?, prefixMark }` to the current claim before replay. `ownerByEvent` uses the exact event objects passed to `replay`. |
| `retirePersistedFilter(tabId: string): void` | Releases or discards this tab's filter before a new resync. |
| `deferLiveEvent(event, tabId, sessionId, deliver: (excludeTabIds?: ReadonlySet<string>) => void): boolean` | A delivery callback must honor excluded tab IDs; existing zero-argument callbacks remain valid. |
| `SessionLivenessReconcilerService.reconcileTab(tabId: string, sessionId: string): Promise<void>` | Runs the existing revision-safe unordered status probe for one tab. |
| `StreamViewportController.requestStreamResync(tabId: string): Promise<void>` | Sends an immediate v2 viewport request with `resyncTabIds`, swallowing and warning on failure. |

## Rule evidence

Paths below are relative to `libs/frontend/chat/src/lib/services/`. Test names are in the matching `.spec.ts` files. `Not covered` means a requested regression still needs a runnable spec; the required suite was blocked before execution.

| Rule | Code | Test name / status |
| --- | --- | --- |
| Component 8 claim seed, guard, once-only close, release cleanup | `chat-store/session-history-replayer.service.ts:186,225,665` | `runs a claim seed after finalization and before buffered events exactly once`; older claim and rebound cases use existing replay specs, but new seed-specific variants are not covered. |
| Component 8 reservation, idempotent release, joined overflow | `chat-store/session-history-replayer.service.ts:237-255,642-647` | `keeps a reservation across another claim and records overflow for joined holders` |
| Component 8 fence bound and early ordered delivery | `chat-store/session-history-replayer.service.ts:583-608` | Existing `warns at the bound, delivers the buffer at once and lets later events through` |
| RA-2 handover after each delivery; receiving bound | `chat-store/session-history-replayer.service.ts:741-760` | `hands remaining buffered entries to a claim opened during delivery`; receiving-bound overflow variant not covered. |
| B.2.3(b) arrival mark and whole-entry handover | `chat-store/session-history-replayer.service.ts:97-101,259,606,741-760` | `preserves arrival across claims and filters only pre-snapshot seed copies` |
| B.2.3(b) claim inputs and replay history index H/tool result/tool IDs | `chat-store/session-history-replayer.service.ts:264,296-359` | `filters a persisted block after close and retires at the terminal`; tool result index variant not covered. |
| B.2.3(b) current/bound guard, filter registration, seed through filter | `chat-store/session-history-replayer.service.ts:665-725` | `filters seed content against the replayed owned history block`; no-filter/overflow/rebound variants not covered. |
| B.2.3(b) finalized tool result reconciliation | `chat-store/session-history-replayer.service.ts:723-738` | R-B7 wiring test not covered. F1 tests cover the pure patch and filter. |
| B.2.3(b) filter consultation in buffer, overflow and after close | `chat-store/session-history-replayer.service.ts:583-619,763-799` | `filters a persisted block after close and retires at the terminal`; `preserves arrival across claims and filters only pre-snapshot seed copies` |
| B.2.3(b) retirement on terminal, claim, resync; stale tab discard | `chat-store/session-history-replayer.service.ts:193-200,269-275,781-798` | Terminal variant in `filters a persisted block after close and retires at the terminal`; explicit claim/resync/stale-tab variants not covered. |
| Component 9 one-tab revision-safe probe | `chat-store/session-liveness-reconciler.service.ts:51-57` | `reconcileTab probes only the requested tab through the unordered turn-state path` |
| Component 10 immediate v2 resync request and failure handling | `stream-viewport-controller.service.ts:57-75` | `requests one immediate resync with the current viewport only after v2 acceptance`; `warns and resolves when an immediate resync RPC rejects` |
| R-B1 / R-B2 / R-B1s replayer variants | `chat-store/session-history-replayer.service.ts:335-359,665-725,781-799` | R-B1: `filters a persisted block after close and retires at the terminal`; R-B2: `preserves arrival across claims and filters only pre-snapshot seed copies`; R-B1s partial: `filters seed content against the replayed owned history block`. Complete batch variants not covered. |
| R-B2c / R-B3b / R-B3d / R-B6 / R-B7 | `chat-store/session-history-replayer.service.ts:237-255,335-359,665-799` | Not covered at replayer level. F1 pure-filter specs cover their decision logic. |

## Checks

| Required command | Result / observed tail |
| --- | --- |
| `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.spec.ts libs/frontend/chat/src/lib/services/chat-store/session-liveness-reconciler.service.spec.ts libs/frontend/chat/src/lib/services/stream-viewport-controller.service.spec.ts libs/frontend/chat/src/lib/services/chat-store/persisted-content-filter.spec.ts --coverage=false --maxWorkers=2` | **NOT RUN**. Locked PowerShell command was rejected before launch: `CreateProcess ... rejected: blocked by policy`. |
| `npx nx typecheck @ptah-extension/chat --parallel=1` | **NOT RUN**. Same automatic rejection. |
| `npx nx lint @ptah-extension/chat --parallel=1` | **NOT RUN**. Same automatic rejection. |
| `ptah_get_diagnostics` scoped to the three service files | **PASS for requested files**: `No diagnostics in the requested files`; unrelated sibling errors remain. |
| `ptah_get_diagnostics` scoped to replayer spec | **Existing errors**: TS2352 fixture casts at lines 138 and 415; neither line was edited. |

## Decisions

- Used `ReplayLiveSeed` to carry seed event objects, the apply callback, and block counts together. The original callback-only signature is still accepted for existing callers; the object form is required for filtered seed delivery.
- A missing synthetic result list treats every history tool result as synthetic, keeping real live results until compared to one known persisted result.
- On claim, pending updates are cleared before an old filter releases held content, so that release cannot be erased by the clear.
- Filtered out events are excluded from only the rebuilt tab; sibling tabs retain their normal delivery. An exact block in history is shown from history, while unmatched content is released by F1's filter.

## Open

- **F3 caller wiring:** `ChatMessageHandler` must pass `deliver(excludeTabIds)` through its tab fan-out, applying to every non-excluded tab with `fanOut: false`. Its seed callback must accept an event list and route exactly that list, then pass `{ events: snapshot.liveSeed, apply, liveSeedBlocks: snapshot.liveSeedBlocks }` through `ChatStore.resyncStream` and `SessionLoaderService` to `replayer.claim`.
- **F3 loader wiring:** take `liveArrivalMark()` synchronously at resync arrival before the first await; call `retirePersistedFilter(tabId)` then. After validating history owners and synthetic result indices, call `setPersistedFilterInputs(claim, { ownerByEvent, syntheticResults, prefixMark })` before `replay`; pass `null` for absent/malformed owners or synthetic results. Use `reserveFence`/`releaseReservation` around a resync waiting behind another load, read `overflowedDuring(holder)` before release, and request a fresh resync on overflow. Call `reconcileTab` where the plan requires status recovery.
- The required Jest, Nx typecheck and Nx lint results are unavailable because automatic command review rejected the locked PowerShell commands. The rejection supplied only `blocked by policy`, with no more specific reason. Re-run the exact required commands when this restriction is resolved.
- Replayer-level regression coverage remains incomplete for R-B2c, R-B3b, R-B3d, R-B6, R-B7 and the full R-B1s variants. This batch should not be treated as fully verified until those cases run.
