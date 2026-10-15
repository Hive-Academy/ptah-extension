# Final scoped Gate 2 check: R9 split addendum (after Revision 2)

Verdict: APPROVED, 8/10, with 6 batch-level notes that the team-leader settles in the R9u-R9x batch contracts (no further plan revise round).

Scope: `implementation-plan-rail-r9-split.md` (133 lines, "Revision 2" table at 120-133 and every body line it cites), against `implementation-plan-rail-r9-split-rereview.md` (REVISE 7/10), `decisions.md` rows 77, 80-83, and `batches-rail-r9.md` ownership. Code spot-checks in W: `chat-view.component.ts:176-190,410-470`, `canvas-rail-board.component.ts:105-165,205-225,325-420`, `canvas.store.ts:364-380,598-610`. Read-only; no tests or builds run.

## Item table (previous re-review open items)

| # | Item | Status | Evidence (plan line) |
| --- | --- | --- | --- |
| 1 | Header actions had no consumer (R9x owned neither focus area nor board) | RESOLVED | Line 87: R9x now owns header, focus area and board (+ their specs, `chat-input` spec, e2e) = 8 files, adds `closeSplitRequested` / `closePaneRequested` / `swapPanesRequested`, focus area forwards the pane id, board consumes all three and owns announcement and focus return. Line 80: R9w consumes the R9v card outputs; "no unconsumed action output after R9x". Spec cases per output on line 87. |
| 2 | Swap panes had no mechanism (live-to-live host exchange breaks the no-duplicate rule) | RESOLVED | Line 28: swap changes wrapper (CSS) order only; tab X stays in its host, no release/acquire. Hosts are keyed by stable pane identity (line 24, 61). Line 87 and recheck 3 (line 95) test ChatView DOM identity, drafts, dock state, <=2 hosts, no duplicate subtree. The no-duplicate rule holds because nothing transfers. Caveat: see note N3. |
| 3 | R9v -> R9w interface unnamed | RESOLVED (note N5) | Line 85: `openBesideRequested`, `moveUpRequested`, `moveDownRequested` are `output<string>()` with the tab id; `canMoveUp`, `canMoveDown` booleans; `splitDisabledReason: string \| null`. Rail forwards outputs unchanged and passes the reason to every card. Remaining gap is only the Rail-level input name (N5). |
| 4 | `close()` focus logic / null-focus `tiles[0]` fallback | RESOLVED | Line 22 and 34: capture "was store-focused" and the surviving pane before `removeTile`, transition inside `close()`, inactive close never calls `focusTile(neighbour)`, active close focuses the survivor only if the store did not, never derive from `focusedId()` fallback. Line 86 names both spec cases (inactive close with ordered neighbour; active close with the other tab at `tiles[0]`). Matches the code: `close()` today focuses the neighbour unconditionally (`canvas-rail-board.component.ts:~385-392`) and `removeTile` nulls focus via `clearFocusIf` (`canvas.store.ts:375-380`). Caveat: removals outside `close()` (N1). |
| 5 | Forced-overlay mechanism unnamed; R9u could not own the dock spec | RESOLVED | Line 30 names `RAIL_MIN_CONTENT_WIDTH: InjectionToken<Signal<number \| null>>`, exported from the chat public API, optional in ChatView, with the exact `isOverlay` expression. I checked it against `chat-view.component.ts:422-426,454-459`: `dockWidth` is clamped by `hostWidth`, and `hostWidth` is the ChatView host width, which does not depend on the dock layout, so the new term cannot oscillate. R9u (line 84) owns `chat-view.keepalive.spec.ts` with the "804 px side vs 644 px overlay" case; file count is exactly 8. |
| 6 | Card menu trigger placement | RESOLVED (note N6) | Line 32: labelled `Session actions` sibling of `ptah-compact-session-card` inside the fixed-height `li`, outside `rc-lane-overflow` and `.rc-select`; collapsed 56 px = 32/24 two-cell row, select first then trigger; roving `tabIndex` 0 only for the current card; `isIgnoredCardClick` ignores trigger and menu; Escape returns focus. R9v owns the card, rail, keyboard files and specs (line 85). |
| 7 | R9x dependency column | RESOLVED | Line 87: "R9l (canvas e2e spec), then R9w"; the stray "R9f (header)" is gone. Confirmed R9l owns `canvas.spec.ts` and finishes first (`batches-rail-r9.md` R9l block). |
| 8 | `lastFocusedId` and visible-tab registration | RESOLVED | Line 22: board keeps `lastFocusedId`, effect reads it before reconciling. Line 24 and 61: `registerVisibleTab` follows `SESSION_VISIBLE`, `SESSION_FOCUSED` is the new pane signal. R9w owns the four files in the chain (line 86). |
| 9 | Forced overlay at every width (user decision) | RESOLVED | Decision 82 applied exactly: line 30 and S2 (line 54) "side dock when `paneWidth - dockWidth >= 360`, overlay otherwise". No width forces overlay: the 1920 case keeps the side dock (804 - 400 = 404), 1600 overlays (644 - 400 = 244), computed per pane from the measured ChatView host width and per-tab dock width. Recheck 1 (line 93) varies the saved dock width across the 360 boundary. |
| 10 | Stale HELD labels in `batches-rail-r9.md` | OUT OF SCOPE (not a plan defect) | Line 80 and 133 assign it to the team-leader at decomposition under decision 81. File still shows R9h/R9f/R9l HELD (lines 3, 88-93, 324-362); I did not edit it. |

## Decisions 82 and 83: applied exactly?

- Decision 82: yes. Lines 30, 54, 61, 93. Side dock is kept wherever the pane keeps >= 360 px of transcript/composer; overlay only below that. Revision 1's forced overlay is explicitly superseded (line 107).
- Decision 83: yes. Details overlays the active pane only while split is on; single focus keeps the existing column (lines 24, 30, 54, 93, 118). It is recorded as approved, not as a pending proposal. The pane-width arithmetic at 1920/1600 is now correct because Details is not a column in split. See note N2: no batch contract or named spec carries the Details overlay.

## New Blocking/Serious check on Revision 2

None found. Checks performed:

- File ownership: R9u 8 files (new coordinator + spec, retention service + spec, `chat-view.component.ts/.html`, `chat-view.keepalive.spec.ts`, `chat/src/index.ts`), R9v 6, R9w 8, R9x 8. Overlaps with earlier owners (R9b board, R9c card, R9f focus area/lane view/transcript, R9h retention/ChatView/index, R9l e2e) are serial writers after those commits (line 80, 82). `chat-input.component.spec.ts` has no other owner. R9t keeps `reorderTiles`; the addendum does not touch the store.
- Every new output/token has a consumer in the same or a later batch: card outputs -> Rail -> board (R9w); header outputs -> focus area -> board (R9x); `RAIL_MIN_CONTENT_WIDTH` provided by the R9w transcript, consumed by R9u ChatView (optional, so R9u-before-R9w is safe); `paneFocused` chain is all in R9w. One input path is unnamed (N4).
- No-duplicate-subtree rule: kept (line 28). Swap never moves a subtree; a tab switching panes is disposed in A before B acquires; distinct-tab-tree count; last-owner cache release.
- BL rule "<= 1 live ChatView, <= 2 while split": lines 28, 63, 86 ("exactly two and <=2"), recheck 4 (line 96) with the board-scoped selector.
- Keyboard-accessible reorder: card menu in expanded and collapsed Rail plus Alt+Shift+Arrow, boundary disabling, focus restore, announcement, geometry baseline `{ key, order }` (lines 32, 85, 86, 97).
- Dock protection: decisions 77/82 honoured; both panes get the full dock (line 24, 61, rows 120). See N6 on the `HIDE_AGENT_SIDEBAR` refusal.

## Batch-level notes (APPROVED; settle in the batch contract at decomposition)

- N1 (Moderate, R9w): a pane's tab can leave the board without going through `close()`: `removeTileFromAnyWorkspace` / `removeTileOnly` (`canvas.store.ts:364,598-610`, e.g. a session closed from the left sidebar). Then `otherTabId` is a ghost, or the `tiles[0]` fallback can equal `otherTabId` and put the same tab in both panes. Add to the R9w contract and board spec: derive pane validity against `tiles()`, drop a pane whose tab is gone, never let both panes resolve to the same id, announce once. Also define the "suppress the external-focus effect" mechanism (line 22) as updating `lastFocusedId` synchronously inside the transition, not a boolean cleared before the effect runs.
- N2 (Moderate, R9w): Decision 83 has an owner file (the Details aside is in `canvas-rail-board.component.ts:120-165`) but no line in R9w's contract (line 86) or named spec. Add: in split, Details is an overlay on the active pane at every band (the xl/lg/md aside has no opener today, so split needs an opener/close pair and dialog-style focus handling; reuse the `sm` pattern at lines 120-155 but absolutely positioned, not pushing), what happens to `detailsOpen` when split toggles, and a spec case "split: Details overlay on active pane, single focus: column".
- N3 (Moderate, R9x): CSS `order` swap leaves DOM and tab order unchanged while the visual and `Left/Right` labels change. State the intended Tab order (DOM order will not match the visual order) and the `visualOrder` field (it is in the Revision 2 table, line 125, but not in the state shape on line 22), and that collapse resets it.
- N4 (Moderate, R9w): the value of `RAIL_MIN_CONTENT_WIDTH` is "360 only while split is displayed" (line 30), but no input carries "split displayed" along focus area -> lane view -> transcript (only `paneFocused` is named, line 24). Name it in the R9w contract; all four files are R9w-owned.
- N5 (Minor, R9v/R9w): name the Rail-level input that receives the board's `splitDisabledReason`, and say who computes `canMoveUp/Down` (line 85 says the Rail "passes per-card boundary inputs", line 86 says the board "computes ... move boundary inputs"). Also say that Alt+Shift+Arrow is emitted by the card/Rail (R9v), so the board's reorder handler is the single consumer.
- N6 (Minor): (a) add the `HIDE_AGENT_SIDEBAR: true` refusal (decision 77d) to R9u and R9w; the plan never mentions it and R9w edits the transcript host that used to set it; (b) the expanded-card action gutter narrows the compact card, which R9v does not own; keep the fixed 176/96 heights and the `+N more` fit as a spec/recheck assertion (recheck 5 covers heights); (c) the base BL "at most one live ChatView" wording in `batches-rail-r9.md` and the s-heap criteria must be updated to "or two while split" by the team-leader.

## Lane-introduced constraints

Only lane-proposed rules; tagged user = decision-backed, project = repo rule.

1. Pane state `{ activeSide, otherTabId }` with `lastFocusedId`, exchange-on-focus rule, in-method `close()` transition (line 22). Mechanism for decisions 80/81.
2. Open beside on the active tab is refused with an announcement (line 22).
3. Split state is ephemeral per workspace visit; no schema field (lines 28, 56). **Pending removal proposal, see below.**
4. Split available only at container >= 1440 px; collapse below with one announcement; widening never reopens (lines 28, 30, 94). **Pending removal proposal, see below.**
5. `RAIL_MIN_CONTENT_WIDTH` token and `isOverlay` expression (line 30, 84). Mechanism for decision 82; the 360 px value itself is user-requested.
6. Transcript visibility registration follows `SESSION_VISIBLE`, not pane focus (lines 24, 61).
7. Board-scoped retention coordinator, shared cap four (two pinned + at most two frozen), disposal-before-acquire (line 28, S3, row 122).
8. Swap panes by CSS order, plus header actions Close split / Close pane / Swap panes (lines 87, 125). Swap and the two close actions are additions, not requested in decision 80.
9. `Session actions` trigger placement, collapsed 32/24 two-cell layout, roving Tab order, Alt+Shift+ArrowUp/Down shortcut (line 32, S5).
10. Reorder baseline `{ key, order: expectedIds }`, focus restore, announcement format (line 32).
11. R9v card/Rail API names, serial batch order R9u -> R9v -> R9w -> R9x, "codex only" for R9u/R9w, R9w-before-R9x consumer split (lines 80-87).
12. Pane region labels `Left session: {title}` / `Right session: {title}, active`, `focusin` activation (line 24). Accessibility rule; repo-consistent, but lane-chosen wording.
13. 180 ms fade reuse and no per-card timers/observers (line 30): inherited from base R9 (decision 74), restated, not new.

## Proposed removals (for the user)

Not approved here. Row 83 (Details column removed while split is on) is user-approved and excluded.

1. Split unavailable below a 1440 px canvas container, and an open split collapses to one pane when the container drops below it (plan lines 28, 30, 54, 94, 115). The user decisions (82, 83) do not approve this. Note for the decision: with Details an overlay in split (decision 83) and the dock rule from decision 82, a 1280 px canvas gives about 484 px per pane (1280 - 304 - 8, halved), which still satisfies the 360 px content rule with an overlay dock, so the threshold now takes away a capability that the approved rules could carry. The plan's own 1280 arithmetic (line 30) still assumes a Details column and is stale.
2. Split is not restored after a workspace switch, canvas close or reload (plan lines 28, 56, 116). The user has not approved it; the alternative is persisting `otherTabId` in the v3 board record.

Until the user decides, treat the 1440 constant and the ephemeral behaviour as single changeable points in R9w; the width-based dock contract is valid for any pane that fits.

## Verdict

APPROVED, 8/10. All nine substantive items from the previous re-review are closed with plan-line evidence; decisions 82 and 83 are applied exactly; Revision 2 introduces no Blocking or Serious defect. The score is not higher because six contract details (N1-N6) remain implicit, N1 and N2 being the ones most likely to surface as bugs or missed acceptance, and two lane-proposed removals still await the user. The residual uncertainty is that R9f/R9h and the unfinished R9 batches are not yet committed (line 18 assumption), so the "change the existing file in place" rule (line 89) applies at implementation time.
