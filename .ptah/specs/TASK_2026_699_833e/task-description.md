# Requirements - TASK_2026_699_833e

Revision: 3 (AC 3.6 amended per `decisions.md` row 10: Electron width is install-wide, VS Code
width is per webview view type). Revision 2 added requirement 7, PLAN LIMITS cards, per
`task-description-review.md` Finding 1 and `decisions.md` row 7.

## Context

The "This session" inspector (`ptah-session-inspector`,
`libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.ts:57`)
is mounted by the full main chat panel in
`libs/frontend/chat/src/lib/components/templates/chat-view.component.html:283-317` (`.cs-inspector`).
Its open state, width band, modal sheet and focus routine live in `InspectorShellController`
(`libs/frontend/chat/src/lib/services/session-inspector/inspector-shell.controller.ts:94`). The
controller observes the `.cs-shell` element and picks a band: `docked` at >= 960 px
(`INSPECTOR_DOCKED_MIN_WIDTH`, line 23), a 336 px modal `sheet` at 640-959 px, and a full-width
modal sheet below 640 px (`INSPECTOR_SHEET_MIN_WIDTH`, line 25). The docked width is a fixed
336 px in CSS (`chat-view.component.css:17-26`); there is no resize handle and no width
persistence. The only opener is the icon toggle in the session header
(`libs/frontend/chat/src/lib/components/molecules/session-header/session-header.component.ts:171-200`),
which also carries the closed-state cues (dot, context ring, limit cue). The docked open/closed
choice is in-memory, per tab and per view mode (`inspector-open-state.service.ts:17-60`).

The user asked to make the inspector a resizable side dock that behaves like the existing rails:
open/close with the vertical `ptah-sidebar-tab` used by the Workspaces and Git rails
(`libs/frontend/chat-ui/src/lib/atoms/sidebar-tab.component.ts`;
`libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:323-372`), a drag
handle like the Git dock (`ptah-electron-resize-handle` + `ElectronLayoutService` width/drag state,
`libs/frontend/core/src/lib/services/electron-layout.service.ts:180-195,708-718`; `ptah-split-handle`
for the VS Code webview, `libs/frontend/chat-ui/src/lib/atoms/split-handle.component.ts`), a
persisted width clamped to min/max, a wider default on large screens, and the current sheet/modal
presentation kept on narrow widths. Evidence: dark and light screenshots at 1440 px and 760 px.

The inspector is the main place to read session cost, context, agents, plan limits, task, todos
and git state. A fixed 336 px column truncates that content on large screens, and its only toggle
is a small header icon that is not discoverable the way the rail tabs are.

Added by the user after Gate 1 started (`context.md`, Conversation Summary; `decisions.md` row 7):
the PLAN LIMITS section should become cards, with the center item on its own full-width row.
Today `ptah-inspector-limits-lanes`
(`libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-limits-lanes.component.ts:39-45`)
renders one `ptah-plan-limit-tile` per plan window with `variant="inspector"`. The tile
(`libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.ts:57-118`)
puts the label, the center content (status text "unknown · resets …", or progress bar + value),
and the state chip ("? Usage unknown", "50% used") in one flex row; the reset line and source
chips ("Live event", "Provider API") sit under it indented by `pl-[4.5rem]` (lines 119-145); the
chevron is absolutely positioned (lines 146-152). In a 336 px column the center wraps badly. The
inspector variant already has its own face class (`faceClass`, lines 189-191). The tile's other
consumer is the session stats card `session-stats-summary.component.html:442-448`, which uses the
default `strip` variant; the dashboard provider-account card does not use this tile.

## Classification

- Type: FEATURE — adds a toggle surface, a resize gesture and width persistence to an existing panel.
- Estimate: M — one host template, one controller and its CSS in `libs/frontend/chat`, a width
  state with persistence in two hosts (Electron and VS Code webview), and keyboard/a11y on the
  handle; plus a layout change to one presentational tile variant in `libs/frontend/chat-ui`
  (requirement 7); no backend or RPC change.
- Priority: not defined here.

## Scope

In scope:

- A vertical `ptah-sidebar-tab` on the chat view that opens and closes the inspector, in the full
  main chat panel of both hosts (Electron renderer and VS Code webview).
- A drag resize handle between the main column and the docked inspector, with pointer and keyboard
  operation, in both hosts.
- A docked inspector width that is clamped to a minimum and a maximum, persisted, and restored.
- A larger default docked width on large shells, and the current 336 px default on standard ones.
- Keeping the 640-959 px sheet and the < 640 px full-width sheet presentations, their modal
  semantics, scrim, focus trap and focus restore.
- Keeping the session-header toggle working and in sync with the new tab.
- Unit/component tests for the new behaviour, and the dark + light screenshots at 1440 and 760.
- PLAN LIMITS cards in the inspector: each plan window rendered as a card whose center item
  (status text or progress bar + value, reset text, source chips) takes its own full-width row,
  with label, state chip and chevron on the header row (requirement 7). Inspector variant only.

Out of scope:

- Persisting the inspector's open/closed choice across reloads or restarts — today it is in-memory
  per tab (`inspector-open-state.service.ts:17`); the request does not ask to change it. A
  follow-up task can add it (see Clarifications).
- The Canvas Rail board host (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:203,221,259,268`),
  which shows the inspector `embedded` or as its own sheet — it is not the chat-view dock the
  user named; it must keep working unchanged.
- Canvas tiles, the compact session card, forced cards and `'bare'` embeds — they host no
  inspector today (`chat-view.component.ts:1102-1105`) and get no tab or handle.
- Content, order or styling of the other inspector sections (Orchestrator, SESSION, AGENTS,
  LANES, TASK, TODOS, GIT) beyond reflowing to the new width — not requested; only PLAN LIMITS
  was asked to change (requirement 7).
- The `strip` variant of `ptah-plan-limit-tile` in the session stats card
  (`session-stats-summary.component.html:442-448`), lane tiles and the subtotal tile, and the
  dashboard provider-account card — the user asked about the inspector section only; they keep
  today's layout.
- The plan-limit data, wording, tones, source logic and detail-panel content
  (`plan-window-detail.component.ts`) — the request is a layout change.
- Resizing the narrow-band sheets — the request keeps sheet/modal as is.
- Changing the band thresholds (960 / 640 px) — not requested.
- The Agents panel, Display dock, Workspaces sidebar and Git dock behaviour and widths.

## Requirements

### 1. Open and close from a vertical sidebar tab

Requirement: user of the full main chat panel — opens and closes "This session" from a vertical
rail tab like Workspaces and Git — the inspector is discoverable and toggled the same way as the
other rails.

Acceptance criteria:

1. When the full main chat panel shows a tab and the chat-view shell is in the docked band
   (>= 960 px), the system shall render a `ptah-sidebar-tab` on the right edge of the chat view
   whose label names the inspector, with `aria-expanded` equal to the inspector's open state.
2. When the user clicks that tab or presses Enter/Space on it while the inspector is closed, the
   system shall open the docked inspector; when it is open, the system shall close it.
3. When the shell is in the sheet or full-sheet band and the sheet is closed, the system shall
   still show the tab, and activating it shall open the modal sheet exactly as the header toggle
   does today (scrim, `role="dialog"`, `aria-modal="true"`, focus moves to "Close session details").
4. When the modal sheet is open, the system shall keep the tab unreachable by Tab key and pointer
   (focus stays trapped in the sheet; the scrim intercepts clicks).
5. When the inspector is opened or closed by any of the tab, the header toggle, the inspector's
   close button, Escape or the scrim, the system shall show the same open state on the tab
   (`aria-expanded`, active indicator) and the header toggle (`aria-pressed`, label) without a
   render lag of more than one change-detection pass.
6. When the inspector closes and focus was on or inside it, the system shall return focus to the
   control that opened it (tab or header toggle); when that control is gone, to the session title;
   never to `body`.
7. When the view is a canvas tile, a compact or forced card, or a `'bare'` embed, the system shall
   render neither the tab nor the handle.
8. When the closed inspector has a pending request, a plan-limit cue or a workflow cue, the
   system shall keep showing the header toggle's dot (`limitAwareDot`) as today, and shall show a
   matching `badgeType` on the tab.

### 2. Drag and keyboard resize of the docked inspector

Requirement: user with the inspector docked — changes its width by dragging or by keyboard — sees
more or less session detail without leaving the chat.

Acceptance criteria:

1. When the inspector is docked and open, the system shall render a vertical separator between the
   main column and the inspector with `role="separator"`, `aria-orientation="vertical"`, an
   accessible name, `aria-valuenow` (current width, px), `aria-valuemin` and `aria-valuemax`.
2. When the user drags the separator, the system shall set the inspector width to follow the
   pointer, measured from the inspector's own right edge (not the window edge), in both hosts,
   including when the Electron Git dock is open to the right of the chat panel.
3. When the separator has focus and the user presses ArrowLeft/ArrowRight, the system shall widen /
   narrow the inspector by a fixed step and update `aria-valuenow`.
4. When the user presses Escape during a drag, or the window loses focus during a drag, the system
   shall restore the width the drag started with and end the drag.
5. When the user double-clicks the separator, the system shall reset the width to the default for
   the current shell size (requirement 4).
6. While a drag is in progress, the system shall suppress text selection and the inspector's
   entrance animation, and shall show a `col-resize` cursor.
7. When the inspector is in the sheet or full-sheet band, or closed, the system shall render no
   separator.

### 3. Clamping and persistence

Requirement: user — has a width preference that survives reloads and never breaks the layout.

Acceptance criteria:

1. When a drag or key step would go below the minimum width, the system shall stop at the minimum;
   above the maximum, at the maximum. The minimum and maximum are named constants next to
   `INSPECTOR_DOCKED_MIN_WIDTH` and recorded in the design spec.
2. When docked at any shell width, the system shall keep the main chat column at least 624 px wide
   (960 - 336: the narrowest docked main column today), lowering the effective maximum on narrow
   docked shells.
3. When the shell narrows so the stored width no longer fits, the system shall render the clamped
   width without overwriting the stored preference; when the shell widens again, the stored width
   shall come back.
4. When a drag ends or a key step is taken, the system shall persist the width; when the Electron
   app is restarted or the VS Code webview is reloaded, the system shall restore it.
5. When the stored value is missing, not a finite number, or out of range, the system shall use the
   default (requirement 4) or the clamped value, and shall not throw.
6. When two chat views exist in the same storage scope, the system shall use one shared
   inspector width for them. In Electron the scope is the whole install (every workspace and
   chat view of the app). In VS Code the scope is one webview view type: the sidebar
   (`ptah.main`) and editor panels (`ptah-angular-spa`) each keep their own width, and a width
   set in one view type is not required to appear in the other. No new RPC or host setting is
   added for this. (Amended in revision 3 per `decisions.md` row 10.)

### 4. Default widths per shell size

Requirement: user on a large screen — sees a wider inspector by default; user on a standard screen
keeps today's width.

Acceptance criteria:

1. When no width is stored and the docked shell is narrower than the large-screen breakpoint, the
   system shall dock the inspector at 336 px (today's width).
2. When no width is stored and the docked shell is at or above the large-screen breakpoint, the
   system shall dock it at a larger default. The breakpoint and the default are named constants
   recorded in the design spec.
3. When the Electron window is 1440 px wide with the Workspaces sidebar open and the Git dock
   closed, and no width is stored, the system shall dock the inspector wider than 336 px.

### 5. Narrow widths keep the sheet / modal

Requirement: user on a narrow window or the VS Code sidebar — keeps today's sheet behaviour.

Acceptance criteria:

1. When the shell is 640-959 px wide and the inspector is opened, the system shall show it as a
   modal sheet `min(336px, 100%)` wide over a scrim, with the main column `inert`.
2. When the shell is < 640 px wide, the system shall show a full-width modal sheet.
3. When the sheet is open, the system shall trap Tab/Shift+Tab inside it, close it on Escape (unless
   an inner request panel already handled Escape) and on a scrim click, and restore focus per 1.6.
4. When the shell crosses from docked to sheet band, the system shall close the sheet and keep the
   docked choice; when it crosses from sheet (open) to docked, the inspector shall stay open docked,
   at the stored or default width.
5. When the user switches tab or session with the sheet open, the system shall close the sheet.

### 6. Visual evidence

Acceptance criteria:

1. When the work is handed to review, the task folder shall contain Electron screenshots in dark and
   light theme at 1440 px (inspector docked, open, handle visible, tab active) and at 760 px
   (inspector open as a sheet), i.e. four images, referenced from `visual-review.md`.
2. When the work is handed to review, the task folder shall also contain dark and light
   screenshots of the PLAN LIMITS section at 1440 px and 760 px (four images), showing at least
   one unknown-usage card and one known-usage card, referenced from `visual-review.md`.

### 7. PLAN LIMITS windows as cards

Requirement: user reading the inspector — sees each plan window (5-hour, Weekly, …) as a card
whose usage line is not squeezed between the label and the state chip — reads the status text,
progress bar and reset time without bad wrapping.

Acceptance criteria:

1. When the inspector PLAN LIMITS section renders plan windows, the system shall render each as
   its own card (visible border or surface separating it from its neighbours), one card per
   `ptah-plan-limit-tile`.
2. When a card renders, its header row shall contain the window label on the left and the state
   chip (e.g. "? Usage unknown", "50% used") plus, for expandable tiles, the expand chevron on the
   right; the center item shall not share that row.
3. When the window's usage is unknown (tile kind `status`), the system shall show the status text
   (`value · resetLine`, `data-testid="plan-limit-status"`) on its own row below the header that
   spans the card's full inner width, with no left indent reserved for the label.
4. When the window's usage is known (a bar is drawn), the system shall show the progress bar
   (`role="progressbar"`, same `aria-valuenow`/`aria-valuetext`/`aria-label` as today), the value
   and the reset text on a full-width row (or rows) below the header, with the bar spanning the
   card's inner width minus the value text.
5. When a tile has its own caption or source chips (e.g. "Live event", "Provider API"), the system
   shall still show them inside the card under the center row; when the section header already
   shows them (`captionShared`, `sharedSources`), the card shall omit them as today.
6. When the user activates an expandable card (click, Enter or Space), the system shall toggle its
   detail panel as today (`aria-expanded`, `aria-controls`, panel `hidden` while closed, chevron
   up/down); non-expandable kinds (`status`, `local-usage`) shall stay non-interactive.
7. When the card renders, every cue present today shall still be present: label, value, chip text
   and glyph, tone accent and bar fill colour, reset text, caption, source chips, `title`
   tooltips, `data-testid` hooks and `data-tile-id`.
8. When `ptah-plan-limit-tile` is rendered with the default `strip` variant
   (`session-stats-summary.component.html:442-448`), the system shall render it as today; the
   existing `plan-limit-tile.component.spec.ts` and `session-stats-summary.component.spec.ts`
   cases pass unchanged or with only selector updates.
9. When the inspector is docked at its minimum width, docked at a wide width, or shown as the
   760 px sheet, the center row shall not overflow the card horizontally.

## Non-functional requirements

- Accessibility: tab and separator reachable and operable by keyboard; separator exposes the ARIA
  separator value attributes; visible focus indicator on both; `prefers-reduced-motion` keeps
  disabling the inspector animation (`chat-view.component.css:197-200`).
- Compatibility: Electron renderer and VS Code webview; the Canvas Rail board inspector keeps its
  `embedded` and `sheet` presentations unchanged.
- Performance: during a drag, width updates at most once per animation frame (both existing handles
  already do this).

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| --- | --- | --- |
| Electron desktop user | A wider, resizable inspector toggled like the other rails | Tab opens/closes it; drag sticks across restart |
| VS Code extension user | Same dock in the editor-panel webview; sidebar keeps the sheet | Docked + handle in wide panels; sheet in the sidebar |
| Keyboard / screen-reader user | Operable tab and separator with announced state | Arrow keys resize; `aria-expanded`/`aria-valuenow` correct |
| Maintainers of chat-view | No regression in sheet focus logic, header toggle, Rail host | Existing chat-view and canvas-rail specs pass |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| `ptah-electron-resize-handle` computes width as `window.innerWidth - x` (`electron-resize-handle.component.ts`), wrong for a dock not at the window edge, and has no keyboard support | HIGH | HIGH | Architect picks a handle that measures from the inspector edge and supports keys (e.g. `ptah-split-handle`) or extends the Electron handle; AC 2.2/2.3 tested in both hosts |
| `ElectronLayoutService` is Electron-shell state; the inspector also runs in the VS Code webview | MEDIUM | MEDIUM | Architect places the width state where both hosts can read and persist it; AC 3.4 tested per host |
| Two openers (tab + header toggle) break focus restore, which looks up `[aria-controls="inspector"]` (`chat-view.component.ts:996-1000`) | MEDIUM | MEDIUM | Developer adds a spec for focus return to the actual opener (AC 1.6) |
| New tab crowds the right edge next to the Agents tab / Display dock | MEDIUM | LOW | Designer fixes order and spacing in the design spec; visual review at 1440/760 |
| `InspectorShellController` has no spec today; band/sheet logic regresses silently | MEDIUM | HIGH | Developer adds a controller spec covering AC 5.1-5.5 before changing it |
| At 1440 px with the Git dock open the chat shell falls below 960 px and shows a sheet, not a dock | HIGH | LOW | Screenshot setup in AC 4.3/6.1 states Git dock closed; designer notes the behaviour |
| `ptah-plan-limit-tile` is shared with the session stats card (`strip` variant); a layout edit leaks into it | MEDIUM | MEDIUM | Developer scopes the card layout to the `inspector` variant and adds a spec per variant (AC 7.8) |
| The inspector also mounts in the Canvas Rail board and is captured by `webview-e2e-harness/.../plan-limits-visual.e2e.spec.ts`; its baselines shift | MEDIUM | LOW | Visual reviewer re-captures that scenario and records the expected diff in `visual-review.md` |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the session-header toggle alongside the new tab | keep / remove | Header toggle carries dot, context ring and limit cue (`session-header.component.ts:171-200`); request does not ask to remove it | yes |
| Main column floor when docked = 624 px | 624 / 400 (Electron chat min) / ratio cap | 960 - 336 = narrowest docked main column today | yes |
| One persisted width, shared install-wide in Electron and per webview view type in VS Code (decisions.md row 10) | per tab / shared | Git dock and Workspaces width are shared (`electron-layout.service.ts:708-718`); VS Code partitions webview storage by view type | yes |
| Required screenshots are Electron (4 images); VS Code covered by component tests | Electron only / both hosts | Electron e2e screenshot harness exists (`apps/ptah-electron-e2e`); no VS Code webview screenshot harness found | yes |
| Sheets stay non-resizable at 336 px / full width | resizable / fixed | "Keep the sheet/modal presentation on narrow widths" | yes |

## Open questions

- Exact tab label ("Session" vs "This session") and position relative to the Agents tab and the
  Display dock — ui-ux-designer.
- Minimum, maximum, large-screen breakpoint and large default values — ui-ux-designer, within
  AC 3.1-3.2 and 4.1-4.3.

## Clarifications Needed

1. Should the inspector's open/closed state also persist across restarts, like the Workspaces and
   Git rails do?
   - No, keep today's per-tab in-memory rule (Recommended)
   - Yes, persist one global open/closed state
   - Yes, persist per tab
2. Should the VS Code webview also get dark/light screenshots at 1440 and 760?
   - No, Electron screenshots plus component tests for VS Code (Recommended)
   - Yes, eight screenshots across both hosts

## Handoff

- Next specialist: ui-ux-designer, then software-architect.
- Why: the tab placement and width constants are design calls, and the shared width state across
  Electron and the VS Code webview is the architectural question. The designer also specifies the
  PLAN LIMITS card (requirement 7).
- Likely affected files for requirement 7:
  `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.ts` (+ spec),
  possibly `plan-limits/stats-tile.styles.ts`, and
  `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-limits-lanes.component.ts`
  (card grid spacing). `plan-window-detail.component.ts` content is unchanged.
