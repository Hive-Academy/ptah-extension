# TASK_2026_619 Batch 11 probe fix

## Summary

Fixed the Windows process-tree PID-reuse false positive by attaching process creation timestamps to probe entries and rejecting a child that predates either its recorded parent or the root host. Held real-state-path diagnostics now retain the holder command line (capped at 300 characters), ISO creation time, and observed PID chain to the root.

## Files changed (absolute paths)

- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\open-handle-probe.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\real-state-guard.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\open-handle-probe.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\real-state-guard.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.ptah\specs\TASK_2026_619_af7f\batch-11-probe-fix-report.md`

## Design choice (single vs dual tree implementation)

Dual implementation retained. PowerShell computes the same creation-time-filtered PID set before scanning Windows handles, avoiding probes of unrelated processes. TypeScript independently applies the identical rule to form the returned tree. Unknown timestamps preserve the previous parent-PID behavior.

## Tests added

- PID reuse does not adopt an old process under a reused parent PID.
- A legitimate later child is adopted.
- Unknown creation times fall back to parent PID.
- A process older than the root is excluded.
- Injectable guard probe verifies the failure text includes command line, ISO creation time, and parent chain.

## Checks run (command + result, tail only)

`npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/transport/open-handle-probe tools/mcp-bench/src/transport/real-state-guard`

```text
Test Suites: 2 passed, 2 total
Tests:       5 passed, 5 total
Time:        18.444 s
```

`npx tsc -p tools/mcp-bench/tsconfig.spec.json --noEmit`

```text
error TS5058: The specified path does not exist: 'tools/mcp-bench/tsconfig.spec.json'.
```

`git diff --check`

```text
No output (passed).
```

## Decisions

- Linux `/proc` entries leave creation time and command line unavailable, as allowed; the safe fallback is the legacy parent-PID rule.
- Windows emits `createdMs` as epoch milliseconds (or null) and command line for every process-table entry.
- No unrelated pre-existing worktree changes were modified.

## Anything not done

- The suggested spec tsconfig is absent from this worktree, so no separate TypeScript compiler check could be run. Focused Jest passed.

## Revision 1

### Windows creation-time verification

Corrected the PowerShell conversion at `tools/mcp-bench/src/transport/open-handle-probe.ts:269-272`: `Win32_Process.CreationDate` is already a `System.DateTime`, so the probe now converts its UTC value through `DateTimeOffset.ToUnixTimeMilliseconds()` without a catch that could hide a systematic conversion failure. A null remains only when `CreationDate` itself is absent.

Ran the real CIM query and conversion on this machine for the throwaway PowerShell process:

```text
{"pid":24064,"creationDateType":"System.DateTime","createdMs":1791385016417,"startMs":1791385016417,"deltaMs":0}
```

`createdMs` was non-null and exactly matched `Get-Process.StartTime` converted to epoch milliseconds (0 ms delta).

### Tree implementation confirmation

The implementation intentionally remains dual so that the Windows native handle scan is limited before handle duplication. PowerShell builds `$byPid` once at `open-handle-probe.ts:286-288`, applies the creation-time checks in its loop, and passes only that PID set to `OpenPaths` at line 299. Separately, `parseWindowsTreeReply` calls TypeScript `processTree` at line 351 to build `result.tree`. Both reject a child when known creation times show it predates either its parent or the root; either unknown timestamp retains the parent-PID fallback.

### Revision checks and tests

- Replaced the per-pass `Where-Object` parent lookup with a single PID-to-entry hashtable.
- Added parser-path coverage showing `createdMs` and `commandLine` survive Windows JSON parsing, while `createdMs: null` still adopts a child by PPID.

`npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/transport/open-handle-probe tools/mcp-bench/src/transport/real-state-guard`

```text
Test Suites: 2 passed, 2 total
Tests:       6 passed, 6 total
Time:        11.913 s
```

`git diff --check` produced no output (passed).

## Orchestrator correction (disclosed)

The scoped gate (`nx run-many -t typecheck,lint,test -p mcp-bench`) found one stale expectation outside the lane's scope: `tools/mcp-bench/src/transport/host-launcher.spec.ts` ("parses the win32 reply ...") compared parsed tree entries exactly, and the parser now adds `createdMs: null` and `commandLine: null`. The orchestrator updated that expectation only; no production code changed.
