# Code Logic Review - Batch R9u (TASK_2026_629_c0b3)

Reviewer: Claude code-logic-reviewer. Implementer: codex lane. State: uncommitted, 7 chat files.
Scope read in full: `rail-transcript-retention-coordinator.service.ts` (+spec), `transcript-retention.service.ts` (+spec diff),
`chat-view.component.ts` (isOverlay, dock, retention wiring, transcriptTabIds), `chat-view.keepalive.spec.ts` diff, `chat/src/index.ts` diff,
`canvas-detail-transcript.component.ts:45-75` (how the Rail provides tokens), lane report, contract, decisions 77/82/85/86/89.
Verification run by me (one at a time, scoped, through the lock): coordinator spec 3/3 pass, `transcript-retention.service.spec.ts` 19/19 pass,
`chat-view.keepalive.spec.ts` 6/6 pass (log shows `NG0101 ApplicationRef.tick is called recursively` console errors; I could not tell whether they
pre-exist, because I may not change git state to compare).
Not run: the file that holds R9h's decision-89 dock cases (not identified in this batch's file list), typecheck, lint, FULL(chat).

## Verdict

**APPROVE-WITH-FIXES. Score 6/10. Confidence MEDIUM.**

The coordinator state machine is sound: one owner per tab id, transfer releases the old subtree before the new owner retains and preserves the
cache, the cache clears only at the last owner, pins are read from each host's live signal, and the non-coordinator path is the R9h path. The
width formula matches the contract and decision 82. The score is held at 6 because three of the four keepalive named cases are proven only on a
pure helper, one named case is vacuous, and the transfer order is only proven on service state, not on the DOM, where it depends on tree order.
Bands: 7-8 would need the component wiring and the DOM-level single-subtree invariant exercised; below 5 would need a wrong ownership model,
and none is found.

| Blocking | Serious | Moderate | Minor |
| --- | --- | --- | --- |
| 0 | 2 | 3 | 3 |

## Named-case table

| Named case | Status | Evidence / can it fail? |
| --- | --- | --- |
| coordinator: tab retained in A then shown in B gives exactly one subtree | PRESENT (service state only) | spec:53-64. Dropping `releaseForTransfer` (coordinator:27-30) fails `a.retainedTabIds() not.toContain('X')`. Counts ids, not Angular subtrees (see S2). |
| coordinator: count <= 4 counts distinct tab trees | PRESENT, merged into the next case | spec:66-73. Summed entries would differ only in the transfer case (spec:62 expects 1), so distinctness is proven there; here every id is single-owner. |
| fifth distinct tab evicts the LRU frozen tree, never a pinned visible tab | PRESENT | spec:72-76. A is the oldest tick and pinned, C is evicted; removing the pin check (coordinator:58) fails. B's pin is not independently tested (B has a newer tick). |
| close and workspace release | PRESENT, weak on workspace | spec:84-95. Close path via listener is real. The workspace step is not isolated: the first `tick()` also runs the activeTabId effect whose `disposeUnresolvable` backstop (service:93-94) disposes Z, so deleting the removed-workspace effect (service:113-119) leaves it green. |
| cache cleared only at last owner, not on transfer | PRESENT (merged with the above) | spec:82-85: no clear after A->B transfer, clear after B disposes. Both halves asserted. |
| board destroy / host destroy / split collapse release owners (contract prose) | MISSING | `coordinator.releaseHost(a)` is called directly (spec:92); the `DestroyRef.onDestroy` wiring at service:76-81 and coordinator:15-19 is never exercised. |
| no coordinator -> unchanged behaviour | PRESENT | `transcript-retention.service.spec.ts:280-285`; fails if the Rail cap of 4 or the cache clear is lost. Largely overlaps older Rail cap specs. |
| keepalive: 804 px side / 644 px overlay with 360 min | PRESENT on helper only | keepalive.spec:261-264 calls `shouldOverlayDock(…, 400, 360, …)`, not the component. See S1. |
| keepalive: 976 side (1280 stacked) / 648 overlay (920 stacked) | PRESENT on helper only | keepalive.spec:266-269. "Stacked" is just a label; nothing differs between the cases. |
| keepalive: token absent -> old breakpoint | PRESENT on helper only | keepalive.spec:271-275. `expect(RAIL_MIN_CONTENT_WIDTH).toBeDefined()` is trivial. The optional-inject default (chat-view.component.ts:276) is untested. |
| "Rail ChatView with coordinator keeps the display dock mounted (HIDE_AGENT_SIDEBAR not provided)" | **VACUOUS** | keepalive.spec:277-280 asserts `RailTranscriptRetentionCoordinator` is defined and `shouldOverlayDock(804,400,360,true)` is false. It mounts nothing and cannot fail if `HIDE_AGENT_SIDEBAR: true` is provided or the dock branch is deleted. |
| R9h decision-89 dock cases stay green | NOT VERIFIED by me | Not in the specs I ran; the lane claims green. |

## Findings

### Serious

**S1. The named dock case is vacuous and the token wiring is not tested anywhere.**
- Files: `chat-view.keepalive.spec.ts:261-280`; `chat-view.component.ts:276,442-449`.
- Scenario: someone changes `this.railMinContentWidth?.() ?? null` to `null`, drops the `inject`, or a board provides `HIDE_AGENT_SIDEBAR: true`.
  All four new cases stay green because they exercise only the pure helper with a hand-fed 400.
- Impact: the contract's N6(a)/decision 77d guard (dock never hidden) and decision 82 (per-pane width) have no regression protection at the
  component level. The batch's own `Mode 2` gate cannot catch the defect it was written to prevent.
- Fix: reuse the harness of the first describe in the same file: mount a ChatView with `SESSION_CONTEXT`, `RAIL_TRANSCRIPT_RETENTION`, the
  coordinator and `RAIL_MIN_CONTENT_WIDTH = signal(360)`, drive `hostWidth` (stub `ResizeObserver` or `clientWidth`), and assert the dock region
  renders (no `HIDE_AGENT_SIDEBAR` provided) and that `isOverlay` flips at 760/759 px with the default 400 dock. Add a no-token mount at 644 px
  asserting side column.

**S2. "A disposes before B acquires" holds in service state but not provably in the DOM; it depends on pane tree order.**
- Files: `rail-transcript-retention-coordinator.service.ts:25-31`; `transcript-retention.service.ts:88-96`;
  `chat-view.component.ts:849-870` (`transcriptTabIds` appends the active tab when it is not retained).
- Scenario: the release of X from pane A runs inside B's activeTabId effect (touch -> coordinator.touch -> `previous.releaseForTransfer`).
  Meanwhile B's template already renders its active tab X through the append at `chat-view.component.ts:864-868`, independent of the effect.
  View effects run just before the owning component's template refresh. If A precedes B in the tree and was already refreshed in that pass, A
  still renders its frozen X when B creates X; A drops it only on the re-run. For a transfer in the other direction the order is reversed.
  So two `ptah-chat-transcript` X subtrees can coexist within one tick, in one direction of transfer only. The lane report itself says
  "DOM timing unverified"; the spec cannot see it.
- Impact: duplicated construction of a heavy transcript, and tab-keyed state read by two live instances for a moment; a direct breach of
  the contract line "never two X subtrees" and of the R9w s-switch "fail on duplicate per tab id" check, which will surface it late.
- Fix: make the exclusion reactive instead of effect-ordered. Expose from the coordinator a per-host computed (or a `liveElsewhere(host)`
  predicate over the registered active signals) and have `transcriptTabIds` filter out any retained id that is the other host's current
  active tab. Add a two-ChatView test (shared coordinator, swap active) asserting one X subtree after every `detectChanges`, in both transfer
  directions.

### Moderate

**M1. The dock can be dragged or keyed into the overlay state, which removes its own separator.**
- Files: `chat-view.component.ts:476-488` (`dockWidth` clamps to 75% of host, not to host minus the minimum content), `:442-449`,
  `chat-view.component.html:267,336` (separator only when `panelOpen() && !isOverlay()`).
- Scenario: Rail pane 804 px with the 360 minimum; the side dock is allowed up to 444 px but the clamp allows 603. Dragging, `ArrowLeft`
  presses, or `End` (`:616-640`, Infinity) beyond 444 flips `isOverlay` true mid-gesture: the dock becomes a full-surface overlay, the focused
  separator leaves the DOM, and the user cannot shrink it back (Enter reset is on the same separator) without widening the pane.
- Impact: a surprising mode switch caused by the user's own resize on the path decision 82 protects.
- Fix: when the token is non-null, cap `dockMaxWidth` at `hostWidth - token` (keeping the 300 px floor), so width never reaches the flip point
  by user action. Add a spec for `End` at 804 px staying in side mode.

**M2. Destroy wiring of the coordinator is untested.** `transcript-retention.service.ts:76-81` and `coordinator:15-19`. The contract lists host
destroy and board destroy as release triggers; a regression that forgets `releaseHost` leaks a static `owners` count in
`TranscriptRetentionService.owners` (service:46-49) and so keeps the tree cache alive after the board is gone (and blocks the later last-owner clear).
Add a test that destroys the host injector and the coordinator injector and asserts `clearForTab` for every owned tab and `distinctRetainedCount() === 0`.

**M3. One test carries three named cases, and the workspace-removal step is not isolated** (spec:79-96; see table). A failure points at no case,
and the workspace branch is protected only by an unrelated effect. Split it and assert the workspace case with a tab not otherwise touched by
the first effect run.

### Minor

- `rail-transcript-retention-coordinator.service.ts:21-23` / `transcript-retention.service.ts:73-75`: a Rail host with the coordinator but without
  `SESSION_CONTEXT` is never registered, so it is never pinned and the active tab can be an eviction victim. Unreachable with today's
  `canvas-detail-transcript` providers (`:49-61` always provide both), but a silent trap; register unconditionally or throw.
- `coordinator:62`: `victim === null` returns with more than four owners. Only possible with more than two registered hosts; fine for R9w,
  but the cap is not a hard guarantee, and nothing tells the caller. Document it or log.
- Coordinator does not defend the invariant it relies on: if both panes show tab X (R9w must prevent this), `touch` silently steals the retained
  slot and both panes still render X via the append at `chat-view.component.ts:864-868`. Assert in dev mode.

## Five logic questions

1. **Silent failure.** The vacuous dock case (S1) reports green while proving nothing. Eviction with every candidate pinned returns silently with
   more than four owners (coordinator:62).
2. **Unexpected user action.** Resizing the dock past the pane's content minimum flips it to overlay and removes the separator (M1). Opening a
   tab beside that is currently frozen in the other pane exercises the transfer path (S2).
3. **Wrong answer on input.** `hostWidth === 0` or unmeasured returns `panelOpen` regardless of the token (`chat-view.component.ts:114`): same
   as the old behaviour, correct. A null/absent token gives exactly the 600 px rule (`:115-116`). A non-finite token value would make the
   comparison false and degrade to the old rule; not a hazard. `dockWidth()` is evaluated even when the token is null (extra recompute only).
4. **Dependency failure.** `clearForTab` is called through the shared `ExecutionTreeBuilderService` only at the last owner; a coordinator
   destroyed before its hosts is handled (`releaseHost` is idempotent). `ResizeObserver` absent seeds `window.innerWidth` (existing), which
   skews the per-pane decision but only toward the old column behaviour.
5. **Missing though unstated.** DOM-level single-subtree proof, destroy-path tests, a mounted dock test, and a dev-mode guard for duplicate
   active ids across panes.

## Contract checks that held

- Ownership: one `owners` map by tab id across hosts; `distinctRetainedCount = owners.size` (`coordinator:11-12,34,43`), a signal.
- Transfer: `releaseForTransfer` (preserveCache) strictly before `retainFromCoordinator` (`coordinator:27-31`); static owner count goes
  1 -> 0 -> 1 with no clear (`service:166-172`). No release on transfer means no cache clear (spec:83 asserts it).
- Insertion order stable: `retainFromCoordinator` appends only when absent (`service:137-148`).
- Pins: active signal of each registered host (`coordinator:58`); recency tie broken by monotonic clock.
- No coordinator: `_coordinator` is null unless the Rail flag is true and a coordinator is provided (`service:43-45`), so tiles, the main
  panel and a single view keep R9h behaviour (`service:127-133`, `evictOverCap` untouched).
- Token semantics: `shouldOverlayDock` (`chat-view.component.ts:108-117`) is the contract formula; the boundary is 760 px with the 400 px
  default dock (`760-400 = 360`, not `< 360`), consistent with 804 side / 644 overlay and 976 / 648.
- `HIDE_AGENT_SIDEBAR` is not provided anywhere; the coordinator imports nothing from canvas; `index.ts` exports only the two new symbols; no
  capability removed; the HTML is unchanged and the dock branch (`html:250`) is intact.

## Recommended fixes before commit

1. S1: replace the vacuous case with a mounted-ChatView test and add a component-level token test (writer lane, same files).
2. S2: reactive "live in other pane" filter plus a two-ChatView DOM test, or record it as a hard R9w e2e gate with the measure named.
3. M1/M2/M3 can ride with the same fix round; M1 touches only `chat-view.component.ts` and its spec.
