# Task 10d.fix-V — VS Code native Codex lane fixes (TASK_2026_714_c8a2, revise round 1 of 2)

W = D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration
T = W\.ptah\specs\TASK_2026_714_c8a2

## HARD RULES (read first)

- Do NOT run verify, tests, typecheck, lint, build, nx, npm or ptah_get_diagnostics. Do NOT commit, push or run
  history-changing or discarding git (stash, reset, restore, checkout, clean). The coordinator runs all checks.
- Also apply every rule in T\task-10d-common-rules.md (section HARD RULES).
- Do not convert line endings. Edit only the lines you must change. UTF-8 without BOM.
- Another codex lane edits the CLI files at the same time. Touch ONLY the files in Scope.

## Inputs

- Original task: T\task-10d-V.md. Reports: T\batch-10d-V-report.md, T\batch-10d-V-fix-1-report.md.
- Review: T\code-logic-review-10d-CV.md, section "10d.V defects" (V-1 .. V-6).
- Shared helper (already added): `inspectCodexExecutable`, `CodexExecutableInspectionError` exported from
  `@ptah-extension/codex-runtime` (W\libs\backend\codex-runtime\src\lib\codex-executable-inspection.ts; report
  T\batch-10d-fix-A-report.md). Cached by realpath/size/mtime, real streamed SHA-256, error `code`.
- Gate-admitted spec pattern (`CodexParityGate.isEnabled` is typed to return `false`, replace it with
  Object.defineProperty): W\apps\ptah-electron\src\di\codex-runtime-composition.spec.ts:192-207.

## Fix list

1. V-1 + V-6 — W\apps\ptah-extension-vscode\src\di\codex-lane-runtime-composition.ts: replace the body of
   `inspectVsCodeCodexBinary` (:67-81) with a call to `inspectCodexExecutable` (keep the native-path resolution
   and the explicit-path/native-path mismatch refusal). The probe and `open()` both use it; `open()` passes the
   measured `sha256` and `versionOutput` into the runtime ports. A second probe/open on an unchanged file must not
   re-hash. Delete the local hash code.
2. V-2 — on a failed open, run dispose in try/catch: log the dispose error with the injected Logger (real Error
   object) and rethrow the ORIGINAL open error. The catch needs
   `// degradation-audit: reported - <reason>` if it swallows the dispose error.
3. V-3 — W\apps\ptah-extension-vscode\src\di\codex-lane-runtime-composition.spec.ts gate-admitted routing case
   (:259-277) must be able to fail: register a gate stub that records `isEnabled('lane', platform)` and assert the
   call, or make the raw runtime token unresolvable so only `resolveGatedCodexRuntime` can return the runtime.
4. V-4 — add spec cases: digest mismatch (code `codex-digest-mismatch`, Codex not installed / open refused) and
   missing pin (code `codex-pin-unavailable`). Keep the missing-binary case. The helper caches by
   realpath/size/mtime, so use a new tmp file per case.
5. V-2 spec — a failed open whose dispose also fails rejects with the open error and logs the dispose error.
6. V-5 is information only (D27). Do not change behavior. Mention it in the report.

## Scope (only these files)

- W\apps\ptah-extension-vscode\src\di\codex-lane-runtime-composition.ts
- W\apps\ptah-extension-vscode\src\di\codex-lane-runtime-composition.spec.ts

## Deliverable

**Deliverable**: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-V-fix-2-report.md
Write it early as a skeleton. Content: per fix item, what changed (file:line); `## Decisions`; anything not done.
Reply `WROTE: <path>` plus one headline line.
