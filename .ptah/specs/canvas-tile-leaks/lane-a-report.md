# Lane A report

## Files changed

- `libs/frontend/chat-state/src/lib/tab-manager.service.ts` — retained the legacy `closedTab` signal and added synchronous, teardown-capable `onTabClosed` delivery after a removed tab leaves state.
- `libs/frontend/chat-routing/src/lib/stream-router.service.ts` — drains every synchronous close event; pop-out clears only tab caches when no remaining tab displays the session, without evicting agents.
- `libs/frontend/chat-routing/src/lib/stream-router.service.spec.ts` — covers consecutive close delivery and pop-out cache release/shared-session preservation.
- `libs/frontend/chat/src/lib/services/closed-tab-session-ender.service.ts` — uses the subscription API so each close is considered exactly once.
- `libs/frontend/chat/src/lib/services/closed-tab-session-ender.service.spec.ts` — covers two closes in one tick.
- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts` — checks tab existence immediately before history-page construction.
- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.older-page.spec.ts` — covers a tab closing during chunked older-history replay.
- `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts` — consumes every close through the subscription API and tears it down on component destroy.

## Findings fixed

1. `TabManagerService.onTabClosed` at `tab-manager.service.ts:277` synchronously notifies every subscriber, while `closedTab` remains a backward-compatible last-event signal. `StreamRouter`, `ClosedTabSessionEnderService`, and canvas subscribe at `stream-router.service.ts:80`, `closed-tab-session-ender.service.ts:40`, and `orchestra-canvas.component.ts:469`; this prevents same-tick event loss.
2. `StreamRouter.handleTabClosed` at `stream-router.service.ts:963` releases `clearForClosedTab` and pending updates on a pop-out only when no other open tab displays the session. Its running-agent cleanup remains limited to regular close/reset at `stream-router.service.ts:954`.
3. `SessionHistoryReplayer` now rejects the replay before `HistoryMessageBuilder.build` when `findTabByIdAcrossWorkspaces` no longer finds the tab at `session-history-replayer.service.ts:279`; the `finally` still clears any partial cache.

## Verification

- `npx nx run-many -t test -p chat-state chat-routing chat canvas --skip-nx-cache 2>&1 | Select-Object -Last 40` — launched; no result count was returned before the command wrapper timed out, and its Nx child was still running at the single completion check.
- `npx nx run-many -t lint -p chat-state chat-routing chat canvas 2>&1 | Select-Object -Last 20` — launched; no result count was returned before the command wrapper timed out, and its Nx child was still running at the single completion check.
- Focused TypeScript diagnostics were requested after edits, but the workspace typecheck service remained unavailable after its 45-second limit (0 checked files; 5 pending), so no diagnostic pass/fail count is available.

## Open Items

- Await the already-running scoped Nx test and lint processes for final pass/fail counts; no source finding remains intentionally deferred.

## Revision 1

## Revision 2 — Canvas Follow-up

### Files changed

- `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts` — mounts the component before checking subscription teardown and invokes the captured `onTabClosed` listener for close/reset assertions.

### Finding fixed

- The destroy test now creates the component before reading `onTabClosedMock.mock.results[0]` (`orchestra-canvas.component.spec.ts:323`). The close and reset tests invoke the captured synchronous listener at `:375` and `:389`, rather than mutating the obsolete `closedTab` signal.

### Verification

- `npx jest -c libs/frontend/canvas/jest.config.ts orchestra-canvas --silent`: exceeded the execution channel's 30-second foreground limit; no Jest footer or pass/fail count returned.

## Revision 2

### Files changed

- `libs/frontend/chat-state/src/lib/tab-manager.service.ts` — snapshots close listeners, catches and logs each listener failure, then continues delivery and post-close state work.
- `libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts` — covers throwing-listener isolation/state saving and re-entrant close delivery.
- `libs/frontend/chat-routing/src/lib/stream-router.service.ts` — documents the synchronous close subscription and always clears tab-id-keyed caches; session cleanup remains shared-session guarded.
- `libs/frontend/chat-routing/src/lib/stream-router.service.spec.ts` — proves a shared-session pop-out clears the closed tab's tree/pending caches without clearing session caches.
- `libs/frontend/chat/src/lib/services/closed-tab-session-ender.service.ts` — excludes the closing tab explicitly from display checks, independently of router listener order.
- `libs/frontend/chat/src/lib/services/closed-tab-session-ender.service.spec.ts` — covers the ender receiving a close before router unbinding.
- `libs/frontend/chat/src/lib/services/transcript-retention.service.ts` — replaces the coalescing signal effect with a teardown-capable `onTabClosed` subscription.
- `libs/frontend/chat/src/lib/services/transcript-retention.service.spec.ts` — uses a real listener mock and covers two same-tick closes.

### Findings fixed

1. Per-listener isolation and a snapshot iteration are at `tab-manager.service.ts:285`; failures log at `:294`, so remaining listeners and the caller's active-tab/save work continue. Regression coverage is at `tab-manager.service.spec.ts:211` and `:239`.
2. `stream-router.service.ts:963` always clears `clearForClosedTab` and pending updates, while only session-keyed agent/background/session-tree cleanup is guarded at `:952`. Shared-session pop-out coverage is at `stream-router.service.spec.ts:1176`.
3. Transcript retention now subscribes with destroy-time teardown at `transcript-retention.service.ts:84`; same-tick delivery coverage is at `transcript-retention.service.spec.ts:178`.
4. The ender filters `closed.tabId` from `findTabsBySessionId` at `closed-tab-session-ender.service.ts:72`, so its outcome does not depend on router registration order. Coverage is at `closed-tab-session-ender.service.spec.ts:209`.

### Verification

- Scoped TypeScript diagnostics: unavailable after 45 seconds; 0/8 files checked, no diagnostic count returned.
- `npx jest -c libs/frontend/chat-state/jest.config.ts --silent`: exceeded the execution channel's 30-second foreground limit; no Jest footer or pass/fail count returned.
- `npx jest -c libs/frontend/chat-routing/jest.config.ts --silent`: exceeded the execution channel's 30-second foreground limit; no Jest footer or pass/fail count returned.
- `npx jest -c libs/frontend/chat/jest.config.ts closed-tab-session-ender transcript-retention --silent`: exceeded the execution channel's 30-second foreground limit; no Jest footer or pass/fail count returned.

## Open Items

- Obtain Jest result footers/counts after the existing worker processes complete; no code finding is intentionally deferred.

### Files changed

- `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts` — added `onTabClosed` to all component test doubles and a destroy-time subscription teardown regression test.
- `libs/frontend/canvas/src/lib/canvas-tile.component.spec.ts` — added teardown-capable `onTabClosed` to every TabManager test double.
- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts` — added a teardown-capable `onTabClosed` test double.
- `libs/frontend/canvas/src/lib/canvas.store.spec.ts` — added a teardown-capable `onTabClosed` test double.
- `libs/frontend/chat-routing/src/lib/__tests__/surface-vs-tab-parity.spec.ts` — added the subscription API to the shared TabManager mock.
- `libs/frontend/chat-routing/src/lib/stream-router.setup-surfaces.spec.ts` — added the subscription API to the shared TabManager mock.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts` — added a teardown-capable `onTabClosed` test double.
- `libs/frontend/chat/src/lib/services/transcript-retention.service.spec.ts` — added a teardown-capable `onTabClosed` test double.

### Verification

- `npx nx test canvas --skip-nx-cache 2>&1 | Select-Object -Last 15` — started once; still running (PID 27564) after the terminal wrapper’s 30-second limit. Pass/fail counts unavailable.
- `npx nx test chat-routing --skip-nx-cache` — not started, to honor the required sequential verification while canvas remains active.
- `npx nx test chat-state --skip-nx-cache` — not started, to honor the required sequential verification while canvas remains active.
