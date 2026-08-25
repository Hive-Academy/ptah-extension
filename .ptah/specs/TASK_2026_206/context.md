# Context — glob-string exclusion drift in `editor-rpc.handlers.ts`

## Origin

`TASK_2026_173` (Editor panel), Batch 9 follow-up filing, Task 9.2, carried forward per that batch's
Validation Notes (also traced to Batch 5 §10.2's open item). Not one of the numbered Task 9.3 register
items — filed separately because the dispatch calls it out by name as something that must not be lost.

## The finding

Two **hand-maintained glob-string** exclusion lists exist in
`apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.ts`, independent of the
`TREE_HIDDEN_DIRS` / `isExcludedWorkspacePath` predicate mechanism that Batch 5 (B4, Option B) unified
for the file-tree builder and the workspace watcher:

- `:487`, inside `registerSearchInFiles` (serves `editor:searchInFiles`):
  ```ts
  const excludePattern = ['**/{node_modules,dist,.git,.nx,.cache}/**'];
  ```
- `:736`, inside `registerListAllFiles` (serves `editor:listAllFiles`):
  ```ts
  const excludePattern = ['**/{node_modules,dist,.git,.nx,.cache}/**'];
  ```

Both are byte-identical to each other (a second, smaller drift — they at least agree with one another)
but both are a hand-written glob covering exactly **5 names**: `node_modules`, `dist`, `.git`, `.nx`,
`.cache`.

## Comparison against the canonical set

`TREE_HIDDEN_DIRS` (`libs/shared/src/lib/constants/workspace-scan.constants.ts`, current content
verified at filing time) has **11 members**, not the 12 referenced in some Batch 8/9 planning prose —
the actual `Set` literal is:

```ts
export const TREE_HIDDEN_DIRS: ReadonlySet<string> = new Set([
  '.git',
  '.hg',
  '.svn', // VCS metadata
  '.DS_Store',
  '.Trash', // OS / platform noise
  '.cache',
  '.tmp',
  '.temp', // generic caches/scratch
  '.nx', // tooling caches
  'node_modules',
  'dist', // dependency/output trees
]);
```

**5 of 11 are covered** by the two glob lists (`.git`, `.cache`, `.nx`, `node_modules`, `dist`).
**6 are missing**: `.hg`, `.svn`, `.DS_Store`, `.Trash`, `.tmp`, `.temp`. (Reported as observed —
the "12 names" figure in some upstream planning documents does not match the current file; this record
uses the actual current count so a future implementer is not chasing a stale number.)

## Why this matters

`editor:searchInFiles` and `editor:listAllFiles` can currently surface matches from `.svn`, `.hg`,
`.DS_Store`, `.Trash`, `.tmp` and `.temp` directories that the file tree itself hides and the watcher
itself ignores — an inconsistency between what the user browses and what search/quick-open returns.
Not a data-safety issue, but a real behavioural drift that will only widen as `TREE_HIDDEN_DIRS` gains
members over time and these two literals do not.

## Fix

Point both glob lists at `TREE_HIDDEN_DIRS` and derive the globs from it programmatically (e.g.
`` `**/{${[...TREE_HIDDEN_DIRS].join(',')}}/**` ``), replacing the two hand-written literals, so the
drift cannot recur — a future addition to `TREE_HIDDEN_DIRS` propagates to search and quick-open
automatically instead of requiring a third manual edit.

## Source

`TASK_2026_173/batch-9-dispatch.md` §3 (Task 9.2, final paragraph); `TASK_2026_173/tasks.md` Task 9.3
Validation Notes (post-table); `TASK_2026_173/batch-5-report.md` §10.2;
`apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.ts:487,736`;
`libs/shared/src/lib/constants/workspace-scan.constants.ts`.
