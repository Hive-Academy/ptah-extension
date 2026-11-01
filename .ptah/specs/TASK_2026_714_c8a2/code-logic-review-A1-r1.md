# Code Logic Review - A1 r1

Score: 8.5/10. Verdict: APPROVED. Blocking 0, Serious 0, Moderate 1 (minor).

Scope: the git diff of the worktree plus `apps/ptah-electron/src/di/codex-electron-admission.ts`, read in full. Read-only: no tests, typecheck or lint run. The part of the spec diff that sat above the omitted lines was read from the diff text.

## B1 (unpackaged runs admitted for chat): FIXED

- `codex-electron-admission.ts:16-18`: chat is admitted by `gateEnabled || codexDevRouteCovers(devRoute,'chat') || packagedWindows`. `packagedWindows` requires `isPackaged && win32 && x64`, so unpackaged runs are no longer admitted by default.
- The lane rule is unchanged: `!isPackaged || gate || packagedWindows` (line 19), the same expression as before.
- `codex-lane-composition.ts:52-56` delegates to the shared predicate with `'lane'`.
- Unpackaged chat goes through `resolveGatedCodexRuntime` (`codex-runtime-composition.ts` resolveRuntime hunk). The raw `scope.resolve` is used only when `isPackaged`, the shared chat gate is closed and admission passes. Any other case, including gateway and unpackaged chat, takes the gated resolver. So the dev-route override check and the `PTAH_CODEX_RUNTIME_DEV` warning still run for unpackaged chat.
- Packaged non-win32/x64 chat with the gate closed throws "Codex chat production routing disabled by parity gate".

## Flag versus resolver agreement

- Packaged linux or darwin with `PTAH_CODEX_RUNTIME_DEV` set: `readCodexDevRouteOverride({isPackaged:true})` yields no route, per the existing spec expectation that a packaged dev env gives `devRoute: null`. `nativeCodex` is false and the resolver throws, so they agree.
- Packaged win32/x64: the flag is true and the resolver is raw, so they agree. The table case `{isPackaged:true, env:{DEV:'1'}, chat:true, gateway:false}` matches. The gateway stays gated and closed.
- Unpackaged with a gateway-only route: the flag is false because `codexDevRouteCovers(...,'chat')` is false. The resolver refuses through the shared gate. The spec at "does not admit unpackaged chat from a gateway-only development route" asserts this.
- Unpackaged with no env: the flag is false and the resolver refuses. The spec "refuses unpackaged chat without a development route" restores the no-env expectation.

## Spec assertions

- Restored `nativeCodex:false` for unpackaged without env.
- A new `nativeCodex:true, nativeCodexGateway:false` case for the chat-only route.
- A dev-route chat resolver test asserts the same runtime instance and the warning text.
- Packaged win32/x64 asserts the flag, the raw resolve, and exactly one admission log.
- Denied linux/x64 and darwin/arm64 assert the flag is false, the throw, and no info log.
- The first test now uses a packaged linux platform so that it exercises the native-off throw.
- The adapter spec covers both branches: a `resolveRuntime` port present, and absent (falls back to the shared gate).

## Info log

`codex-runtime-composition.ts` logs when `isPackaged && nativeCodex && !gate(chat)`. That is reachable only through the packaged win32/x64 admission, because the dev route is null when packaged. It is correct. It is emitted once per binding context creation, not per session.

## Moderate (non-blocking)

- The packaged win32/x64 admission is a hardcoded predicate that mirrors `codex-parity-gate.ts:201-212`. It can drift from the shared gate. There is no test tying it to the gate. This is the same drift risk the earlier comment already described, so it is accepted.
- The raw resolver error message differs from the shared one. The adapter only maps it to `runtime-failed`, so behaviour is not affected.

## Five questions (brief)

1. Silent failure: none found. Refusals throw and map to `runtime-failed`.
2. User action: opening unpackaged chat without the env var is now refused, which is the intended behaviour.
3. Input data: a gateway-only route does not open chat, and this is tested.
4. Dependency failure: not changed by this batch.
5. Missing: a contract test that links the Electron win32/x64 literal to the parity gate. Optional.

Verdict: APPROVED. Confidence: HIGH on logic, with the caveat that nothing was executed.
