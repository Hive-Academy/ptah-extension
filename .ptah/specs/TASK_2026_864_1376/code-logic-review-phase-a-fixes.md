# Code Logic Review (scoped re-review, fix lane FA) - TASK_2026_864_1376

Verdict: **APPROVED** (0 blocking, 0 serious, 2 moderate, 2 minor new findings). Static read only; no nx/jest/verify run (per instruction), so the specs were read, not executed.

## Per-finding status

| Finding | Status | Evidence |
| --- | --- | --- |
| A1 stop() unbounded | CLOSED | `codex-login.service.ts:253-268`: `whenSpawned` and `killTree` sit in one async IIFE raced against a `CODEX_LOGIN_KILL_TIMEOUT_MS` (1.5 s) timer. Timeout, null pid or throw all reach the catch, which calls `child.kill('SIGKILL')` inside try/catch. The timer is cleared in `finally` and unref'd. The IIFE is inside the race, so a late rejection is observed (no unhandled rejection). No child yet -> immediate return, and `launch` re-checks `settled` before spawning (`:100-116`). `dispose()` awaits only this bounded promise, so quit cannot hang on it. The spec uses fake timers (per report). |
| A2 two live children | CLOSED, with a caveat (N2) | `start()` `:77-91`: awaits `previous.stopPromise` (bounded) before spawning and clears a stale `starting`. The restart path does `cancel()` then awaits `stopPromise`. Concurrent starts after the await: the second sees the new non-settled `active` and returns its state, so no double spawn. |
| A5 LineSplitter | PARTIAL (N1) | `flush()` exists and is called for stdout and stderr on close (`codex-login.service.ts:169-174`). An unterminated tail (final URL or code with no newline) is now delivered. An oversized partial is now chunked instead of cleared. Complete oversized lines are still dropped, and ordering is inverted (N1). Kimi: `extractHttpsUrl` is untouched (first candidate, 2048, undefined when there is no URL). Kimi's `LineSplitter` use (`kimi-code-login.service.ts:198-199`) never calls `flush`, so its behaviour is unchanged for all lines under 8192 chars. Only a >8192-char partial now yields chunks instead of nothing; a Kimi URL over 2048 is rejected as before. |
| A7 + style 2 RPC validation | CLOSED | `provider-account-rpc.schema.ts:30-40`: one `ReadinessTriggerSchema` is reused by `ProviderGetAmbientClaudeStatusSchema` (`:142`). `trigger ... .catch(undefined)` drops an unknown trigger. undefined becomes `{}`; null, an array, a non-boolean `refresh`, or a bad `mode`/`restart` fail `safeParse`. Both `codex-readiness-method.ts` and `interactive-login-methods.ts:200-202` throw `RpcUserError(..., 'INVALID_PARAMS')`. The frontend sends `{mode, restart}` and `{refresh, trigger?}` (`codex-sign-in.service.ts:66`, `codex-readiness.service.ts:61`), which both pass. The validation also runs on the legacy no-`codexLogin` path, which is acceptable. |
| Style 1 composition | CLOSED | `created` is now a closure local in `registerElectronCodexReadinessAndLogin`, so there is no module-level mutable state. The handle is registered per container under `CODEX_SIGN_IN_QUIT_HANDLE`, and `expected-resolvable.ts:43` lists it. `main.ts:462-466` only obtains the handle from `bootContainer` (the container `bootstrapElectron` returns), falling back to a no-op when it is absent, as before. `stop()` delegates to the bounded `dispose()`. |

The platform-cli / cli-engine path is untouched: no change under `libs/backend/platform-*` or the runner libs, and `LineSplitter.flush` is additive.

## New findings

### N1 (Moderate) - LineSplitter keeps ordering inversion and a silent drop
`cli-login-output.ts:48-58`: in `push`, the leftover partial is chunk-emitted in the `while` loop before the completed `lines` are emitted in the `for` loop. For `"a\n" + 9000 chars` the later partial text reaches `onLine` before `"a"`. Complete lines longer than 8192 are still discarded by `if (line.length <= MAX_LINE_CHARS)`, so the "overflow no longer silently clears" claim holds only for partials. A Codex URL or code on a single huge line is still lost whenever its newline arrives in the same chunk.
Fix: emit the completed lines first (chunking oversized ones instead of dropping them), then handle the partial.

### N2 (Moderate) - A2 waits for the kill call, not for child exit
`codex-login.service.ts:253-268`: `stopPromise` resolves when `killTree` resolves, on timeout, or after `SIGKILL` is sent. Nothing waits for the child's `close`. If the kill is ignored or slow (the report concedes this), a new start can spawn while the old child still lives, and both can write the same auth file. The bound is deliberate and the window is small. Optionally await a `close`/exit signal, bounded, after the kill.

### N3 (Minor) - Trigger literals are not tied to the shared type
`provider-account-rpc.schema.ts:30`: the enum literals are not checked against `AuthGetCodexReadinessParams['trigger']`. A compile-time `satisfies` or equality check would stop the two from drifting.

### N4 (Minor) - Strictness change for `auth:codexLogin`
`interactive-login-methods.ts:200-202`: `mode: 'bogus'` or `restart: 'yes'` used to fall back to defaults and now returns INVALID_PARAMS. This is the intended direction (decision 70). The existing frontend callers always send valid values.

## Checks for races, leaks and hangs
- No leaked timers: the kill timer is cleared and the login timer is cleaned up in `cleanup`.
- No unhandled rejections found: `stop` is fire-and-forget through `void this.stop`, and its IIFE catches everything.
- Quit: `handleWillQuit` -> `dispose()` -> `cancel()` + a bounded `stopPromise`. It is worst-case about 1.5 s per active attempt.
- Residual uncertainty: specs and types were not executed. The report states that the `ptah_get_diagnostics` calls did not complete, so typecheck is left to CI.
