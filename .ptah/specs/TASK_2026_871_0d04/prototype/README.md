# Tasks UI static prototype

## What this shows

The self-contained [index.html](index.html) previews the Phase 1 Electron Tasks board, list and spec-folder detail in Ptah's anubis and anubis-light themes. It uses realistic content from `TASK_2026_871_0d04`: carrier metadata, present files, expected missing files, a directory entry, rendered markdown and the inactive Phase 2 run-panel location. Buttons for New Task, Commands, Start and file selection demonstrate placement and visual states; no backend operation is performed. The small **Prototype controls** strip is only for theme preview and is not part of Electron Tasks. Electron owns global branding and theme selection.

## Open

Open `prototype/index.html` directly in a browser with a `file://` URL; no server, build or network resource is needed. Use the strip's theme control, the Board/List switch, a task title to open detail, and Back to return. The screenshots below were captured at browser viewport widths 1280px and 760px.

## Screenshot index

| Surface | Dark 1280 | Light 1280 | Dark 760 | Light 760 |
| --- | --- | --- | --- | --- |
| Board | [board-dark-1280.png](screenshots/board-dark-1280.png) | [board-light-1280.png](screenshots/board-light-1280.png) | [board-dark-760.png](screenshots/board-dark-760.png) | [board-light-760.png](screenshots/board-light-760.png) |
| Detail | [detail-dark-1280.png](screenshots/detail-dark-1280.png) | [detail-light-1280.png](screenshots/detail-light-1280.png) | [detail-dark-760.png](screenshots/detail-dark-760.png) | [detail-light-760.png](screenshots/detail-light-760.png) |

## Lane-introduced constraints

- [lane-proposed] Compact controls have 32px minimum height; primary actions have 36px. This is a prototype sizing choice.
- [lane-proposed] The 1280px board uses five 220px lanes and a 58px terminal Cancelled rail; below 1100px it uses 242px scrollable lanes. Detail rails are 248px and 268px with 16px gutters.
- [lane-proposed] Reader inline allowlist is direct-child lowercase `.md`, UTF-8, at most 1 MiB. This is the proposed safe boundary for the new read API; backend implementation must validate it.
- [lane-proposed] Secondary text uses `base-content-muted` instead of alpha text classes to preserve the measured theme contrast ladder.
- [lane-proposed] The **Prototype controls** strip exists only to switch themes in a standalone HTML file. It must not ship in the Tasks header.
- [project-rule] Structural surfaces come from `apps/ptah-extension-webview/tailwind.config.js:37-41` and `src/styles.css:157-168`; the chat navbar uses them at `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:117`.
- [project-rule] Focus class comes from `libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-styles.ts:11-12`.
- [project-rule] Markdown uses shared `ptah-markdown-block` and its `auto` variant; no unsanitized `innerHTML` (`libs/frontend/markdown/src/lib/markdown-block.component.ts:18-21,27-58`; `task-description.md`, NFR). The reader retains the shared `prose-sm` scale.
- [project-rule] The versionless agent description falls back to “Run through the codex CLI lane.” (`libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts:74-76`).

## Parity

See [parity-inventory.md](../parity-inventory.md) for all 24 retained capability rows and [design-spec.md](../design-spec.md#parity-mapping) for their locations. The static prototype illustrates layout and states; it does not implement persistence, RPC, file opening, bulk mutations or the Phase 2 runner. No capability is proposed for removal.
