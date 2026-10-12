# Code Logic Review — TASK_2026_629_c0b3, B0–B1

## Summary

| Metric | Result |
| --- | --- |
| Score | 6/10 |
| Verdict | REVISE |
| Findings | 1 Serious, 1 Moderate, 1 Minor |

The sampler covers the ordinary live, trailing, finalized, and destroy paths in `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:195-250`. The explicit deciding-tab pulse is published in `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:430-436`. The score is below 7 because a denied permission from a non-active tab can still be attributed to the active tab, and the router's cancellation path has already lost its target list when it reads the pulse. It is above 5 because the core sampling branches and their direct specs cover the stated cadence and cleanup (`compact-session-card.component.spec.ts:399-423,475-523`).

## Findings

1. **Serious — explicit deciding tab is ignored for hard-deny attribution.** `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:412-430,451-462`; downstream `libs/frontend/chat-streaming/src/lib/turn-state-applier.service.ts:124-135`. When a user denies a permission from a card whose request has neither `sessionId`, `tabId`, nor attached target metadata, `hardDenyBucketFor` falls back to `activeTabId()`, even though the caller supplied the card's `tabId`. The pulse identifies the card, but the hard-deny ID is stored under the active tab. On terminal turn state, the card's bucket is empty, so its denied agent is not marked interrupted; an active-tab turn can consume the misplaced ID instead. Pass the explicit deciding tab into `hardDenyBucketFor` as the final tab fallback, and add a spec with a different active tab and no request routing metadata.

2. **Moderate — the decision pulse cannot drive the documented cross-tab cancellation.** `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:427-439`; `libs/frontend/chat-routing/src/lib/stream-router.service.ts:87-96,723-741`. The handler deletes `_promptTargetTabs` immediately after publishing the pulse. The router's effect later calls `targetTabsFor(promptId)`, which therefore returns `[]` (`permission-handler.service.ts:360-361`), so the deciding tab is never used to choose other tabs. The global prompt list is already removed, so today's visible prompt disappears, but the D8 cancellation contract is inert and would silently fail if per-tab queues use this seam. Carry the target IDs in the pulse or preserve them until the router has consumed them; add a router integration spec with two targets and an explicit non-active deciding tab.

3. **Minor — the 100-event acceptance spec does not send events.** `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.spec.ts:357-369,399-410`. Its loop clones the current `StreamingState` 100 times without adding an event or changing an accumulator. This proves the timer call bound for replacement inputs, but not that the card displays the latest content from a real stream. Mutate event/accumulator content between updates and assert the rendered trailing summary, including a pending timer followed by a tab switch. The production sampler already clears that timer on tab change (`compact-session-card.component.ts:223-229`); this is a coverage gap, not a claimed tab-switch defect.

## Five logic questions

1. **Silent failure:** The wrong hard-deny bucket causes a denied card agent to remain unmarked (`permission-handler.service.ts:422-425,451-462`; `turn-state-applier.service.ts:124-135`). The cancellation pulse loses its targets before the router reads them (`permission-handler.service.ts:437-439`; `stream-router.service.ts:723-741`).
2. **Unexpected user action:** Denying a card's permission while another tab is active triggers finding 1 when the request has no routing metadata (`permission-handler.service.ts:412-430,451-462`).
3. **Wrong-answer input:** A permission request without `sessionId`, `tabId`, or attached targets is bucketed under the active tab despite an explicit deciding tab (`permission-handler.service.ts:451-462`).
4. **Dependency failure or bad shape:** The card assumes each input has a usable `streamingState`; a null state deliberately takes the finalized path (`compact-session-card.component.ts:195-200,213-220`). A missing target lookup returns an empty list, and the router does not signal that cross-tab cancellation was skipped (`permission-handler.service.ts:360-361`; `stream-router.service.ts:723-741`).
5. **Unspecified requirement:** D8 does not say how to retain target metadata until the asynchronous pulse consumer runs, even though the handler removes it synchronously (`permission-handler.service.ts:432-439`; `stream-router.service.ts:87-96`).

## Scope and verification

Reviewed the B0/B1 commit hunks, the card and its changed spec at B1, the B0 permission-response path and changed spec, D5/D8, AC 2.1–2.5, the router consumer, the turn-state hard-deny consumer, and stream state publication. Later commits touching the card were excluded. No tests, typechecks, lint, builds, or Git mutations were run, per request. The sampler's tab-switch behavior was reasoned from `compact-session-card.component.ts:213-250`; there is no explicit tab-switch spec in B1, so runtime timing under Angular change detection remains unverified.
