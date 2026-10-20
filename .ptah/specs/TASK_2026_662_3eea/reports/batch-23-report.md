# Batch 23 report

## Changed lines

- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-action-gating.ts:241` — documented nullable graded rate; at `:249` removed the invocation-count gate and returned the grade label directly.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-action-gating.spec.ts:309` — replaced the old zero-invocation expectation with independent grade cases; at `:321` covered null for both zero and nonzero invocations.

## Before/after behavior

| Input | Before | After |
| --- | --- | --- |
| `successRate: null`, `invocationCount: 0` | `null` (hidden) | `No grade` |
| `successRate: null`, `invocationCount: 4` | `No grade` | `No grade` |
| `successRate: 0.75`, `invocationCount: 0` | `null` (hidden) | `75%` |
| `successRate: 0`, `invocationCount: 0` | `null` (hidden) | `0%` |
| `successRate: 0.5`, `invocationCount: 4` | `50%` | `50%` |
| `successRate: NaN`, `invocationCount: 4` | `No grade` | `No grade` |

## Decisions

- Use `successRate` alone for `formatSuccessRate`. The shared `CloneSummary` already defines `successRate: number | null`, and plan row 21 says task grades can exist independently of invocation count. This is reversible in the formatter alone.
- Keep the non-finite guard and the `invocationCount` field. The former preserves existing defensive behavior; other action-gating code still reads the latter. This is reversible.

## Verification

- Inspected the formatter and focused spec; confirmed both edited source files have LF line endings.
- No nx/Jest commands, lint, or build were run, as directed by the batch executor rules. `ptah_get_diagnostics` returned unavailable because its TypeScript check was still running after 45 seconds; no diagnostics result was obtained. The orchestrator owns verification.
