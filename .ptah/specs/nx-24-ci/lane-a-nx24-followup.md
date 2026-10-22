## 1 ERESOLVE
Resolved without --force or --legacy-peer-deps. Plain npm install --ignore-scripts succeeded (34 added, 24 removed, 43 changed).
Aligned root @angular/youtube-player and exact peers in libs/shared, libs/frontend/{core,ui,markdown,tribunal-panel}/package.json to ~22.2.0. Core/common/forms resolve to 22.2.3; CDK family to 22.2.4. Angular tooling stays on the migration's 22.2 ranges; angular-eslint 22.6.0 and jest-preset-angular 17.0.0 already support them.
Initial explicit install/update still hit stale 22.1 lock entries. Removed only Angular/tooling lock entries, regenerated with npm install --package-lock-only --ignore-scripts, then ran the successful plain install. Root manifest and lock dependency sections match.
Aligned five optional @nx native packages to 24.0.0; all directly declared nx/@nx packages now use 24.0.0.

## 2 migrations.json
Deleted the one-time root migrations.json after the prior lane completed all generators.

## 3 Jest
Converted @ptah-extension/vscode-core:test-real-git to nx:run-commands with jest --config libs/backend/vscode-core/jest.real-git.config.ts. Preserved runInBand=true, passWithNoTests=false and outputs=[]; retained inherited cache/inputs and translated ci.codeCoverage to ci.coverage. Original target had no env or testPathPattern override. Added Nx Jest plugin's TS_NODE_COMPILER_OPTIONS environment for config loading.
Removed @nx/jest:jest targetDefaults. Inferred test/e2e defaults retain caching, passWithNoTests and ci={ci:true,coverage:true}; inferred outputs continue to follow coverageDirectory. Explicit project overrides take precedence.
Resolved vscode-core:test shows command=jest, passWithNoTests=true and ci.coverage=true. Nx run-commands forwards unknown options by default, so --coverage and --maxWorkers=2 reach Jest; --parallel=2 remains Nx orchestration. No Jest suite was executed.
93 test targets before and after; 77 previously used @nx/jest:jest, while existing explicit Jest command targets remain unchanged. No removed Jest/ESLint executor references remain in project.json files.

## 4 ESLint
The migration's 22 fallback targets lacked a runnable inferred target. Added explicit nx:run-commands, command=eslint ., cwd=project root, cache=true; retained migration inputs. Each original target was a bare @nx/eslint:lint without extra options.
Each row was verified with npx nx show project <project> --json after its fix; no lint was run.

| Project | Lint target form | OK? |
|---|---|---|
| ptah-cli | nx:run-commands: eslint . | Yes |
| ptah-electron | nx:run-commands: eslint . | Yes |
| ptah-extension-vscode-e2e | nx:run-commands: eslint . | Yes |
| ptah-landing-page-e2e | nx:run-commands: eslint . | Yes |
| ptah-tui | nx:run-commands: eslint . | Yes |
| ptah-video-studio | nx:run-commands: eslint . | Yes |
| @ptah-extension/cron-scheduler | nx:run-commands: eslint . | Yes |
| @ptah-extension/harness-sync | nx:run-commands: eslint . | Yes |
| @ptah-extension/memory-curator | nx:run-commands: eslint . | Yes |
| @ptah-extension/messaging-gateway | nx:run-commands: eslint . | Yes |
| @ptah-extension/output-styles | nx:run-commands: eslint . | Yes |
| @ptah-extension/platform-cli | nx:run-commands: eslint . | Yes |
| @ptah-extension/platform-core | nx:run-commands: eslint . | Yes |
| @ptah-extension/platform-electron | nx:run-commands: eslint . | Yes |
| @ptah-extension/platform-vscode | nx:run-commands: eslint . | Yes |
| @ptah-extension/plugin-marketplace | nx:run-commands: eslint . | Yes |
| @ptah-extension/session-organization | nx:run-commands: eslint . | Yes |
| @ptah-extension/task-specs | nx:run-commands: eslint . | Yes |
| @ptah-extension/thoth-runtime | nx:run-commands: eslint . | Yes |
| @ptah-extension/usage-analytics | nx:run-commands: eslint . | Yes |
| @ptah-extension/voice-providers | nx:run-commands: eslint . | Yes |
| mcp-bench | nx:run-commands: eslint . | Yes |

## 5 ai-migrations
Inspected all three 24.0.0 directories: tools/ai-migrations/@nx/eslint/24.0.0, @nx/jest/24.0.0 and nx/24.0.0. All were empty, with no instructions to follow; deleted them. Existing 23.2.1 instruction files remain untouched.

## Verification
- npm ls @angular/common @angular/forms: initially exposed invalid 22.1.7 installations; manifest search found the five library pin locations above.
- npm install --ignore-scripts: exit 0, no peer bypass. npm ls @angular/core nx filtered for invalid: 0.
- npx nx report (once): Nx/plugins 24.0.0, TypeScript 6.0.3; reports transitive Devkit 23.2.1 (see limitation below).
- npx nx show projects -t test (once): non-TTY output is one JSON-array line, so literal wc -l is 1; parsed project count is 93. Compared with origin/main project.json definitions and git show origin/main:nx.json (no Jest inference plugin): 93 before, no missing or extra names. No stash used.
- npx nx show project @ptah-extension/vscode-core --json (once): test and test-real-git resolve correctly, including ci behavior.
- npx nx run ptah-electron-e2e:typecheck --parallel=1 (once): exit 0, one task succeeded, no cache hit.
- All 22 lint project queries exited 0; retry queries were limited to targets fixed after their first inspection.
- git diff --check: clean. ptah_get_diagnostics scoped to edited JSON: unavailable, no requested file could be checked; JSON parsed successfully in native checks.
- Nx Cloud ID and affected.legacy remain absent; local caching retained.

## Decisions
- Prefer Angular 22.2 alignment over reverting: migration ranges and compatible installed peer declarations support it; reversible manifest/lock changes. Used README.md/CONTRIBUTING.md npm setup and CLAUDE.md scoped checks, narrowed by this task's explicit limits.
- Use explicit lint commands rather than expanding inference filters: Nx project inspection proved fallbacks missing; matches the migration command convention and preserves per-project scope; reversible.
- Use explicit Jest command for the secondary config rather than another inference plugin; preserves both test targets and arguments; reversible.
- Keep nx-prisma's compatible Devkit dependency rather than force a forbidden peer version: @nx-tools/nx-prisma@7.3.0 declares @nx/devkit >=18 <24; all official Nx 24 plugins resolve their own Devkit 24.0.0. Changing the Prisma plugin is outside this Angular/config follow-up; revisit with a compatible release.

## Not done / blockers
No requested repair remains unimplemented. Nx report retains the nx-prisma/Devkit 23.2.1 warning above; Prisma runtime/migrations were not exercised. Nx emits recoverable Jest ESM config-loading warnings during graph creation; graph queries and the allowed typecheck succeeded.
No tests, lint, build, run-many, workspace-wide check, publish, git mutation, or excluded-file edit performed. Coverage forwarding was verified from resolved configuration and installed Nx command-forwarding code, not by executing tests. npm reports 51 audit findings; remediation was outside scope.
