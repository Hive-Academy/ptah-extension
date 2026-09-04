# Batch C1 Report — TASK_2026_334

## Verdict

PASS. Both requested defects are fixed, all requested regression cases are covered, and both exact uncached Nx verification commands exited 0 after running both requested projects.

## Architecture Assessment

**Complexity Level:** 1 — targeted bug fix.

**Signals observed:**

- Two small, independent defects with exact file ownership and prescribed behavior.
- No new dependencies, services, persistence, or integration patterns.
- Existing runtime/service and pure-helper seams already own the affected behavior.

**Patterns justified:**

- Named exported constants provide one source of truth for the concurrency contract.
- Pure, local UTF-16 boundary guard preserves the existing trimming algorithm.

**Patterns explicitly rejected:**

- No new abstraction, feature flag, compatibility layer, configuration surface, or refactor was needed.

## Changes

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`
  - Added and exported `MIN_CONCURRENT_AGENTS = 1`, `MAX_CONCURRENT_AGENTS = 20`, and `DEFAULT_CONCURRENT_AGENTS = 5`.
  - Updated `getMaxConcurrentAgents()` to use the default constant, fall back to 5 for non-finite values, and clamp finite values to 1..20.
  - Updated the method documentation to explain why runtime enforcement is required for Electron, CLI, and hand-edited settings, and why malformed non-finite values use the default.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/index.ts`
  - Re-exported the three concurrency constants through the library's existing CLI-agent/public barrel.
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`
  - Replaced the duplicated hard-coded `1` and `20` bounds with the public cli-agent-runtime constants.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager-helpers.ts`
  - Updated `trimBufferToLowWater()` so only the no-newline fallback advances past a low surrogate at the cut point.
  - Kept the newline path unchanged because a newline cannot be part of a surrogate pair.
  - Kept `linesDropped` based on the final adjusted `dropEnd`.
  - Updated the function documentation to describe the UTF-16-safe fallback.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts`
  - Added direct regression coverage using the suite's existing typed private-member cast convention; no `any` or suppression was introduced.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager-helpers.spec.ts`
  - Added the new pure-helper spec for an exact surrogate split and the unchanged newline-boundary path.

## Exact Test Names Added

Under `AgentProcessManager - SDK Execution Path > getMaxConcurrentAgents()`:

- `clamps a configured value above the maximum down to 20`
- `clamps a configured 0 up to the minimum of 1`
- `clamps a configured -5 up to the minimum of 1`
- `preserves a configured value inside the supported range`
- `falls back to 5 for a non-finite configured value`

Under `trimBufferToLowWater`:

- `does not leave a lone surrogate when the no-newline cut splits a pair`
- `continues to cut at the next newline boundary`

## Verification

### Tests

Exact command:

```text
npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers --skip-nx-cache
```

Exit code: `0`.

Nx project header and final result:

```text
NX   Running target test for 2 projects:

- @ptah-extension/cli-agent-runtime
- @ptah-extension/rpc-handlers

NX   Successfully ran target test for 2 projects
```

Verbatim Jest counts:

```text
@ptah-extension/cli-agent-runtime

Test Suites: 42 passed, 42 total
Tests:       525 passed, 525 total
Snapshots:   0 total
Time:        54.694 s
Ran all test suites.
```

```text
@ptah-extension/rpc-handlers

Test Suites: 91 passed, 91 total
Tests:       31 skipped, 2620 passed, 2651 total
Snapshots:   0 total
Time:        74.402 s
Ran all test suites.
```

The cli-agent-runtime Jest process also printed its existing worker-force-exit warning, but the suite and Nx command completed successfully with the counts above.

### Typecheck and lint

Exact command:

```text
npx nx run-many -t typecheck lint -p @ptah-extension/cli-agent-runtime @ptah-extension/rpc-handlers --skip-nx-cache
```

Exit code: `0`.

Nx project header and final result:

```text
NX   Running targets typecheck, lint for 2 projects:

- @ptah-extension/cli-agent-runtime
- @ptah-extension/rpc-handlers

NX   Successfully ran targets typecheck, lint for 2 projects
```

Verbatim lint counts:

```text
@ptah-extension/cli-agent-runtime
✖ 35 problems (0 errors, 35 warnings)

@ptah-extension/rpc-handlers
✖ 18 problems (0 errors, 18 warnings)
```

Both typecheck targets completed with no TypeScript diagnostics. Lint had zero errors; the warnings are allowed by the task's verification rule.

## Tooling Note

`ptah.code.searchSymbols` and `ptah.code.getSymbol` were not available in this session. I used the available `ptah.ast.analyze` tool before targeted reads; the structural analyzer also confirmed that the requested helper spec did not exist, so it was created. Targeted PowerShell/`rg` reads were used only as the required fallback for test conventions and public barrel contents.

## Scope

No files under `libs/backend/agent-sdk/**` were touched. No commit was created.
