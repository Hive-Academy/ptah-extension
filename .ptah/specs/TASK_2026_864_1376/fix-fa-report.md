# Fix FA report

## Findings

- Phase A F1: `codex-login.service.ts:240-269` formerly awaited `whenSpawned` and `killTree` without a bound. Both now run under `CODEX_LOGIN_KILL_TIMEOUT_MS` (1500 ms); timeout, null PID, or rejection sends direct `SIGKILL`. `codex-login.service.spec.ts` covers never-settling spawn and tree kill with fake timers.
- Phase A F2: `codex-login.service.ts:77-91` formerly let a new start bypass a settled attempt while its child was alive. A new start waits for the prior bounded stop and releases a stale launch promise before spawning. The spec covers cancel followed by immediate retry, including a never-settling `whenSpawned`.
- Phase A F5: `cli-login-output.ts:46-64` formerly discarded an oversized partial line and an unterminated tail. It now emits 8192-character chunks and exposes `flush()`. `codex-login.service.ts:169-174` flushes stdout and stderr on close. Specs cover overflow, one-time flush, and a final URL without newline.
- Phase A F7 / style F2: `provider-account-rpc.schema.ts:30-40,137-144` now owns one trigger enum and Codex readiness/login Zod schemas. `codex-readiness-method.ts:20-27` and `interactive-login-methods.ts:200-208` use `safeParse` and raise `INVALID_PARAMS` on malformed inputs. Unknown readiness triggers are dropped. Specs cover malformed readiness and login inputs, plus retained unknown-trigger behavior.
- Style F1: `codex-login-composition.ts:18-35` formerly exposed a quit handle over module-level mutable state. The handle is now registered per container under `CODEX_SIGN_IN_QUIT_HANDLE`; `main.ts:39,462-464` resolves it from the boot container, and `expected-resolvable.ts:16,43` includes the token. The composition spec covers two independent containers.

## Files touched

- `libs/backend/auth-providers/src/lib/providers/codex/codex-login.service.ts` and `.spec.ts`
- `libs/backend/auth-providers/src/lib/providers/cli-login-output.ts` and `.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.schema.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/auth/codex-readiness-method.ts` and `.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/auth/interactive-login-methods.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.spec.ts`
- `apps/ptah-electron/src/di/codex-login-composition.ts` and `.spec.ts`
- `apps/ptah-electron/src/di/expected-resolvable.ts`
- `apps/ptah-electron/src/main.ts`
- `.ptah/specs/TASK_2026_864_1376/fix-fa-report.md`

## Decisions

- Use a registration-local handle and an Electron-local DI token, keeping the service lazy and the handle tied to the container. A shared auth-providers token was unnecessary. Reversible.
- Preserve permissive extra fields in Codex request objects while rejecting malformed known fields; readiness unknown `trigger` is dropped as required by Batch 6. Reversible.
- After the bounded tree-kill attempt, direct `SIGKILL` is the terminal fallback. It cannot prove OS process exit when a child ignores or fails the kill request. Reversible.

## Risks and limitations

- No Jest, Nx, npm verify, tsc, build, or git commands were run, per lane instructions. The scoped `ptah_get_diagnostics` calls did not return a completed TypeScript result within 45 seconds, so typechecking and execution remain for CI.
- The fake-spawner tests never invoke a real `codex login`.
