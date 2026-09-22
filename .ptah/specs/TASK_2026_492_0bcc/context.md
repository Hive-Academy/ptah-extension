# Context

Parent research: `.ptah/specs/TASK_2026_490_583c/research-report.md`. Read Revision 4, Revision 5 and Revision 6 first. They replace the earlier revisions
where they disagree.

Lane A. Depends on: none.

## Scope of the specification

1. Two navigation sets: code workspace (Chat, Apps, Tasks, Tribunal, Analytics) and space (Home, Chat, Apps, Schedules). Location of the global configuration area (Thoth, Setup hub, Marketplace, Settings). Give every surface in both sets a stable addressable id, and say which surfaces must stay mounted when the user leaves them. See "Navigation mechanism" below.
2. Home: a grid of pinned apps (gridstack is already in `libs/frontend/canvas`).
3. Pin flow: temporary card in the chat, "Pin to Home", and what the user sees before the pin (refresh source, schedule, cost).
4. Tile states: loading, fresh, stale, failed, auth necessary, schedule stopped because Ptah was closed.
5. Three permission levels: silent read with a log entry, staged change with a "Commit" button, destructive action with a confirmation in plain language.
6. Catalog components for TASK_2026_493: stat, line chart, bar chart, table, list. Text fallback.
7. Accessibility: keyboard entry and exit, focus return, chart alternative as a table, no color-only encoding.

## Constraints

- Angular 22.1.7, signals, OnPush, Tailwind 3 + daisyui 4. Use the project tokens.
- Electron only. The VS Code extension keeps one workspace and no spaces.
- "Workspace" stays one concept with a type. Do not add a second word to the interface.
- The plugin consent dialog and the permission card stay hand-built.

## Evidence

- `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:122-205` (8 tabs), `:232-233` (welcome screen without a folder).
- `libs/frontend/core/src/lib/services/app-state.service.ts:20-33` (`ViewType`), `:244-262` (partition for each workspace path).

## Navigation mechanism

Added 2026-09-22. Sibling task: `.ptah/specs/TASK_2026_524_1125`.

That task establishes that the Angular Router **can** run in the shared webview,
behind a custom in-memory `PlatformLocation`. The old rule that the Router is
impossible here was documentation, not a measured limit. Three lane reports in
that task folder carry the evidence.

This changes nothing in the scope above, and this task still writes no product
code. It changes two things in how the specification must be expressed:

1. Describe navigation as a set of **addressable surfaces**, each with a stable
   id, rather than as a row of tab buttons. The ids become the route table. This
   spec requires only that the id stays stable across releases. Where the active
   id is persisted and how it is restored at startup are not defined here.
2. Mark every surface that must **stay mounted** after the user navigates away.
   The chat and canvas area is already one, because its always-mounted pattern
   protects `CanvasStore`. A surface marked this way cannot sit in a plain route
   outlet, so the specification must state the intent rather than leave the
   implementer to guess it.

TASK_2026_524_1125 batch 1 runs in parallel with this specification. It replaces
the navigation mechanism under today's view ids and keeps every id in one
constant, so the remap into the two navigation sets defined here is a single
edit. Nothing in this specification is blocked by it.

## Source

`.ptah/specs/TASK_2026_490_583c/research-report.md` Revision 5. `.ptah/specs/TASK_2026_490_583c/critique-product.md` section 5.
