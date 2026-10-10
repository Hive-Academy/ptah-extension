# Phase-1 in-process logic re-review (round 2)

| Round-1 finding | Status | Evidence |
| --- | --- | --- |
| 1. Local bench-data guard duplicated and weakened the safety boundary | CLOSED | `tools/mcp-bench/src/memory-skills/data/verify-candidate-manifest.ts:99-102`, `data/candidate-row-diff.ts:206-209`, `data/sample-sessions.ts:240-243`, `labelling/select-rubric-sample.ts:679-682`, and `labelling/build-labelling-packet.ts:119-122` all call `resolveBenchDataDir` with the explicit directory as `PTAH_MCP_BENCH_DATA_DIR`; the local guard is gone. |
| 2. Sampler could freeze a partial JSONL transcript and record stale size | CLOSED | `tools/mcp-bench/src/memory-skills/data/sample-sessions.ts:197-203` excludes malformed and post-window sessions; `:302-327` rescans the copied file, rejects it if no longer eligible, and records its own byte count and hash. |
| 3. Freeze verification missed empty directories and aborted on non-regular entries | CLOSED | `tools/mcp-bench/src/memory-skills/data/verify-candidate-manifest.ts:135-150` turns both cases into report problems; `:235-257` counts empty directories and records non-regular entries without following them. |
| 4. Task-619 worktree exclusion regex over-matched task-6190/task-6195 | CLOSED | `tools/mcp-bench/src/memory-skills/data/sample-sessions.ts:221-223` uses `task-619(?![0-9])`; the regression cases are in `sample-sessions.spec.ts:146-155`. |
| 5. Packet order-collision guard skipped two-document samples | CLOSED | `tools/mcp-bench/src/memory-skills/labelling/build-labelling-packet.ts:171-174` now checks all samples with at least two documents; the two-document regression exercise is in `build-labelling-packet.spec.ts:310-338`. |

## New findings

1. **Major — pure benchmark modules still import the runtime `@ptah-extension/memory-curator` barrel.** `tools/mcp-bench/src/memory-skills/baselines/retention-policy-defaults.ts:1-4` and `tools/mcp-bench/src/memory-skills/ground-truth/seeded-session-generator.ts:40-44` import it at module initialization, contrary to the headless/pure-module boundary. The current tests conceal the extension dependency: `retention-policies.spec.ts:1-10` and `seeded-session-generator.spec.ts:16-23` install a virtual `vscode` mock and `reflect-metadata` before importing the barrel. A headless use of either pure module without that Jest-only setup can fail during barrel initialization instead of producing benchmark data. Import only the required leaf modules through a headless-safe boundary, or move the needed pure constants/helpers to one.

Jest result observed: `Test Suites: 8 passed, 8 total; Tests: 71 passed, 71 total; Snapshots: 0 total; Time: 9.541 s.`

## Verdict

REVISE
