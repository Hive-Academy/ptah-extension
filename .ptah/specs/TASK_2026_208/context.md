# Context — undocumented B4 AC4 asymmetry (explicit access vs. navigation)

## Origin

`TASK_2026_173` Batch 9 register, item 2 of 17. Raised by Batch 5 review, Judgment Call 3. Filed per
NFR-9 — deliberately not fixed (and arguably should not be "fixed" without a product decision).

## Finding (from the register)

> Pre-existing B4 AC4 asymmetry, undocumented anywhere. An explicitly-targeted ignored directory is
> enumerable via `editor:getFileTree` with an explicit `rootPath` (`buildFileTree` filters `root`'s
> _children_, never `root` itself) and openable via `handleFileOpen` (which applies no exclusion filter
> at all) — even though the same directory is unreachable by navigation from the workspace root.
> Confirmed byte-identical to `HEAD` before and after Batch 5, so genuinely pre-existing and untouched.
> Arguably the correct "user asked for it explicitly" behaviour, but it is written down nowhere.

## Fix

Document the asymmetry explicitly, either in `GitInfoService`/file-tree service class docs or in
`workspace-scan.constants.ts`'s own header comment (which already documents the two-tier
`TREE_HIDDEN_DIRS`/`WATCH_IGNORED_DIRS` policy): navigation from the workspace root always respects the
exclusion set; explicit access (an exact `rootPath` passed to `editor:getFileTree`, or a direct
`editor:openFile` path) does not filter on it at all. State this as intentional ("explicit user intent
overrides default hiding") or flag it for a follow-up decision if it should instead be symmetric.

## Source

`TASK_2026_173/tasks.md` Task 9.3 register item 2; `TASK_2026_173/batch-9-dispatch.md` §4;
`TASK_2026_173/batch-5-report.md` Judgment Call 3.
