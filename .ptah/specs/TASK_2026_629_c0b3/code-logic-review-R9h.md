# Code Logic Review — R9h (Rail retention cap 4, stable ChatView, dock by tab id)

Review family: Claude (reviewer) vs codex (implementer)

Task: TASK_2026_629_c0b3 | Batch R9h | Decision 79 cross-family review | Decisions 77, 81, 89

## Summary

| Metric              | Value                  |
| ------------------- | ---------------------- |
| Overall score       | 7/10                   |
| Verdict             | APPROVE-WITH-FIXES     |
| Blocking issues     | 0                      |
| Serious issues      | 1                      |
| Moderate issues     | 4                      |
| Minor issues        | 3                      |

Scope read in full: `transcript-retention.service.ts` (and spec), the changed regions of `chat-view.component.ts`
(sessionAgents 543-552, resolvedTabId/resolvedSessionId 770-788, transcriptTabIds 815-841, panelKey 438-445, agent
auto-open effect 1345-1361), `chat-view.component.html` 80-93 and 285-360, `agent-monitor.store.ts` 878-895,
`agent-monitor-panel.component.ts` 636-640, `execution-tree-builder.service.ts` 905-930, the three spec diffs and
`session-context.token.ts`/`index.ts`. I ran two scoped specs through the lock runner (`chat-view.keepalive.spec.ts`:
2 passed; `chat-view.dock.spec.ts`: 22 passed) to read the NG0101 and NG0956 stacks. No other check was run.

No blocking defect found. The refcount is symmetric and the strict/tolerant switch is keyed on the right token. The
problems are test depth (the Rail path through the real `ChatViewComponent` is not exercised), one unannounced
behaviour change for the ordinary main panel (destroy now clears tree caches), and a few edge-case gaps.

## Five logic questions

### 1. How does this fail silently?

- Owner-count drift cannot occur inside one instance: `touch` increments only when the id is not already in
  `_retainedTabIds` (`transcript-retention.service.ts:120-127`), `dispose` decrements only when it was
  (`:137-145`). A double `dispose` is a no-op because of the `includes` guard at `:137`. Destroy, eviction, tab
  close and workspace removal all go through `dispose`, so I found no leak path for a tab that is retained and then
  forgotten.
- A hidden regression of the refcount: a non-retaining surface (an ordinary canvas tile without the token) reads the
  same `tab-${id}` memo (`execution-tree-builder.service.ts:905-918`) but holds no owner. A Rail LRU eviction or a
  main-panel eviction clears the memo under it. Cost is a rebuild, not wrong output. This was already true before
  the batch, but the refcount comment ("tree cache survives while another surface retains the tab") reads as if it
  were solved. See finding M3.
- `dispose` of a tab that this instance never retained no longer calls `clearForTab` (`:137` returns early; the
  old code cleared unconditionally). Close-time cleanup of such a tab now depends on
  `stream-router.service.ts:968` (`clearForClosedTab`), which exists, so no leak in the close path. Not a defect,
  but a silent behaviour change worth knowing (m2).

### 2. What user action produces unexpected behaviour?

- Closing the Rail's contextual tab: `dispose(closed)` removes it from `retainedTabIds`, but `transcriptTabIds`
  re-appends `resolvedTabId()` while `SESSION_CONTEXT` still names the closed id (`chat-view.component.ts:835-838`).
  A transcript for a tab that no longer exists stays mounted until the host moves the context signal. In the main
  panel `activeTabId` moves on close, so this is Rail-specific. The Rail host (R9f) must null or switch the context
  in the same flush. See M4.
- Rapid tab switching in the Rail (A, B, C, D, E): `touch` runs in an effect, so for one frame
  `transcriptTabIds` can render 5 nodes (4 retained + the new active appended), then the effect evicts the LRU. Brief
  and bounded, not a defect.
- The destroy hook now applies to the ordinary main panel (finding M1).

### 3. What input data produces a wrong answer?

- `sessionAgents` for a SESSION_CONTEXT host whose tab has no `claudeSessionId` yet returns `[]`
  (`chat-view.component.ts:545-548`, unchanged). A Rail tab with a running agent whose session id resolves later
  shows no badge and no auto-open until then. This is the intended strict rule of decision 89, but the first
  seconds of a fresh session are the common case for that trigger. The agent is picked up as soon as
  `claudeSessionId` binds because the computed reads `tabs()`.
- An agent whose `parentSessionId` is a stale id from a previous run of the same tab never matches strictly. Same
  rule, same outcome as `compact-session-card.component.ts:231`.

### 4. What happens when a dependency fails?

- `findTabByIdAcrossWorkspaces` returning null for a tab that is merely not yet registered would make
  `disposeUnresolvable` (`:168-174`, called from the effect at `:84`) evict it immediately. Pre-existing behaviour,
  identical for Rail. For the Rail it matters slightly more because the effect touches the context id first and then
  immediately prunes unresolvable ids in the same callback: a context tab that does not resolve in any partition is
  retained, then removed in the same tick, while `transcriptTabIds` still renders it through the active fallback.
  The result is a transcript with no retention slot (rebuilt on the next switch). Harmless but worth a spec.
- `ExecutionTreeBuilderService.clearForTab` throwing would abort `dispose` after the signal was already updated
  (`:138` before `:144`); the owner count was already decremented only in the same function, so a throw leaves the
  retained list and counts consistent. OK.

### 5. What is missing that the requirements never mentioned?

- No test of the destroy hook (`:69-71`) at all, although it is new and the report lists "release on destroy" as
  contract coverage.
- No component-level test that a non-opt-in tile (SESSION_CONTEXT, no Rail token) still renders exactly one
  transcript after the `transcriptTabIds` change (`chat-view.component.ts:826-829`). The branch is correct by
  reading, but nothing pins it.
- No provider for `RAIL_TRANSCRIPT_RETENTION` exists anywhere in `libs` or `apps` (grep: only the token, the two
  injection sites and specs). The opt-in is dead until R9f. Expected for this batch; R9f must provide it above the
  `ChatViewComponent` host.

## Failure modes

### Main panel clears tree caches when destroyed
- Trigger: any ordinary main-panel `ChatViewComponent` is destroyed (route or view swap, test teardown).
- Symptom: its retained tabs' `tab-${id}` memos are cleared although a canvas tile may still render those tabs
  (the builder doc says the entry is shared by main panel and tiles, `execution-tree-builder.service.ts:905-910`).
  Cost is a full rebuild on next render, not wrong output.
- Evidence: `transcript-retention.service.ts:68-71`. The early return at `:68` only exempts contextual non-Rail
  hosts, so the main panel (no SESSION_CONTEXT) registers the destroy hook. The old constructor had no destroy hook.
- Current handling: dispose all retained ids, decrement owners, clear when count reaches zero.
- Recommendation: either gate the destroy release on `this._railRetention` (matches "ordinary main panel unchanged"),
  or keep it for everyone and add a spec stating that this is intended. Releasing the owner count on destroy is
  right; clearing the shared memo for a non-opt-in surface is the questionable part.

### Closed contextual tab remains rendered
- Trigger: user closes the tab the Rail is showing.
- Symptom: a `ptah-chat-transcript` for a dead tab id stays in the `@for` (fallback at
  `chat-view.component.ts:835-838`) until the host updates `SESSION_CONTEXT`.
- Evidence: `transcript-retention.service.ts:91-96` removes it from the retained set; `chat-view.component.ts:835`
  puts it back.
- Current handling: none Rail-specific.
- Recommendation: in Rail mode only append the active id when `findTabByIdAcrossWorkspaces` resolves it, or require
  and test the R9f host contract (context moves in the same flush as close).

### Shared-cache owner is invisible to non-retaining surfaces
- Trigger: Rail or main panel evicts tab X while an ordinary tile renders X.
- Symptom: tile's memo is rebuilt (CPU only).
- Evidence: `transcript-retention.service.ts:139-145`; tiles return early at `:68` and never register.
- Recommendation: accept and document, or have the tile register as an owner in a later batch.

## Blocking issues

None.

## Serious issues

### S1. The Rail path through the real ChatView is untested; the keepalive "Rail host" spec is partly vacuous
- File: `chat-view.keepalive.spec.ts:233-262` (test body), host at `:104-124`.
- Scenario: the test name claims "Rail host retains by SESSION_CONTEXT tab id and per-tab dock state survives a tab
  change". The host is `KeepAliveHostComponent`, a stub that binds only `TranscriptRetentionService.retainedTabIds`
  and `tabManager.activeTabId()`; it is not `ChatViewComponent`. The dock half uses `new DisplayDockState()` created
  inside the test (`:246`), a different instance from any the ChatView would inject, so the `open`/`pinned`/
  `widthPx` assertions test `DisplayDockState` in isolation (and `dock.tab(tabB).open === false` is its default).
  The retention half is real: it fails if the Rail token or the context-following effect is removed, so it is not
  empty, but it only covers the service.
- Impact: the changed ChatView code that R9f depends on is not exercised with the opt-in: `transcriptTabIds`
  with `ctx && railRetention` (`chat-view.component.ts:826-838`), the `[active]` flag following `resolvedTabId()`
  (`html:83`), `panelKey` switching on context change (`:441-445`), and `syncDockWidthPerTab` restoring the width
  on a context change. A regression there passes every named spec.
- Fix: add a `chat-view` level case (dock spec harness already has `contextual` and `contextTabId`) that provides
  `RAIL_TRANSCRIPT_RETENTION: true`, switches `contextTabId` across two tabs, and asserts (a) two
  `ptah-chat-transcript` nodes, the first being the same instance after a round trip, (b) `active` true only on the
  context tab, (c) `store().tab('tab-1').open` / width unchanged after returning, using the ChatView's own injected
  `DisplayDockState`. Add the paired negative: contextual without the token renders exactly one transcript.

## Moderate and minor issues

Moderate

- M1. Destroy hook applies to the ordinary main panel (failure mode above), `transcript-retention.service.ts:68-71`.
  Contradicts "ordinary tile/main-panel behaviour unchanged" in the letter. No spec covers destroy.
- M2. Positive case for strict ownership is missing. The dock mock always returns `[]` for
  `agentsOwnedBySession` (`chat-view.dock.spec.ts:299`), so the Rail case proves only that the component routes to the
  strict accessor. A bug that makes strict always empty (for example inverting the `resolvedSessionId` guard) would
  still pass; the real store filter (`agent-monitor.store.ts:891-894`) is covered only by its own spec. Make the mock
  filter on `parentSessionId === sid` and add one owned running agent that does badge and auto-open.
- M3. Refcount only counts retention services (see failure mode); a non-opt-in tile can lose its memo to a Rail
  eviction. Comment at `transcript-retention.service.ts:131-133` overstates the guarantee.
- M4. Closed contextual tab ghost transcript (failure mode above).

Minor

- m1. `SESSION_CONTEXT`-keyed strictness also reaches the tribunal conductor tile
  (`conductor-tile.component.ts:218` provides `SESSION_CONTEXT`) and `canvas-detail-transcript.component.ts:48`.
  Decision 89 asks for exactly this, and `AgentMonitorPanelComponent` already scopes strictly on the same token
  (`agent-monitor-panel.component.ts:636-640`), so the embedded list now agrees with the panel. Noted only because
  "ordinary tile unchanged" in the contract summary conflicts with decision 89 for those hosts; decision 89 wins.
- m2. `dispose` of a never-retained id no longer clears the memo (`:137`). Safe because
  `stream-router.service.ts:968` clears on close; confirm no other caller relied on the old unconditional clear.
- m3. Rail panel state that is per-instance, not per-tab, survives a context switch: `selectedAgentId` in the
  monitor panel, `actionError`, `dockFocusRequest`. Out of the contract (dock state itself is correctly keyed by
  `panelKey`), but visible once the Rail swaps tabs inside one ChatView.

Formatting (route to style reviewer, not scored): unformatted ternary and long lines in the service/spec diffs,
extra trailing blank lines at EOF in the service, component and dock spec.

## Review focus answers

1. WeakMap refcount: correct and symmetric within an instance (`touch` `:120-127` vs `dispose` `:137-145`); double
   release is a no-op via the `includes` guard; destroy, eviction, close and workspace removal all route through
   `dispose`. Static `owners` is keyed by builder instance, so two retention services sharing the root builder share
   counts and distinct builders do not. Leak risk: none found for retained tabs. Weakness: non-retaining readers hold
   no ownership (M3) and the destroy hook is new for the main panel (M1).
2. LRU/DOM stability: insertion order is kept (`filter` at `:138`, append at `:126`), recency is a separate map, so
   `@for track tabId` never moves live nodes. `evictOverCap(tabId)` skips the touched id (`:156`), and `touch` is
   always called with the active context id, so the active contextual tab is never evicted. The one-frame 5-node
   render is bounded.
3. ChatView 813-841: for hosts without the token, `_railRetention` is `false`, so `ctx && !false` keeps the old
   single-id branch for tiles, and the main panel (no ctx) takes the retained path as before. The only change on that
   path is `this._tabManager.activeTabId()` becoming `this.resolvedTabId()`, which equals `activeTabId()` when ctx is
   null (`:781-784`), so no behaviour change. With the token, the active transcript follows `resolvedTabId()` both in
   the list and in `[active]` (`html:83`); retention follows the same signal through the service effect `:79-81`.
   Both read the token from the same injector chain, so they cannot disagree. One edge: token set without
   SESSION_CONTEXT would give the main panel cap 4 with activeTabId; harmless misuse.
4. `sessionAgents`: keyed on `_sessionContext` only (`:549-551`), `SESSION_CARD_ACTIONS` is not referenced in the
   component's logic. Consumers: `agentBadgeType` (`:556-562`), auto-open effect (`:1345-1360`), dock `[agents]`
   (`html:296`), monitor fallback `[embeddedAgents]` (`html:314`, `:353`). All read the same computed, so the
   strict/tolerant choice applies uniformly. The no-session branch is unchanged. See M2 and m1.
5. NG0101: harness artifact, not a production re-entrancy bug. Evidence: stack ends at `TestBed.tick()` called from
   the spec's `flush()` (`chat-view.keepalive.spec.ts:189`), through `ApplicationRef.tick` ->
   `synchronize` -> `runEffectsInView` -> `NgZone.run` `onLeave` -> `checkStable` -> `onMicrotaskEmpty` ->
   `ApplicationRef.tick` again. The manual `TestBed.tick()` runs outside the Angular zone, so entering the zone for
   effects at nesting 0 emits `onMicrotaskEmpty` mid-tick and the zone-based scheduler ticks recursively. It fires at
   lines 206, 216 and 227, which belong to the pre-existing first test, and also at 246, 252, 257 in the new test
   (8 occurrences total in my run). It is independent of what the effects write, so the changed retention effect
   (which writes only inside `untracked`) is not the cause. In production the tick is already inside the zone.
   Cosmetic fix: call `fixture.detectChanges()` only, or `await fixture.whenStable()`, or run the spec zoneless.
   NG0956: not caused by a changed `@for`. `chat-view.component.html` has no diff; the warning is raised from
   `ChatViewComponent_Conditional_3_Template` (the transcript `@for ... track tabId`, size 1) and fires in the
   existing tab-switch tests (`activeTabId.set` at `chat-view.dock.spec.ts:587-613, 705-711`). The mock
   `findTabByIdAcrossWorkspaces: jest.fn(() => null)` (`:229`) makes `disposeUnresolvable` prune the previous tab on
   every switch, replacing the whole one-element collection. In production the lookup resolves and the tab is kept.
   Mock artifact.
6. Named specs, do they assert what they claim:
   - "Rail host (SESSION_CONTEXT) counts only owned agents ..." (`dock.spec:827-834`): non-vacuous for routing
     (paired with the tolerant case it fails if the accessor is wrong), asserts `sessionAgents()` empty, badge null,
     and `open === false`. Gap: no positive owned case (M2).
   - "single chat view that provides SESSION_CARD_ACTIONS without SESSION_CONTEXT keeps unresolved agents"
     (`:836-843`): real. Provides the card-actions token with `SESSION_CONTEXT: null`, expects 1 agent, badge `info`,
     dock auto-opened.
   - "a fenced ptah-ui display [id] opens ... and updates in place" (`:845-864`): real. Same
     `StubDisplayPanelComponent` instance after a same-key update, one `ptah-display-dock`. It characterises existing
     behaviour (no production change backs it), which is what the contract asked for.
   - "Rail opt-in retains four contextual tabs and evicts the fifth least recently used tab"
     (`retention.spec:253-266`): real. Asserts the exact retained list, the evicted tab's `clearForTab`, and that the
     global active tab is ignored.
   - "Rail host retains by SESSION_CONTEXT tab id and per-tab dock state ..." (`keepalive.spec:233-262`): half real
     (see S1).
   - Also real: shared-cache test (`retention.spec:268-278`) and close/workspace-release test (`:280-296`). Missing:
     destroy release.

## Data flow

1. Rail host provides `RAIL_TRANSCRIPT_RETENTION` and `SESSION_CONTEXT` (provider not yet present; R9f). OK.
2. `ChatViewComponent.providers` creates `TranscriptRetentionService`; constructor reads token and context
   (`:40-52`). OK.
3. Context signal changes: effect `:78-86` touches the context id, prunes unresolvable ids. OK; prune-after-touch edge
   noted in question 4.
4. `touch` registers owner, inserts at end, evicts LRU over cap 4. OK.
5. `transcriptTabIds` (`chat-view.component.ts:824-841`) renders retained plus the active fallback. OK; closed-tab
   ghost (M4).
6. `[active]` follows `resolvedTabId()`, `panelKey` follows `resolvedTabId()`, dock state is per key. OK.
7. Agents: `resolvedSessionId` -> strict `agentsOwnedBySession` -> badge, auto-open, dock. OK.
8. Release: close, workspace removal, eviction, destroy -> `dispose` -> clear memo at last owner. OK; destroy applies
   to the main panel too (M1).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Rail opt-in token, cap 4, default 8 unchanged | COMPLETE | No provider yet (R9f) |
| Retention follows SESSION_CONTEXT for that host | COMPLETE | ChatView level untested (S1) |
| Fifth tab evicts LRU | COMPLETE | |
| Tree cache survives while another surface retains the tab | COMPLETE | Non-retaining readers not counted (M3) |
| Close and workspace release | COMPLETE | Closed contextual tab ghost render (M4) |
| Ordinary tile / main panel unchanged | PARTIAL | Main panel now clears caches on destroy (M1); strict agents reach tile and tribunal per decision 89 |
| `sessionAgents` strict only with SESSION_CONTEXT, never on SESSION_CARD_ACTIONS | COMPLETE | Positive strict case missing (M2) |
| Dock state keyed by tab id | COMPLETE | Not exercised through the real ChatView (S1) |
| Never `HIDE_AGENT_SIDEBAR: true`; display dock protected (77) | COMPLETE | No provider added |
| No extra live ChatView | COMPLETE | One view, up to four retained transcript nodes |
| Named dock case (display opens and updates in place) | COMPLETE | |
| Remove `compactHeightUnits` comment | COMPLETE | |

Implicit requirements not addressed: destroy-path test; ChatView-level Rail test; documented provider contract for R9f
(token above ChatView; context moves with tab close).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Double release of a tab | YES | `includes` guard `:137` | none |
| Same tab retained by two services | YES | static WeakMap count | tile readers not counted |
| Fifth tab in Rail | YES | LRU, active protected | none |
| Re-touch an existing tab | YES | recency only, order kept | none |
| Context null | YES | no touch | none |
| Context tab closed | PARTIAL | disposed from set | re-rendered via fallback (M4) |
| `/clear` reset close | YES | `kind === 'reset'` skipped | none |
| Workspace removed | YES | effect `:103-109` | none |
| Destroy with retained tabs | PARTIAL | releases all | changes main panel, untested (M1) |
| Token without SESSION_CONTEXT | PARTIAL | cap 4 on activeTabId | misuse only |
| Tab without `claudeSessionId` | YES | strict returns `[]` | intended |

## Verdict

- Recommendation: APPROVE-WITH-FIXES
- Confidence: HIGH on the service and sessionAgents logic (read in full, specs run); MEDIUM on Rail runtime
  behaviour, which no provider exercises yet.
- Top risk: the real `ChatViewComponent` Rail path (`transcriptTabIds`, `[active]`, `panelKey`) has no test with the
  opt-in, so R9f can build on unverified wiring.
- What a robust implementation would add:
  1. A ChatView-level Rail spec (two contexts, same transcript instance on return, `active` only on the context tab,
     per-tab dock state read through the ChatView's own `DisplayDockState`) plus a no-token contextual case that pins
     one transcript.
  2. Gate the destroy-time memo clear on the Rail opt-in, or state it as intended and test it.
  3. A destroy-release spec and a double-dispose spec for the refcount.
  4. A store-faithful mock for `agentsOwnedBySession` and one owned running agent in the strict case.
  5. In Rail mode, do not re-append an unresolvable context id in `transcriptTabIds`.
  6. Replace `TestBed.tick()` plus `detectChanges()` in the keepalive `flush` with a pattern that does not trigger
     NG0101, and give the dock harness a `findTabByIdAcrossWorkspaces` that resolves, to silence NG0956.
