# Code Logic Review A1 (TASK_2026_714_c8a2)

Score: 5/10. Verdict: REVISE (1 blocking, 0 serious, 2 minor).

## Blocking

### B1. Unpackaged dev behavior changed: chat is now native-admitted without a dev route
- `apps/ptah-electron/src/di/codex-electron-admission.ts:11-13`: `!input.isPackaged ||` admits every unpackaged run (any platform, no `PTAH_CODEX_RUNTIME_DEV`). The lane rule is copied verbatim, but the chat rule it replaces was `gate.isEnabled(chat) || codexDevRouteCovers(devRoute, chat)` (old `codex-runtime-composition.ts:81-83`), i.e. unpackaged without the env flag was OFF.
- Effect 1: `codex-runtime-composition.ts:83` now yields `nativeCodex=true` for plain `electron .` dev runs, so `apps/ptah-electron/src/activation/bootstrap.ts:593` binds native chat and routes main chat to the App Server for every unpackaged developer. The intent said "unpackaged dev unchanged".
- Effect 2: the resolver (`codex-runtime-composition.ts:583-592`) skips `resolveGatedCodexRuntime` for unpackaged, so the `DevRouteOverride` check and the dev-route warning (`libs/backend/codex-runtime/src/lib/di/registration.ts:116-134`) never run. A dev route covering only `gateway` no longer limits chat.
- Effect 3: the spec was rewritten to match the regression: `codex-runtime-composition.spec.ts` "admits unpackaged chat while keeping its gateway gated" now expects `nativeCodex: true` (previously `false`), and the `binds six stable ports` table flips `isPackaged:false, env:{}` to chat `true`. The refusal tests cover only packaged linux/darwin.
- Fix: chat admission must be `gate.isEnabled(chat) || codexDevRouteCovers(devRoute, chat) || (isPackaged && win32 && x64)`. Keep the lane helper unchanged (it needs `!isPackaged`); give chat its own predicate or a consumer-specific branch. In the resolver, route everything except the packaged-win32/x64 case through `resolveGatedCodexRuntime`. Restore the old unpackaged expectations in the specs and add a test that unpackaged without env stays refused for chat.

## Verified OK
- Binary verification and session scoping preserved: the resolver only calls `scope.resolve(Runtime)` on the child scope container built in `createElectronCodexScopeFactory` (`codex-runtime-composition.ts:224-262`), after `createElectronCodexExecutable`, the identity check and the inherited-runtime rejection. No bypass of root/hash checks.
- Admission and flag agree: `nativeCodex` (line 83), the scope factory guard (line 230), the resolver and the lane all call `isElectronCodexConsumerAdmitted`, so no native-marked-then-throws split, apart from B1 itself.
- Gate-open branch (`codex-runtime-composition.ts:583-587`) still uses `resolveGatedCodexRuntime`; `gateway` always does, and `nativeCodexGateway` is untouched.
- Info log (`codex-runtime-composition.ts:320-323`) is emitted once per binding, only when packaged, admitted and the shared gate is closed; the denied-platform test asserts `logger.info` not called, and the admitted test asserts exactly 1.
- Absent port: `codex-chat-adapter.ts:361-363` falls back to the exact old `resolveGatedCodexRuntime(..., this.ports.platform)`; the new spec asserts the parity-gate rejection and `open` not called. `resolveRuntime` is optional, so VS Code, CLI and `cli-engine` port constructors still compile (grep shows only electron plus agent-sdk reference the field).
- Lane behavior is the same expression as before (`codex-lane-composition.ts:55`). No `any`, `as unknown as`, `@ts-ignore` or `eslint-disable` in added lines.

## Minor
- `codex-runtime-composition.ts:586` gates on `isEnabled(chat)` using `input.platform` while the adapter port also has `platform`; fine today, but a duplicated source of truth.
- The adapter-level spec only tests the port with a stub runtime; the real Electron resolver is covered only via `ports.resolveRuntime` in the composition spec (acceptable).

Confidence: HIGH on B1 (diff-evident); tests were not run per instructions.
