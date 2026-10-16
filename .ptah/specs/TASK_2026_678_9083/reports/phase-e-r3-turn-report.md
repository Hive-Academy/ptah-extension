# Phase E round 3 — turn lane

## S-A

Confirmed ownership defect: `command-center-turn-status.ts:32-41` previously skipped a marked tab already in `visibleTabIds`; `tab-manager.service.ts:3090-3106` used a plain set, so one owner's removal could hide another owner. The page controller calls the registration effect at construction (`command-center-page.controller.ts:297`), and the page provides that controller locally (`command-center-page.component.ts:38-43`). The source does not prove the exact old/new component destruction order seen in the review, but the overlap test covers that order. Chat does not call `registerVisibleTab`: `stream-viewport-controller.service.ts:75-85` independently adds the active tab only while the current surface is `chat`. That explains why opening Chat flushed the retained stream without confirming the reviewer's Chat registration hypothesis.

`TabManagerService` now counts registrations per tab while exposing the same `ReadonlySet` signal for viewport consumers. The Command Center page always registers the marked tab and releases that ownership on effect cleanup. The canvas transcript now does the same; the conductor tile already registered and unregistered unconditionally (`conductor-tile.component.ts:225-237`).

Specs: `tab-manager.command-center.spec.ts` checks two registrations, one removal, final removal and an extra removal; `command-center-page.controller.spec.ts` checks that a page registering before an older owner cleans up keeps the tab visible.

## S-E

Trace: `MessageSenderService` resets optimistic state when the initial RPC rejects (`message-sender.service.ts:485-525`) and when continue rejects (`:745-779`). The observed spawn failure instead happened after the send succeeded. The backend broadcaster catches stream failures, forces an idle `turn_state`, flushes it, and only publishes `chat:error` when the error is not classified as an abort (`chat-stream-broadcaster.service.ts:297-369`). Chat's error handler also finalizes and resets the tab when it receives `chat:error` (`completion-handler.service.ts:47-99`). In the observed zero-event abort, the page's missing viewport registration could retain the forced terminal state, leaving the frontend tab `streaming`; the Chat surface's active-tab viewport then released it. This is the same visibility failure as S-A, not a missing sender rollback.

The Command Center shown status now gives a stored `stopped` or `error` precedence over a stale streaming tab. A failed terminal pulse or terminal reason while the page is still running sets `error` and shows the fixed text “The Command Center turn could not finish.” The existing coordinator rejection path already sets a safe fixed-text toast (`session-coordinator.ts:238-283`); its regression spec checks that an error string containing a private path is not exposed. A user Stop sets `stopped` first (`session-coordinator.ts:217-226`), so a later abort pulse does not produce this failure toast.

Specs: `command-center-page.controller.spec.ts` covers stopped/error precedence, an aborted terminal pulse and a failed turn without a pulse; `session-coordinator.spec.ts` covers safe send-rejection text.

## Files changed

- `libs/frontend/chat-state/src/lib/tab-manager.service.ts`
- `libs/frontend/chat-state/src/lib/tab-manager.command-center.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-center-turn-status.ts`
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts`
- `libs/frontend/command-center/src/lib/model/session-coordinator.spec.ts`
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts`

## Decisions

- Count each visible-tab owner. Options were set ownership or per-tab counts; the overlapping page and canvas registrations plus the plain set's removal behavior support counts. Reversible.
- Treat a terminal abort as a Command Center failure only while its store still says `running`. Options were a global chat error change or page-scoped feedback; the broadcaster already emits terminal state, and Stop must remain stopped. Reversible.

## Not done

- Did not run Nx, Jest, build, serve, e2e or package, as required for this parallel lane.
- `ptah_get_diagnostics` was invoked on all six changed TypeScript files. The completed retry found no diagnostics in the requested files. It reported 40 errors in sibling specs outside this lane's ownership; those were not edited.
