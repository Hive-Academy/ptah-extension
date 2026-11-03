# Batch B5 report: detail, markdown and inactive seam

All paths are under `libs/frontend/tasks-ui/src/lib/components/detail/`.

## Files changed

- MODIFIED `task-detail.component.ts`: now a composition of 450 lines (was 810). It has a header (breadcrumb, title, status/type/stage), then a grid of files | reader-or-overview | rail. The rail holds carrier metadata, relations, the metadata editor, activity and the run placeholder. A container query switches the layout at 980px.
- MODIFIED `task-detail.component.spec.ts`: adds the `spec folder` suite (composition, read through store, last selection, editor routing, close to overview, directory browse, host contract).
- CREATED `task-folder-overview.component.ts` + spec: carrier `task.md` overview. It shows the canonical `.ptah/specs/<folder>/` path, flags an id/folder mismatch (the folder wins), and shows the description, validation warnings and the body through `MarkdownBlockComponent variant='auto'`.
- CREATED `task-folder-files.component.ts` + spec: the "On disk" vs "Expected workflow files" groups. Rows show actual types (Carrier, Legacy, Folder, symlink inert), breadcrumbs and directory browsing, plus loading, empty, error and typed listing states.
- CREATED `task-document-reader.component.ts` + spec: a filename header and state badge, a skeleton, the empty state, and copy for missing, unreadable, binary, directory, too-large (1 MiB, matching `task-index.service.ts:427`), rejected and error. It also has Open in editor and close.
- CREATED `task-activity.component.ts` + spec: sessions with phase, todos and PRs (https-only links, `rel="noopener noreferrer"`), plus the CLI lane labels.
- CREATED `task-run-placeholder.component.ts` + spec: `Planned for Phase 2 · TASK_2026_358`, with nullable `selectedTaskId`/`workspaceRoot` inputs and no controls.
- Not changed: `task-metadata-editor.*`, `task-relations.*`. They are preserved and composed as they were.

## Already present vs completed in this run

The stopped subagent had written all 12 files, and they typechecked, linted and passed. In this run I:

- reviewed each file against the B5 acceptance items, design-spec.md and the B3 store API;
- checked the 1 MiB copy against the backend limit;
- checked the guard (`text-base-content/<n>`) in non-spec `.ts` (none; only `border-base-content/70`, which the guard allows);
- added one spec, `task-folder-files.component.spec.ts`, "keeps every actionable row a named native button in the tab order", which covers keyboard reachability of the disclosure and file rows;
- ran the verification below.

## Acceptance items

- Met: the `ptah-task-detail` selector and all inputs and outputs are kept. The spec "keeps the public host contract tasks-view binds" covers this.
- Met: canonical folder, carrier, body and warnings are shown separately from `context.md`. `context.md` is a file row that opens in the reader.
- Met: actual file types and expected missing docs are listed. `tasks.md` shows as Legacy. Directories expand through `openFolderDirectory` and are never read as markdown.
- Met: the reader shows every typed state and the editor action. The editor action is offered only for `isOpenableRootFile`.
- Met: markdown renders only through the shared `MarkdownBlockComponent` (`variant='auto'`, marked + DOMPurify). There is no `[innerHTML]`. Specs check that script, img/onerror and `javascript:` links are not rendered. Code and tables overflow inside their own blocks (`::ng-deep .task-reader-body`).
- Met: metadata, relations, sessions, progress and PR are kept.
- Met: the layout is 248px / flexible / 268px with 16px gutters when wide. When narrow it stacks, and the files section has a 290px max-height with internal scroll.
- Met: the placeholder has the required text, the nullable inputs and no runnable controls.
- Met: components use only the TasksStore public API. They make no RPC calls.

## Deviations

- The 3-column layout uses a container query (≥980px panel width), not the viewport. Beside the Kanban the panel is a fixed 384px (`w-96`), so it stacks there. It shows three columns in wide (list) mode. Making the detail full-width in board mode would be a B4 change to `tasks-view`.
- The design-spec header lists Back, Start and a status menu. Adding them would need new detail outputs, which B5 may not add (fixed public API). They stay owned by the board and card. A B4 follow-up can add them.
- `openDocument`, `documentContent` and `documentLoading` are kept as inputs but no longer read: the reader uses `store.documentState()`. The `readDocument` output is kept but no longer emitted: reads go through `store.readFolderFile`. Both are kept because the public API is frozen.
- The shared `markdown-block` spec (libs/frontend/markdown) was not run. It is outside the scoped commands given for this batch.

## Verification

- `npm run verify -- -t typecheck,lint -p @ptah-extension/tasks-ui` → `2 tasks: 2 succeeded`, exit 0 (run before and after the spec edit).
- `npm run verify -- -t test -p @ptah-extension/tasks-ui -- --testPathPatterns="components/detail"` → exit 0; `Test Suites: 8 passed, 8 total`, `Tests: 127 passed, 127 total` (counts read from the cached run with `--output-style=static`).
- One mistaken combined run (`-t test,lint` with the Jest flag) failed only because eslint rejected `--testPathPatterns`. It was not a code failure. The two commands were then run separately as prescribed.
- Not run: `ptah-extension-webview` project checks, the full tasks-ui suite, and the markdown lib spec, as instructed.
