# Batches 15–17: idle compaction chat notice

## Batch 15

### Files changed

- `libs/frontend/chat-state/src/lib/conversation-registry.service.ts:39-47,275-319,322-348,368-400`: added `idleCompaction` to marker records and token updates; retained it for the same boundary and summary update, cleared it on a new boundary, and accepted persisted data only with a finite, nonnegative token count.
- `libs/frontend/chat-state/src/lib/conversation-registry.service.spec.ts:23-75`: covered persistence, reload, summary retention, new-boundary clearing, and invalid stored values.
- `libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.ts:24-32,105,140`: added the signal input and exact idle sentence using the existing `format` helper; kept the generic title when absent.
- `libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.spec.ts:51-67,103-119`: covered the exact formatted sentence, generic text, and absence of “manual” wording.

### Checks

- Targeted chat-state Jest: `Test Suites: 1 passed, 1 total`; `Tests: 45 passed, 45 total`.
- Targeted chat-ui Jest: `Test Suites: 1 passed, 1 total`; `Tests: 12 passed, 12 total`.
- `nx typecheck @ptah-extension/chat-state --parallel=1`: exit 0; final output reported `Run duration: 22.9s`.
- `nx typecheck @ptah-extension/chat-ui --parallel=1`: exit 0; final output recommended splitting its `30.6s` critical path.

### Decisions

- Retain an omitted idle notice on an update for the same explicit boundary; clear it on a new or unidentified boundary. Options were preserving every prior notice or clearing on every omission. The existing measurement merge in `ConversationRegistry.setCompactionMarkerTokens` uses boundary identity for exactly this distinction. Reversible.
- Change only the inline marker title. The existing modal title labels the summary dialog, while the requested notice describes the inline chat marker. Reversible.

### Not done

- None within this batch.

## Batch 16

### Files changed

- `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:139,586`: copied the event field into `AccumulatorResult`.
- `libs/frontend/chat-streaming/src/lib/accumulator-core.service.spec.ts:877-889`: covered present and absent notice forwarding.
- `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:207,417,498`: added the field to both result shapes and forwarded the accumulator value.

### Checks

- Targeted accumulator Jest: `Test Suites: 1 passed, 1 total`; `Tests: 48 passed, 48 total`.
- `nx typecheck @ptah-extension/chat-streaming --parallel=1`: exit 0; final output reported `Run duration: 14.8s`.

### Decisions

- Use the backend event's optional notice unchanged. The shared `CompactionCompleteEvent` already defines the source field, and the accumulator forwards adjacent compaction metadata directly. Reversible.

### Not done

- None within this batch.

## Batch 17

### Files changed

- `libs/frontend/chat/src/lib/services/chat.store.ts:428`: forwarded the streaming result field.
- `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts:363,523,756,779`: forwarded it through normal and late-boundary paths into the registry; updated the late-boundary helper type.
- `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.spec.ts:880-890`: asserted notice forwarding to the registry.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:97`: bound the record field to the marker input.

### Checks

- Targeted lifecycle Jest: `Test Suites: 1 passed, 1 total`; `Tests: 70 passed, 70 total`.
- Initial `nx typecheck @ptah-extension/chat --parallel=1`: exit 1. Direct scoped TypeScript diagnostics found TS2339 at the late-boundary helper result type. After adding the missing field, the same Nx typecheck exited 0; final output reported a `46.6s` critical path.
- `prettier --check` on all 11 changed source and spec files: `All matched files use Prettier code style!` (exit 0).
- `eslint` on all 11 changed source and spec files: no output (exit 0).
- Scoped `ptah_get_diagnostics` timed out twice after 45 seconds and returned unavailable; the targeted Nx checks above completed.

### Decisions

- Forward the notice in the late-boundary merge as well as the normal completion. The service already merges late verified compaction metrics into the same marker; omitting the field there would lose a valid idle notice. Reversible.

### Not done

- None within this batch. Visual screenshots and phase review are assigned downstream in `batches.md`, outside these file ownership boundaries.
