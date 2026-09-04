# TASK_2026_367 — batch report FIX-F2

Review findings addressed:

- **Wave 1 F2 (MEDIUM)**: ANSI-strip raw SDK stderr before classifying in `PtahCliRegistry.handleChildStderr`.
- **Wave 1 F4 (LOW)**: Word-boundary regression test in `classifyCliStderr` asserting embedded keywords (e.g. `abortive attempt`) classify as `'info'`.
- **Wave 2 F2 (LOW)**: Shared typed spawner fake (`FakeSdkProcessSpawner`) replacing eight `as unknown as never` / `null as never` test casts, plus container DI smoke spec asserting `CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY` resolves with the real `OffThreadProcessSpawner`.

---

## Files Created / Modified

### Created

- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/testing/fake-sdk-process-spawner.ts`
- `libs/backend/cli-agent-runtime/src/lib/di/register.ptah-cli-registry.smoke.spec.ts`

### Modified

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-stderr-severity.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts`
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-off-thread-spawn.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-harness-preflight.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-lmstudio-proxy.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-output-style.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-permission-routing.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-sakana-proxy.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-spawn-model.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-tiers.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.proxy-lease.spec.ts`

No other files were touched.

---

## Changes and Guarantees

### 1. ANSI-strip before classifying (Wave 1 F2)

- In `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts`:
  - Imported `stripAnsiCodes` from `../cli-agents/cli-adapters/cli-adapter.utils`.
  - In `handleChildStderr`: stripped ANSI escape sequences and trimmed before classification:
    ```ts
    const isError = classifyCliStderr(stripAnsiCodes(data).trim()) === 'error';
    ```
  - The raw original `data` is preserved verbatim in the log payload (`[PtahCliRegistry] Agent "${agentConfig.name}" stderr: ${data}`).
- In `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-off-thread-spawn.spec.ts`:
  - Pinned callback identity assertion:
    ```ts
    expect(capturedHooks.onStderr).toBe(options?.stderr);
    ```
  - Added regression test asserting an ANSI-coloured error line (`\x1b[31mError\x1b[0m: ENOENT: no such file or directory`) passes to `logger.warn` with the full message and never invokes `logger.error`.

### 2. Word-boundary test (Wave 1 F4)

- In `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-stderr-severity.spec.ts`:
  - Added `expect(classifyCliStderr('abortive attempt')).toBe('info');` in `it('respects word boundaries', ...)`.
  - Supplements the existing non-keyword checks with an exact compound word embedding the `abort` fragment.

### 3. Typed spawner fake replacing 8 `as never` casts (Wave 2 F2)

- Defined `FakeSdkProcessSpawner` in `libs/backend/cli-agent-runtime/src/lib/ptah-cli/testing/fake-sdk-process-spawner.ts`.
  - Implements `ISdkProcessSpawner` from `../../spawn/sdk-process-spawner.port`.
  - Uses structural return types and runtime delegation (`createJestMock`) to avoid direct `jest` global namespace dependencies during `tsconfig.lib.json` compilation.
  - Generates minimal conforming `SpawnedProcess` doubles.
- Replaced `{ spawn: jest.fn() } as unknown as never` and `null as never` across all 8 existing test constructor call sites:
  1. `ptah-cli-registry-harness-preflight.spec.ts`
  2. `ptah-cli-registry-lmstudio-proxy.spec.ts`
  3. `ptah-cli-registry-output-style.spec.ts`
  4. `ptah-cli-registry-permission-routing.spec.ts`
  5. `ptah-cli-registry-sakana-proxy.spec.ts`
  6. `ptah-cli-registry-spawn-model.spec.ts`
  7. `ptah-cli-registry-tiers.spec.ts`
  8. `ptah-cli-registry.proxy-lease.spec.ts`
     All 8 specs pass `createFakeSdkProcessSpawner()` directly with compile-time type safety.

### 4. Container DI smoke spec (Wave 2 F2)

- Added `libs/backend/cli-agent-runtime/src/lib/di/register.ptah-cli-registry.smoke.spec.ts`.
- Builds a tsyringe child container with host platform mocks (`TOKENS.LOGGER`, `TOKENS.CONFIG_MANAGER`, `PLATFORM_TOKENS.SECRET_STORAGE`, `TOKENS.AUTH_SECRETS_SERVICE`, `TOKENS.GIT_INFO_SERVICE`, etc.).
- Mocks `@ptah-extension/agent-generation` to provide `AGENT_GENERATION_TOKENS` without loading tree-sitter ESM in CommonJS Jest.
- Executes container registrations in production order:
  - `registerAuthProvidersServices(c, logger)`
  - `registerSdkServices(c, logger)`
  - Stubs `SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER` to decouple deep query-runner runtime dependencies.
  - `registerCliAgentRuntimeServices(c, logger)`
- Resolves `CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY` and asserts:
  - Instance is a `PtahCliRegistry`.
  - Injected `processSpawner` is the real `OffThreadProcessSpawner` (`spawner.constructor.name === 'OffThreadProcessSpawner'`).
  - `typeof spawner.spawn === 'function'`.

---

## What the DI Smoke Proves and What It Intentionally Does Not Prove

### Proves

1. The DI binding `CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY` resolves to `PtahCliRegistry` in a production-structured tsyringe container without missing collaborator registrations.
2. The `PtahCliRegistry` constructor parameter `@inject(SDK_TOKENS.SDK_PROCESS_SPAWNER) private readonly processSpawner: ISdkProcessSpawner` is successfully wired to `agent-sdk`'s registered `OffThreadProcessSpawner` instance, confirming cross-library token alignment without public barrel coupling.

### Intentionally Does Not Prove

1. Does not spawn a live worker thread or execute external binaries. (Off-thread process execution is verified by unit and performance tests in `@ptah-extension/agent-sdk`).
2. Does not exercise interactive query loops or tool execution, since `SessionLifecycleManager` and UI-layer dependencies are stubbed to isolate registry resolution from full desktop application runtime services.

---

## Verification Results

| Target / Command                                                    | Result       | Details                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime`      | **PASSED**   | **45/45 suites passed**, **543/543 tests passed** (100%).                                                                                                                                                                                                        |
| Targeted test: `ptah-cli-registry*`                                 | **PASSED**   | **10/10 suites passed**, **45/45 tests passed**.                                                                                                                                                                                                                 |
| Targeted test: `cli-stderr-severity.spec.ts`                        | **PASSED**   | **1/1 suite passed**, **5/5 tests passed**.                                                                                                                                                                                                                      |
| Targeted test: `register.ptah-cli-registry.smoke.spec.ts`           | **PASSED**   | **1/1 suite passed**, **2/2 tests passed**.                                                                                                                                                                                                                      |
| `npx nx run-many -t typecheck -p @ptah-extension/cli-agent-runtime` | **PASSED**   | **0 errors**. `tsconfig.lib.json` compiles cleanly.                                                                                                                                                                                                              |
| `npx nx run-many -t lint -p @ptah-extension/cli-agent-runtime`      | **REPORTED** | 0 errors and 0 warnings in any touched/created files. 1 project error in `package.json` (`@nx/dependency-checks` missing `@anthropic-ai/claude-agent-sdk` from B8 `src/lib/spawn/sdk-process-spawner.port.ts`). 35 pre-existing warnings in other adapter files. |
| `npx prettier --write <files>`                                      | **CLEAN**    | All touched files formatted according to repo conventions.                                                                                                                                                                                                       |

---

## Anything Left Undone

- `libs/backend/cli-agent-runtime/package.json` was left unmodified in strict accordance with the hard constraint ("Edit only files under libs/backend/cli-agent-runtime/src/lib/ptah-cli/, cli-agents/cli-adapters/cli-stderr-severity.spec.ts, and (for the smoke) src/lib/di/"). Adding `"@anthropic-ai/claude-agent-sdk": "0.3.150"` to `package.json` dependencies will clear the single pre-existing `@nx/dependency-checks` warning whenever package manifest edits are authorized.

---

DONE: FIX-F2 — ANSI stripped before stderr classify, word boundary tested, typed spawner fake replaces 8 never casts, and PtahCliRegistry container DI smoke passes with real OffThreadProcessSpawner
