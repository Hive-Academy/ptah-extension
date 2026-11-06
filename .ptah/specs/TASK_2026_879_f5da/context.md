# TASK_2026_879_f5da — context

User request (2026-11-04), Electron first:

1. Unify the display side panel (ptah-ui `display` surfaces + HTML artifacts,
   `libs/frontend/chat-ui/src/lib/organisms/display-panel/`) with the markdown file viewer that
   opens when a user clicks a file link in chat. Today that viewer replaces the git sidebar and
   shows markdown only. Target: a clicked file opens as a surface in the same display panel.
2. Support images and PDF files in the display panel, next to HTML artifacts and markdown. All
   content kinds show in the same display panel.
3. Make the display panel detachable, like browser DevTools: two modes, docked in the sidebar
   and a separate window. (`apps/ptah-electron/src/windows/display-window.ts` already exists —
   check what it does.)
4. Remove the link between the turn summary card and the display panel: no "Turn summary" pill
   in the panel strip, no "Open in panel" button on the card. Center the turn summary card in
   the chat column.
5. (Answered) "Pin" stops auto-select and auto-scroll when a surface is created or updated.
   Consider a clearer label or tooltip.
7. (Added 2026-11-04) The Command Center must use the same unified display, including detach.
   History: TASK_2026_853_3401 (PR #858, merged) shipped the detachable display sidebar for the
   main ChatView only. Its plan kept the Command Center on its own rail Display tab
   (`libs/frontend/command-center/src/lib/components/command-rail-display.component.ts`,
   `session-embed.component.ts:116-120`, `command-center-page.component.ts:200`) with no
   detach. Item 3 is therefore an extension of the existing `display-window` work, not new.
## User decisions (2026-11-04)

- D1 PDF: try Chromium's built-in PDF viewer first, because it must work cross-platform
  (Windows, macOS, Linux). If it cannot work under Ptah's protocol/CSP on all three, use pdf.js
  with a locally bundled worker. Record the evidence in the batch report.
- D2 Detach: ONE detached display window for the app. It follows the focused chat tab or
  Command Center session (same model as PR #858).
- D3 (orchestrator default) Only markdown, raster image and PDF links route to the display
  panel. Code files keep opening git review. A direct file click opens even when pinned.

6. Most important: when a user asks for a report or a visual/representational view of their
   work, the agent must load the proper skills (e.g. ptah-surface-authoring, frontend-design,
   dataviz) and publish an attractive HTML artifact (`ptah_artifact_publish`) instead of only
   ptah-ui blocks. Find where skill routing / system prompt / routing reminders decide this.
