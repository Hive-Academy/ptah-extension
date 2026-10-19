# Canvas open timeouts — fix round 1 logic re-review

Verdict: APPROVED  
Score: 8/10  
Review family: codex (implementer: Claude)

Scope: findings 1–3 from `canvas-open-timeouts-review.md`, the working-tree diff against HEAD excluding `.gitignore`, and the related source and specs. No tests or builds were run in this read-only review. The orchestrator reports passing typechecks for core, chat, canvas, and the webview; my scoped `ptah_get_diagnostics` call returned two files unchecked after 45 seconds. The known absence of a second-mounted-tile spec remains outside this round's findings.

## Numbered findings

No open blocking, serious, moderate, or minor findings in this scoped fix round.

1. **Closed — drained requests settle after adoption or focus failure.** `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:459-487` removes the queue, handles each request in its own `try/catch`, and calls its resolver before moving on. When `adoptTab` throws before returning, the result falls back to the tile lookup at lines 481–485; when `focusTile` throws after a successful adoption, the returned tab ID still yields true. `libs/frontend/canvas/src/lib/canvas.store.ts:328-333,426-430` confirms adoption appends before returning and focus is a separate operation. The new spec at `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts:510-541` asserts false for a throwing first adoption and true for the next request. This closes prior finding 1's stranded-request path.

2. **Closed — late branch failure no longer overwrites a newer visible banner or appears in another mounted tab.** `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:1456-1459` captures the originating tab; lines 1500–1516 attach late false and rejection handlers after the timeout; lines 1552–1559 require the same local banner generation and either the original shared banner or an empty slot before showing a tab-scoped error. The action banner helpers advance the generation at lines 351–366, and the shared service creates a fresh banner state on each show at `libs/frontend/chat/src/lib/services/action-banner.service.ts:66-80,107-116`. The newer-action spec at `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts:1480-1515` asserts the newer banner remains the same object after the older request resolves false. This closes prior finding 2 for the stated overlap.

3. **Closed — specs cover the omitted late outcomes.** `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts:1442-1478` rejects the original request after timeout and checks that the real banner is an error scoped to `tab-abc`; lines 1480–1515 cover a newer action followed by late false. `chat-view.component.ts:1511-1522` supplies both rejection handling and a trailing catch that logs errors thrown while reporting the late outcome, preventing an unhandled rejection from that handler. This closes prior finding 3.

## Five logic questions

1. **Silent failure:** A drained adoption exception now logs and settles from tile presence (`orchestra-canvas.component.ts:469-486`). A late notification failure logs through the trailing catch (`chat-view.component.ts:1517-1522`).
2. **Unexpected user action:** Starting a newer branch after the 10-second wait increments this view's generation when it shows its result, so the older failure leaves that banner in place (`chat-view.component.ts:1500-1509,1523-1525,1552-1559`; spec `chat-view.component.spec.ts:1494-1511`).
3. **Wrong answer from input data:** The late error carries `originTabId`, and each mounted view filters by tab ID (`chat-view.component.ts:1457-1458,1559,322-341`). This addresses the previous global-banner path; a two-tile rendering assertion remains untested.
4. **Dependency failure:** `adoptTab` and `focusTile` exceptions are caught per request (`orchestra-canvas.component.ts:469-486`); a rejected late `requestCanvasSession` invokes the rejection handler (`chat-view.component.ts:1510-1522`).
5. **Missing requirement:** The fix defines the formerly absent post-timeout precedence rule: a newer local banner or a different current shared banner takes precedence over the old branch failure (`chat-view.component.ts:1547-1559`). The exact behavior after another tile's banner has auto-cleared is not specified; the old failure may then display on its originating tab because the slot is null (`action-banner.service.ts:113-115`; `chat-view.component.ts:1557-1559`). That does not replace a newer visible result.

## Verification and remaining uncertainty

The canvas test exercises an `adoptTab` throw followed by another request (`orchestra-canvas.component.spec.ts:510-541`). It does not separately throw from `focusTile`, although the source orders `adopted =` before the focus call and resolves true when that value is non-null (`orchestra-canvas.component.ts:469-486`). The branch tests use the real banner service for rejection and newer-action cases (`chat-view.component.spec.ts:1442-1515`). They do not mount a second tile, as already recorded in the handoff. Those limits keep the score at 8 rather than 9; the closed failure paths and direct behavior assertions support a score above 6–7.

## Decisions

- **Decision:** Approve this scoped fix round. **Options:** approve or request another revision. **Evidence:** the three earlier failure paths have direct source handling and targeted tests at the locations above. **Reversible:** yes; future coverage can add a two-tile rendering test without changing this verdict.
