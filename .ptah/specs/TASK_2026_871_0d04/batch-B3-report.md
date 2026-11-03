# Batch B3 report: folder state and reader data

## Files changed

All paths are under `libs/frontend/tasks-ui/src/lib/services/`.

- CREATED `task-folder-entries.ts`: pure mapping. It validates host entries, builds root rows (actual entries plus missing workflow documents, with the `tasks.md` legacy fallback), builds nested rows, builds breadcrumbs, validates paths and checks direct-child editor targets.
- CREATED `task-folder-entries.spec.ts`: covers the name and path validators, breadcrumbs, entry parsing, the root and nested mapping (actual, missing, legacy, extra, directory and symlink rows) and the openable-file check.
- CREATED `task-folder.store.ts`: `TaskFolderStore` (signals, `providedIn: 'root'`). It holds the document reader state, the root and nested listings, breadcrumbs and two latest-request guards.
- CREATED `task-folder.store.spec.ts`: covers every read and listing result variant, a local rejection, RPC and transport failures, refusal of mismatched taskId/file, out-of-order responses, task, root and close invalidation, the folder name winning over the frontmatter id, and a nested listing race.
- MODIFIED `tasks-store.service.ts`:
  - The document signals and `documentReqSeq` were removed. The facade now delegates to `TaskFolderStore`.
  - New public members were added for the folder browser and the reader.
  - `openArtifact` now validates the target as a direct-child file (typed entries, or artifacts as a fallback).
  - A `tasks:changed` push now re-reads the open document and the browsed directory instead of closing them.
- MODIFIED `tasks-store.service.spec.ts`: appends the suite `TasksStore — folder reader facade` (8 tests).

`task-presentation.ts` was not changed. It is reused through `WORKFLOW_ARTIFACTS`.

## Public store API for B4/B5 (`TasksStore`)

Existing members are unchanged in name and type:

```ts
readonly openDocument: Signal<DocFile | null>;   // now computed: open file if it is a DocFile
readonly documentContent: Signal<string | null>; // content when state is 'ready'
readonly documentLoading: Signal<boolean>;
readDocument(file: DocFile | null): Promise<void>;
closeDocument(): void;
openArtifact(file: string): Promise<void>;       // direct-child regular file only
```

New members:

```ts
readonly openFile: Signal<string | null>;                       // any open file, incl. extra markdown
readonly documentState: Signal<TaskDocumentState>;
readonly folderListing: Signal<TaskFolderListing>;
readonly folderEntries: Signal<readonly TaskFolderEntry[]>;
readonly folderDirectory: Signal<string>;                       // '' = task folder root
readonly folderBreadcrumbs: Signal<readonly TaskFolderBreadcrumb[]>;
readFolderFile(file: string | null): Promise<void>;             // null closes the reader
openFolderDirectory(directory: string): Promise<void>;          // '' = root, 'prototype/assets'
```

Types to import with `import type` from `./services/task-folder.store` and `./services/task-folder-entries`:

```ts
type TaskDocumentState =
  | { status: 'idle' }
  | { status: 'loading'; file: string }
  | { status: 'ready'; file: string; content: string }
  | { status: 'missing' | 'unreadable' | 'binary' | 'directory' | 'too_large' | 'rejected'; file: string }
  | { status: 'error'; file: string; message: string };

interface TaskFolderListing {
  directory: string;
  status: 'idle' | 'loading' | 'ready' | 'missing' | 'unreadable' | 'rejected' | 'too_many' | 'error';
  entries: readonly TaskFolderEntry[];
  message: string | null; // only for 'error'
}

interface TaskFolderEntry {
  name: string;
  kind: 'file' | 'directory' | 'symlink' | 'other';
  presence: 'present' | 'missing';
  role: 'carrier' | 'workflow' | 'legacy' | 'extra';
  label: string | null; // workflow stage label for workflow/legacy rows
  readable: boolean;    // show "Read" (shared predicate or DocFile; never carrier, never nested)
  openable: boolean;    // show "Open in editor" (root-level regular file)
}

interface TaskFolderBreadcrumb { label: string; path: string }
```

How B5 uses it:

- Show `Read` when `entry.readable` is true, and call `readFolderFile(entry.name)`.
- Show `Open` when `entry.openable` is true, and call `openArtifact(entry.name)`.
- For a directory, call `openFolderDirectory(joinFolderPath(folderDirectory(), entry.name))`. `joinFolderPath` is exported from `task-folder-entries.ts`.
- For a breadcrumb, call `openFolderDirectory(crumb.path)`.
- Render the reader from `documentState().status`.

The `.../services/*` modules are not added to the lib barrel (`services.ts`). Components in the same lib import them by relative path.

## Acceptance checklist

- Done: A signal store holds the folder entries, which are typed files, directories, symlinks and others with present or missing states. It also holds the selected file, the reader state per result variant, the nested listing state and breadcrumbs.
- Done: A rejected or failed read is a visible state, never a thrown error.
  - An ineligible name becomes `rejected` locally, without a host call.
  - RPC failures, thrown transport errors and unknown or mismatched payloads become `error`.
- Done: Rapid file switching shows the last selected file.
  - One sequence covers both `tasks:getArtifact` and `tasks:readFolderMarkdown`.
  - That sequence is invalidated on a file change, a task change, a root change, close, and `tasks:changed` (through the re-read).
  - A result is applied only when its taskId and file match the request, and when the context is the same object.
- Done: Directory listing has its own guard and is reset on a task or root switch.
- Done: The closed `DOC_FILES` reader still uses `tasks:getArtifact`, so `content: null` becomes `missing`.
  - `tasks.md` still reads through it and still satisfies the batch stage when `batches.md` is absent.
- Done: The carrier `task.md` is listed with role `carrier` and is not offered to the reader; its body stays on the detail.
- Done: The folder name wins over the frontmatter id for read and list calls.
- Done: `TasksStore`'s public API is kept; nothing was removed or renamed.
- Done: Host calls go only through `ClaudeRpcService`.
  - Production code has no `any`, no `as` casts and no `as unknown as`. Result unions are narrowed with type guards.
  - The new spec files avoid `as unknown as`. The pre-existing pattern in `tasks-store.service.spec.ts` was left as it was.
- Done: Specs cover the ordering race, each read and listing variant, entries mapping, the rejected state, task, root and close invalidation, `tasks:changed`, the legacy fallback, nested navigation and the editor target.

## Verification

- `npm run verify -- -t typecheck -p @ptah-extension/tasks-ui`: `1 task: 1 succeeded`, exit code 0. It was re-run after the final edit and passed again.
- `npm run verify -- -t test -p @ptah-extension/tasks-ui -- --testPathPatterns="services/(tasks-store|task-folder)"`:
  - Final run: `Test Suites: 3 passed, 3 total` and `Tests: 192 passed, 192 total`, exit code 0.
  - The first run had 3 failures in existing bulk/selection tests. Those tests mock `tasks:get` without a `task`. `setDetail` was fixed to treat a missing detail as `null`.
- Lint, the webview project and the full tasks-ui test suite were not run locally, as instructed (CI runs the heavy checks).

## Decisions

- **Folder store scope.** `TaskFolderStore` is `providedIn: 'root'`, and `TasksStore` drives it through `selectTask`, `setDetail` and `reset`.
  - Options: a root service, or a plain class created inside TasksStore.
  - Evidence: the repository convention is root services, and TestBed can inject it.
  - Reversible.
- **Change events.** `tasks:changed` is handled through TasksStore's existing push path (`refreshActiveFromPush`), not a second subscription to `TasksChangedFeed`.
  - Reason: the store already gates pushes during bulk runs and while the surface is unmounted, and a second listener would bypass that gate and duplicate reads.
  - The open file and directory are restored only when the user has not opened something newer during the re-read.
  - Reversible.
- **Error banner kept.** A failed document read still sets the store-level `error()`, as `readDocument` did before, in addition to the reader `error` state.
  - Typed non-ready states (`rejected`, `missing`, ...) do not set `error()`.
  - Reversible.
- **Nested entries.** Rows inside a nested directory are navigable but have `readable: false` and `openable: false`.
  - Reason: the read RPC and the editor opener accept only direct children of the task folder (plan B1/B3: nested editor opening is deferred).

## Deviations

- The plan says to invalidate on `tasks:changed` from `tasks-changed-feed.service.ts`. Pushes are taken from TasksStore's own message handler instead, for the reason under Decisions.
- The root listing comes from `TaskSpecDetail.entries` (or `artifacts`), not from a `tasks:listFolderEntries('')` call. This avoids an extra round trip on every task open and keeps the existing RPC call expectations unchanged. `openFolderDirectory('')` returns to that root view.

## Open issues

- B5 must still render `documentState`, `folderEntries`, `folderListing` and `folderBreadcrumbs`. The existing detail component still binds `openDocument`, `documentContent` and `readDocument`, which work unchanged.
- No component files were edited. B4's in-progress component specs were not part of this run.
- An optional pure export of these types through the lib barrel is left to B5 if a consumer outside the lib needs them.
