# Context — Submodule paths surface as the generic `unknown` error code

## Origin

`TASK_2026_173`, Batch 9 follow-up filing, Task 9.2. This is `r3-triage.md` §"Follow-up findings" item
2, discovered during the same R-3 triage matrix as `TASK_2026_204`. **Nothing was re-suppressed** —
this is exactly the kind of previously-invisible git-read failure A3 was built to surface, filed rather
than absorbed per NFR-9.

## Finding (quoted from `r3-triage.md`)

> **Submodule paths surface as the generic `unknown` error code**, not a `submodule` or `gitlink`
> -specific code. Same non-blocking shape as [the directory-row finding] — correct, safe behaviour with
> a slightly less specific message than ideal.

## Fix

Add a `submodule` outcome to `GitReadErrorCode` (`libs/shared/src/lib/types/rpc/rpc-git.types.ts`) and
classify on the pair that already distinguishes this case in `GitInfoService`'s `readBlob`
classification ladder (`libs/backend/vscode-core/src/services/git-info.service.ts`): `git show
<rev>:<path>` exits 128 (object type is a commit reference, not a blob), **and** `git rev-parse
--verify <rev>` for the gitlink's recorded commit succeeds (exit 0) — the pair that already
distinguishes a submodule/gitlink entry from a genuinely missing or unreadable blob. Map the new code to
a submodule-specific message on the frontend error-string table in `diff-view.component.ts`.

## Source

`TASK_2026_173/r3-triage.md` §"Follow-up findings" item 2; `TASK_2026_173/batch-9-dispatch.md` §3
(Task 9.2); `TASK_2026_173/tasks.md` Task 9.2, DoD item 9.
