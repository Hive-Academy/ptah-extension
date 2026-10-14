# Code Logic Re-Review - Fix D (codex writer), C-dedupe follow-up

Scope: findings 1, 3, 4, 5 of `code-logic-review-agents-dedupe.md`. Finding 2 (deferred, row 116) and
`agent-monitor.store.ts` (row 117) are out of scope. Read-only; no code edited. I read every file in the focus list in
full (workflow card + new spec, detail service + spec, detail transcript + spec, display-dock imports, chat-view
JSDoc and effects) plus the consumers of `CanvasDetailService.open` and the lane tab / lane view ownership rules.
I did not re-run the specs; the writer's four green runs are in `lane-fix-d-report.md`, and I judged non-vacuity by
reading (below).

## Summary

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Verdict | APPROVE (with the two Moderate follow-ups below, neither blocks the commit) |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 2 |
| Minor | 4 |

Finding 1, 4 and 5 are closed. Finding 3 is closed for the reported case (a rejected click now tells the user and does
not move focus or lane), but the announcement mechanism is weaker than it looks and the new ownership check is not
pinned by a test.

## Focus 1 - Finding 1 (Workflow chip): CLOSED

- `workflow-card.component.ts:79` captures `inject(VSCodeService).isElectron`. `VSCodeService.isElectron` is a plain
  boolean getter (`core/.../vscode.service.ts:172`), so the `@if (isElectron)` / `@if (!isElectron)` checks at `:53,59`
  are real booleans, not an always-truthy signal function.
- The discriminator is the same one that creates the dock store (`chat-view.component.ts:260-262`,
  `dockEnabled = displayDock !== null` at `:450`). So "no button" and "ChatView ignores `panelOpenRequest`
  (`:1351`)" flip together: there is no host where the button renders but the request is dropped.
- Electron: no button, so `requestPanelOpen` is unreachable (spec `workflow-card.component.spec.ts:32-37` asserts both;
  it fails on HEAD, where the button exists). VS Code: button remains, calls `requestPanelOpen('tab-1')` through
  `sessionContext` (`:116`; spec `:39-43`). Accessible text: the misleading `title` is gone with the button in
  Electron; the static line is plain text, no role. OK.
- JSDoc `:20-25` now says the request is VS Code only.

## Focus 2 - Finding 3 (`CanvasDetailService.open` ownership check)

### False negatives (valid lane rejected)

I traced every lane source against `canvas-lane-tabs.component.ts:98-170`; the service's rule is the same rule.

| Case | Result |
| --- | --- |
| `sub:x` for a record with `status !== 'background'` | accepted (`canvas-detail.service.ts:51-53`, kind `subagent` matches any status) |
| `sub:x` for a record whose status is `background` | accepted; lane tabs map `sub:`->`bg:` (`:168`) so it selects. Consistent |
| `bg:x` from monitor record with status `background` | accepted (`:53`) |
| `bg:x` from `BackgroundAgentStore` only (no monitor record) | accepted (`:57-58`), matches lane tab group `:151-159` |
| `bg:x` whose record flipped to completed before the click | rejected; lane tabs would also drop it (no `bg:`->`sub:` mapping). Consistent |
| `cli:id` | accepted via `monitor.agents()` `parentSessionId` (`:55-56`), same list and rule as tabs `:105-109` and needs-you `canvas-needs-you-queue.ts:90-94` |
| Non-active split pane tile | `tiles()` check then `findTabByIdAcrossWorkspaces(tabId)` (tab-keyed, not active-pane-keyed); accepted, then `focusTile` swaps panes. OK |
| Tile rendered from the execution tree but its `SubagentRecord` not registered yet / restored history | rejected. Before Fix D this was focus + silent reset to Orchestrator (`canvas-lane-tabs.component.ts:173-175`), so no valid lane is lost: the lane view cannot render without the record (`canvas-lane-view.component.ts:204-236`). The one behavioural delta is that the tile is no longer focused; acceptable, matches the review's recommendation |

The session id comes from `tab.claudeSessionId`, which is the same value the focus area passes to lane tabs and lane
view (`canvas-focus-area.component.ts:59,69`). A tab with no session id yet rejects every non-orchestrator lane;
the lane tabs would too.

Injection safety: `AgentMonitorStore` and `BackgroundAgentStore` are `providedIn: 'root'`
(`agent-monitor.store.ts:657`, `background-agent.store.ts:71`), and `TabManagerService` was already injected. The
service is only provided by the canvas host and every consumer injects it `optional` or sits under the canvas, so
no host (Tribunal conductor, single chat) can throw on the new injections. Boundaries: `parseLaneKey` comes from
the `@ptah-extension/chat` barrel (`chat/src/index.ts:36`), the stores from the `@ptah-extension/chat-streaming`
barrel (`chat-streaming/src/index.ts:46`); `canvas-lane-tabs.component.ts:16-20` already imports the same barrels. No
deep import, no new lib edge.

### Live region

See finding M1.

## Focus 3 - Finding 4 (vacuous assertions) and new specs: CLOSED

- The `ptah-display-dock` null checks are gone from `canvas-detail-transcript.component.spec.ts` and
  `chat-transcript.component.spec.ts` (the latter has no diff against HEAD and no `display-dock` text, so no residue).
  The remaining `display-dock` hit (`canvas-detail-transcript.component.spec.ts:144`) is a positive
  `toHaveLength(1)` assertion that follows a real surface push, so it can fail.
- `canvas-detail.service.spec.ts:64-70` ("rejects an unknown lane") fails on HEAD: `open` returned `void`, and it
  set the lane. Not vacuous.
- `canvas-detail-transcript.component.spec.ts:124-127` fails on HEAD (no notice element). Not vacuous. Caveat: it uses
  `querySelector('[role="status"]')`, i.e. the first match in DOM order; it passes today only because ChatView renders
  none before the host's own span (`canvas-detail-transcript.component.ts:40`). Fragile, see Minor m3.
- Gap: see M2.

## Focus 4 - Finding 5 (cleanup): CLOSED

`display-dock.component.ts:1-31` imports are all used (I grepped each symbol; every one has at least one use beyond
its import). The JSDoc at `chat-view.component.ts:~1057` reads correctly.

## Findings

### M1 (Moderate) - The "not available yet" announcement is one-shot and sticky

- File: `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts:75-78`, template `:40`.
- Scenario A (silent repeat): the user clicks an unavailable sub-agent tile, hears "This agent is not available
  yet.", clicks again (or clicks a different unavailable tile). `agentNotice.set(<same string>)` is a no-op on a
  signal, so the DOM text never changes and the polite live region says nothing the second time. The user gets exactly
  the silent dead click this fix set out to remove, only on retry, and retrying is the natural reaction.
- Scenario B (stale): the notice is cleared only by a later successful `openLane`. `openSession` (`:79`) does not clear
  it, and nothing clears it on blur, timeout or when the agent later registers. The sr-only text stays in the
  accessibility tree ("not available yet" while the agent is now available) until some lane click succeeds.
- Impact: assistive-technology users only; sighted users see no feedback at all in either case (the span is `sr-only`).
  The sighted case is the same silent no-op as before, just with focus preserved. The review (finding 3) asked for
  "announce through the existing live region"; for sighted users there is no visible message anywhere.
- Fix: make each rejection a distinct event, e.g. keep a counter and append a zero-width toggle or clear then set on
  `queueMicrotask`/`afterNextRender`, and clear `agentNotice` in `openSession` plus on a short timer
  (about 4 s). If sighted feedback is wanted, render the same signal as a small visible toast/inline line and keep the
  `sr-only` variant only for AT. Add a spec: two consecutive rejected clicks produce two live-region updates, and the
  text is empty after `openSession`.

### M2 (Moderate) - The new session-ownership check is untested

- File: `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.spec.ts:15-18,64-70`.
- Scenario: every mocked subagent and agent has `parentSessionId: 'session'`, which is also the mocked tab's session
  (`:37`). The only rejection test uses an id that does not exist at all. Deleting `agent.parentSessionId ===
  sessionId` (`canvas-detail.service.ts:52,56`) or the `agent.sessionId === sessionId` background check (`:58`) leaves
  all six tests green. The `bg:` branches (monitor `status === 'background'`, `BackgroundAgentStore`) have no test
  either (`BackgroundAgentStore` is mocked with an empty list, `:40`).
- Impact: this is the behaviour that stops a click from focusing another session's lane (the reason for Moderate 3's
  "session ownership" wording); a regression would not be caught.
- Fix: add cases: (1) record with `parentSessionId: 'other'` -> `open(...)` is `false`, focus not called; (2) `bg:` key
  with a monitor record `status: 'background'` -> `true`, and with `status: 'running'` -> `false`; (3) `bg:` key
  present only in `BackgroundAgentStore.agents()` with matching `sessionId` -> `true`, mismatched -> `false`;
  (4) tab with `claudeSessionId` null -> `false`.

### Minor

- m1. `workflow-card.component.ts:55`: "Its agents appear as lanes of this session." is true only in the Rail (lane
  tabs, `canvas-lane-tabs.component.ts:117-130`). In Electron single chat and the Tribunal conductor there are no lane
  tabs (finding 2 remains deferred), so the sentence points at a surface that does not exist there. This was the
  review's own suggested wording; acceptable until the tile follow-up, but record it next to row 116 so it is revisited
  with finding 2.
- m2. Callers that ignore the new boolean: `canvas-rail-card.component.ts:273` and
  `canvas-needs-you-queue.component.ts:238`. Their rows come from the same stores and the same ownership rule
  (`canvas-needs-you-queue.ts:90-94`; strict `buildLaneSummary`), so rejection needs a store change between render and
  click and is rare. When it does happen the click is a silent no-op, and previously it still focused the tile.
  Cheap fallback: when `open` returns `false` for a known tile, call `canvasStore.focusTile(tabId)` at those two sites.
- m3. `canvas-detail-transcript.component.spec.ts:126`: the first-match `querySelector('[role="status"]')` is order
  dependent. Query `.sr-only[role="status"]` or add a `data-testid` on the span.
- m4. The word "yet" in the notice is wrong for restored history, where the record will never register
  (`canvas-detail-transcript.component.ts:77`). "This agent is not available in this view." would be accurate in both
  cases and would also match the single chat wording (`chat-transcript.component.ts:776`).

Style only (route to code-style-reviewer, not scored): the new `@if (!isElectron)` block in `workflow-card.component.ts`
is not indented like its siblings, the new spec has long one-line objects, and the nested ternary in
`canvas-detail.service.ts:51-58` is hard to read. Prettier in lint-staged will fix the first two.

## Five logic questions (Fix D only)

1. Silent failure: a repeated rejected click is silent (M1-A); `canvas-rail-card`/needs-you ignore a `false` result
   (m2).
2. Unexpected user action: clicking a tile in a non-active split pane whose record is not registered no longer focuses
   that pane. Intended, per the review.
3. Wrong answer: none found; the ownership rule equals the lane tab / lane view rule for all three lane kinds.
4. Dependency failure: stores are root-provided; no new throw path. A store that is empty (history restore) yields the
   rejection notice rather than a wrong lane.
5. Missing: tests for the ownership branches (M2); visible feedback for sighted users (M1).

## Verdict

- Score 7/10: findings 1, 4, 5 closed cleanly with spec evidence; finding 3 closed for the main case with a correct
  validation rule and no boundary or injection regressions. It stops short of 8 because the announcement mechanism
  does not repeat and goes stale (M1), and the main new rule has no test that would catch its removal (M2).
- Recommendation: APPROVE. Fold M1 and M2 into the next fix round; neither blocks the commit.
- Confidence: HIGH on findings 1, 4, 5 and on the false-negative analysis; MEDIUM on M1's AT behaviour (reasoned from
  signal equality and live-region semantics, not exercised with a screen reader).
