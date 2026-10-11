# Sonar follow-up report

## Changes

- Fix A — `tools/mcp-bench/src/utils/git-executable.ts`, `tools/mcp-bench/src/baselines/rg-runner.ts`, `tools/mcp-bench/src/ground-truth/relevance-questions.ts`, `tools/mcp-bench/src/baselines/native-baselines.ts`, and `tools/mcp-bench/src/main.ts`: generalized the cached, validated executable resolver, centralized the sole `which`/`where` launch, added `GH_PATH` support, and replaced the specified bare `git`/`gh` launches with resolved absolute executables.
- Fix B — `.github/workflows/mcp-bench.yml`: the `bench-electron` job now restores Electron's downloaded binary after its scripts-disabled install.
- Fix C — `tools/mcp-bench/src/suites/tool-results.ts` and `tools/mcp-bench/src/suites/tool-suites.spec.ts`: restored the original location regex and covered `file:line:column` plus quoted-path behavior.
- Fix D1 — `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts` and its spec: queue the per-file lock synchronously while converting setup failures to rejected promises.
- Fix D2 — `libs/backend/thoth-runtime/src/lib/workspace-index-lifecycle.ts` and its spec: synchronously thrown abort errors again return without reporting or scheduling a follow-up run.
- Fix D3 — `tools/mcp-bench/src/metrics/retrieval-metrics.ts` and its spec: preserve `/` as a workspace root and relativize paths beneath it.

## Verification

- PASS — `node D:/projects/ptah-extension/node_modules/jest/bin/jest.js -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/suites/tool-suites.spec.ts tools/mcp-bench/src/metrics/retrieval-metrics.spec.ts --coverage=false --maxWorkers=2` — 2 suites passed; 29 tests passed; 0 failed. The first run exposed two incorrect new test expectations, corrected before this passing run.
- PASS — `node D:/projects/ptah-extension/node_modules/jest/bin/jest.js -c libs/backend/workspace-intelligence/jest.config.ts libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.spec.ts --coverage=false --maxWorkers=2` — 1 suite passed; 56 tests passed; 0 failed.
- PASS — `node D:/projects/ptah-extension/node_modules/jest/bin/jest.js -c libs/backend/thoth-runtime/jest.config.ts libs/backend/thoth-runtime/src/lib/workspace-index-lifecycle.spec.ts --coverage=false --maxWorkers=2` — 1 suite passed; 22 tests passed; 0 failed.
- PASS — `node D:/projects/ptah-extension/node_modules/jest/bin/jest.js -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/baselines/native-baselines.spec.ts --coverage=false --maxWorkers=2` — 1 suite passed; 11 tests passed; 0 failed.
- PASS — `node D:/projects/ptah-extension/node_modules/typescript/bin/tsc -p tools/mcp-bench/tsconfig.json --noEmit` — 0 errors.
- PASS — `node D:/projects/ptah-extension/node_modules/typescript/bin/tsc -p libs/backend/workspace-intelligence/tsconfig.lib.json --noEmit` — 0 errors.
- PASS — `node D:/projects/ptah-extension/node_modules/typescript/bin/tsc -p libs/backend/thoth-runtime/tsconfig.lib.json --noEmit` — 0 errors.
- PASS — Prettier ran successfully on every changed source, spec, workflow, and this report, including `tools/mcp-bench/src/baselines/rg-runner.ts`.

The Jest commands emitted existing Windows native-cache EPERM warnings but their summary lines reported passing suites and tests.

## Skipped

- No workspace-wide checks, builds, benches, e2e runs, or Nx run-many targets were run, per the memory-safe verification requirement.
- No resolver-specific spec was added because `tools/mcp-bench/src` contains no existing `git-executable.spec.ts`; no test spawns `gh`.
