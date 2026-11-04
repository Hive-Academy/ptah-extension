# Batch 8 report

## Files written

- `apps/ptah-electron/src/di/codex-login-composition.ts` — Electron-only lazy DI factories and the sign-in quit handle.
- `apps/ptah-electron/src/di/codex-login-composition.spec.ts` — synthetic-spawner lifecycle, lazy selection, and sanitizer regression cases.
- `apps/ptah-electron/src/di/phase-2-libraries.ts` — calls the composition immediately after `registerSdkServices`.
- `apps/ptah-electron/src/di/expected-resolvable.ts` — includes both Codex tokens in the DI census.
- `apps/ptah-electron/src/replay/scenario-sanitizer.ts` — allows the read-only readiness RPC, and always drops Codex login RPCs and status pushes.
- `.ptah/specs/TASK_2026_864_1376/batch-8-report.md` — this report.

## Tokens registered

`AUTH_PROVIDERS_TOKENS.SDK_CODEX_LOGIN` resolves a cached `CodexLoginService`. `AUTH_PROVIDERS_TOKENS.SDK_CODEX_READINESS` resolves a cached `CodexReadinessReader`. The selection callback checks `CODEX_RUNTIME_TOKENS.SelectionSnapshot` on each use and throws `CodexExecutableUnavailableError` if absent. It does not resolve the snapshot during registration or service construction. Both tokens are listed in `EXPECTED_RESOLVABLE_TOKENS`. No new `@inject` decorators were added.

## Lifecycle API

`codexSignInQuitHandle` exposes `isActive()` as `created?.isActive() ?? false` and `stop()` as `created?.dispose() ?? Promise.resolve()`. Batch 9 will wire the quit hook. The handle never resolves the service from DI.

## Sanitizer rule

`auth:getCodexReadiness` is in the default RPC allow list. `auth:codexLogin`, `auth:codexLoginCancel`, and `auth:codexLoginStatus` are dropped even if a caller supplies a custom allow list. The regression case includes a synthetic URL, device code, and CLI output.

## Decisions

- **Decision:** Keep the login instance in a module-scoped variable, as the implementation plan specifies. **Options:** module scope or a container lookup on quit. **Evidence:** the planned quit handle must not create a service while quitting. **Reversible:** yes.
- **Decision:** Enforce Codex sign-in exclusion even with custom scenario allow lists. **Options:** rely on the default allow list or force exclusion. **Evidence:** the task requires dropping payload text, including URL and device code. **Reversible:** yes.

## Verification and risks

`ptah_get_diagnostics` was called twice after edits, scoped to the five changed TypeScript files. Both calls reported the TypeScript check still running after its 45-second timeout and returned no diagnostics; this is **not** a passing typecheck. The supplied sandbox forbids running Jest, TypeScript, Nx, or `npm run verify`, so tests were written but could not be executed here. No real `codex login` was run. The module-scoped handle assumes one Electron composition root, matching the plan; a second root would replace its tracked instance.
