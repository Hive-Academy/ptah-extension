# @ptah-extension/tasks-ui

[Back to Main](../../../CLAUDE.md)

## Purpose

Standalone **Tasks** board surface (TASK_2026_157, Phase 1). Renders the
`.ptah/specs/` task folders as a six-column Kanban board driven entirely by the
`tasks:*` RPC namespace, with a task-detail panel that renders the `task.md`
markdown body through the DOMPurify chokepoint.

## Boundaries

**Belongs here**: the Tasks board UI (view, board, column, card), the detail
panel, and `TasksStore` (signals + `tasks:changed` push handler + RPC calls).

**Does NOT belong**: backend scanning / indexing (→ `@ptah-extension/task-specs`),
the orchestration start flow (Batch D wires `TaskStartService`; the card's Start
button is a placeholder here), any `chat` coupling.

## Public API (from `src/index.ts`)

`TasksViewComponent` (the surface, bound to `TASKS_VIEW_COMPONENT`), `TasksStore`
(root-provided; joins `MESSAGE_HANDLERS`), the presentational
board/column/card/detail components, and `TASKS_CHANGED_MESSAGE_TYPE`.

## Internal Structure

- `src/lib/services/tasks-store.service.ts` — root-provided signal store; all
  data via `ClaudeRpcService` (`tasks:board/get/create/updateStatus/reindex/
generateRegistry`); `MessageHandler` for `tasks:changed` → refresh. **No
  optimistic state** (R5.7): status changes re-fetch the authoritative board.
- `src/lib/components/tasks-view.component.ts` — smart page: header actions
  (New Task, Registry, excluded chip, Reindex), empty state with create CTA,
  board + detail panel, New Task modal.
- `src/lib/components/board/` — `task-board`, `task-column`, `task-card`
  (all presentational, pure `@Input`/`@Output`).
- `src/lib/components/detail/task-detail.component.ts` — frontmatter facts,
  `depends_on`, validation warnings, body via `MarkdownBlockComponent`.
- `src/lib/task-presentation.ts` — status/type label + daisyui badge maps.

## Dependencies

**Internal**: `@ptah-extension/shared` (task-spec plain types + `tasks:*` RPC
contracts), `@ptah-extension/core` (`ClaudeRpcService`, `MessageHandler`),
`@ptah-extension/markdown` (`MarkdownBlockComponent`).

**External**: `@angular/core`, `@angular/forms`, `lucide-angular`.

## Angular Conventions Observed

Standalone, `ChangeDetectionStrategy.OnPush` on every component, signals +
`computed()` + `inject()` exclusively, zoneless-compatible, `track` on all
`@for`, Tailwind 3 + daisyui 4 classes.

## Guidelines

1. **Never bind the task body via `[innerHTML]`** — route through
   `MarkdownBlockComponent` (NFR-10). The detail component is the only renderer.
2. **No backend lib imports, no `chat` import** (NFR-11). Cross-lib launch
   (Batch D) inverts through the `AppStateManager` signal bridge.
3. **No optimistic board state.** The board only moves on an authoritative
   re-fetch or the `tasks:changed` push.
