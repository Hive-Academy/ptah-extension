# Code Logic Review - TASK_2026_714_c8a2 batch 10e.G

Score: 8.5/10. Verdict: APPROVED (no blocking or serious defects; 3 minor items).

## Scope read

codex-lane-composition.ts (whole), its spec diff, container.smoke.spec.ts 10e.G hunks, cli-detection.service.ts and spec diff, codex-parity-gate.ts, codex-runtime di/registration.ts (resolveGatedCodexRuntime), phase-2-libraries.ts call site, VS Code smoke spec diff. No commands run.

## Checks

- Platform check is exact: `platform === 'win32' && arch === 'x64'` (codex-lane-composition.ts:51-56). The gate's closed row is also win32/x64 (codex-parity-gate.ts:201). No packaged path admits anything else: `!isPackaged` false, `gate.isEnabled` is typed `false` and always returns false, third clause is the exact row. OK.
- Single routing boundary: the same `isElectronCodexLaneAdmitted` drives the factory bind (:245) and runtime resolve (:254). Packaged darwin/linux binds no factory and resolve throws. OK.
- Shared gate and other hosts unchanged: no diff under libs/backend/codex-runtime, cli-engine, apps/ptah-cli, apps/ptah-tui, or VS Code src (only the VS Code smoke spec, adjusted for removal of the legacy adapter). OK.
- Raw Runtime token in packaged win32/x64: pin lookup and `inspectElectronCodexBinary` run in `open()` (:204-209) before the scope is built and before `.open()`, and in `binary.resolve` (:167), so the digest check still precedes any spawn; a mismatch rejects and disposes the scope (:235-238). The dev-route warning is skipped, which is correct: resolveGatedCodexRuntime would throw in packaged builds because readCodexDevRouteOverride yields null when packaged, and the warning text names PTAH_CODEX_RUNTIME_DEV, which would be false. Unpackaged behaviour is identical to before (it already used the raw token). Not harmful.
- Specs: admission matrix covers packaged win32/x64, darwin/arm64, linux/x64, and unpackaged darwin/linux (spec :185-213) with injected platform objects, not process.platform. Digest-mismatch test uses the fixed `platform` constant (:56). Smoke spec uses an injected `hostPlatform`. Remaining process.platform uses (:167, :327, :356, :396) are pre-existing home-key normalisation, unrelated. Assertions are not weakened except as noted in defect 3.
- Rule scan: no `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`, or new catches in the 10e.G hunks. CR bytes 0 in all five files.
- cli-detection.service.ts:107-109: no-factory branch is warn with the same Error context and keeps the unavailable adapter; factory-throws path still error/Sentry (:100). Defect 1 of the 10e review is fixed.

## Defects

1. Minor - codex-lane-composition.ts:54 and :256-257. The `new CodexParityGate().isEnabled('lane', ...)` clause in the admission and the `resolveGatedCodexRuntime` branch are unreachable while the gate is typed/returns `false`. They are kept for a future gate release, but the hard-coded win32/x64 literal at :55 duplicates the gate's reviewed row, so the two can drift. Fix: add a one-line comment that the gate clause is a forward-compatibility hook and the literal is the Electron-local D29 row to remove when the shared gate opens; no behaviour change.

2. Minor - codex-lane-composition.ts:250-259. Packaged win32/x64 now routes through the raw token with no log line, so the production exception is invisible in logs (the dev-route warning that previously marked non-gated routing is skipped, correctly). Fix: log once per scope/process at registration (:245) via `logger.info('Native Codex lane admitted by Electron win32/x64 signed proof (D29)')` when `isPackaged` and the gate is closed.

3. Minor - apps/ptah-extension-vscode/src/di/container.smoke.spec.ts:~125. The production assertion changed from `toBeInstanceOf(CodexCliAdapter)` to `toMatchObject({ name: 'codex', supportsMcp: false })`, which does not prove the adapter is the unavailable stand-in. Fix: also assert `await prod.service.getAdapter('codex')?.detect()` reports not installed/unavailable (whatever unavailableCodexAdapter returns), so the no-factory state is distinguished from a working adapter.

## Five questions (short)

Silent failure: none new; missing factory now warns visibly. Unexpected user action: packaged macOS/Linux users see Codex unavailable, as decided. Wrong-answer input: platform strings other than the exact pair deny. Dependency failure: binary inspection rejection propagates and spawns nothing (tested). Missing: admission log (defect 2).
