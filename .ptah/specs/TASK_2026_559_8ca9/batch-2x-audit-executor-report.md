# Batch 2x-audit — executor report (TASK_2026_559_8ca9)

Unplanned remediation batch: `degradation-audit:lint` (CI, `.github/workflows/ci.yml:141-144`) failed with
`libs/backend/tool-output-reducers: 2 FAIL (baseline 0)` and `libs/backend/vscode-lm-tools: 8 FAIL (baseline 2)`.
`tools/degradation-audit/baseline.json` was NOT changed.

## Declaration mechanism (read from source)

`tools/degradation-audit/check-degradation.ts:27-56`: a site is declared by a
`// degradation-audit: <optional-capability|reported> — <reason>` comment placed
directly above the `catch`, as the first comment lines inside the catch body, or
(for `.catch(...)`) above the containing statement. A marker that does not parse
is `bare-suppression`; one that attaches to nothing is `orphaned-suppression` —
both fail. Precedent: commit `c74443c1b` (the `reported` kind with a stated reason
inside the catch body). A catch that calls `.error(...)` is not counted, but
`.warn(...)` is, so a surfaced-at-warn site still carries a `reported` marker.

## Per-site decisions

| #   | Site (pre-edit line)                                                                             | Decision                | Kind                | Reason / evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------ | ----------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `tool-output-reducers/src/lib/content-detector.ts:118` `isJson`                                  | declared                | optional-capability | `JSON.parse` failing is the predicate's "not JSON" answer, not an error; the detector falls through to the other sniffers. Pinned by `content-detector.spec.ts`.                                                                                                                                                                                                                                                                                                                        |
| 2   | `tool-output-reducers/src/lib/reduce-output.ts:267` `errorName`                                  | declared                | reported            | Guards a hostile `name` getter while classifying an error that `reduceOutput` is already logging (`reduce-output.ts:155-159`, "reducer threw <name>; the raw output is kept"). The failure is still reported, under `Error`.                                                                                                                                                                                                                                                            |
| 3   | `vscode-lm-tools/.../mcp-core/code-outliner.adapter.ts:176` `outline`                            | declared                | optional-capability | Tree-sitter outline is optional: `null` makes the code reducer keep the plain cut. `TreeSitterParserService` logs its own failures (`_handleAndLogError`, `tree-sitter-parser.service.ts:917-927`); a host without WASM grammars has no outline. The adapter has no logger, and injecting one would change its constructor/wiring — outside this batch.                                                                                                                                 |
| 4   | `vscode-lm-tools/.../mcp-core/protocol-dispatcher.ts:2365` `tokensWithinBudget`                  | declared                | optional-capability | Fast-path pre-check only. `null` routes the text to `applyToolResultBudget`, which never throws and logs its own failure on the output channel (`tool-result-budget.ts` `applyToolResultBudget` catch → `logLine(...) … returning a plain cut`, sent to `logger.warn` by `budgetOutputChannel`).                                                                                                                                                                                        |
| 5   | `vscode-lm-tools/.../mcp-core/protocol-dispatcher.ts:2402` `knownWorkspaceFolders`               | **surfaced** + declared | reported            | A throwing host workspace provider is a real host fault, and it was silent: the spool quietly moved to `os.tmpdir()`. Now logged with `deps.logger.warn('[MCP] workspace provider failed; spooling under the system temp directory: <message>', 'CodeExecutionMCP')` (same shape as the file's screenshot-save warn, `protocol-dispatcher.ts` ~1391). Behaviour is unchanged: still `[]`, still the temp-dir fallback. Warn, not error: the call still succeeds. Regression spec added. |
| 6   | `vscode-lm-tools/.../mcp-core/tool-result-budget.ts:485` `.catch(() => undefined)` in `spoolRaw` | declared                | reported            | Best-effort removal of a partial spool file; the write error itself is rethrown on the next line and surfaces in the trailer as the spool failure.                                                                                                                                                                                                                                                                                                                                      |
| 7   | `vscode-lm-tools/.../mcp-core/tool-result-budget.ts:606` `errorCode`                             | declared                | reported            | A throwing `code` getter loses only the errno; the caller (`spoolRaw`, `failure: errorCode(error) ?? errorName(error)`) still reports the failure.                                                                                                                                                                                                                                                                                                                                      |
| 8   | `vscode-lm-tools/.../mcp-core/tool-result-budget.ts:619` `errorName`                             | declared                | reported            | As #2: guard inside the classifier used by the trailer and the log line; the failure is still reported under `Error`.                                                                                                                                                                                                                                                                                                                                                                   |
| 9   | `vscode-lm-tools/.../namespace-builders/analysis-namespace.builders.ts:364` `getDependencies`    | untouched               | —                   | **Pre-existing debt, not this branch**: `git diff main...HEAD` does not list the file, and `git show main:` has the same `catch { return []; }` at 364/376. These are the 2 sites the `vscode-lm-tools` baseline of 2 already allows.                                                                                                                                                                                                                                                   |
| 10  | `.../analysis-namespace.builders.ts:376` `getDependents`                                         | untouched               | —                   | As #9.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

No spec asserted the silence of any site; no existing spec changed.

## Files changed

- `libs/backend/tool-output-reducers/src/lib/content-detector.ts` — marker (#1).
- `libs/backend/tool-output-reducers/src/lib/reduce-output.ts` — marker (#2), plus Prettier reformat of two pre-existing over-width lines (the file failed `prettier --check` at HEAD; lint-staged's `nx format:write` would apply the same change at commit).
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-outliner.adapter.ts` — marker (#3).
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` — marker (#4); warn log + marker (#5).
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts` — new test "logs a throwing workspace provider at warn and still spools under the system temp directory" in `spool root trust (review F1)`.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts` — markers (#6-#8), plus Prettier reformat of pre-existing drift (same reason as `reduce-output.ts`; formatting only).

The 4 staged Batch 5 files were not touched (`git diff --cached --stat` unchanged).

## Verification (from the worktree root)

- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` → exit 0; `libs/backend/vscode-lm-tools: 2 ok (baseline 2)`, `tool-output-reducers` no longer listed (0), no orphaned/bare suppressions.
- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/tool-output-reducers @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2` → exit 0, "Successfully ran targets test, lint, typecheck for 2 projects" (run before and after the Prettier pass).
- New spec alone: `nx run @ptah-extension/vscode-lm-tools:test --testPathPattern=protocol-dispatcher.spec --testNamePattern="throwing workspace provider"` → 1 passed.
- `prettier --check` on the 6 changed files → "All matched files use Prettier code style!".
- Pre-commit equivalent (`.husky/pre-commit` → lint-staged → `.lintstagedrc.mjs`): `nx affected --target=lint --max-warnings=-1 --parallel=2` → exit 0, lint for 75 projects.
- Pre-commit build gate `nx run ptah-electron:validate-deps` → **FAILS (pre-existing, not caused by this batch)**: `ptah-electron:build-main:production` cannot resolve `@ptah-extension/tool-output-reducers` imported by `protocol-dispatcher.ts:25` and `tool-result-budget.ts:45`.

## Out-of-scope observation (blocks the next commit)

`@ptah-extension/tool-output-reducers` is in `tsconfig.base.json:238`, but missing from the explicit `paths` maps of `apps/ptah-electron/tsconfig.build.json`, `apps/ptah-cli/tsconfig.build.json` and `apps/ptah-tui/tsconfig.build.json` (each already lists `@ptah-extension/vscode-lm-tools`). Batch 2e introduced the import; hooks never ran on this branch, so it went unnoticed. The pre-commit hook will reject every commit until the alias `"@ptah-extension/tool-output-reducers": ["../../libs/backend/tool-output-reducers/src/index.ts"]` is added to those three files (devops/build-config ownership; not edited here). The electron runtime-deps check that `validate-deps` runs after the build was not reached and should be re-run once the build passes.

## Build config (devops remediation, follow-up to the out-of-scope observation above)

**Files changed:**

- MODIFIED `apps/ptah-electron/tsconfig.build.json` — added `"@ptah-extension/tool-output-reducers": ["../../libs/backend/tool-output-reducers/src/index.ts"]` to `compilerOptions.paths`, same style/position as the existing `@ptah-extension/vscode-lm-tools` entry immediately above it.
- MODIFIED `apps/ptah-cli/tsconfig.build.json` — same alias addition.
- MODIFIED `apps/ptah-tui/tsconfig.build.json` — same alias addition.
- MODIFIED `apps/ptah-electron/project.json` — added `"marked"` to `targets.build-main.options.external`, next to the existing `"gpt-tokenizer"` entry. `libs/backend/vscode-lm-tools/package.json` already depends on `@ptah-extension/tool-output-reducers`, which depends on `marked` (ESM-only, `^18.0.13`) and `gpt-tokenizer` at runtime; `apps/ptah-electron/package.json` already lists both as dependencies (added in Batch 2e) but `marked` was never added to the esbuild `external` list, so `build-main:production` would try to statically bundle an ESM-only package into the CJS-shimmed main bundle. `gpt-tokenizer` was already externalized. `apps/ptah-cli/project.json` and `apps/ptah-tui/project.json` already externalize both `marked` and `gpt-tokenizer` — no change needed there.

**Why no change needed elsewhere:**

- `apps/ptah-extension-vscode/tsconfig.app.json` (the VS Code extension app's build tsconfig, used directly by its `build-esbuild` target per `apps/ptah-extension-vscode/project.json:22`) has no `paths` override of its own — it extends `tsconfig.json` → `tsconfig.base.json`, so it already inherits the `tool-output-reducers` alias from `tsconfig.base.json:238`. No explicit map to add.
- `apps/ptah-extension-vscode/project.json` `build-esbuild.options.external` only lists `["vscode", "@cursor/sdk"]` because that target builds with `thirdParty: true` (bundles all other npm deps, including `marked`/`gpt-tokenizer`, into the output) — consistent with its existing pattern; not part of this defect.
- `apps/ptah-tui`'s `build` target writes into `dist/apps/ptah-cli` and has no `generatePackageJson` step of its own (reuses `ptah-cli`'s generated `package.json`), so no separate runtime-dependency declaration was needed for it.

**Surface observed:** Nx `@nx/esbuild:esbuild` executor per app (`apps/ptah-electron/project.json`, `apps/ptah-cli/project.json`, `apps/ptah-tui/project.json`, `apps/ptah-extension-vscode/project.json`); TypeScript path aliasing via `tsconfig.base.json` and per-app `tsconfig.build.json` overrides; the electron runtime-dependency gate `apps/ptah-electron/scripts/validate-deps.js` (invoked by `apps/ptah-electron/project.json` `validate-deps` target and by `.husky/pre-commit`); pre-commit sequence defined in `.lintstagedrc.mjs` and `.husky/pre-commit`.

**Triggers affected:** none (no CI workflow, publish trigger, or release branch changed). These are build-time resolution/bundling fixes only, exercised by the same local build and pre-commit targets that already existed.

**Verification (from the worktree root, `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`):**

1. `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache` → exit 0. Rebuilt `build-main:production` first (bundle was stale/unminified), then scanned: `marked` and `gpt-tokenizer` both listed ✅ in "Detected external imports"; `"✅ All external imports are covered by package.json dependencies."`; sqlite-vec native binary check passed.
2. `node_modules/.bin/nx run ptah-cli:build-esbuild --configuration=production --skip-nx-cache` → exit 0 ("Successfully ran target build-esbuild for project ptah-cli and 27 tasks it depends on"), including a fresh `@ptah-extension/tool-output-reducers:build`.
3. `node_modules/.bin/nx run ptah-tui:build --configuration=production --skip-nx-cache` → exit 0 ("... for project ptah-tui and 30 tasks it depends on").
4. `node_modules/.bin/nx run ptah-extension-vscode:build-esbuild --configuration=production --skip-nx-cache` → exit 0 ("... for project ptah-extension-vscode and 26 tasks it depends on").
5. Generated Electron dist manifest: `grep -n "marked\|gpt-tokenizer" dist/apps/ptah-electron/package.json` → both present (`"gpt-tokenizer": "^4.0.0"`, `"marked": "^18.0.13"`).
6. Pre-commit sequence, run against the 4 changed files (all JSON, so `.lintstagedrc.mjs`'s TS/JS-only lint step does not apply to them — verified by reading `.lintstagedrc.mjs`):
   - `node_modules/.bin/nx format:check --files=apps/ptah-electron/tsconfig.build.json,apps/ptah-cli/tsconfig.build.json,apps/ptah-tui/tsconfig.build.json,apps/ptah-electron/project.json` → exit 0, no output (all already Prettier-formatted).
   - `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache` → exit 0 (see #1).
   - `.husky/pre-commit`'s actual gate is `nx run ptah-electron:validate-deps` (not a separate `format:check-equivalent`/lint step for these files, per `.lintstagedrc.mjs`'s file-type filter) — both steps that apply to this change set pass.

**Rollback:** revert the four path/external additions (`git checkout -- apps/ptah-electron/tsconfig.build.json apps/ptah-cli/tsconfig.build.json apps/ptah-tui/tsconfig.build.json apps/ptah-electron/project.json`); this restores the pre-remediation state where `ptah-electron:validate-deps` fails on `@ptah-extension/tool-output-reducers` resolution, i.e. no additional risk introduced by rolling back.

**Secrets or variables required:** none.

**Out-of-scope observations:** none beyond what Batch 2x-audit already flagged above (now resolved by this section).
