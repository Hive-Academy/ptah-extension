# Batch 2 report — shared session embed

## Changed files

- `libs/frontend/chat/src/lib/components/templates/session-embed.component.ts` (new): one normal `ChatViewComponent`, minimal named header/add-on projection, scoped injector and visibility lifetime.
- `libs/frontend/chat/src/lib/components/templates/session-embed.component.spec.ts` (new): four embed contract tests.
- `libs/frontend/chat/src/lib/components/index.ts`: exports the embed.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts`: delegates the chat view to the embed; retains canvas guard, lane actions, rail policy, override freezing and unavailable-agent notice.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts`: exercises the delegated injector and canvas policy.
- `libs/frontend/chat-state/src/lib/tab-manager.service.ts`: reference counts visible-tab registrations.
- `libs/frontend/chat-state/src/lib/tab-manager.lifecycle.spec.ts`: verifies duplicate owners and final release.

## Injector tokens

The embed owns one child `EnvironmentInjector` and provides `SESSION_CONTEXT` (tab ID signal), `SESSION_VISIBLE`, `SESSION_FOCUSED`, `RAIL_MIN_CONTENT_WIDTH`, `SESSION_START_GUARD`, `SURFACE_ACTIVE`, `RAIL_TRANSCRIPT_RETENTION`, optional `RailTranscriptRetentionCoordinator`, and `SESSION_CARD_ACTIONS`. It destroys that injector with the component. The canvas supplies its start guard, card actions and retention input; the feature host's projected content remains in its declaration injector.

## Visibility ownership

The embed registers the tab while `SURFACE_ACTIVE` and its `visible` input are true. Its effect unregisters on hide, tab change or destruction. Register/unregister calls are `untracked` so updating `visibleTabIds` cannot retrigger the effect. `TabManagerService` counts registrations per tab; a second embed or another host can keep the same tab visible after the first leaves. The canvas uses `contentVisible` to freeze a transcript behind a sublane while keeping its pane registered, matching the existing lane behavior.

## Parity evidence

- Canvas focus/split and lane host remain in their existing components. The changed canvas detail transcript renders `<ptah-session-embed>` and still supplies 360px minimum width in split mode; its isolated spec passes 10/10 tests.
- `SESSION_CONTEXT` remains a tab ID and the visible/focused/surface tokens remain scoped per embedded view; the new embed spec tests token changes without recreating the child injector.
- Canvas start guard, `CanvasDetailService` lane/session actions, rail retention/coordinator and unavailable-agent notice remain in the canvas wrapper; its existing transcript spec covers them.
- Live visibility registration and duplicate-owner cleanup are covered by the embed spec and the new chat-state lifecycle test. Chat view still owns transcript, permissions, history, stats, and the complete composer; the embed instantiates that same `ChatViewComponent` once.
- With no projected content, the embed adds no header, aside, sizing rule or control around the chat view, preserving the canvas transcript. The embed spec covers both minimal named slots and confirms there is no aside.

## Verification

- Prettier ran on all changed source/spec files. Typecheck and lint passed for chat, canvas and chat-state (6 Nx targets).
- Chat: 3,940 passed, 2 skipped across 210 suites after D6. Before this batch: 3,936 passed, 2 skipped; four embed tests added.
- Chat-state: 574 passed across 26 suites (cached after the D6 change, which did not touch chat-state). Before this batch: 573 passed; one owner test added.
- Canvas: the isolated changed transcript spec passes 10/10. Full project after D6: 370 passed, 1 failed across 23 suites (371 tests). A before-batch full pass count was not recorded; the current test total is 371. The failing test is `canvas-lane-view.component.spec.ts`'s `keeps one transcript and draft while covering it, and focuses Back then restores the opener`. It stubs the `CanvasDetailTranscriptComponent` template with only `<ptah-test-chat-view />`, then reads `transcript.componentInstance.childInjector`. The injector now belongs to `SessionEmbedComponent`; the stub template omits that child, so the read fails. The first full canvas run additionally exhausted a Jest worker because the visibility effect tracked its own set update; that was fixed with `untracked`, and the subsequent full runs had no worker crash.
- `ptah_get_diagnostics` was invoked on all changed TS files after edits but timed out as unavailable; Nx project typechecks passed.

- Orchestrator fix (next session): `canvas-lane-view.component.spec.ts` now stubs the
  `SessionEmbedComponent` template instead of the transcript template, so the real embed owns
  `childInjector`. Re-run without cache: canvas 371/371, chat 3,940 + 2 skipped, chat-state 574,
  typecheck and lint for 3 projects, degradation-audit clean.

## Decisions

- **Keep covered canvas lanes registered while suppressing transcript rendering.** Options: unregister whenever transcript content is hidden, or separate pane registration from transcript visibility. Evidence: the parity inventory and existing canvas transcript tests require the parent tab to stay registered behind a sublane. Reversible: yes; the extra `contentVisible` input can be revised with lane hosting.
- **Reference count the tab manager registration API.** Options: a local embed-only count or a count at the shared visibility owner. Evidence: the canvas and tribunal both register through this API; a local count cannot preserve visibility when a non-embed owner unmounts. Reversible: yes.
- **Follow D6's inspector ownership.** Options: lay out an add-on beside the embed, or leave the embed slots as direct projection points. Decision D6 assigns the session inspector to `ChatViewComponent` in TASK_2026_677 and harness projection to TASK_2026_649. The embed therefore has no add-on inputs, output, panel or layout CSS. Reversible: yes.

## Deviations and remaining work

- Added `contentVisible` beyond the planned embed input list to preserve canvas sublane parity while keeping the planned `visible` input's hide/unregister behavior.
- D6 superseded the original add-on panel contract. The two slots remain as minimal projection points; `addonOpen`, `addonTitle` and `addonDismissed` were removed.
- Next session: update `canvas-lane-view.component.spec.ts` to render the embed in the transcript test setup and query its `childInjector` for token assertions, while retaining the chat stub for draft/focus assertions. This lane did not edit that adjacent spec because the orchestrator reserved it for the next session.
