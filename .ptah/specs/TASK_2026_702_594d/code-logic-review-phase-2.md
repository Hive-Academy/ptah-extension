# Code Logic Review, Phase 2 (2A-2E) - `TASK_2026_702_594d`

Review family: Anthropic (reviewer) / codex (implementer)

Scope read in full: `recent-sessions.store.ts`, `orchestra-canvas.component.ts`, the board template and the changed rail code, every e2e/selector diff in the scope list, the docs diff. Not run (per instruction): nx, jest, tsc, e2e. Spec files were read only where they back a claim.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | REVISE |
| Blocking issues | 0 |
| Serious issues | 4 |
| Moderate issues | 5 |
| Minor issues | 3 |

The store, popover anchoring, dock removal parity and populated-board keyboard order are sound. The defects are a missing e2e marker (known), two stale e2e selectors that break on the new empty-board copy, a focus-steal regression introduced by the new focus-return code, and a recent-sessions list that never refreshes.

## Serious

### S1. `data-testid="canvas-interactive"` is absent (known item #18.1, confirmed)

- File: `apps/ptah-electron-e2e/src/specs/perf/startup-tti.spec.ts:58` waits for it; nothing under `libs/` or `apps/` sets it (grep: only that spec mentions it). `orchestra-canvas.component.ts:103` is the intended spot.
- Impact: the TTI spec times out on the first `waitFor` (default timeout), so the perf reference spec fails every run.
- Required change: in `orchestra-canvas.component.ts` add `data-testid="canvas-interactive"` to the board wrapper `<div class="flex-1 min-h-0">` at line 103. It has a painted box, so Playwright's `visible` holds (a zero-size or `display:none` node would not). Do not put it on `session-viewport` or `canvas-grid`: both ids are already used by other specs and one element holds one test id. Add one assertion in `orchestra-canvas.component.spec.ts` that the marker exists and contains `ptah-canvas-rail-board`.

### S2. Stale empty-board heading in two e2e specs

- Files: `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:70` (`getByRole('heading', { name: 'No sessions on this board' })`) and `apps/ptah-electron-e2e/src/specs/git/hunk-revert-top-layer.spec.ts:193` (same heading, a file the lanes did not touch).
- Evidence: the old heading came from `canvas-rail-board.component.ts` at HEAD:142; the new board renders `<h1>A fresh space to work</h1>` (`canvas-rail-board.component.ts:158-163`). No `No sessions on this board` remains in any source file.
- Impact: both tests fail on the assertion timeout. The hunk-revert spec uses the heading as its guard that the canvas sits behind the dialog, so it fails outright instead of guarding.
- Required change: replace the heading name with `A fresh space to work` at both places, or better assert `getByRole('main')` / the `canvas-rail-empty-board` test id plus `canvas-hero-new-session`. Add `hunk-revert-top-layer.spec.ts` to the selector sweep and re-run its typecheck. Also grep `apps/**/*.spec.ts` for `No sessions on this board` once more before handoff.

### S3. Focus is stolen by the tile-bound effect (regression from new focus-return code)

- File: `orchestra-canvas.component.ts:268-272` (`handleCancelSession` now ends with `this.sessionPopoverAnchor()?.focus()`) and the effect at about line 380 (`if (!canAddTile()) untracked(() => this.handleCancelSession())`). At HEAD `handleCancelSession` had no focus call (HEAD:619-622).
- Scenario: the board reaches 20 tiles (user creates the 20th, or agent-child adoption fills it while the user types in a tile). The effect calls `handleCancelSession` unconditionally, even though the popover is closed, and focuses the last stored anchor (the footer button, or a detached hero). On "create the 20th" the effect runs after `handleCreateSession` has already moved focus to the new tile via `board.sessionCreated`, so focus jumps off the new tile onto the aria-disabled footer button.
- Impact: keyboard and screen-reader users lose their place; typing in a composer is interrupted.
- Required change: split the close from the focus return. `closeSessionPopover()` resets open and name state with no focus. `handleCancelSession()` (Cancel, Escape, backdrop `closed`) calls it and then restores focus only when `sessionPopoverOpen()` was true on entry. The tile-bound effect calls the non-focusing variant. Add a spec: reaching the bound with the popover closed does not change `document.activeElement`.

### S4. Recent sessions never refresh after the first load

- File: `canvas-rail-board.component.ts:443-445` (`effect(() => { if (this.visible()) void this.recentSessions.load(this.workspacePath()); })`). `RecentSessionsStore.refresh()` (`recent-sessions.store.ts:90`) has no caller anywhere (grep).
- Scenario: workspace opens on an empty board and loads the top 3. The user starts a session from the hero, works, closes the tile, and the empty board returns. The store still holds the old three, so the session just used is missing or ranked wrong. The effect only re-runs when `visible` or `workspacePath` change. It also loads while tiles exist, which wastes an RPC pair.
- Impact: visible wrong data on a normal path (use the app, close the last tile).
- Required change: reload when the empty branch is entered: track `orderedTiles().length === 0 && visible()` in that effect (call `load` inside `untracked`) so every 0-tile entry refetches and populated boards do not. Add a board spec: tiles 1 to 0 triggers a second `load`.

## Moderate

- M1. `recent-sessions.store.ts:37-43`: every `load` resets `sessions: []`, so a reload makes the cards vanish and layout jump under the hero. Keep the previous rows while `loading` for the same workspace path (clear only when the path changes).
- M2. Notice dismissal never resets when the same condition repeats. `orchestra-canvas.component.ts:231-262,280-289`: the revision only bumps when the joined source string changes. `writeFailed()` stays `true` across repeated failed writes, and a repeated `headerMessage` with the same text leaves the same key, so a dismissed notice stays hidden. The plan says dismissal resets "on source refresh even if the condition remains". Required: bump `noticeRevision` inside `openNewSessionPopover`'s blocked branch and whenever `layoutPersistence` records a new failed write (if it exposes a counter; otherwise document the limit in decisions).
- M3. The rail is rendered from one `ng-template` into two `@if/@else` branches (`canvas-rail-board.component.ts:108,207,209`). A 0 to 1 or 1 to 0 tile change destroys and recreates `ptah-canvas-rail`, so its scroll position, the footer focus and internal state reset on first-tile creation and last-tile close. The old rail was a single persistent instance. Prefer one rail outside the `@if` with the main/rail order set by CSS `order`. DOM order for the empty case is the only reason for the template, and `order-first` is already there.
- M4. `canvas-rail-board.component.ts:444`: `load()` runs synchronously inside an effect. Wrap it in `untracked` so a future signal read inside the store cannot create a reload loop.
- M5. `canvas-rail-board.component.spec.ts:204,1136`: stale `Open Marketplace Skills` stub (known item #18.2, confirmed). Required change: line 204 to `<button type="button">Open Library</button>`, line 1136 to `toContain('Open Library')`. Same text in `marketplace-servers.e2e.spec.ts:229` is already migrated. Moderate because the test passes while asserting the wrong contract.

## Minor

- m1. `orchestra-canvas.component.ts:93-102`: the chip row (`shrink-0`, about 32px with the invisible "All clear" placeholder) sits inside the measured `session-viewport`, so `layoutService.observe` sees a shorter viewport. Fine temporarily, but record it in phase 3 notes when the chip is removed.
- m2. `canvas-rail-board.component.ts:144`: `<main>` plus `<h1>` inside a shell that may already own a `main` landmark; check the e2e/a11y pass for duplicate landmarks.
- m3. `apps/ptah-docs/.../canvas/index.md`: the cap note now says "New session buttons switch off at twenty tiles"; at the cap the rail footer is aria-disabled but still focusable. Wording "switch off" is acceptable; no change needed unless the docs lint complains.

## Five logic questions

1. Silent failure: a `session:list` failure on either of the two calls clears the cards with no UI (`recent-sessions.store.ts:64-72`), by design ("no invented empty-history text"); it is logged. A dismissed repeat notice stays hidden (M2). Workspace path `''` (implicit board) is rejected by `isAuthorizedWorkspace` server-side and the store sees only an error (silent, acceptable).
2. Unexpected user action: reaching 20 tiles while focus is elsewhere moves focus (S3); clicking Create on the last empty-board hero fires focus on a node about to be removed, then moves to the tile (benign).
3. Wrong answer rather than error: stale recent list (S4). Top-3 merge itself is correct: the union of the top 3 of each of the two queries always contains the global top 3, dedupe keeps the newest row, tie-break is by id, and the shared request counter drops stale responses (`recent-sessions.store.ts:36,62,82`).
4. Dependency failure: the store handles rejected and failed results and ignores superseded ones. `openRecentSession` catches a throw and a `'failed'` result and announces a safe message (`canvas-rail-board.component.ts:953-960`). Popover with a disconnected anchor falls back to an unpositioned panel (Phase 1 code, not in scope).
5. Missing: no marker for TTI (S1), no refresh trigger (S4), no spec asserting focus is not stolen (S3), no e2e sweep for headings (S2).

## Parity check (parity-inventory.md)

| Capability | Status |
| --- | --- |
| Hero primary action, focusable `aria-disabled`, reason, guarded click | COMPLETE (`canvas-rail-board.component.ts:167-187,948-952`) |
| Footer action, tile-bound reason before running cap, collapsed accessible name | COMPLETE (`canvas-rail.component.ts:233-246,343-346`) |
| Popover from hero and footer, Enter/Create/Escape/Cancel, default name, final cap recheck | COMPLETE (`orchestra-canvas.component.ts:253-285`) |
| Focus return to invoking trigger | COMPLETE on cancel/create, but regressed by S3 |
| Popover out of layout flow, no cap-state `tabindex`/`role=group` host (N2) | COMPLETE (`orchestra-canvas.component.ts:119-124`; wrapper has no focusable attributes) |
| Blocked-create reason | COMPLETE as `cap` notice, `role=status` |
| Write-failure / read-only warnings, priority order | COMPLETE with exact text, `role=alert` (`orchestra-canvas.component.ts:238-262`, board template line 187); repeat-dismiss gap M2 |
| Ticker removal, Thoth reachable from its page, `BackOfficeActivityService` kept | COMPLETE (approved removal; export and files removed, no importers left in scope) |
| Needs-you chip mounted, deferred, placeholder | COMPLETE (`orchestra-canvas.component.ts:92-102`) |
| Populated-board Tab order and `onRailKeydown`, `onTabKey` container lookup | COMPLETE (`[data-testid="rail-pane-container"]` is still the direct parent of the pane sections; empty board only reorders main before rail) |
| Aurora paused when the surface is hidden | COMPLETE (`[visible]="surfaceActive()"`, `visible() && parentActive()` at line 385; hidden boards are not rendered at all) |
| Leaked subscriptions/observers | None found: no new subscriptions; the popover focus `setTimeout` at `orchestra-canvas.component.ts:293-297` is pre-existing and uncleared (trivial) |

## e2e selector verification

Empty versus populated branch choice is correct everywhere I traced: `canvas.spec.ts:33` (hero for the first, footer after), `new-project-question-routing.spec.ts:121,183` (empty fixture board, hero), `task-370...:130`, `compaction-duplicate-session.spec.ts:176` (footer after the first tile), `ui-driver.ts:453` (footer exists in both branches, so no hang), `sessions.shot.ts`, and the three showcase scenes (visibility-branched, hero first). None can hang on the button choice. The two failures are the heading text (S2) and the TTI marker (S1).

## Verdict

- Recommendation: REVISE
- Confidence: HIGH on S1-S3 (verified by grep and by reading the HEAD diff), MEDIUM-HIGH on S4 (traced by reading the effect and the absence of `refresh` callers).
- Top risk: the focus-steal effect (S3) plus two e2e specs that cannot pass as written (S1, S2).
- Fix round for the lane: S1, S2, S3, S4 required; M5 (the stub) rides along; M1-M4 recommended in the same pass since they touch the same two files.
