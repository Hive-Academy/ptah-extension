# Phase 3 — Per-message records + transcript structural split

## Built

- Added `StreamPresentationStore`, a root presentation store with a stable writable signal per message id and a separate structural signal per tab. It rebuilds through the existing tree builder only from the scheduler-published tab snapshot, then writes record signals only when that record's presentation content changes.
- Added the single rollback gate `STREAM_PRESENTATION_RECORDS_ENABLED`; setting it to `false` restores the existing transcript computed derivation.
- Updated `ChatTranscriptComponent` to synchronize only while active, read the structural slot list, iterate `@for (slot ...; track slot.id)`, and pass `slot.record()` to each bubble. Content-only writes therefore do not publish a new slot list, render-window id map, or transcript-wide view model.
- Preserved streaming-to-finalized identity: finalization changes the record for the stable id while the slot and bubble instance remain in place.
- Kept ordering through the same finalized/streaming time merge and existing handler/tree-builder path, so replay/resume semantics remain unchanged.

## Files changed

- `libs/frontend/chat/src/lib/services/stream-presentation-store.service.ts` (new)
- `libs/frontend/chat/src/lib/services/index.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts`
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html`
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.spec.ts`
- `.ptah/specs/TASK_2026_STREAMING_ARCH/phase-3-report.md`

## Tests added

- `updates one live record without recomputing transcript-wide derivations`: asserts the changed bubble receives a new record, an unchanged bubble retains its record, and spies show zero calls to `allMessages`, `finalizedMessageIds`, and `TranscriptRenderWindow.syncMessages` for the content delta.
- `keeps the bubble component when a live record finalizes with its id`: asserts the same bubble component instance survives the live-to-finalized transition.
- Extended the streaming ordering regression to assert the rendered stable slot order, not only the legacy computed list.

## Verification

- `npx jest -c libs/frontend/chat/jest.config.ts src/lib/components/organisms/transcript/chat-transcript.component.spec.ts --coverage=false --maxWorkers=2` — passed, 25 tests.
- `npx nx typecheck @ptah-extension/chat --parallel=1` — passed. One existing Angular optional-chain warning in `peer-session-send-dialog.component.ts`; Nx Cloud reported its disabled organization but the command exited successfully.
- `npx nx lint @ptah-extension/chat` — passed. It reports 34 existing project warnings (no errors); this change adds none.
- Targeted TypeScript diagnostics reported no diagnostics in the changed files. The diagnostic service also lists existing sibling test errors outside this change.

## Deviations

- None. Phase 4 incremental markdown and shared scroll-dirty work was not implemented.

## Decisions

- The presentation store is synchronized by the active transcript after `BatchedUpdateService` has published its per-frame `TabState`; this retains the streaming handler and tree builder as the semantic owners and preserves inactive transcript freeze behavior.
- Derived timestamps from `createExecutionChatMessage` are excluded from record equality. They are recreated on every tree read and do not represent a content update; ignoring them prevents untouched bubbles from receiving a false record update.

## Remaining work

- Phase 4 and later plan items remain outside this phase.
