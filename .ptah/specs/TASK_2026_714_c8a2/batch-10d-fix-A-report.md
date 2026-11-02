# Batch 10d.fix-A report

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-executable-inspection.ts` — shared cached inspection helper.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-executable-inspection.spec.ts` — portable fixture specs.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\index.ts` — public export.
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-fix-A-report.md` — this handoff report.

## Exported API

`CodexExecutableInspection`, `CodexExecutableInspectionErrorCode`, `CodexExecutableInspectionError`, and `inspectCodexExecutable(executablePath, platform, options?)` are exported from `@ptah-extension/codex-runtime` (index.ts:98).

## Rules 1-7

1. The helper selects the reviewed pin for the exact platform and architecture and rejects an absent pin with `codex-pin-unavailable` (codex-executable-inspection.ts:42-49).
2. It resolves the real path, stats it, rejects non-files, and preserves the cause in `codex-executable-missing` (codex-executable-inspection.ts:50-66).
3. It keys the cache by real path, size, modification time, pin digest and version; shares pending promises, replaces the entry for a changed path identity, and evicts failed promises without removing a newer entry (codex-executable-inspection.ts:69-77, 101-108).
4. It streams chunks into SHA-256, compares without case sensitivity, and raises a condition-specific `codex-digest-mismatch` error (codex-executable-inspection.ts:79-90).
5. It uses the supplied `readVersion` result or the reviewed version line and checks the resulting identity through `verifyCodexBinary` (codex-executable-inspection.ts:91-99).
6. No reset export was needed; specs use a new temporary directory for each case (codex-executable-inspection.spec.ts:19-43).
7. The helper imports only Node crypto/filesystem modules and local pin/verification modules; it imports no host API (codex-executable-inspection.ts:1-5).

## Decisions

- Cache one entry per real path. Options were a global tuple-key map and a path-keyed map. The task requires old entries for a real path to be replaced; the path-keyed map implements that directly. Reversible.
- Reject a supplied version line that fails the reviewed identity check. Options were returning it unchecked or applying the existing verifier. The specification requires the value to pass `verifyCodexBinary`; the helper applies that verifier. Reversible.

## Not done

- Host adoption belongs to later lanes.
- Tests, typecheck, lint, build, Nx, npm, verify, and diagnostics were not run, as explicitly prohibited by the task.
- No skill-loading or skill-discovery tool was available in this lane.
