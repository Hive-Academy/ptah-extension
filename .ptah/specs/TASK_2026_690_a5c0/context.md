# Context — TASK_2026_690_a5c0

Worktree: `.claude-worktrees/chat-layout-display-sheet`, branch `feat/chat-layout-display-sheet`,
based on `feat/sidebar-mcp-card` (= TASK_2026_683 PR #748 + the sidebar MCP card). Rebase on main
after #748 merges.

## User request (2026-10-17, after a manual test of the 683 dev app)

1. "a big issue with our responsive heights and scroll bars inside the chat component, I think it
   plays a critical part in our animation as well". Screenshots (Electron, light theme): the chat
   shows more than one vertical scrollbar (one inside the transcript, one at the far right of the
   pane next to the DISPLAY rail); empty space under the composer; the transcript scroller does not
   fill the height cleanly.
2. "the whole chat needs to be centered properly" (screenshot 2: the transcript column and the
   composer sit off-center; the right DISPLAY rail takes width on the right).
3. "change the display sidebar to a bottom sheet that shows inside the chat session itself, and
   make sure it shows all components together, so rather than clicking open in display we show
   directly in the page; give it the whole chat room to display its content and remove the sidebar
   hassle that conflicts with our main session sidebar".

## User answers (AskUserQuestion, 2026-10-17)

- Sheet behaviour: **Peek bar, expand on demand** — a thin bar above the composer
  ("Display · N items"); when a turn adds or updates a display block the bar pulses and the sheet
  opens to about 40% height; drag or click to full chat height, or collapse. The transcript keeps
  its own scroll.
- Block place: **Inline in the turn only** — each display block renders in full in its turn; no
  "open in display" step; the right DISPLAY rail is removed.

The two answers overlap (the second option text said "no sheet"). Working interpretation, to be
confirmed at plan approval: every `ptah-ui` block renders in full inline in its turn (no
"In display" chip that needs a click); the persistent display panel (`ptah-ui display [id]`
blocks that update in place) moves from the right rail into the peek-bar bottom sheet inside the
session, showing all panels together; the right DISPLAY rail is removed.

## User answers to the plan clarifications (2026-10-17)

- Keep the sheet: **Yes, inline + sheet.** Every block renders in full inline in its turn; the
  peek-bar sheet collects the latest `display [id]` panels plus the turn summaries.
- Approved removal: **only the right DISPLAY rail + toggle** (right-edge tab, width persistence,
  resize separator, overlay mode).
- NOT approved for removal: the chip's "Open in display" action (keep an equivalent: the inline
  block or chip opens/scrolls the sheet to that panel) and the dock pin control (the sheet gets a
  pin button with the same semantics).

## Out of scope

- The session-switch motion itself (683 O22) — but the layout fix must keep it working.
- The `AbortError: Transition was skipped` dev log — fixed in 683.
