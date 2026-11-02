# Batch 8p-6 report

## Move and line counts

| Symbol | Old location | New location |
| --- | --- | --- |
| `CodexRuntimeOptions` | `codex-runtime.ts:53-62` | `codex-context.ts:46-55`; type re-exported from `codex-runtime.ts:20` |
| `Subscriber` | `codex-runtime.ts:191-196` | `codex-context.ts:57-62` |
| `RuntimeContext` and its preceding comment | `codex-runtime.ts:198-1045` | `codex-context.ts:64-911`; module export at line 913 |

`CodexRuntime` remains in `codex-runtime.ts:22-139`. `diagnosticMessage` remains there at lines 141-147 because `CodexRuntime.open` uses it. The new module does not import `codex-runtime.ts`, and `RuntimeContext` was not added to the package barrel.

Line counts: `codex-runtime.ts` 1045 → 147; `codex-context.ts` 913; `codex-runtime.spec.ts` 1790 → 1832. The context class alone is 847 lines, so the new file cannot be under 700 lines while moving the class intact within the permitted files.

The `Subscriber` and `RuntimeContext` block was copied directly from old lines 191-1045 to new lines 57-911. A line-for-line, case-sensitive comparison of the written block against the original in memory returned `originalBlockMatch=True` for all 855 lines. The options interface was copied as a line slice. Only imports, the internal export, and the type re-export were added around the moved code; there were zero logic edits. Comments and degradation-audit markers moved verbatim.

## Spec

Added `codex-runtime.spec.ts:1676-1716`: start with original system, developer, and output-style prompts; resume the same identity with changed prompts and the same permission level, sandbox policy, approval policy, and fingerprint; assert that open succeeds and `thread/resume` carries the current `baseInstructions` and `developerInstructions`.

No tests, lint, typecheck, build, diagnostics, or git commands were run, as required by the lane rules. The team leader owns verification.

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-context.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8p-6-report.md`
