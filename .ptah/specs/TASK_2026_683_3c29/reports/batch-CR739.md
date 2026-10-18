# PR #739 CodeRabbit fixes

## Files changed

- `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:355`: copy `latestTodoWrite` into a new marker object and shallow-copy its optional `input`; preserve `undefined` when absent.
- `libs/frontend/chat-streaming/src/lib/message-finalization.service.spec.ts:228`: regress the evicted TodoWrite case, asserting equal marker value and separate marker/input references.
- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts:374`: remove owner IDs absent from `historyState.messageEventIds` before reconciliation. When all owners are absent, warn with tab and owner IDs and skip both state updates. With partial presence, only present owners move from tab messages to live state.
- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.spec.ts:898`: assert all missing owners leave rows in tab messages, produce no live state, and log the warning. `:921`: assert a partial match moves only the present owner and retains the missing owner's row.

## Verification

- `npx jest -c libs/frontend/chat-streaming/jest.config.ts libs/frontend/chat-streaming/src/lib/message-finalization.service.spec.ts --coverage=false --maxWorkers=2`: **1 suite passed, 34 tests passed**.
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.spec.ts --coverage=false --maxWorkers=2`: **1 suite passed, 62 tests passed**.
- Scoped `ptah_get_diagnostics` completed after an initial timeout. It reported no errors on the added lines or edited service files; it did report pre-existing type errors in the specs and sibling files, so a clean TypeScript diagnostic result is unavailable.

## Decisions

- Filter the existing `owners` set in place before the reconciliation branch. This keeps the current extraction and row-removal code aligned with `messageEventIds` without restructuring the block. Alternative: add a second nested reconciliation branch. Evidence: both `ownerStarts` and `messageIds` derive from `owners`. Reversible: yes.
- Shallow-copy the TodoWrite `input` record. The marker type is a readonly record and the requested isolation matches the service's existing shallow-copy approach. Alternative: deep-copy arbitrary nested values. Reversible: yes.
