# Batch 11 report — Analysis freshness service and DI

## Task 11.1

Added `AnalysisFreshnessService.getStatus(workspaceRoot)` and `computeWorkspaceFingerprint` in `analysis-freshness.service.ts`. The service reads manifests through `AnalysisStorageService.readManifest`, distinguishes absent runs from malformed or unreadable runs, verifies all four v4 output files against their recorded SHA256 hashes, compares the workspace fingerprint and checks the seven-day age boundary. It performs no writes.

The fingerprint includes sorted top-level file and directory names with their types, plus the exact bytes of root package manifests and lockfiles when present. The bounded filename set is `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`, `pyproject.toml`, `poetry.lock`, `uv.lock`, `Pipfile`, `Pipfile.lock`, `requirements.txt`, `Cargo.toml`, `Cargo.lock`, `go.mod`, `go.sum`, `pom.xml`, `build.gradle`, `build.gradle.kts`, `Gemfile`, `Gemfile.lock`, `composer.json`, `composer.lock`, `deno.json`, `deno.jsonc`, and `deno.lock`. The hash uses length-delimited names, types and file bytes, so entry order and concatenation ambiguity do not change the result. `.ptah`, `.git`, dependency directories (`node_modules`, `vendor`, `.venv`, `venv`, `.yarn`, `.pnpm-store`) and generated outputs (`dist`, `build`, `out`, `target`, `coverage`, `.next`, `.nuxt`, `.nx`, `.turbo`, `.cache`) are excluded. This keeps a status read bounded and avoids changes caused by analysis artifacts, dependencies or build output.

## Task 11.2

Added `AGENT_GENERATION_TOKENS.ANALYSIS_FRESHNESS_SERVICE` with the repository's `Symbol.for` convention, registered `AnalysisFreshnessService` as a singleton beside storage, and exported the class, function and age constant from the package barrel. The DI lint result below verifies registration.

## Task 11.3

Added an in-memory platform-core filesystem spec covering `ok`, `no-analysis`, `legacy-v3`, `incomplete`, the exact expiry boundary and one millisecond after it, `workspace-changed`, `output-mismatch` for modified and missing files, and `unreadable` for malformed manifests and I/O failure. It checks fingerprint stability under reversed directory order and sensitivity to lockfile bytes. Write, delete and create-directory mock methods are asserted unused during status reads.

## Files created or modified

- `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\agent-generation\src\lib\services\analysis-freshness.service.ts` (created)
- `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\agent-generation\src\lib\services\analysis-freshness.service.spec.ts` (created)
- `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\agent-generation\src\lib\di\tokens.ts` (modified)
- `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\agent-generation\src\lib\di\register.ts` (modified)
- `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\agent-generation\src\index.ts` (modified)
- `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\.ptah\specs\TASK_2026_652_7284\batch-11-report.md` (created)

## Verification

- `npx prettier --write` on exactly the five changed source/spec files: all five processed, exit 0.
- `npx prettier --check` on exactly those five files: `All matched files use Prettier code style!`, exit 0.
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-generation --parallel=1`: `test`, `typecheck` and `lint` each passed; `Successfully ran targets typecheck, test, lint for project @ptah-extension/agent-generation`, exit 0. Nx Cloud printed an unrelated account 401 after the local targets succeeded.
- `npx nx run di-lint:lint`: `di-lint OK: 1825 @inject sites all resolve to a registered token (793 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies`; `Successfully ran target lint for project di-lint`, exit 0. Nx Cloud printed the same account 401 after local success.
- Scoped `ptah_get_diagnostics` after edits: 0 errors, 0 warnings, clean coverage.

An initial combined run with `--maxWorkers=2` passed test and lint but failed typecheck because Nx forwarded that Jest flag to `tsc` (`TS5023: Unknown compiler option '--maxWorkers=2'`). The exact batch command above was then run successfully without the incompatible flag.
