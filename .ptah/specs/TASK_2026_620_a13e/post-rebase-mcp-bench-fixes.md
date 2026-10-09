# Post-rebase MCP bench fixes

## Changes

- `tools/mcp-bench/src/memory-skills/suites/memory/retention-support.ts:64,89` renames the stale-observation summary to `stuckKept` and accepts the product's new handled `failed` curation outcome.
- `tools/mcp-bench/src/memory-skills/suites/memory/retention-port.ts:190-203` maps skipped runs to `stuckKept: null` and product runs to `report.stuckKept`.
- `tools/mcp-bench/src/memory-skills/suites/memory/retention-growth.ts:9,90-154,216-249` records `failed` passes separately, keeps the growth evidence wording current, and reports the no-loss result without claiming a quarantine occurred.
- `tools/mcp-bench/src/memory-skills/suites/memory/retention.suite.ts:11` and `retention.suite.spec.ts:3-13,155-205,543-577` update the product-faithful in-memory port and expected stall result: old unprocessed rows are retained, so the 9-day stall produces zero unprocessed deletions and passes.
- `tools/mcp-bench/src/memory-skills/host/redact-secrets.ts:5,11,15,21,25` removes unnecessary quote escapes without changing the regex character classes or matching behavior.
- `tools/mcp-bench/src/memory-skills/labelling/model-panel.ts:1`, `labelling/select-rubric-sample.ts:1`, and `suites/skills/judge-agreement.suite.ts:1` add narrowly documented `max-lines` waivers. These are the three lint warnings inside `memory-skills`; no out-of-scope warning was changed.

## Honest retention mapping

TASK_2026_621 replaced `stuckQuarantined` with `stuckKept`: both identify the same cohort (unprocessed observations older than `stuckDays`), but the new product contract deliberately keeps that cohort rather than deleting or quarantining it. The bench therefore renames its port field instead of treating the count as deletions. The growth suite's primary measurement remains the observed before/after count of unprocessed rows; it now correctly reports zero loss for the stalled sessions. No `na` row is needed because the product exposes the required count and the suite directly measures retention without inventing a quarantine result.

## Checks

- `npx tsc -p tools/mcp-bench/tsconfig.json --noEmit` — passed.
- `npx nx run mcp-bench:lint --parallel=1` — passed with 0 errors. Three pre-existing warnings remain outside `tools/mcp-bench/src/memory-skills/`: `ground-truth/scip-cross-check.ts` max-lines, `main.ts` max-lines, and `transport/bench-host-process.spec.ts` unused disable.
- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/host/redact-secrets.spec.ts tools/mcp-bench/src/memory-skills/suites/memory/retention.suite.spec.ts --coverage=false --maxWorkers=2` — passed: 2 suites, 25 tests.
- Prettier ran on all nine changed source files; formatting completed successfully.

The check environment emitted its existing native-module cache `EPERM` warning and Nx Cloud disabled-organization notice; neither caused a failed check.
