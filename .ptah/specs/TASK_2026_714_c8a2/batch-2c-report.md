# Batch 2c — legacy Codex credential home

Implemented the credential-path correction in the two assigned source files. Verification is incomplete: Jest cannot resolve a configured dependency and project lint fails.

## Changes

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:429`: `getAuthPath()` now reads `CODEX_HOME/auth.json` when CODEX_HOME is nonempty; otherwise it retains HOME, USERPROFILE, then os.homedir(), with `.codex/auth.json` appended. Resolution remains per call.
- The access-token reader at adapter line 488 and credential freshness probe at line 512 both use that resolver.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.spec.ts:290`: added seven credential-home regression cases.
- Ran the requested Prettier write on both entire files; this also formats existing code in those files. No execution behavior, permission policy, exec workaround, or SDK integration was changed.

## Execution and credential agreement

`runSdk()` copies process.env into its SDK environment at adapter line 562, adding only FORCE_COLOR and NO_COLOR. The Codex constructor receives that environment at line 641. `CliCommandOptions` (cli-adapter.interface.ts:46) has no per-spawn environment or CODEX_HOME field. Therefore this batch implements the expressly permitted env > default branch, without extending the shared contract. A nonempty CODEX_HOME selects the same directory for SDK execution and both credential readers. Production code does not mutate process.env.

There is no per-spawn override to test today: the explicit-home test supplies CODEX_HOME through the existing environment and verifies it wins over HOME and USERPROFILE. A separate test captures the SDK constructor environment and verifies the credential path uses that exact CODEX_HOME. This is not a claim that a new per-spawn option was implemented.

## Specs

Seven added cases (not executed successfully; see verification):

1. Explicit CODEX_HOME wins over HOME and USERPROFILE (spec line 308).
2. Environment CODEX_HOME is read anew for each access-token read (line 321).
3. HOME fallback takes precedence over USERPROFILE (parameterized case at line 344).
4. USERPROFILE fallback works when HOME is empty (same parameterized test).
5. os.homedir() fallback when both home environment variables are absent (line 357).
6. SDK execution environment and credential path agree; production call leaves process.env unchanged (line 365).
7. Unreadable selected-home credentials return false without reading default credentials (line 390).

## Verification

Commands ran sequentially in the assigned worktree. PowerShell `Select-Object -Last 30` supplied the requested tail behavior.

- Scoped `ptah_get_diagnostics` before the mandatory commands: **0 errors, 0 warnings**, clean TypeScript compiler coverage.
- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.spec.ts --coverage=false --maxWorkers=2`: exit **1**; **0 passed suites, 1 failed suite, 1 total; 0 tests executed; 0 snapshots**. Jest cannot resolve its configured `marked` mapping to `W/node_modules/marked/lib/marked.umd.js`. Import chain: markdown.reducer.ts → tool-output-capper.ts → agent-sdk registration/index → cli-adapter.utils.ts → adapter spec. No test assertions ran. No dependency installation or configuration changes attempted.
- `npx nx run-many -t typecheck lint -p @ptah-extension/cli-agent-runtime --parallel=1 --output-style=static`: exit **1**; lint reported **52 problems: 1 error, 51 warnings**. The only listed failed task was `@ptah-extension/cli-agent-runtime:lint`; no typecheck failure was listed. The retained tail does not contain the lint error location or an independent typecheck success line, so no stronger per-target pass claim is made. No rerun performed to retrieve discarded output; attempted cache lookup found no local cache at the checked paths.
- `npx prettier --write` on the two assigned files completed and reported both formatted (507 ms and 942 ms). A subsequent cache lookup in the same shell command failed because `.nx/cache` does not exist; this did not affect formatting.
- Required diagnostics after formatting returned **unavailable**: TypeScript check was still running after 45 seconds, **2 files unchecked**; the tool stated it did not cancel the check. No final clean-diagnostics claim is made.

No git commands, installation, build, serve, e2e, workspace-wide checks, or edits outside the assigned source files and this report.

## Decisions

- **Decision:** implement environment > default without adding a per-spawn API. **Options:** use the current inherited environment (chosen), or extend the spawn contract. **Evidence:** batch instructions explicitly permit this fallback when no per-spawn option exists; CliCommandOptions has none, and runSdk copies process.env. **Reversible:** yes; a later explicitly scoped contract change can supply a spawn-specific home.
- **Decision:** preserve the existing empty-value fallback behavior and per-call resolution. **Options:** treat empty CODEX_HOME as absent (chosen), or introduce validation/errors. **Evidence:** existing HOME/USERPROFILE resolution uses nonempty values and this batch requests an interim path fix only. **Reversible:** yes.
- **Decision:** leave dependency resolution and unrelated project lint failures to the invoking workflow. **Options:** report verification blockers (chosen), or modify out-of-scope configuration/source. **Evidence:** ownership is limited to the two named files; the retained lint tail does not identify the sole error. **Reversible:** yes; coordinator can investigate with the appropriate ownership and verification scope.

## Follow-up

The orchestrator repaired the worktree node_modules junction. The now-runnable suite exposed the original spy's attempt to redefine Node's non-configurable readFile export.

- Replaced `jest.spyOn(fsPromises, 'readFile')` in `codex-cli.adapter.spec.ts` with a partial `jest.mock('fs/promises')` matching the adapter's import. Other exports come from typed `jest.requireActual`; readFile delegates through a typed Jest mock whose default implementation is the real readFile. Credential cases override that implementation and restore it afterward. All seven assertions/cases remain intact; no production adapter change was needed.
- Fixed the single declaration in `agent-process-manager.service.spec.ts:608-609` by explicitly initializing `let attachment: McpAttachment | undefined = undefined`. The variable is assigned an attachment later in the same test, so changing it to const caused TS2588. Explicit initialization preserves both the initial undefined state observed by the probe and the subsequent assignment, while removing prefer-const. No other intentional behavior change in this file.

Final required verification, sequential and scoped:

- Jest on codex-cli.adapter.spec.ts and agent-process-manager.service.spec.ts, `--coverage=false --maxWorkers=2`: **exit 0; 2 suites passed / 2 total; 276 tests passed / 276 total; 0 snapshots** (25.694 seconds). This includes all **93 Codex adapter tests**, including the seven credential-home cases, and **183 process-manager tests**. Jest emitted a non-fatal config module-format warning.
- `npx nx run-many -t typecheck lint -p @ptah-extension/cli-agent-runtime --parallel=1 --output-style=static`: **exit 0; successfully ran both typecheck and lint; 0 lint errors, 51 warnings**.
- `npx prettier --write` on the two follow-up changed spec files: **exit 0**, both files formatted. Adapter production code was not changed in this follow-up.
- PowerShell Select-Object/Select-String supplied the requested tail/grep filtering. No workspace-wide checks, installations, builds, or git operations.

Intermediate verification found the const declaration invalid (one failed suite, 93 passing Codex tests), then confirmed 276 passing tests with the restored let but the original lint error. The final explicit initialization resolved that lint error; the final counts above supersede those intermediate results. Scoped Ptah diagnostics also caught the intermediate const error; final verification is the successful required Jest and Nx commands.

Follow-up decision: use an explicit undefined initializer with let, rather than const, because the current source assigns attachment later and the test relies on observing both states. This is the minimal equivalent one-line fix permitted by the request and is reversible. The module mock follows the existing partial-module-mock pattern and avoids redefining native property descriptors.
