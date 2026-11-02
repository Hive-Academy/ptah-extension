# Batch 10d.V fix 1 report

## Changes

1. Gate-admitted spec cases:
   - `apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.spec.ts:261-275`: replaced the impossible typed `mockReturnValue(true)` with a saved `isEnabled` descriptor, a temporary `Object.defineProperty` override, and restoration in `finally`.
   - `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts:136-146`: used the same descriptor override; the production container is disposed and the descriptor restored in `finally`.
2. Logger type:
   - `apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.spec.ts:8,76-88`: registered the mock under `TOKENS.LOGGER` and passed `parent.resolve<Logger>(TOKENS.LOGGER)` to the factory, matching the Electron spec's typed container pattern.
3. Legacy composition guard:
   - `apps/ptah-extension-vscode/src/di/surface-composition.spec.ts:92-95,104-108`: asserted phase 2 imports only `registerVsCodeCodexLaneFactory` from the lane file and calls it. Exempted only the normalized path ending in `/di/codex-lane-runtime-composition.ts` from the `registerCodexRuntime*` / `CODEX_RUNTIME_TOKENS` ban. The lane file remains checked for `devRoute`, `readCodexDevRouteOverride`, and all listed chat host bindings; every other source retains the full guard.

## Decisions

- Used the Electron descriptor override pattern for the gate-admitted cases. A Jest return-value mock conflicts with the gate's literal `false` return type. This is test-local and reversible.
- Resolved `Logger` through the registered DI token, as the compiled Electron lane spec does. This avoids a cast and keeps the fixture's logger identity. Reversible.
- Kept the guard exception at one path, with separator normalization and a path-component boundary. The lane helper legitimately composes a native lane; chat bindings remain forbidden. Reversible.

## Verification

- Inspected the edited lines, confirmed each scoped spec remains UTF-8 without BOM and retains LF line endings.
- Did not run verify, tests, typecheck, lint, build, nx, npm, or `ptah_get_diagnostics`, per the task hard rules.