# Batch A1: Electron Codex main-chat admission

## Design

Electron chat and lane admission now share one local rule: unpackaged, shared consumer gate open, or packaged win32/x64. The rule cites the reviewed `codex-parity-gate.ts` row and D29/D30. Electron sets `nativeCodex` from chat admission, logs one admission line when the packaged win32/x64 exception applies, and leaves `nativeCodexGateway` under its existing gate/dev-route rule.

`CodexChatAdapterPorts` has an optional host runtime resolver. Electron supplies it for session scopes: an open shared chat gate uses `resolveGatedCodexRuntime`; a closed gate denies non-admitted packaged hosts with `Codex chat production routing disabled by parity gate`; an admitted host resolves the scoped raw runtime. Gateway calls remain gated. Hosts without this port retain the adapter's existing shared-gate resolution. The existing Electron executable bundle, root, version, and hash verification path is unchanged.

## Files written

- `apps/ptah-electron/src/di/codex-electron-admission.ts` — new shared Electron admission helper (extra file 1).
- `apps/ptah-electron/src/di/codex-lane-composition.ts` — lane rule delegates to the helper (extra file 2).
- `apps/ptah-electron/src/di/codex-runtime-composition.ts` — chat capability, log, and scoped runtime port.
- `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts` — routing expectations and packaged platform, port, and log cases.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts` — optional runtime-resolution port and default gated fallback.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts` — absent-port gate refusal and present-port raw runtime cases.
- `.ptah/specs/TASK_2026_714_c8a2/batch-A1-report.md` — this handoff.

## Evidence and limits

- Added tests for packaged win32/x64 admission, scoped runtime resolution, and one admission log; packaged linux/x64 and darwin/arm64 denial; unpackaged chat and existing development override; and adapter behavior with and without the host port. Updated prior packaged win32/x64 refusal assertions.
- Reviewed the diff; `git diff --check` reported no whitespace errors. All six source/spec files written had **0 CR bytes and no UTF-8 BOM**. The report itself also has **0 CR bytes and no UTF-8 BOM**.
- Tests, typecheck, lint, build, Nx, npm, and Ptah diagnostics were not run, as the task assigns those checks to the coordinator. Runtime behavior therefore remains unverified by execution in this lane.
- The CLI exposed no invocable matching skill mechanism for this backend task. Ptah workspace analysis and AST inspection were available; the dependency graph was still building, so targeted source reads supplied the fallback.
