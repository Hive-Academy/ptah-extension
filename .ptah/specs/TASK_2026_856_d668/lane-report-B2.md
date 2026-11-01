# Batch B2 lane report

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics\libs\shared\src\lib\utils\token-usage.utils.ts` (created)
- `D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics\libs\shared\src\lib\utils\token-usage.utils.spec.ts` (created)
- `D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics\libs\shared\src\lib\utils\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics\libs\shared\src\lib\utils\cli-usage.utils.ts`
- `D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics\libs\shared\src\lib\utils\cli-usage.utils.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics\.ptah\specs\TASK_2026_856_d668\lane-report-B2.md` (this report)

## Acceptance

- `messageTokenTotal`: sums input, output, cache read and cache creation; omitted cache counts are zero. Missing usage, invalid/non-finite/negative counts and non-finite sums return `null`; known zero returns `0`.
- `sessionTokenTotal`: returns only a finite host `tokenCount`, including zero. It does not read token parts or reconstruct missing totals.
- `cliUsageTokenTotal`: uses a finite reported `totalTokens` with `exact: true`; otherwise sums available input/output with `exact: false`, excluding cache counts. Missing or invalid counts return `null`.
- All three functions are exported by the shared utils barrel, which `@ptah-extension/shared` re-exports.
- Added concrete-number specs for each rule and edge case.

## Lane check

The one required foreground command passed: `npm run verify -- -t test -p @ptah-extension/shared -- --testPathPatterns="token-usage|cli-usage"`. PowerShell's `Select-Object -Last 60` captured the tail. It waited 453 seconds for the shared verification lock. The reporter did not print the conventional “Running target ... for 1 project” header; its command names only `@ptah-extension/shared`, and the Nx summary confirms one task.

Output tail:

```text
[verify 2026-10-30T17:00:49.234Z] lock slot 1 acquired after 453s: verify test (@ptah-extension/shared)

 NX   1 task: 1 succeeded

Re-run with --output-style=static to inline logs.

  Run duration:      11.6s
  Cache:             0/1 hit (0%)
  Critical path:     11.4s (1 task)
  Recoverable time:  <1ms
[verify 2026-10-30T17:01:12.403Z] lock released after 23.2s, exit code 0
VERIFY_EXIT_CODE=0
```

Scoped Ptah TypeScript diagnostics later reported 0 errors and clean coverage for all five changed TypeScript files. `git diff --check` passed for the modified tracked files.

## Decisions

- Message token classes must each be finite and non-negative; the sum must also be finite.
- A reported CLI total takes precedence over split counts; invalid reported totals do not silently fall back.
- A single reported CLI input or output count is a useful inexact subtotal, with the other absent side counted as zero.

## Anything not done

No host typecheck or broader batch gate was run; those belong to the team leader after parallel lanes complete. No CLI skill invocation mechanism was available in this session; no matching skill was applied.
