# CI unit-test fixes report

## Files changed

- `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts` — completed the fake logger with `error`.
- `libs/backend/cli-engine/src/lib/bootstrap/cli-workspace-index.spec.ts` — completed the harness logger and asserted the current `error`-level open-failure log.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-execution.engine.spec.ts` — added `isIndexing: jest.fn(() => false)` to the indexer double.
- `.github/workflows/ci.yml` — installs ripgrep when the `mcp-bench` project is assigned to a test shard.
- `tools/mcp-bench/src/baselines/native-baselines.spec.ts` — documents both workflows that install ripgrep.

## Verification

Executed from the task worktree, with `--coverage=false --maxWorkers=2`:

```text
node D:/projects/ptah-extension/node_modules/jest/bin/jest.js -c .ptah/tmp/jest.cli-engine.worktree.config.cjs libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts libs/backend/cli-engine/src/lib/bootstrap/cli-workspace-index.spec.ts --coverage=false --maxWorkers=2
```

Result: 2 suites passed, 27 tests passed, 0 failed.

```text
node D:/projects/ptah-extension/node_modules/jest/bin/jest.js -c .ptah/tmp/jest.vscode-lm-tools.worktree.config.js libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-execution.engine.spec.ts --coverage=false --maxWorkers=2
```

Result: 1 suite passed, 31 tests passed, 0 failed.

```text
node D:/projects/ptah-extension/node_modules/jest/bin/jest.js -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/baselines/native-baselines.spec.ts --coverage=false --maxWorkers=2
```

Result: 1 suite passed, 11 tests passed, 0 failed.

The standard cli-engine config and all project presets map `marked` to this worktree's absent `node_modules`; the temporary cli-engine and requested vscode-lm-tools configs remap it to the main checkout. Jest reported native-cache or line-ending warnings that PowerShell surfaced with a nonzero wrapper exit, but each Jest summary above has zero failed tests.

Scoped TypeScript diagnostics were requested after editing but were unavailable because the compiler service was still running after its 45-second check window.
