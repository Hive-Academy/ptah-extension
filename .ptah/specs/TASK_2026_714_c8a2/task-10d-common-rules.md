# Common rules and pattern for batches 10d.C and 10d.V (TASK_2026_714_c8a2)

W = D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration
T = W\.ptah\specs\TASK_2026_714_c8a2

## HARD RULES

- Do NOT run verify, tests, typecheck, lint, build, nx, npm or ptah_get_diagnostics. The coordinator runs all checks.
- Do NOT commit, push, stash, reset, restore, checkout or clean. Never revert a change you did not make.
  Another codex lane edits other files in the same worktree at the same time: touch ONLY the files in your Scope.
- Never strip, revert or comment out MCP (Ptah MCP or user MCP servers).
- Work only in W. Use absolute paths. Edit only the lines you must change; do not convert line endings.
- No `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`. `import 'reflect-metadata'` first in tsyringe specs.
  Use Object.defineProperty for readonly mocks, leave no pending real timers, no excess properties in typed
  object literals, bracket `process.env['X']`. A swallowing catch needs
  `// degradation-audit: optional-capability|reported - <reason>`. UTF-8 without BOM.
- Specs must pass on Windows AND Linux: build absolute paths with path.resolve/join/tmpdir, and compare
  homes/workspaces through normalizeCodexHomeKey / normalizeCodexWorkspaceKey (win32 lowercases them).
  Optional adapter methods are called with `?.()`.
- Do not import `vscode` or `electron` into host-neutral libs. Import only from lib public `src/index.ts` aliases.

## Pattern to copy (read first)

- Electron reference implementation (committed in 932dbeb92, reviewed APPROVED):
  W\apps\ptah-electron\src\di\codex-lane-composition.ts and codex-lane-composition.spec.ts; wiring in
  W\apps\ptah-electron\src\di\phase-2-libraries.ts; D27 cases in W\apps\ptah-electron\src\di\container.smoke.spec.ts
  (composePhase2 with captureDetection: the real CliDetectionService is resolved after the harness stubs) and
  codex-runtime-composition.spec.ts.
- Pattern notes: T\batch-10d-E-report.md section "Pattern notes for 10d.C (CLI/TUI) and 10d.V (VS Code)".
- Decisions: T\decisions.md rows D26 and D27 (last rows). Binding review rules R1-R4: T\plan-p10-review.md.
- Traps found in the Electron reviews: T\code-logic-review-10d-E.md, T\code-logic-review-10d-E-r1.md.

Key rules:
- One host helper is the single lane routing boundary.
- Bind CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY before registerCliAgentRuntimeServices, and only when D27
  (as mapped in your task) allows it. Otherwise bind nothing: CliDetectionService keeps the legacy Codex SDK lane.
- create()/detect() spawn no process.
- Each lane open gets its own child-owned runtime/context with a consumer 'lane' profile, the selected CODEX_HOME
  (the same home for profiles, credentials, catalog and user MCP discovery) and the host executable pin.
- Lane thread identities use createCodexThreadIdentityStore(..., 'lane').
- requestUserInput is declined with one kind-only line (R1/D26); approvals are declined by the adapter's lane sink.
- Catalog context uses CODEX_LANE_DEFAULT_MODEL and a neutral tmpdir cwd.
- Empty HOME/CODEX_HOME gives one visible message.
- PTAH_CODEX_RUNTIME_DEV never covers lanes. No SDK fallback inside the native adapter.
- Prefer exported helpers from @ptah-extension/codex-runtime, @ptah-extension/cli-agent-runtime and
  @ptah-extension/agent-sdk over copied code. If a needed helper exists only inside apps/ptah-electron, copy the
  minimum into your host file and list it under ## Decisions (do not edit Electron files).
