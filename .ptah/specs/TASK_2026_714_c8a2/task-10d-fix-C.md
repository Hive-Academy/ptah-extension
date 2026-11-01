# Task 10d.fix-C — CLI/TUI native Codex lane fixes (TASK_2026_714_c8a2, revise round 1 of 2)

W = D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration
T = W\.ptah\specs\TASK_2026_714_c8a2

## HARD RULES (read first)

- Do NOT run verify, tests, typecheck, lint, build, nx, npm or ptah_get_diagnostics. Do NOT commit, push or run
  history-changing or discarding git (stash, reset, restore, checkout, clean). The coordinator runs all checks.
- Also apply every rule in T\task-10d-common-rules.md (section HARD RULES).
- Do not convert line endings. Edit only the lines you must change. UTF-8 without BOM.
- Another codex lane edits the VS Code files at the same time. Touch ONLY the files in Scope.

## Inputs

- Original task: T\task-10d-C.md. Batch report: T\batch-10d-C-report.md.
- Review: T\code-logic-review-10d-CV.md, section "10d.C defects" (C-1 .. C-6).
- Shared helper (already added): `inspectCodexExecutable`, `CodexExecutableInspectionError` exported from
  `@ptah-extension/codex-runtime` (W\libs\backend\codex-runtime\src\lib\codex-executable-inspection.ts; report
  T\batch-10d-fix-A-report.md). Cached by realpath/size/mtime, real streamed SHA-256, error `code`.
- Type-safe Logger and CodexContext fakes without casts: W\apps\ptah-extension-vscode\src\di\codex-lane-runtime-composition.spec.ts.
- Gate-admitted spec pattern (`CodexParityGate.isEnabled` is typed to return `false`, replace it with
  Object.defineProperty): W\apps\ptah-electron\src\di\codex-runtime-composition.spec.ts:192-207.

## Fix list

1. Verify failure 1 — W\libs\backend\cli-engine\src\lib\codex-lane-runtime-composition.spec.ts does not compile:
   TS2345 MockLogger -> Logger at :122,139,166,185,210,231,264,294,324; TS2352 casts to CodexContext at :195,288
   (use a type-safe fake, no `as unknown as`, no `as` to a non-overlapping type); TS2322 at :79
   `get: async (id) => rows.get(id)` must return `null`, not `undefined` (`rows.get(id) ?? null`).
2. Verify failure 2 — W\libs\backend\cli-engine\src\lib\surface-composition.spec.ts guard "CLI legacy Codex
   composition (Batch 8e)" forbids `readCodexDevRouteOverride|registerCodexRuntime|CODEX_RUNTIME_TOKENS|devRoute:`
   in CLI sources and now hits the new lane file. Exempt ONLY `codex-lane-runtime-composition.ts` from the
   `registerCodexRuntime|CODEX_RUNTIME_TOKENS` part. Keep the `devRoute`/`readCodexDevRouteOverride` and
   chat-host-binding checks for that file. Copy the narrow style of the VS Code exemption
   (W\apps\ptah-extension-vscode\src\di\surface-composition.spec.ts:92-108).
3. C-1 + C-5 — in codex-lane-runtime-composition.ts, the probe AND `open()` both call `inspectCodexExecutable`.
   `open()` passes the MEASURED `sha256` and `versionOutput` from the inspection into the runtime ports
   (`binary`), never `pin.binarySha256`/`pin.version`. Delete the local hash code. The spec that opens a file
   containing `fixture` must now fail the open (digest mismatch) unless the pin is computed from the fixture bytes.
4. C-2 — the probe refuses an explicit path whose realpath differs from the native path that `open()` uses,
   with the same message `open()` uses.
5. C-3 — keep the adapter as is (shared code, out of scope). The probe must throw the
   `CodexExecutableInspectionError` unchanged so the `code` reaches the adapter. List the adapter log gap
   (errorClass only) under ## Decisions as a follow-up for the adapter owner.
6. C-4 — add spec cases: (a) the same CODEX_HOME reaches user MCP discovery (the value the adapter reads from
   `lane.identity.normalizedHome`); (b) make the TUI case real or rename the duplicate "TUI" call so it does not
   claim TUI coverage; (c) assert explicitly that `CodexAccountUsageClient` is not closed on dispose (or not
   created) instead of the implicit `usage === null`.
7. C-6 — only remove code that the shared helper now replaces. Do not refactor the other copies.

## Scope (only these files)

- W\libs\backend\cli-engine\src\lib\codex-lane-runtime-composition.ts
- W\libs\backend\cli-engine\src\lib\codex-lane-runtime-composition.spec.ts
- W\libs\backend\cli-engine\src\lib\surface-composition.spec.ts
- W\apps\ptah-cli\src\di\container.smoke.spec.ts (only if needed for item 6b)

## Deliverable

**Deliverable**: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-C-fix-1-report.md
Write it early as a skeleton. Content: per fix item, what changed (file:line); `## Decisions`; anything not done.
Reply `WROTE: <path>` plus one headline line.
