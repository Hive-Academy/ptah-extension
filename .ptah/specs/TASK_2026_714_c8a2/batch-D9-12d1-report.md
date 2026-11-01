# Batch D9 12d-1 — Electron native session history binding

## Design and evidence

- `apps/ptah-electron/src/di/codex-runtime-composition.ts:502-521` defines fixed-message, coded errors. No native error text or path is included in messages returned by this port.
- `apps/ptah-electron/src/di/codex-runtime-composition.ts:541-596` validates the persisted native identity, checks saved `codexExecution.codex.normalizedHome` against the current Codex home resolver, uses the saved thread ID even if `codexThread` is absent, and builds a read profile. The matching live session's explicit MCP references are copied when available; after reload, the read-only process uses the unchanged `CODEX_HOME` config. The port never writes Codex settings.
- `apps/ptah-electron/src/di/codex-runtime-composition.ts:598-636` checks the binary, creates a fresh scoped runtime for each read, races history reading against timeout/AbortSignal, and disposes the scope in `finally`. It maps missing root thread and other reader failures to fixed public codes.
- `apps/ptah-electron/src/di/codex-runtime-composition.ts:782-784,819-833` binds `SDK_TOKENS.NATIVE_SESSION_HISTORY_PORT` with `useValue` and resolves the current home and runtime lazily through the existing Electron scope/adapter ports. `apps/ptah-electron/src/di/expected-resolvable.ts:128` and `apps/ptah-electron/src/di/surface-composition.spec.ts:412-421` extend the DI surface guard from six tokens to seven.
- `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:148-258` adds focused cases for reload without a live scope, unchanged home configuration and live MCP references, changed home, unavailable binary, missing rollout, timeout and abort disposal, and two concurrent sessions with distinct scopes.

## Files touched

- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\apps\ptah-electron\src\di\codex-runtime-composition.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\apps\ptah-electron\src\di\codex-runtime-composition.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\apps\ptah-electron\src\di\expected-resolvable.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\apps\ptah-electron\src\di\surface-composition.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\.ptah\specs\TASK_2026_714_c8a2\batch-D9-12d1-report.md`

## R1 moderate follow-ups found

`code-logic-review-D9-12ab-r1.md` records M1–M4. None belongs to the four authorized 12d-1 code files, so none was edited here:

- M1: the reader can label a missing child `thread/read` as a missing root. This is in `libs/backend/codex-runtime/src/lib/codex-session-history.ts`.
- M2: embedded/paged item equality uses key-order-sensitive `JSON.stringify` in the same reader.
- M3: `CodexRuntime.close()` does not track or abort an in-flight history process in `libs/backend/codex-runtime/src/lib/codex-runtime.ts`. This matters to this batch's timeout/abort path: the returned promise rejects and its Electron scope is disposed, but the underlying read process may continue until its own request timeout and `finally` close. Fix needs that runtime file.
- M4: child closure is O(candidates × depth), and listing the full thread corpus per read is costly; this is also in the reader.

## 12d-2 and release gate

12d-2 must route resume and older-page reads through `SessionHistoryRouter`, keep the Claude UI result/paging contracts, and map coded native/route errors to the user-facing RPC boundary. The 12c-2 review explicitly deferred RPC error mapping to 12d-2. No frontend Codex branch was added.

The release gate still needs an authorized live pinned-binary `thread/read` sample with pagination and child threads, then a packaged Electron reload comparison against the Claude UI event contract. This batch did not start Electron, App Server, or a paid request.

## Verification and UNCONFIRMED

- Static `git diff --check` passed. Source was re-read after edits. CR counts are 0 and UTF-8 BOM is absent in each of the four code files and this report.
- Tests, typecheck, lint, build, Nx, npm, npx, and Jest were not run, per the task's first rules. Runtime behavior and TypeScript compilation remain **UNCONFIRMED**.
- Live App Server history shape, missing-thread text, pagination, child discovery, and packaged reload remain **UNCONFIRMED** by this batch.
- A persisted session stores the normalized Codex home, not a complete copy of explicit live MCP references. On reload the read-only process loads the saved home's `config.toml`; any ephemeral MCP overrides that were never persisted cannot be reconstructed here. This is **UNCONFIRMED** against a packaged reload.
- CLI skill invocation was unavailable in this lane. The local `execute-phase-gated-task` skill was read; its test and commit steps conflict with the user's explicit prohibitions and were not followed. `rg.exe` was access denied, so PowerShell search was used as fallback. Ptah symbol search returned no usable index result, so source was inspected directly.
