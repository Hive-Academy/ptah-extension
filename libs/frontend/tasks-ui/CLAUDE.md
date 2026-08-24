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
  data via `ClaudeRpcService` (`tasks:board/get/create/updateMetadata/reindex/
generateRegistry`); `MessageHandler` for `tasks:changed` → refresh. **No
  optimistic state** (R5.7): status changes re-fetch the authoritative board.
  **Every carrier write goes through `applyMetadata`, and through
  `tasks:updateMetadata` — there is no second mutating call site.** A status
  change is a metadata patch: `updateStatus` is a call onto `applyMetadata`, so
  the board no longer issues `tasks:updateStatus` (the method still exists on
  the wire for the CLI and MCP paths). Writes are serialized per task id by
  `enqueueWrite`, which removes this UI's ability to raise a `TASK_CONFLICT`
  against itself; correctness still comes from the writer's pre-write re-read.
  **Board fetches are coalesced and surface-gated** — see guidelines 8 and 9.
- `src/lib/components/tasks-view.component.ts` — smart page: header actions
  (New Task, Registry, the exclusions drawer trigger, Reindex), empty state with
  create CTA, board + detail panel, New Task modal, exclusions drawer.
- `src/lib/components/board/` — `task-board`, `task-column`, `task-card`,
  `task-list` (all presentational, pure `@Input`/`@Output`).
  **`task-board` and `task-list` are interchangeable at the host**: same
  `TaskBoardColumn[]` input, same six outputs, same selection / pending /
  outcome inputs. A new filter facet or bulk state therefore reaches both
  layouts without either being taught about it — keep it that way rather than
  giving one layout an input the other lacks.
- `src/lib/services/task-view-mode.service.ts` — which layout is active
  (`kanban | list`), persisted in `localStorage` under `ptah.tasks.viewMode`.
  Deliberately NOT part of `SavedTaskView`: a saved view is a lens (filter +
  sort) and the layout applies to every lens equally, so folding it in would put
  a per-machine preference into shared project settings.
- `src/lib/components/detail/task-detail.component.ts` — frontmatter facts,
  `depends_on`, validation warnings, body via `MarkdownBlockComponent`, and the
  **in-place workflow-document viewer**. Each present Workflow stage has TWO
  controls: read here (`readDocument`, fetched over `tasks:getArtifact`) and
  open in the editor (`openArtifact`). They are different intents — do not
  collapse them back into one click. Document markdown goes through
  `MarkdownBlockComponent` like the body: these files are agent-written and no
  more trusted than the carrier is.
- `src/lib/task-presentation.ts` — status/type label + daisyui badge maps,
  `WORKFLOW_ARTIFACTS` (derived from the shared `DOC_FILES` contract, never
  hand-listed), and the exclusion-reason sentences keyed by the shared
  `ExcludedTaskFolder['reason']` union.

## Dependencies

**Internal**: `@ptah-extension/shared` (task-spec plain types, the
`task-spec.contract` doc-file set, `tasks:*` RPC contracts),
`@ptah-extension/core` (`ClaudeRpcService`, `MessageHandler`),
`@ptah-extension/markdown` (`MarkdownBlockComponent`), `@ptah-extension/ui`
(`NativeDrawerComponent`).

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
4. **Never hand-write a per-task `*.md` filename here.** Every document name
   comes from the shared `DOC_FILES` contract; a CI ratchet fails the build on
   any literal that reappears. The batch-breakdown stage accepts both
   `BATCHES_FILE` and its pre-rename name — that fallback is PERMANENT and is
   never deprecation-warned.
5. **`tasks:getArtifact` takes a `DocFile`, never a string.** The value is
   joined onto a folder path in `TaskIndexService.readArtifact`, so the closed
   enum at the Zod boundary is the whole thing standing between a document
   reader and an arbitrary-file read primitive. Never widen it to `z.string()`
   with a traversal check — pinned by `tasks-rpc.handlers.spec.ts`.
6. **Start lives on the card and the row, and nowhere else.** Neither
   `TaskDetailComponent` nor the bulk bar can launch a task, so a layout that
   drops its launch control removes the feature rather than relocating it. The
   row keeps Start in a cell (costing no height) and carries isolation as a
   menu ACTION rather than the card's sticky per-item toggle.
7. **Excluded folders are listed by name, never counted.** A count tells a user
   that folders vanished without telling them which or why; that silent drop is
   the exact failure the drawer exists to end.
8. **`loadBoard` never coalesces; `refreshBoard` always does.** Every
   post-write reload goes through `loadBoard`, and joining a fetch that was
   issued BEFORE the write would answer it with a board that predates the
   change — a staleness `boardReqSeq` cannot repair, because the stale response
   would be the newest one to resolve. Refresh triggers (the `tasks:changed`
   push, the focus/visibility reconcile, the workspace-switch revalidate) carry
   no local change, so they join whatever is in flight. Do not "simplify" this
   by pointing both at one path.
9. **Nothing mounted, nothing fetched.** The store is root-provided AND eagerly
   constructed (it joins `MESSAGE_HANDLERS`), so it outlives every
   `TasksViewComponent` — while the app shell destroys and re-creates the
   surface on every view switch. `attachSurface` / `detachSurface` is how it
   knows, and the push and reconcile paths return early without it: a full
   `.ptah/specs` scan to repaint a board nobody is looking at is pure waste, and
   an agent writing spec folders pushes once per watcher debounce window.
   Losing those refreshes costs nothing — the surface fetches on mount. Keep it
   a COUNTER: the incoming instance's constructor runs before the outgoing
   instance's `onDestroy`, and a boolean would latch closed on a remount.
