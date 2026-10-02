---
id: TASK_2026_583_c0a1
status: done
type: feature
title: 'Compact session view: normal-view content polish and freely adjustable tile height'
branch: feat/task-2026-583-compact-polish
---

# TASK_2026_583 — Compact session view polish

Follow-up to TASK_2026_512_feaa (compact redesign) and TASK_2026_531_compact
(markdown recap, size-adaptive card, layout menu). Three user complaints,
taken from screenshots of the current compact tile.

## Requirements

R1 **Recap pane ("Assistant recap").** Shows the latest assistant prose, rendered
as cleanly as the normal chat view: a modest type scale, inline code chips,
plain lists, no nested bordered boxes and a single scroll area. Tool-result or
tool-error text is never rendered as markdown. A tool failure that the
assistant has not yet followed up appears as a short monospace snippet.

R2 **Feed pane ("Teletype wire stream").** Each tool row reads like the normal
view's tool header: the tool icon, a tool-name badge coloured by status in the
same way as the normal view (`badge-success`, `badge-info` or `badge-error`),
the concise target (a shortened path, a pattern or a command), and a status
icon. A row never shows a tool result body. TERM, PROSE, AGENT, ASK and COMP
rows stay compact.

R3 **Height.** The user can set a compact tile's height freely:

- drag the bottom edge; the height snaps to grid units within `[2, 5]`;
- use the menu presets (Compact = 2, Tall = 3) and a −/+ stepper.

The height is stored per tab and survives a reload. The header toggle stays
binary (full <-> compact) and returns to the last compact height. Legacy
`compact-tall` tabs migrate to compact at 3 units.

## Acceptance criteria

- AC1 A finalized session whose last turn contains a failed Bash call (for
  example a PowerShell `op_Subtraction` error) followed by assistant prose
  shows that prose in the recap, not the error.
- AC2 While the newest activity is a tool failure with no later prose and no
  later successful tool, the recap shows at most 8 lines or 600 characters of
  the error as plain monospace text. The recap has no `<ptah-markdown-block>`
  and no `<pre>` scroll box.
- AC3 A recovered tool error from an earlier point does not set the status to
  "Failed" or the outcome tag to FAILED.
- AC4 Recap prose has no `.prose-list-card` border or background and no
  `pre` element with its own scroll area. Its headings are at most 0.8125rem.
- AC5 A live or finalized tool row shows a `ptah-tool-icon`, a badge whose
  text is the tool name (Ptah MCP tools show their short name), the target
  (no verb prefix), and a check or cross icon when settled. No row text, title
  or expanded detail contains a successful tool's output. A failed tool's
  expanded detail shows the bounded error excerpt.
- AC6 On an unlocked canvas, a compact tile shows only a south resize handle
  and a full tile shows only east and west handles. Dragging the south handle
  commits `compactHeightUnits` clamped to `[2, 5]`. Neighbouring tiles reflow.
  The value survives a reload.
- AC7 On a locked canvas, no resize handle is shown. The menu presets and the
  stepper still change the height, and the grid reflows through the existing
  locked view-change exception without committing a gesture.
- AC8 A persisted tab with `viewMode: 'compact-tall'` restores as
  `viewMode: 'compact'` with `compactHeightUnits: 3`. `TabViewMode` no longer
  contains `'compact-tall'`.
- AC9 These all pass: `nx test chat-ui`, `nx test canvas`,
  `nx test chat-state`, `nx test chat`, and lint for each of those projects.
  The updated `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts` passes.

## Out of scope

- Vertical resize of full tiles (full stays 6 units).
- Changing the cell-height fitting rule in `canvas-layout.service.ts`.
- The permission card's own copy of the path-shortening code.
- Any backend change.
