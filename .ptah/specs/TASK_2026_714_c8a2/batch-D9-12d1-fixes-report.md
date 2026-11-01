# Batch D9 12d-1 fixes report

Workspace: `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a`

## Items addressed

1. MCP profile type and fidelity: `apps/ptah-electron/src/di/codex-runtime-composition.ts:595` copies every live server and converts readonly stdio args and reference maps to the mutable profile input shape. All optional HTTP and stdio fields remain on their respective servers. `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:165` checks both transports and their references.
2. Narrow runtime fake contract: `apps/ptah-electron/src/di/codex-runtime-composition.ts:530` requires only `open` and an optional `CodexHistoryReader`; the fake at `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:125` satisfies that contract.
3. Timer lint and cleanup: `apps/ptah-electron/src/di/codex-runtime-composition.ts:639` uses `const timer`, calls `unref()`, and clears it in `finally` at `:649`. The abort listener is removed there too.
4. DI census: `apps/ptah-electron/src/di/expected-resolvable.ts:119` includes `NATIVE_SESSION_HISTORY_PORT` in `EXPECTED_RUNTIME_TOKENS`; `apps/ptah-electron/src/di/rpc-surface.spec.ts:113` expects seven bound tokens.
5. Handle leak: `libs/backend/codex-runtime/src/lib/codex-runtime.ts:59-111` passes a signal to the App Server process, tracks outstanding reads, and closes the process in `finally`. `close()` aborts and awaits all tracked reads at `:224-233`. The Electron timer and listener are cleared on every allocated-scope path. The prior Jest worker warning cannot be confirmed cleared without running Jest.
6. Abort on timeout, signal, and close: `apps/ptah-electron/src/di/codex-runtime-composition.ts:626-656` aborts the runtime read before scope disposal on timeout or caller abort. `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:421,442` covers abort-closes-process and close-aborts-inflight. `libs/backend/codex-runtime/src/lib/codex-runtime.types.ts:295` adds the optional signal to the reader contract.
7. Preserve primary outcome on dispose failure: `apps/ptah-electron/src/di/codex-runtime-composition.ts:654-659` logs a real `Error` through the injected logger and retains success or the original timeout/cancel error. The spec at `:269` covers success and timeout with rejecting disposal.
8. Concurrent reads: `apps/ptah-electron/src/di/codex-runtime-composition.ts:553` allows at most two active reads per Electron history port. A third returns fixed `busy` before scope/process allocation. The spec at `:307` covers the cap. This choice avoids an unbounded wait queue and bounds child processes per host.
9. Extra edge cases: `apps/ptah-electron/src/di/codex-runtime-composition.ts:563-577` maps `realpathSync` failure to `pathUnavailable`; `:628` observes the cancellation promise immediately. Specs cover different-home live profiles (`:199`), createScope failure and pre-aborted signal (`:283`), missing reader (`:297`), and verified App Server home mismatch (`libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:465`).
10. Deferred review findings: `.ptah/specs/TASK_2026_714_c8a2/plan-d9-history.md:44-46` adds release-gate lines for M1, M2, and M4. M3 is addressed in the runtime changes above.

## Files touched and line endings

All paths below are under `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a`. Each file has CR count 0 and no UTF-8 BOM (the report is checked separately after writing).

- `apps/ptah-electron/src/di/codex-runtime-composition.ts` — CR 0
- `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts` — CR 0
- `apps/ptah-electron/src/di/expected-resolvable.ts` — CR 0
- `apps/ptah-electron/src/di/rpc-surface.spec.ts` — CR 0
- `libs/backend/codex-runtime/src/lib/codex-runtime.ts` — CR 0
- `libs/backend/codex-runtime/src/lib/codex-runtime.types.ts` — CR 0
- `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts` — CR 0
- `.ptah/specs/TASK_2026_714_c8a2/plan-d9-history.md` — CR 0
- `.ptah/specs/TASK_2026_714_c8a2/batch-D9-12d1-fixes-report.md` — CR 0

## Checks and UNCONFIRMED

- Static `git diff --check` passed; edited code was reread. `rg.exe` was access denied, so PowerShell `Select-String` was the search fallback. Ptah workspace analysis and AST inspection were available. No invocable coding skill was exposed to this lane; the skill inventory only listed UI and AI skills unrelated to this backend change.
- **UNCONFIRMED:** TypeScript compilation, lint, tests, and resolution of the Jest worker-exit warning. The task expressly forbids verify, tests, lint, typecheck, Nx, npm, npx, Jest, and diagnostics, so none was run.
- **UNCONFIRMED:** A live pinned-binary App Server history read, child discovery, pagination, and packaged Electron reload. No Electron, Codex, App Server, or paid request was started.
- **UNCONFIRMED:** Persisted reload can recover only MCP references saved in Codex home configuration; an ephemeral live override absent after reload cannot be reconstructed from session metadata.
