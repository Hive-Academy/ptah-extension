# Context — `applyHunks` inherits the undocumented `workspacePath === repo top level` assumption

## Origin

`TASK_2026_173` Batch 9 register, item 14 of 17. Raised in `batch-8a-report.md` §7.5. Filed per NFR-9
as pre-existing and out of scope for that task.

## Finding (from the register)

> `applyHunks` inherits the service-wide assumption that `workspacePath` is the repository top level,
> and it is written down nowhere. Every `GitInfoService` method already assumes it (`readBlob` uses
> root-relative `rev:path`; `readWorktreeBlob` joins `workspacePath + path`). If a user opens a
> **subdirectory** of a repo, `git diff` emits root-relative paths while `git apply` resolves them
> relative to cwd, so the apply **fails safely — it cannot corrupt.** Correctly left alone under NFR-9
> as pre-existing and out of scope, but a safe failure nobody has documented reads as a bug to whoever
> hits it.

## Fix

Two-part, in priority order:

1. **Immediate**: state the assumption explicitly in `GitInfoService`'s class doc
   (`libs/backend/vscode-core/src/services/git-info.service.ts`) — "all methods on this service assume
   `workspacePath` is the git repository top level; opening a subdirectory of a repo is unsupported and
   fails safely rather than corrupting."
2. **Structural** (larger, not required to close this record): resolve the top level once via
   `git rev-parse --show-toplevel` and use it as the `git apply` cwd, removing the assumption instead
   of just documenting it.

## Source

`TASK_2026_173/tasks.md` Task 9.3 register item 14; `TASK_2026_173/batch-9-dispatch.md` §4;
`TASK_2026_173/batch-8a-report.md` §7.5;
`libs/backend/vscode-core/src/services/git-info.service.ts`.
