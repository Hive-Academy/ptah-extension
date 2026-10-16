# Code Logic Review — `TASK_2026_681_738f`

Review family: implementer codex, reviewer Claude.
Scope: uncommitted diff in the worktree `clean-session-followups` (base `main` @ 851846797) plus the new
`session-task-reader.spec.ts`. Whole files read: `stats-tile-expansion.state.ts`, `session-task-reader.ts`,
`canvas-rail-board.component.ts` (relevant regions), `message-bubble.component.{html,ts,spec.ts}`,
`session-inspector.store.ts`, `chat-view.component.html` and the question-card code in `chat-view.component.ts`.
No nx check was run, as instructed. Angular facts were verified in `node_modules/@angular/core` 22.1.7.

## Summary

| Metric              | Value        |
| ------------------- | ------------ |
| Overall score       | 5/10         |
| Assessment          | NEEDS_FIXES  |
| Blocking issues     | 1            |
| Serious issues      | 1            |
| Moderate issues     | 3            |
| Failure modes found | 4            |

Score reasoning: 7 of 10 items are sound. Items 1, 3, 5, 6, 7 and 10 are correct and their regression specs are
meaningful. The score is held to 5 because item 4 introduces a runtime crash on the most common path (a new
session receiving its ID while the inspector stats are shown). Item 9 also breaks three existing specs and adds a
first-open gap. Both are defects the author's tests could not see. Above 5 would need both fixed. Below 5 would
need a second crash class.

## Verdicts on the seven focus points

| # | Focus | Verdict |
| - | ----- | ------- |
| 1 | Item 4 `sessionKey` signal write during template evaluation | DEFECT (Blocking), minimal fix below |
| 2 | Item 1 task-reader key and in-flight/dirty flow | CORRECT |
| 3 | Item 6 `modelFor(id)().needsYouCount` | CORRECT, one minor lifetime note |
| 4 | Item 7 `currentTarget` and `isTabbable` | CORRECT, two minor hardening notes |
| 5 | Item 9 `@defer` | REGRESSION in existing specs (Serious) plus a small UX gap (Moderate) |
| 6 | Item 3 token type | CORRECT (no in-repo providers) |
| 7 | Regression specs | Items 1, 6, 7 fail on old code. Item 2 pins current behaviour only. Item 4 specs miss the defect. |

Item 2 reclassification (decisions row 10): CONFIRMED. `chat-view.component.html:96-117` closes
`ptah-chat-transcript` (inside the `@for` over `transcriptTabIds()`) before the banners.
`ptah-question-card` is rendered at `:193`, inside `@for (questionReq of resolvedQuestionRequests())`, as a
sibling of the transcript. The only other places that use the tag are `harness-builder` and `mcp-apps-page`,
which are unrelated. So the transcript render window cannot unmount the card, and there is no behaviour change.
The real absent-card cases are `resolvedQuestionRequests()` returning `[]` (main panel in grid layout, or not
the active tile, `chat-view.component.ts:1352-1364`). Those are handled by the existing 1 s wait plus
`reportAnswerMiss`. The three new specs (`chat-view.component.spec.ts:624-675`) pass on old code. They are
characterization specs, not regression specs, which is acceptable given the reclassification.

## Five logic questions

### 1. How does this fail silently?

- `session-task-reader.ts:303-316`: `setError` keeps held data only for the same key, so a different-root error
  shows an error with no data. This is correct and not silent.
- Item 4's failure is loud, not silent: a thrown NG0600 on every change-detection pass (Failure mode 1).
- `canvas-rail-board.component.ts:335-340`: if the focused tab has no inspector model yet, `modelFor` creates one
  lazily. A closed tab yields `current === null` first (`stats.inputs()` is null without a tab), so `modelFor`
  is never reached for a closed tab and no model is re-created after `forget`. No silent wrong value.

### 2. What user action produces unexpected behaviour?

- Starting a new chat (session ID null) with the inspector or stats open, then sending the first message so the ID
  arrives: the stats section throws NG0600 (Failure mode 1).
- Clicking "Show activity" on a settled turn: the panel is now absent for at least one microtask plus the chunk
  load, while `aria-expanded="true"` and `aria-controls` point at an id that does not exist yet
  (`message-bubble.component.html:132-143`).
- Clicking blank space inside the compact sheet focuses the `tabindex="-1"` sheet itself. Shift+Tab then
  satisfies neither wrap branch (`canvas-rail-board.component.ts:748-754`) and can leave the sheet. This also
  existed before the diff, and `inert` on the background pane container (`:157`) limits the reach. Minor.

### 3. What input data produces a wrong answer?

- `sameLink` now normalizes the root (`session-task-reader.ts:60-70`). A root that differs only by slash style or
  drive-letter case is treated as the same link, and the retained link object keeps the old spelling. That is
  fine, because `openDocument` uses the raw root and both spellings resolve to the same folder.
- Task ID reuse across roots (the item 1 case) is now keyed correctly (`linkKey`, `:73-75`).
- No other wrong-answer input found.

### 4. What happens when a dependency fails?

- `tasks:get` rejection or `success:false`: `setError(key, ...)` only if `isCurrent(key)` (`:273-295`). A failed
  read for a superseded key is dropped and the dirty re-read fetches the current one. OK.
- The chunk load for the activity panel fails (offline, VS Code webview resource error): the `@defer` has no
  `@error` block, so the toggle opens nothing and gives no feedback. The webview serves local assets, so the
  likelihood is low. Moderate/minor.

### 5. What is missing that the requirements never mentioned?

- A component-level (rendered) test for item 4. The state spec runs outside any reactive context, which is
  exactly why it passes while the template path throws.
- Updating the three existing `message-bubble` specs for the now-asynchronous panel.
- A way to verify item 8. `canvas-tile` was added, but the e2e scenes also depend on `.tile-header span` and
  `[title="Close tile"]` inside the tile, and neither string exists in `libs/frontend/{canvas,chat}` any more.

## Failure modes

### 1. NG0600: signal write inside template evaluation (item 4)

- Trigger: a host component (`InspectorSessionStatsComponent`, `InspectorLimitsLanesComponent`,
  `SessionStatsSummaryComponent`) first renders with `sessionId === null`, then receives a real ID. The template
  calls `isOpen(...)` (`inspector-session-stats.component.ts:63,79,107,119-127,150-154`;
  `inspector-limits-lanes.component.ts:41,63`), which calls `expansion.sessionKey(this, id)`.
- Symptom: `sessionKey` enters the migration branch (`stats-tile-expansion.state.ts:40-51`) and calls
  `this.open.update(...)` unconditionally, even when there is nothing to migrate. `signalUpdateFn` checks
  `producerUpdatesAllowed()` before it runs the updater (`@angular/core/.../_effect-chunk.mjs:367-372`), and
  `producerUpdatesAllowed` is `activeConsumer?.consumerAllowSignalWrites !== false` (`:124-126`). During template
  execution the active consumer is the template consumer or the temporary consumer. Both spread `REACTIVE_NODE`,
  where `consumerAllowSignalWrites` is `false` (`_debug_node-chunk.mjs:5918-5928,5934-5946`;
  `_effect-chunk.mjs:35`). So the write throws NG0600 in dev and prod. The throw happens before
  `this.hosts.set(...)` (`:52`), so the host record is never updated and every later change-detection pass throws
  again. The stats section of a new session stays broken.
- Evidence: `stats-tile-expansion.state.ts:30-52`. The new specs (`stats-tile-expansion.state.spec.ts:59-91`) call
  the state directly outside a reactive context, so they cannot see it. No spec renders a host through
  `null -> 'id'`.
- Current handling: none. The "first read is `toggle`, not `isOpen`" case is fine in itself, because an event
  handler is outside any consumer and the migration runs there. In practice a re-render has already hit the
  template path first.
- Recommendation: keep `sessionKey` free of signal writes during reads. Minimal change: keep
  `this.hosts.set(host, { sessionId, key })` synchronous, but wrap the migration in
  `queueMicrotask(() => this.open.update(...))`. The microtask runs before paint, and the next change-detection
  pass shows the migrated tiles. `untracked(() => this.open.update(...))` would remove NG0600 but can still raise
  NG0100 in dev mode when a binding evaluated earlier in the same pass flips, so prefer the microtask. Alternative
  with no deferral: record `realKey -> pendingKey` in a plain `Map` inside `sessionKey` and make `isOpen` also
  test the pending key. Perform the actual rename inside `setOpen` and `toggle` (event context). Whichever is
  chosen, add a rendered spec that sets `sessionId` from `null` to `'s1'` with a tile open and asserts no error
  and the tile still open.

### 2. Existing `message-bubble` specs depend on a synchronous panel (item 9)

- Trigger: `@defer (when activityOpen())` has no placeholder. Dependency loading is always asynchronous: with
  no resolver the framework still uses `Promise.resolve().then(...)`, and with one it uses
  `Promise.allSettled(dependenciesFn())` (`_debug_node-chunk.mjs:13250-13274`). The main block renders only
  after that resolves.
- Symptom: `message-bubble.component.spec.ts` ("keeps tokens and cost in the activity panel", ~lines 170-193;
  "omits the cost item...", ~196-211; "renders a genuinely known zero cost...", ~213-228) click the button, run
  `fixture.detectChanges()` and read `activityPanel()` synchronously. They are plain `it(() => ...)` with no
  `await` or `getDeferBlocks()`. They will see `null` and fail (for example `panel?.id` is `undefined` against the
  `aria-controls` value). That spec file is not in the diff.
- Current handling: the batch report (A1) says only that production size is measured by the orchestrator.
- Recommendation: update the three specs to `await fixture.whenStable()` plus `fixture.detectChanges()`, or use
  `fixture.getDeferBlocks()` and `render(DeferBlockState.Complete)`. Alternatively give the block a fixed-height
  `@placeholder`. The orchestrator's `nx test chat` run should confirm this.

### 3. Dangling `aria-controls` and no feedback for the deferred panel (item 9)

- Trigger: first open, or any reopen. `@if` destroys the defer block on close, so each open re-enters the async
  path.
- Symptom: a gap of one microtask on reopen, or the chunk fetch on first open, with `aria-expanded="true"` and no
  controlled element. There is no `@error`. `(when activityOpen())` is redundant under the outer
  `@if (activityOpen() && ...)` (it is always true on first evaluation). Focus stays on the button by design
  (`message-bubble.component.ts:479-482`), so there is no focus regression.
- Evidence: `message-bubble.component.html:140-146`.
- Recommendation: keep the outer `@if` and use `@defer (on immediate)`, or keep `when`. Add a minimal
  `@placeholder` so the layout does not jump. Moderate.

### 4. Item 8 selector does not revive the scenes

- Trigger: the e2e scenes use `[data-testid="canvas-tile"]`, then `.tile-header span` and `[title="Close tile"]`
  (`canvas-orchestra.scene.ts:121-125`), and count tiles as sessions
  (`:206-214`, `tiles.nth(startCount + i)`).
- Symptom: the Rail board renders at most two panes, and neither `tile-header` nor `Close tile` exists in the
  current libs. `closeStaleAgentTiles` returns at once (harmless), but the `nth(startCount + i)` wait would time
  out for the second session.
- Evidence: `canvas-rail-board.component.ts:160`; grep of `libs/frontend/{canvas,chat}` finds neither string.
- Recommendation: this is outside the logic scope of this diff but should be recorded as "attribute added, scenes
  still stale". Moderate.

## Blocking issues

### Signal write inside template evaluation (item 4)

- File: `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-tile-expansion.state.ts:40-52`, reached from
  the templates of `inspector-session-stats.component.ts` and `inspector-limits-lanes.component.ts`.
- Scenario: a fresh session (null session ID) is shown, then the ID is assigned.
- Impact: NG0600 on every change-detection pass for that host. The inspector's stats and limits section is broken
  until the host is destroyed. The unit specs do not catch it.
- Fix: see Failure mode 1 (defer the migration, or move it into the write methods) plus a rendered null-to-ID
  spec.

## Serious issues

### Three existing `message-bubble` specs will fail (item 9)

- File: `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html:142`; specs at
  `message-bubble.component.spec.ts` ~170-228.
- Scenario: `nx test chat`.
- Impact: the check fails, or the specs get patched blindly. These specs also guard the `aria-controls` contract.
- Fix: make the specs await the defer block, or use a `@placeholder`. See Failure mode 2.

## Moderate and minor issues

- Moderate: dangling `aria-controls` and no `@error` or `@placeholder` on the deferred panel
  (`message-bubble.component.html:140-146`).
- Moderate: item 8 attribute alone does not make the showcase scenes valid (`canvas-rail-board.component.ts:160`).
- Moderate: `stats-tile-expansion.state.ts:24-27,52`. Pending keys for hosts destroyed while their session ID is
  still null stay in `open` until the view is destroyed. The count is bounded by tiles times tiles per host.
  The class doc (`:10-20`) does not mention it.
- Minor: `canvas-rail-board.component.ts:46-47`. `inspectorDialog` only checks the parent chain. A
  `[role="menu"]` or `ptah-display-dock.absolute` that is a direct child of `ptah-session-inspector` would also
  be admitted. Add `overlay.matches('[role="dialog"]')`. The real inspector renders its dialog as the first
  child (`session-inspector.component.html:2`), so there is no current impact.
- Minor: `canvas-rail-board.component.ts:748-754`. Treat `active === sheet` or `!sheet.contains(active)` as a
  boundary (focus the first item on Tab, the last on Shift+Tab). This was already present before the diff.
- Minor: `canvas-rail-board.component.ts:739-741`. A non-`HTMLElement` `currentTarget` now returns silently,
  where the old code prevented the default. This is unreachable from the template binding at `:248`.
- Minor: item 3 `session-workflow-addons.token.ts:23` has no in-repo providers (grep of `libs` and `apps` finds
  only the token, the barrel and `chat-view`). `Type<{ readonly tabId: InputSignal<string> }>` matches
  `input.required<string>()`. External providers with a differently typed `tabId` will fail to compile, which is
  the intent.
- Minor: item 5 (`inspector-git-section.component.ts:59`). `[attr.title]="branch()"` removes the attribute for a
  detached HEAD, which is correct. Item 10 is correct: `--sel` is defined nowhere in `libs` or `apps`, and
  `--ptah-gold` exists at `apps/ptah-extension-webview/src/styles.css:41`.

## Data flow

Item 1 (task reader):

1. `link` computed resolves root plus lead ID (`session-task-reader.ts:112-130`): OK, equality is by normalized
   root.
2. Effect `link -> read()` (`:166-168`): OK.
3. `read()` captures `key = linkKey(link)` (`:257`): OK.
4. `inFlight` guard; a trigger while in flight sets `dirty` (`:250-253`): OK.
5. Response: `isCurrent(key)` drops a stale result (`:273`): OK. The `finally` then runs the dirty re-read
   (`:297-301`), so a root change during flight is never lost.
6. `state` shows `loading` unless `held.key === linkKey(link)` (`:145-160`): OK.
7. `openDocument` requires `held.key === linkKey(link)` (`:218-221`): OK.
8. Change-feed filter uses the folder only for the matching key; with a different key it refreshes without the
   filter (`:186-190`): OK, a safe over-refresh.

Item 4 (expansion key):

1. Template calls `isOpen(tile)` then `sessionKey(host, id)` (`state.ts:30`): OK for the first call (null,
   WeakMap only).
2. ID arrives, `sessionKey` finds `previous.sessionId === null` and calls `open.update` (`:40`): GAP, NG0600.
3. Migration and `hosts.set` never complete (`:52`): GAP, repeated throw.
4. Real to real: key is simply the new ID, and state per session is retained: OK. The plan said "clear on a
   switch", but retaining it is the documented class contract.

Item 6: `focusedId()` -> `stats.inputs()` null-guard -> `modelFor(id)()` (cached computed, dropped on tab close)
-> `needsYouCount` -> `inspectorToggleDescription`: OK, same source as the transcript chip.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| 1 Task reader keyed by root + task ID | COMPLETE | none |
| 2 Question card unmounted | COMPLETE (no change) | Premise confirmed false; specs are characterization only |
| 3 Precise addon component type | COMPLETE | none |
| 4 Null-session expansion key and migration | PARTIAL | Crashes in the template path (Blocking) |
| 5 Branch `title` | COMPLETE | none |
| 6 Real needs-you count | COMPLETE | none |
| 7 Sheet-scoped Tab trap | COMPLETE | Two minor hardening notes |
| 8 `canvas-tile` testid | PARTIAL | Attribute present; scenes still depend on removed `.tile-header` and `Close tile` |
| 9 `@defer` activity panel | PARTIAL | Breaks three specs; no placeholder or error block; size effect unmeasured |
| 10 Remove `--sel` | COMPLETE | none |

Implicit requirements not addressed: a rendered null-to-ID spec for item 4; updated `message-bubble` specs.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Root changes while a read is in flight | YES | `isCurrent(key)` drop plus dirty re-read | none |
| Same task ID, new root, held result | YES | key includes root; state shows loading; `openDocument` refuses | none |
| Root differs only by slash or drive case | YES | `normalizeWorkspaceRoot` in `sameLink` and `linkKey` | none |
| Null-ID host gets an ID | NO | migration writes a signal in a template | NG0600 |
| Two null-ID hosts in one view | YES | unique pending keys | pending entries linger until the view is destroyed |
| Real session A to real session B | YES | key is the session ID | state of A is retained (by design) |
| Focused tab closed in the Rail | YES | `stats.inputs()` null short-circuits before `modelFor` | none |
| Nested dialog inside the inspector dialog | YES | `closest` returns the nested dialog, whose parent is not `ptah-session-inspector` | none |
| Tab/Shift+Tab at sheet boundaries | YES | wraps within all sheet items | focus on the sheet itself escapes (pre-existing) |
| Activity panel reopened | PARTIAL | `@if` recreates the defer block | async gap, no placeholder |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for items 4 and 9 (verified against Angular 22.1.7 source). MEDIUM-HIGH for the rest (read, not
  executed).
- Top risk: item 4's `sessionKey` writes a signal during template evaluation, so any new session that gets its ID
  while the inspector stats are rendered throws NG0600 repeatedly.
- What a robust implementation would add: a pure `sessionKey` read path with the migration deferred (microtask) or
  done in the write methods; a rendered `null -> id` spec for each of the three hosts; updated async
  `message-bubble` specs with a `@placeholder` that reserves space; an honest note on item 8 that the scenes need
  further selector work.
