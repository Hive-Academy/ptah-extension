# Post-main Merge Checks — TASK_2026_620

## Scope

Post-merge, project-scoped verification for the TASK-620 memory-skills benchmark worktree at `5090ef1b8`.

Commands were run sequentially, one target at a time, using the project-defined Nx targets. Test commands used two Jest workers.

| Project | Typecheck | Lint | Test |
| --- | --- | --- | --- |
| `@ptah-extension/memory-curator` | PASS — 0 errors | PASS — 0 errors, 25 warnings | PASS — 47 suites; 916 passed |
| `@ptah-extension/agent-sdk` | PASS — 0 errors | PASS — 0 errors, 50 warnings | PASS — 150 suites passed, 2 skipped; 3,189 passed, 3 skipped |
| `@ptah-extension/cli-engine` | PASS — 0 errors | PASS — 0 errors, 2 warnings | PASS — 23 suites; 230 passed |
| `@ptah-extension/platform-core` | PASS — 0 errors | PASS — 0 errors, 8 warnings | PASS — 46 suites; 1,047 passed, 4 todo |
| `@ptah-extension/rpc-handlers` | PASS — 0 errors | PASS — 0 errors, 50 warnings | PASS — 146 suites; 4,310 passed, 7 skipped |
| `@ptah-extension/skill-synthesis` | PASS — 0 errors | PASS — 0 errors, 29 warnings | PASS — 87 suites passed, 1 skipped; 1,870 passed, 1 skipped |
| `@ptah-extension/thoth-runtime` | PASS — 0 errors | PASS — 0 errors, 0 warnings | PASS — 7 suites; 127 passed |
| `@ptah-extension/core` | PASS — 0 errors | PASS — 0 errors, 14 warnings | PASS — 37 suites; 1,176 passed |
| `@ptah-extension/dashboard` | PASS — 0 errors | PASS — 0 errors, 1 warning | PASS — 12 suites; 152 passed |
| `@ptah-extension/thoth-shell` | PASS — 0 errors | PASS — 0 errors, 0 warnings | PASS — 1 suite; 10 passed |
| `@ptah-extension/shared` | PASS — 0 errors | PASS — 0 errors, 5 warnings | PASS — 107 suites; 2,995 passed |
| `ptah-electron` | PASS — 0 errors | PASS — 0 errors, 17 warnings | PASS — 59 suites passed, 1 skipped; 1,152 passed, 3 skipped |
| `mcp-bench` | PASS — 0 errors | FAIL — 1 error, 6 warnings | Not run (explicitly excluded: full mcp-bench test target) |

## Commands

- `npx nx typecheck <project> --parallel=1`
- `npx nx lint <project> --parallel=1`
- `npx nx test <project> --parallel=1 -- --maxWorkers=2`

Each row used the exact corresponding Nx project name from its `project.json`; the commands above show the common verbatim form. MCP bench was limited to typecheck and lint as requested.

## Fixes Made

None. No TASK-620 merge-interaction failure was found.

## Pre-existing Failure

| Check | Result | Evidence | Action |
| --- | --- | --- | --- |
| `npx nx lint mcp-bench --parallel=1` | 1 error, 6 warnings | The six warnings match the stated pre-merge baseline. The error is in main-introduced executable-resolution code (`tools/mcp-bench/src/utils/git-executable.ts:25-28`): `git diff 9bba84b23 f3ef3a2fe -- tools/mcp-bench/src/utils/git-executable.ts` is empty, proving TASK-620 did not modify the failing file. `git log -p 9bba84b23..origin/main -- tools/mcp-bench/src/utils/git-executable.ts` attributes the file to main's PR #672 follow-up (`8fe62f5f0`). | Not fixed, per instruction to leave pre-existing main failures unchanged. |

## Notes

- All successful Nx invocations reported the unrelated Nx Cloud free-plan warning; this did not alter target results.
- Several Jest invocations emitted Node ESM-loader warnings, and CLI-engine emitted non-fatal mock migration/dispose messages. Their commands completed successfully with the counts above.
