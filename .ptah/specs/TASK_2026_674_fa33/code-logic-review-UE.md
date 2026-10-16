# Code Logic Review (batches U1, U2, E) - TASK_2026_674_fa33

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5.5/10 |
| Assessment | NEEDS_FIXES |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 4 |
| Minor issues | 3 |

Read-only review of the uncommitted diff (no nx/jest run). Excluded as instructed: session-history-replayer*,
message-finalization*. L4 is closed and not reviewed. Scope: L1, L2, L3a, L3b, L5, L6.

## Findings

### S1 (Serious) - L2 hides the status row with `display:none`, which breaks the activity grid

- File: `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:174`
  against `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts:353-356,372-374,379`.
- Cause: the card adds `[&_[data-zone=status]]:hidden` to `ptah-compact-session-activity`. The status `div` is the
  first child of a `<section>` that is a grid with explicit row tracks: `grid-rows-[auto_1fr_auto]` (non-board) and
  `.cs-board { grid-template-rows: auto 1.625rem 2rem minmax(7.5rem,1fr) auto }` (board). A `display:none` child is
  not a grid item, so every remaining zone shifts up one track.
- Non-board (no lanes, the common Canvas compact card): `.cs-body-host` (`container-type:size`, 0 intrinsic height)
  lands in the `auto` track and collapses to 0 px. The metrics strip takes the `1fr` track. The recap and feed vanish.
- Board (lanes present): the sub line takes `auto`, `Now` takes 1.625rem, the lanes zone (`min-height:7.5rem`) is
  squeezed into the 2rem track and clipped by `overflow-hidden`, and metrics land in the `1fr` track.
- Why the specs miss it: `compact-session-card.component.spec.ts:211-224` only asserts the class string and that
  the node is still in the DOM. jsdom has no layout.
- Impact: the exact surface L2 targets (Canvas compact card) loses its body or its lane zone. This is a regression
  in the main view of the host, introduced by the fix.
- Fix: do not remove a grid item with CSS. Add an input to `CompactSessionActivityComponent`, for example
  `showStatus = input(true)`. Wrap the status `div` in `@if (showStatus())`. Choose the track list from it
  (`grid-rows-[1fr_auto]` when off, and a `.cs-board.cs-no-status` rule without the first track). Bind it from the card.
  Add a spec in `compact-session-activity.component.spec.ts` that checks the section's track count, and visually
  re-check the Canvas compact card at one lane and at zero lanes.

### M1 (Moderate) - L2 host signal is a semantic coupling

- File: `compact-session-card.component.ts:212`.
- `RAIL_TRANSCRIPT_RETENTION` is documented as "Opts a contextual Rail host into four-tab transcript retention"
  (`libs/frontend/chat/src/lib/tokens/session-context.token.ts:65`). Using it to mean "the Canvas focus header owns
  title/status/toggle" ties two unrelated concerns together.
- Checked: today `[retainRailTranscript]="true"` has exactly one production binding
  (`canvas-detail-transcript.component.ts:29`). The only other `SessionEmbedComponent` consumers found in
  `libs/` and `apps/` are specs. There is no setup-hub or builder embed. `canvas-rail-card.component.ts:107,141`
  uses `variant="rail"`, which is a separate branch, and is not inside the embed injector. So nothing breaks now.
- Failure scenario: a later embed sets `retainRailTranscript` for a memory reason (it keeps four transcripts alive),
  and its compact card silently loses title, status and Full view with no header to replace them. Conversely, a
  Canvas-like host without retention keeps the duplicates.
- Fix: add a dedicated host-chrome signal (a `SessionEmbed` input and token such as `HOST_OWNS_SESSION_CHROME`, set
  by `CanvasDetailTranscriptComponent` next to `retainRailTranscript`). If the token is kept, add a comment at
  `compact-session-card.component.ts:212` and a spec in `canvas-detail-transcript.component.spec.ts` that ties the two.

### M2 (Moderate) - L2 drops information the Canvas header does not carry

- Files: `compact-session-card.component.ts:151-161,166-168`;
  `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts` (title, `state()`, Compact/Full toggle `data-compact`).
- Title, the Compact/Full toggle (always rendered whenever `focusedTabId` is set,
  `canvas-focus-area.component.ts:33-57`) and the coarse state are present, so there is no state where the user
  cannot return to the full view.
- Lost: (a) the "N needs you" count. The header shows only the word `needs`, and the callout shows one request.
  (b) the finer status texts from `compact-session-summary.ts:684-732` (`Compacting`, `Limit reached`, `Stopped`,
  `Needs attention`, `Failed`), which `CompactRailState` (running/needs/error/done/idle) cannot tell apart.
  (c) `status.workspaceLabel` in the hidden row.
- Fix: accept the loss for (c). For (a) and (b), keep one compact status chip (not the whole row) or confirm with
  the reviewer of the visual finding that the coarse state is enough.

### M3 (Moderate) - L3b: a card can stay open after a quick sweep across the dock (pre-existing, same symptom)

- File: `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:343-346,331-341,405-411`.
- Trace: the card for tab A is open (`cardKey=A`). The pointer leaves A, which queues the A close timer. It enters B
  (`onPointerEnter` runs `clearCardTimer()` and starts the open timer for B). It leaves B inside 220 ms.
  `onPointerLeave(B)` clears the open timer and calls `queueCardClose(B)`. That returns early because
  `cardKey() !== B`. The A close timer was already cancelled, so the A card stays open with no pointer on it.
  `cardHovered` is false and `tabHoveredKey` is null. Only Escape or a new hover closes it.
- The diff (`:focus` to `:focus-visible` at line 416) fixes the click-focus case but not this one.
- Fix: in `onPointerLeave` use `this.queueCardClose(this.cardKey() ?? key)`. Add a spec: enter A, open, enter B,
  leave B at 100 ms, advance 220 ms, expect no tooltip.

### M4 (Moderate) - L6: stale-tile cleanup now only reaches panes that are rendered

- Files: `apps/ptah-electron-e2e/src/showcase/canvas-orchestra.scene.ts:120-133`,
  `chat-code-edit.scene.ts:209-221`, `lane-console-review.scene.ts:95-112`.
- `data-testid="canvas-tile"` exists only on the one or two focused panes
  (`canvas-rail-board.component.ts:162`). A stale `agent-N` / `code-edit` / `lane-review` session that is not
  focused is never matched, and the loop `return`s on the first non-matching focused pane. The old grid showed
  every tile. A leftover session stays, and a later `.first()` or title lookup can hit the wrong one.
- Fix: also match rail cards (aria-label "<title>, <state>" in `canvas-rail-card.component.ts`), or focus the stale
  card before closing. Otherwise record the limitation in the scene comment.

### Minor

- m1 `canvas-rail-board.component.ts:228`: `btn-xs btn-square w-11` makes the strip control 24 px tall (btn-xs) and
  44 px wide. The spec only checks classes. Confirm the target size visually (WCAG 2.5.8 needs 24 px, so it passes).
- m2 `canvas-rail-board.component.ts:229-232`: `aria-expanded="false"` is a static string (pre-existing). It is
  correct only because the branch renders when the sheet is closed. Bind it to `detailsOpen()` to stay correct if
  the branch conditions change.
- m3 `compact-session-card.component.ts:151,161,166`: the new `@if (!canvasHost)` blocks are not indented in the
  template (style only, for the style reviewer).

## Per-item check

| Item | Result | Evidence |
| --- | --- | --- |
| L1 usage contrast | PASS | All 7 spans use `text-base-content-muted` (`cli-lane-usage-summary.component.ts:31-56`). The `--bcm` floor is 5.01:1 on base-100/200/300 for anubis and anubis-light (`tailwind.config.js:104-110,182-188`), and `base-content-muted.spec.ts` enforces 4.5:1 per theme. No information is lost: each span keeps its text prefix (`ctx`, `in`, `out`, `cache read`, `cache write`, cost) and its `title`. Only the hue cue is gone. The light page (250,247,245) is darker than base-100 (`oklch 97.8%`), so the real ratio is a little below 6.03 and still above 4.5. Spec `:47-52` is a valid check (7 spans: ctx, in, out, cache read, cache write, cost, duration). |
| L2 Canvas compact card | FAIL (S1), WARN (M1, M2) | Single production binding confirmed. Full-view return path exists (`data-compact` toggle). Layout break at `:174`. |
| L3a strip opener | PASS | Old button had `aria-label`, static `aria-expanded="false"`, `(click)="toggleDetails()"` and no `aria-describedby` or `data-*`. All kept. `title="Session details"` added, `PanelRight` icon uses `aria-hidden="true"`, `LucideAngularModule` is imported at `:30,69`. Focus outline matches the header button. No `class` plus `[class]` conflict. |
| L3b hover close | PASS for the stated case, WARN (M3) | Click focus is no longer retained (`:416`). Tab to card move: tab leave queues a 220 ms close, card `pointerenter` calls `clearCardTimer()` (`:360-363`), the card has no gap (`offset:0`). Card leave queues the close. Keyboard focus opens via `:focus-visible` (`:351`) and is retained. Escape works through `document:keydown.escape` (`:79,367-371`). Blur queues the close. Timer cleanup is on destroy (`:286`). No listener is added, so none leaks. |
| L5 inspector | PASS | `aria-label` now `at least ` + `formatTokenCount(...)` + ` tokens` (`inspector-agents-section.component.ts:197`) and matches the visible `12.0k`. The spec asserts the exact string (`spec:94`). The null-totals plus `segments: []` spec (`:75-81`) matches the code path (`cliTokens` null, `cliUsagePartial` false, `:362-368`). Cost aria-label (`:203`) already used the formatter. |
| L6 e2e selectors | PASS with M4 | `ptah-canvas-focus-header strong[title]` (`canvas-focus-header.component.ts`, `<strong ... [title]="title()">`), `Close session` button (`aria-label="Close session"`), `canvas-tile` (`canvas-rail-board.component.ts:162`), `canvas-grid` (`orchestra-canvas.component.ts:83`) all exist. `getByRole` name "Close session" cannot hit "Close pane"/"Close split" (menu items). No `.tile-header`, `Close tile` or `.grid-stack-item` remain under `apps/ptah-electron-e2e/src`. Imports and types are unchanged, so no TS error is visible by reading. The exploration code still avoids the close control. The stale-close loops stay bounded (20 iterations, `catch`). |

## Five logic questions

1. Silent failure: S1 shows no error and the body is just 0 px high. The pointer-sweep card (M3) fails silently.
2. Unexpected user action: sweeping the pointer across the dock leaves a card open (M3). In Canvas compact the
   user sees no count of pending requests (M2).
3. Wrong output for input data: a session with no lanes renders a collapsed body (S1, non-board branch).
4. Dependency failure: `matches(':focus-visible')` is unsupported or throws only in old engines. Electron's Chromium supports it.
5. Missing: no layout or visual check on the Canvas compact card after L2. The batch report records no
   visual re-check, and diagnostics were "Unavailable".

## Angular rules

OnPush and signals unchanged. `inject()` for the token, `input()`/`output()` unchanged. The `[class]` binding on
`ptah-compact-session-activity` replaced the old static `class` (no both-on-one-element). No `any` and no casts in
the changed source. `compact-session-card.component.ts:212` compares `=== true`, which is safe for the boolean token.

## Verdict

NEEDS_FIXES. Fix S1 before merge (add a `showStatus` input to the activity component, no CSS removal of a grid
item). M1 to M4 are recommended. L1, L3a, L5 and the L6 selectors are sound.
