# Context

Parent research: `.ptah/specs/TASK_2026_490_583c/research-report.md`. Read Revision 4, Revision 5 and Revision 6 first. They replace the earlier revisions
where they disagree.

Lane A. Depends on: none.

## Scope of the specification

1. Two navigation sets: code workspace (Chat, Apps, Tasks, Tribunal, Analytics) and space (Home, Chat, Apps, Schedules). Location of the global configuration area (Thoth, Setup hub, Marketplace, Settings).
2. Home: a grid of pinned apps (gridstack is already in `libs/frontend/canvas`).
3. Pin flow: temporary card in the chat, "Pin to Home", and what the user sees before the pin (refresh source, schedule, cost).
4. Tile states: loading, fresh, stale, failed, auth necessary, schedule stopped because Ptah was closed.
5. Three permission levels: silent read with a log entry, staged change with a "Commit" button, destructive action with a confirmation in plain language.
6. Catalog components for TASK_2026_493: stat, line chart, bar chart, table, list. Text fallback.
7. Accessibility: keyboard entry and exit, focus return, chart alternative as a table, no color-only encoding.

## Constraints

- Angular 21, signals, OnPush, Tailwind 3 + daisyui 4. Use the project tokens.
- Electron only. The VS Code extension keeps one workspace and no spaces.
- "Workspace" stays one concept with a type. Do not add a second word to the interface.
- The plugin consent dialog and the permission card stay hand-built.

## Evidence

- `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:122-205` (8 tabs), `:232-233` (welcome screen without a folder).
- `libs/frontend/core/src/lib/services/app-state.service.ts:20-33` (`ViewType`), `:244-262` (partition for each workspace path).

## Source

`.ptah/specs/TASK_2026_490_583c/research-report.md` Revision 5. `.ptah/specs/TASK_2026_490_583c/critique-product.md` section 5.
