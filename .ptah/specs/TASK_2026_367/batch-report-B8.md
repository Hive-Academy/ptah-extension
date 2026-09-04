# Batch Report — B8

**Task**: TASK_2026_367 Batch B8 (C7a — off-thread spawn for `cli-agent-runtime`)  
**Branch**: `fix/log-defects-367`  
**Date**: 2026-09-03

---

## 1. Files Created and Modified

### Created

- `libs/backend/cli-agent-runtime/src/lib/spawn/sdk-process-spawner.port.ts`:
  - Declares the `ISdkProcessSpawner` structural port interface (`spawn(options: SpawnOptions, hooks?: { onStderr?: (data: string) => void }): SpawnedProcess`).
  - Typed against `@anthropic-ai/claude-agent-sdk`, matching `OffThreadProcessSpawner.spawn` structurally at the injection site without requiring barrel changes or new DI tokens (Decision D-7a).
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-off-thread-spawn.spec.ts`:
  - Unit tests verifying the off-thread spawn seam on `PtahCliRegistry.spawnAgent()`.
  - Mirrors `ptah-cli-registry-spawn-model.spec.ts` harness construction.

### Modified

- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts`:
  - Injected `@inject(SDK_TOKENS.SDK_PROCESS_SPAWNER) private readonly processSpawner: ISdkProcessSpawner`.
  - Added `spawnClaudeCodeProcess: (spawnOptions) => this.processSpawner.spawn(spawnOptions, { onStderr: handleChildStderr })` in the `queryFn` options object.
  - Kept existing `stderr: handleChildStderr` option in place.
- Updated constructor argument list in 8 existing specs that instantiate `new PtahCliRegistry(...)`:
  - `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-spawn-model.spec.ts`
  - `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-harness-preflight.spec.ts`
  - `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-lmstudio-proxy.spec.ts`
  - `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-output-style.spec.ts`
  - `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-permission-routing.spec.ts`
  - `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.proxy-lease.spec.ts`
  - `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-sakana-proxy.spec.ts`
  - `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-tiers.spec.ts`

---

## 2. Spec Assertions Added

In `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-off-thread-spawn.spec.ts`:

1. **`supplies spawnClaudeCodeProcess on the Options object passed to queryFn`**:
   - Asserts `options.spawnClaudeCodeProcess` is passed to the SDK `queryFn` and is a function.
2. **`delegates to the injected processSpawner with spawnOptions and onStderr hook`**:
   - Asserts calling `spawnClaudeCodeProcess(spawnOptions)` delegates to `spawner.spawn` with identical options and `{ onStderr: expect.any(Function) }`.
3. **`passes onStderr hook that classifies benign stderr to logger.debug and never calls logger.error`**:
   - Asserts benign line `[claude-code:unrecognized_model] {"model":"x"}` passed to `hooks.onStderr` reaches `logger.debug`, and `logger.error` / `logger.warn` are never called.
4. **`passes onStderr hook that classifies error stderr to logger.warn`**:
   - Asserts error line `fatal: process failed with code 1` passed to `hooks.onStderr` reaches `logger.warn`, and `logger.error` is never called.
5. **`preserves the options.stderr callback alongside spawnClaudeCodeProcess`**:
   - Asserts `options.stderr` remains present as a fallback on the `Options` object.

---

## 3. Test, Lint, and Typecheck Results

### Test (`npx nx run-many -t test -p @ptah-extension/cli-agent-runtime`)

- **Test Suites**: 44 passed, 44 total (was 43 passed before, +1 new suite)
- **Tests**: 540 passed, 540 total (was 533 passed before, +7 new tests)
- **Time**: 17.96 s

### Lint (`npx nx run-many -t lint -p @ptah-extension/cli-agent-runtime`)

- **Problems**: 0 errors, 35 warnings (35 warnings pre-existing; 0 warnings/errors in new or modified code)

### Typecheck (`npx nx run-many -t typecheck -p @ptah-extension/cli-agent-runtime`)

- **Status**: Passed with 0 errors (`tsc --noEmit --project libs/backend/cli-agent-runtime/tsconfig.lib.json`)

---

## 4. Deviations from the Plan

None. Reused existing token `SDK_TOKENS.SDK_PROCESS_SPAWNER` via structural port `ISdkProcessSpawner`, avoiding any changes to `agent-sdk` barrels or app composition roots.

---

## 5. Anything Left Undone

None. Batch B8 is complete.

---

DONE: B8 — Off-thread spawn seam wired in PtahCliRegistry with structural spawner port
