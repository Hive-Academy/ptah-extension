# Batch TC0 lane report

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics\libs\backend\agent-sdk\src\lib\helpers\history\history.types.ts` — added raw and projected optional flag types.
- `D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics\libs\backend\agent-sdk\src\lib\helpers\history\jsonl-reader.service.ts` — projects only literal `true`.
- `D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics\libs\backend\agent-sdk\src\lib\helpers\history\jsonl-reader.service.spec.ts` — added a five-value projection regression case.
- `D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics\.ptah\specs\TASK_2026_856_d668\lane-report-TC0.md` — this report.

## Acceptance

- A raw `isCompactSummary: true` produces a projected `isCompactSummary: true`.
- Raw `false`, `"true"`, `1`, and missing values produce no `isCompactSummary` key. The spec checks property absence with `Object.hasOwn`.
- The spec compares every other converted field against the missing-flag baseline, including `isSidechain: true` and the author fields. Existing `jsonl-reader.streaming.spec.ts` and `jsonl-reader.account-context.spec.ts` were unchanged and passed in the scoped `jsonl-reader` run.
- No `any` was added.

## Lane check

Command: `npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns="jsonl-reader" 2>&1 | tail -n 60` (Git for Windows `tail.exe`). One foreground run; exit code 0. The Nx output style did not print a `Running target ... for 1 projects` header. The command names one project and the final Nx summary confirms one task.

Tail of output:

```text
[verify 2026-10-30T17:01:12.560Z] lock slot 1 acquired after 468s: verify test (@ptah-extension/agent-sdk)

 NX   1 task: 1 succeeded

Re-run with --output-style=static to inline logs.

  Run duration:      30.2s
  Cache:             0/1 hit (0%)
  Critical path:     30.0s (1 task)
  Recoverable time:  <1ms

  Recommendations:
    - Drastically reduce your run duration by sharing a cache across your team and CI ? https://cloud.nx.app/connect/4GORreOBI0.
    - Speed up or split the longest tasks on the critical path:
        @ptah-extension/agent-sdk:test    30.0s
[verify 2026-10-30T17:01:56.356Z] lock released after 43.8s, exit code 0
```

## Decisions

- Matched the existing `isSidechain` literal-`true` spread pattern, so no unrelated projected fields change.
- Used one JSONL fixture with identical base fields across all five values to make field preservation observable.
- Skill discovery was available; no local skill matched this JSONL reader change.

## Anything not done

- Project-wide lint/typecheck and host typecheck belong to the batch gate and were not run in this lane.
- Scoped Ptah TypeScript diagnostics timed out while a compiler check was running; the required Jest lane check passed.
