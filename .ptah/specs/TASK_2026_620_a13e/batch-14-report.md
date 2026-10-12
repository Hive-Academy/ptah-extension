# Batch 14 report — net recorder

Author: Glm lane (code). The lane exited twice without writing this report (first while waiting on a
background Nx run; the resume then ended with 0 turns). Per agent-lanes §5 the lane was dropped for
this batch. This report was written by the orchestrator after verifying the code.

## Files
- `tools/mcp-bench/src/memory-skills/runner/net-recorder.ts`
- `tools/mcp-bench/src/memory-skills/runner/net-recorder.spec.ts`

## Verification (orchestrator, 2026-10-07)
- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/runner --runInBand` → Tests: 12 passed, 12 total
- `npx eslint tools/mcp-bench/src/memory-skills/runner` → no output (0 problems)
- `npx prettier --check --ignore-unknown tools/mcp-bench/src/memory-skills/runner` → clean
- `npx nx run mcp-bench:typecheck` → 0 `error TS` lines

## Risks
- Deterministic output: log entries are sorted by kind, tag, detail; no timestamps.
- Malformed log lines throw (no silent drop).
- Restore after error: orchestrator correction — `restoreMainThread` now runs every restore even
  if one throws and reports all failures as an `AggregateError` (before, one failure left the
  remaining globals patched). Not yet covered by a spec; phase-2 review to check.

## Not done
- No spec for the restore-failure path.
- `assertSafeRecorderTarget` uses its own `~/.ptah` check instead of 619's `isPathInside`; phase-2
  review to decide.

## Late lane report (arrived after the completion signal said MISSING)
The first Glm run later sent its report message. Its claims agree with the orchestrator checks:
port of the 563 net guard; records socket connect, `dns.lookup`, `dns.promises.lookup` and `fetch`
in the main thread and in worker threads (generated CJS guard + `guardedWorkerEntry`); `failIfAny()`
fails a run on any recorded outbound attempt; local IPC is recorded as a diagnostic, not a failure;
log targets inside the real `~/.ptah` or already existing are refused.
**Note for Batch 16:** wire `failIfAny(label)` into `--ci` mode and pass worker entries through
`guardedWorkerEntry()`.
