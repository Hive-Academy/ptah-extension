# Phase 2 report — Webview three-tier scheduler

## Status

Implemented Phase 2's webview scheduler and v2 viewport/snapshot consumer in the chat feature library.

## Built so far

- `StreamViewportController` derives the focused tab from the active chat surface and unions it with the mounted-tab set. It sends a debounced, de-duplicated `chat:setStreamViewport` v2 declaration only when that state changes.
- `StreamFlushScheduler` owns at most one focused rAF and one fixed 50 ms task per visible tab. Hidden arrivals are retained without creating a message-triggered task. Work already received before a tab switch is retained and flushed in arrival order, rather than being stranded by the new tier.
- The scheduler deliberately treats every tab as focused until protocol v2 is accepted, covering the plan's stale-state/old-host rollback behavior.
- `ChatMessageHandler` accepts `chat:streamSnapshot`, validates its external envelope without adding Zod to the eager webview bundle, and applies each ordered snapshot through the existing stream path in one scheduled flush. Duplicate/older snapshot ranges are ignored.
- Overflow/resync snapshots use the existing `chat:resume` replay mechanism against the affected tab. `SessionLoaderService` now recognizes this targeted resync reason so an existing live tab is rebuilt rather than merely activated.

## Files changed so far

- `libs/frontend/chat/src/lib/services/stream-viewport-controller.service.ts`
- `libs/frontend/chat/src/lib/services/stream-flush-scheduler.service.ts`
- `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts`
- `libs/frontend/chat/src/lib/services/chat.store.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`
- `libs/frontend/chat/src/lib/services/index.ts`
- `libs/frontend/chat/src/lib/services/stream-flush-scheduler.service.spec.ts`
- `libs/frontend/chat/src/lib/services/stream-viewport-controller.service.spec.ts`
- `libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts`

## Tests added

- Scheduler: one focused rAF, one visible 50 ms task, no hidden task, ordered one-time snapshot application, and visible-to-focused tab-switch ordering.
- Viewport controller: debounced distinct declarations, focused/visible/hidden tier derivation after v2 acceptance, and focused fallback for a v1 acceptance.
- Handler: ordered snapshot dispatch through the normal stream path and overflow-triggered resync.

## Checks run

- `npx jest -c libs/frontend/chat/jest.config.ts src/lib/services/stream-flush-scheduler.service.spec.ts src/lib/services/stream-viewport-controller.service.spec.ts src/lib/services/chat-message-handler.service.spec.ts --coverage=false --maxWorkers=2` — passed: 3 suites, 47 tests.
- `npx nx lint @ptah-extension/chat` — passed: 0 errors; 34 pre-existing warnings. Nx also reported the repository's disabled Nx Cloud organization, which did not affect lint.
- `npx nx typecheck @ptah-extension/chat --parallel=1` — attempted twice, but the runner did not emit a completed result inside this environment's 30-second command window. Do not treat it as passed.
- Scoped editor diagnostics likewise did not finish inside its 45-second service limit; the explicit targeted Jest transpilation and lint above passed.

## Deviations

None from Phase 2's D2/D3 scheduling scope. The resync option is a narrow addition to the existing session-loader reason union so the required `chat:resume` path can target a live tab.

## Decisions

- Snapshot validation is local and structural because the Phase 1 Zod decoder is deliberately isolated from the shared root to avoid adding Zod to the eager webview bundle.
- Until a host accepts protocol v2, the controller returns the focused tier for every tab. This is the approved Phase 2 rollback behavior.
- A snapshot is queued as one work item; its events are applied consecutively inside that flush rather than each creating another rAF/timer.

## Remaining work

- Re-run the scoped chat typecheck in an environment that permits it to finish beyond 30 seconds.
- Phase 3 per-message presentation records and Phase 4 incremental Markdown remain intentionally out of scope.
