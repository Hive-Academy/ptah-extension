# Phase D fix round, lane Q

## B1 — terminal pulses

- `libs/frontend/chat-state/src/lib/tab-manager.service.ts:277,340,451,1799` adds a non-consuming latest-pulse snapshot per tab, updates it when a pulse is emitted, and clears it on tab close. The ledger queue and consumer remain unchanged.
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:39,100,215` uses the snapshot for the compact reply, voice boundary, and send sequence. `libs/frontend/command-center/src/lib/components/command-center-tribunal.transport.ts:35,84,115,131` uses the marked tab's snapshot and rejects a pending discovery on page exit or destroy. `command-center-page.controller.ts:332` cancels an answered confirmation when Decline is clicked before launch.
- Specs: `libs/frontend/chat-state/src/lib/tab-manager.last-terminal-pulse.spec.ts:10` — “retains the latest tab pulse after the queue is consumed and replaces it on a later turn”; `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts:176` — “delivers a settled boundary from the snapshot after another reader consumes the queue”; `libs/frontend/command-center/src/lib/components/command-center-tribunal.transport.spec.ts:130,139,145,152` — consumed queue, pulse before waiter, page exit rejection, and Decline rejection; `command-center-page.controller.spec.ts:448` — “cancels an answered confirmation when Decline is used before launch”.

## S3 — permission card

- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:67,184,286` selects a permission for the marked tab, projects an approval pending input, speaks a short card prompt, and sends the request id with `allow` or `deny` through `ChatStore.handlePermissionResponse`. A request with an authoritative different `tabId` is ignored. `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:128` routes card approval responses to that method.
- Specs: `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts:207` — “shows only the marked tab permission and handles Approve and Deny once by request id”; `:256` — “keeps a spoken yes from answering a marked permission”; `libs/frontend/command-center/src/lib/components/command-center-page.component.spec.ts:209` — “routes approval card decisions to permission response only”.

## M1 — typed voice turn

- **Not done.** `CommandVoiceLoop.onTurnBoundary` checks private `awaitingBoundary` and `awaitingTurnToken`; both are armed only inside the voice loop's speech send path (`libs/frontend/command-center/src/lib/voice/command-voice-loop.ts:393-420`). Changing the controller alone cannot arm a typed turn. `command-voice-loop.ts` is outside the explicit lane file scope. The orchestrator needs to authorize that file or handle M1 in another lane.

## Verification

- `ptah_get_diagnostics` on all eight changed TypeScript files: no errors in requested files. It reports 35 errors in sibling files outside this lane; those were not edited.
- `npx eslint` on changed files: 0 errors, 1 existing `max-lines` warning in `tab-manager.service.ts`.
- `npx prettier --write` and `npx prettier --check` on changed files: passed.
- Nx, Jest, and tsc were not run, per lane instructions.
- Degradation audit: no non-spec `catch` or `.catch` block was added or changed. The existing reported catches in the controller and transport remain as they were.

## Decisions

- Kept one latest terminal pulse per tab as the independent reader source. A pulse arriving before `discoveryComplete()` is checked synchronously, so it cannot strand the waiter.
- `pageExit()` permanently closes the page transport and rejects its waiter. Decline cancels the active waiter without closing the transport, allowing a later proposal on the same page.
- Permission response is reachable from the card output only; speech continues to hit the voice loop's approval guard.

## Correction round

- `libs/frontend/command-center/src/lib/integration/integration-harness.ts:55,86,90,94` now provides the latest pulse snapshot from harness pulses, a writable empty permission request signal, a permission response mock, and the page exit / discovery cancellation transport methods. Existing integration assertions were unchanged.
- M1 is complete, superseding the earlier scope limitation: `libs/frontend/command-center/src/lib/voice/command-voice-loop.ts:414` arms the loop's internal token and boundary for a typed send only while voice is active. `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:107,301,311,327` distinguishes voice transcripts from typed sends, and arms the token after a successful typed send through the existing `onVoiceSend` hook, which records the pulse sequence boundary.
- Specs: `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts:207` — “arms a typed send during voice and delivers its pulse boundary once”; `:234` — “does not deliver a typed pulse boundary while voice is inactive”; `libs/frontend/command-center/src/lib/voice/command-voice-loop.spec.ts:24` — “arms one typed turn only while active and rejects a stale token”.
- Final scoped Jest result: `Test Suites: 30 passed, 30 total`; `Tests: 189 passed, 189 total`.
- `npx eslint` on all five changed TypeScript files: passed, no warnings. `npx prettier --write` followed by `npx prettier --check` on those files: passed.
- Degradation audit: no non-spec `catch` or `.catch` block was changed in this correction round.
- Anything not done: none within the correction scope.
