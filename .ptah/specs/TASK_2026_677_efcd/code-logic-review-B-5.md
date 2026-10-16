# Code-logic review - batch B-5 (grok)

Score: 5/10
Verdict: REVISE
Review family: reviewer grok; implementer codex
Scope: 58d2084dc

The wide and narrow columns host the inspector, stats follow the focused tab, and the workflow badge is still rendered. The new full-screen sheet (width under 400 px) and the split overlay's close path do not. Commit `58d2084dc` removed the immediate "Close details" buttons and points initial focus at `[data-inspector-close]`, which `@defer (on idle)` has not rendered yet. The sheet's Tab handler then treats every control inside `role="dialog"` as not tabbable, so keyboard focus cannot move inside the sheet.

Evidence against 6-7: those two keyboard failures are on the path this batch added, and the board spec never opens a width under 400 px, so the passing 370 tests do not exercise them. Evidence against 3-4: SESSION / PLAN LIMITS / LANES / TODOS / GIT still mount from the focused tab, the 288 px column and the always-visible column still open, and `detailsOpen` does not fight a second open flag.

## Findings

### Blocking

None.

### Serious

1. Opening details does not move focus into the overlay, so Escape does not close it. `openSplitDetails` (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:659-664`) focuses `[role="dialog"] [data-inspector-close]` on the next render. That button is inside `@defer (on idle)` (`:178-179`, `:243-244`). The split dialog shell exists immediately (`:177`), but its close control does not. The compact sheet's dialog exists only inside that same defer (`session-inspector.component.html:1-2`). `afterNextRender` does not run again when the chunk appears. `InspectorShellController` is provided (`canvas-rail-board.component.ts:64`) and the inspector calls `closeReady` (`session-inspector.component.ts:105-110`), but the board never calls `bindTab`, `attach`, or `toggle`, so `pendingCloseFocus` stays false and `isModal()` stays false (`inspector-shell.controller.ts:131-141`, `:270-273`). The late-focus path never runs. Escape is listened on the split aside (`canvas-rail-board.component.ts:177`) and the sheet wrapper (`:242`), which are not ancestors of the header button that still holds focus. A keydown on that button does not reach those listeners. The header's own Escape handler returns immediately when the menu is closed (`canvas-focus-header.component.ts:310-311`). Clicking the header details button again only sets `detailsOpen` true (`canvas-rail-board.component.ts:662`); it does not toggle. Failure: at width under 400 px, or in a split, activate "Open details" and press Escape. The overlay stays. Before this commit the split aside rendered an immediate "Close details" button outside `@defer` and focused it. That button is gone. The board spec dispatches Escape on the dialog element itself (`canvas-rail-board.component.spec.ts:1078`) and uses an inspector stub that is not behind a second defer, so it does not catch this. Fix: keep a close control outside `@defer`, or set the controller's pending-focus flag and call `closeReady` when the deferred button appears; bind Escape on the host while the overlay is open.

2. Tab inside the compact sheet never moves. `onSheetKeydown` (`canvas-rail-board.component.ts:690-695`) collects tabbable controls with `isTabbable`. `isTabbable` returns false for every element inside `[role="dialog"]` (`:37`, `:43`). The sheet presentation's root is that dialog (`session-inspector.component.html:2`), so the filtered list is empty and every Tab is `preventDefault`ed. Failure: width under 400 px, open the sheet, Tab until focus lands on the close button (the first control in the inspector header). Further Tab and Shift+Tab do nothing, so SESSION, lanes, todos, and the rest of the body are not reachable from the keyboard. The handler was added to wrap focus; the shared overlay filter makes the list empty. The split overlay does not use this handler, and `onTabKey` returns before it rewrites Tab when the target is already inside a dialog (`canvas-rail-board.component.ts:869`), so this freeze is the compact sheet only. Fix: filter the sheet's own controls with a check that does not reject descendants of the sheet dialog (disabled, hidden, and inert only).

### Moderate

3. Choosing a lane under the compact sheet does not reveal the pane. Each inspector binds `(laneRequested)="detail.selectLaneFor(id, $event)"` (`canvas-rail-board.component.ts:244`). `selectLaneFor` only stores the lane key (`canvas-detail.service.ts:25-42`). The sheet is an opaque `absolute inset-0` layer (`canvas-rail-board.component.ts:242`) and the pane underneath is `inert` (`:150`). Chat-view closes its modal when a lane is chosen (`chat-view.component.ts:1004-1007`). The rail sheet does not. Failure: width under 400 px, open details, activate an agent lane. The key changes and the covered pane would show that lane, but the sheet stays, with no announcement. The click looks like it did nothing. The split overlay is only the right-hand column (`:177`), so the same call is visible there. Fix: after `selectLaneFor`, close the compact sheet (and return focus) the way chat-view closes its modal.

### Minor

4. A long branch name in the sheet has no full-name hint. The git row renders the branch in a `truncate` span with no `title` (`inspector-git-section.component.ts:59`). The header chip's `title` is the hint (`canvas-focus-header.component.ts:109`). The compact sheet covers that header (`canvas-rail-board.component.ts:242`). Failure: width under 400 px, open details for a session whose branch name is wider than the git row. The visible name is ellipsized and nothing exposes the rest on hover. The full string is still the element's text. Fix: set `title` on the git branch span to the full branch name.

## Parity check

| Row | Result | Evidence |
| --- | --- | --- |
| D-1 | confirmed | Embedded landmark `aria-label="This session"` at `session-inspector.component.html:6`; sheet dialog label at `:2`; heading "This session" at `:13`. The report's line 9 is the closing brace. Placeholder text "Session details" is `aria-hidden` (`canvas-rail-board.component.ts:181`, `:208`, `:235`, `:246`). |
| D-2 | confirmed | Context label, ring, and `role="progressbar"` at `inspector-session-stats.component.ts:42-51`. Unknown window copy at `:54` ("Window unknown" / "No data yet"). |
| D-3 | confirmed | Tokens render `tokenLabel()` at `inspector-session-stats.component.ts:67`. A non-number count becomes "—" at `:185-187`. |
| D-4 | confirmed | Cost tile at `inspector-session-stats.component.ts:79-84` (the report's line 72 is the token-budget bar). A null cost goes to `ptah-cost-badge`, which renders "cost unavailable" (`cost-badge.component.ts:19-20`, `:46-49`), including a real `$0`. |
| D-5 | confirmed | `[turns]` is passed at `session-inspector.component.html:46` from `model().orchestrator.turns` (user-turn count in `session-inspector.store.ts:77-84`). The figure is painted only inside the duration tile (`inspector-session-stats.component.ts:97-101`). A session with turns and no duration shows no turns line. That is the inspector contract this batch hosts, not a second turns source. |
| D-6 | confirmed | Count, active item, and item content: `inspector-todos-section.component.ts:88-93` (done/total/activeTitle), `:129` ("N of M"), `:149-153` (in-progress content), `:176` (count-only active title). |
| D-7 | confirmed, tooltip gap in the sheet | Branch text at `inspector-git-section.component.ts:59`. Full-name `title` is the header chip at `canvas-focus-header.component.ts:109`, not line 108. See finding 4 for the sheet. |
| D-8 | confirmed | Additions, deletions, and the partial marker at `inspector-git-section.component.ts:62-65`, with the partial title at `:62`. |
| D-9 | confirmed | `sessionWorkingRoot` at `inspector-git-section.component.ts:122-130`. `gitStore.track(root, tabId)` is registered in an effect with cleanup at `:144-148`. Tracking follows the inspector `tabId` input, which the board sets from the pane or `focusedId()`. |
| D-10 | confirmed | `@defer (on idle)` plus an aria-hidden "Session details" placeholder at `canvas-rail-board.component.ts:178-182`, `:196-210`, `:232-236`, `:243-247`. |
| D-11 | confirmed | 288 px column and its "i" trigger when `band() === 'sm'` and width is at least 400 px (`canvas-rail-board.component.ts:190-222`; `railWidthBand` is `sm` below 1120 px, `canvas-board-mode.ts:18-22`). Below 400 px the column is replaced by the full-screen sheet (`:240-249`) opened from the header (`canvas-focus-header.component.ts:167`, `:264-267`). At `md`/`lg`/`xl` the aside stays up at 296/320/360 px (`canvas-rail-board.component.ts:224-238`). |

No `canvas-session-details` or `CanvasSessionDetailsComponent` reference remains under `libs/frontend/canvas`.

## Checked and clean

- Workflow badge from the focus-header task is still an always-rendered sibling of the title (`canvas-focus-header.component.ts:104`), fed by `findTabByIdAcrossWorkspaces(tabId).workflow` (`:252-254`). The header spec still expects `ptah-workflow-badge`. The compact-width gate only adds the details button (`:167`).
- `InspectorShellController` is not a second open flag for what the user sees. The inspector never reads `shell.isOpen()` to mount itself. Close goes through `closeRequested`, which the board handles (`canvas-rail-board.component.ts:179`, `:204`, `:244`). The controller's band stays `'docked'` and `sheetOpen` stays false because nothing calls `attach` or `toggle`. That does not stick the board closed or open. It does mean `closeReady` cannot repair finding 1.
- `injectSessionStatsSource` is called with `focusedTab`, which is a signal, so `host.tab()` is a reactive read (`session-stats-source.ts:119-124`, board `:316-325`). `sessionId`, `budget`, and `available` are lambdas read inside those computeds. Changing focus reads the new tab. A null `claudeSessionId` yields no lane runs and a null limits model (`session-stats-source.ts:145-167`), and token/cost unknown states as in D-3 and D-4, not the previous tab's figures. `available` is true whenever a focused tab exists, so SESSION still mounts.
- The board does not call `registerScope` or push `runOwnerKeys`. That matches the batch (no `registerScope`). `limits` stays null until some other surface has loaded `PlanLimitsStore` (`session-stats-source.ts:164-167`). Embedded chat-views still register their own scope (`chat-view.component.ts:1056-1059`, `:1475-1483`). A rail with no live chat-view and no prior snapshot shows SESSION without PLAN LIMITS / LANES. Not filed: the batch forbade a board scope.
- One inspector is mounted. Split overlay, sm column, wide column, and compact sheet are mutually exclusive (`!compactSheet()` on the first three; the sheet requires `compactSheetOpen()`). Section ids are per-instance counters, so a single mount does not duplicate `aria-labelledby` targets.
- The wide aside hides `[data-inspector-close]` with Tailwind `hidden` (`canvas-rail-board.component.ts:226`) and does not bind `closeRequested`. The column has no open flag; hiding the control matches the recorded decision. `display: none` keeps it out of tab order.
- Document `selectionchange` / pointer listeners are removed in the effect cleanup (`canvas-rail-board.component.ts:374-378`). The new controller's `DestroyRef` disconnects its observer (`inspector-shell.controller.ts:170-177`); the board never attaches one. No new timer.
- `answerRequested` is not bound on the rail inspector. Left as the accepted O9 degradation. No closed-state limit cue on the rail trigger. Left as the scheduled D-O6 design call.
- Specs that still describe behaviour were updated rather than emptied: the placeholder-until-defer test (`canvas-rail-board.component.spec.ts:471-479`), focused-tab id on the inspector (`:482-496`), split Escape and focus return (`:1063-1090`), and the deferred dialog Tab case (`:1562-1570`). They stub the inspector, so they do not prove findings 1-3. No width under 400 px is set in that spec (`width.set` values are 0, 639, 640, 920, 1000, 1200, 1439, 1440, 1600).

## Logic questions

1. Silent success: a lane click under the sheet updates the lane key and leaves the sheet up (finding 3). A missed initial focus looks like the overlay opened (finding 1).
2. User action: "Open details" below 400 px, then Escape or Tab (findings 1 and 2). "Open details" in a split, then Escape before the idle chunk (finding 1).
3. Wrong answer rather than an error: a long branch is ellipsized with no tooltip while the sheet covers the header (finding 4). Stats for a new focus are not the previous tab's.
4. Dependency failure: `@defer (on idle)` delays the only close control; `PlanLimitsStore.snapshot()` stays null with no board scope, and PLAN LIMITS / LANES are omitted rather than invented. A null session id does the same for limits.
5. Unspecified: keyboard operation of the new sheet (focus, Escape, Tab) and whether a lane pick should dismiss it. The batch required the controller and the board's 400 px state; it did not say the controller would own focus.

## Decisions

- The unused controller is not a dual open-state defect. Options were "two sources of truth" or "inert until bind/toggle". Evidence: the inspector does not read `isOpen`, and the board never calls `toggle`. Reversible if a later batch wires `attach`.
- Findings 1 and 2 are defects in this commit, not the scheduled D-O6 cue or the O9 `answerRequested` skip.
