# Batch B-2c executor report — C3 `wizard:preview-generation`

Executor: backend-developer (sub-agent). No git command run. batches.md and task.md not edited.

## Files changed (exactly the six in the batch)

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\shared\src\lib\types\rpc\rpc-setup.types.ts`: `WizardPreviewGenerationParams`, `GenerationPreviewCertainty`, `GenerationPreviewFile`, `GenerationPreviewAgent` and `WizardPreviewGenerationResponse`, plus a type-only import of `HarnessTargetId`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\shared\src\lib\types\rpc.types.ts`: the import, a `RpcMethodRegistry` entry and a `RPC_METHOD_ENTRIES` entry for `'wizard:preview-generation'`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\rpc-handlers\src\lib\handlers\wizard-generation-rpc.handlers.ts`: added the method to `METHODS` and `register()`, plus `registerPreviewGeneration`, `previewRivals`, `previewAgent` and `previewFile`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\rpc-handlers\src\lib\handlers\wizard-generation-rpc.schema.ts`: `WizardPreviewGenerationParamsSchema` = `z.array(WizardAgentIdSchema).min(1).max(200)`. This is the id rule at `:36`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\rpc-handlers\src\lib\handlers\wizard-generation-rpc.handlers.spec.ts`: 16 new cases. The `register()` case now also checks METHODS against what is registered.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\rpc-handlers\src\lib\handlers\wizard-generation.preview-fidelity.spec.ts`: 3 cases.

No manifest was edited.

## Task B-2c.1: contract and handler

How the handler works:

1. **Parse.** The request is parsed with the zod schema. If no folder is open, the handler throws `RpcUserError('INVALID_PARAMS')`, the same rule B-2b uses.
2. **Claude path.** Each selected agent gets `.claude/agents/<id>.md` as `definite`. The path comes from `checkpoints.outputDirectoryFor(ws)`, the same `<ws>/.claude/agents` join the orchestrator uses.
3. **Rival targets.**
   - Registration checks use `container.isRegistered`, following the pattern at `:745-798`.
   - If `RECONCILER` or `SOURCE_RESOLVER` is missing, the response lists Claude paths only and carries `warning`.
   - Otherwise the handler runs a fresh `reconciler.verify(harnessRoot, 'wizard:preview-generation')`, never `getLastHealth()`.
   - A rival target is listed when `detected && facets.agents === 'supported'`. Its path comes from `harnessAgentRelPath` (`@ptah-extension/shared`).
   - If `verify` throws, the handler logs `logger.warn` and returns Claude paths only with a `warning`. It does not raise an RPC error or a Sentry report.
4. **Eligibility.** Whether an agent is synced is decided only by `isAgentSelectedForSync({ agentSyncEnabled: true, disabledAgentIds }, slug)`, imported from `@ptah-extension/harness-sync`.
   - `disabledAgentIds` comes from the registered `SOURCE_RESOLVER.resolve(harnessRoot)`, the same source the builder reads.
   - `agentSyncEnabled` is `true` because the wizard grants consent before it propagates, so this is the state after generation (plan C3, finding 5).
5. **Gate or propagation missing.** If `AGENT_SYNC_GATE` or `PROPAGATION` is not registered, every rival path is `conditional` with condition `"agent sync not available on this host"`.
6. **`willOverwrite`** is true when `fs.promises.lstat` succeeds on the path.
7. **Read-only.** The handler calls only `verify`, one source resolve and `lstat`. It never calls `AgentSyncGate.enable`, `propagate` or `reconcile`. The handler spec asserts this, and so does fidelity case 2, where the gate stays `false` after the preview.

## Task B-2c.2: specs

### `wizard-generation-rpc.handlers.spec.ts`

55 tests pass, 16 of them new. They are in `describe('wizard:preview-generation')`:

- codex and opencode detected, copilot not detected, antigravity `agents: 'unsupported'`: exactly 3 `definite` paths. Also checks that `verify` was called fresh on the resolved root.
- Request order is kept and duplicate ids are collapsed.
- An existing file gives `willOverwrite` true for that file only (Claude and codex), and the file is left unchanged.
- No reconciler: warning plus Claude paths only.
- `verify` throws: warning plus Claude paths only, no Sentry report.
- `it.each` over `AGENT_SYNC_GATE` and `PROPAGATION` unregistered: rival paths `conditional` with the exact condition string, Claude path still `definite`.
- An agent in `disabledAgentIds` gets no rival path; the source resolver is called with the harness root.
- A reserved slug (`con`) gets no rival path.
- `policyUnknown`: rival paths `conditional`.
- Nothing is mutated: no `enable`, `propagate`, `reconcile`, checkpoint write or orchestrator call, and the workspace is byte-unchanged.
- `it.each` over a traversal id, an empty list and a missing list: `INVALID_PARAMS`, and `verify` is never called.
- No folder open: `INVALID_PARAMS`.
- A folder nested under another harness root: warning that names the root, Claude paths only, `verify` not called.

### `wizard-generation.preview-fidelity.spec.ts`

3 tests pass. The setup:

- **Container.** A real tsyringe child container with `registerHarnessSyncServices`, giving the real reconciler, propagation, `AgentSyncGate`, builder and all seven targets.
- **Source resolver.** `PluginConfigSourceResolver` over a temp home.
- **CLI detector.** Reports codex, copilot, opencode and antigravity installed.
- **Agent generation.** `registerAgentGenerationServices` supplies the real orchestrator, `AgentFileWriterService`, `AnalysisStorageService` and `UserLayerMirrorService`.
- **Refresher.** Runs the hosts' sequence: `mirrorAll`, then `reconcileAll`, gated by `resolveAgentMirrorSource`.
- **Generation.** Driven through the real `wizard:submit-selection`; each test waits for the single `generation-complete` broadcast.

The cases:

1. Gate enabled; selection `backend-developer`, `frontend-developer`, `tester`; `tester` is in `disabledAgentIds`. The written agent paths equal the `definite` set exactly: 9 paths, with no `tester` copy outside Claude.
2. Gate recorded as disabled (`persist(ws, false)`, then `resolve` returns `{ enabled: false, derived: false }`). The preview leaves the gate disabled. After generation the gate is enabled, and the written paths equal the `definite` set exactly (8 paths).
3. `verify` rejected once. The preview carries a warning and lists only the Claude `definite` paths. Generation still writes both Claude files (with the stubbed content), and the written Claude paths equal the preview's `definite` set.

## How PA-2, PR6 and A-6 were handled

- **PA-2.** Eligibility uses `isAgentSelectedForSync` from `@ptah-extension/harness-sync` (B-1b, 442317863). It is not re-implemented. `disabledAgentIds` comes from the same registered source resolver the builder uses.
- **PR6.** Covered by fidelity cases 1 and 2: exact set equality between the preview's `definite` set and what the real `wizard:submit-selection` writes. I closed three more gaps where the preview would have promised paths that never get written:
  - **Reserved slug.** The builder's `rejectSlug` drops it, so the preview uses the exported `isReservedSlug` and lists no rival path.
  - **Capability policy unreadable** (`policyUnknown`). The reconciler freezes agents for that pass, so rival paths are `conditional`.
  - **Workspace folder below the harness root.** Generation writes `<folder>/.claude/agents`, but the mirror reads `<harnessRoot>/.claude/agents`, so no rival copy is written. The preview returns Claude paths only plus a warning that names the root.
- **A-6.** I stubbed at the content boundary; I did not stub the orchestrator. What stayed real and what was stubbed:
  - **Real:** the orchestrator, including its `.claude/agents/<id>.md` path, and the real file writer.
  - **Stubbed:** `TEMPLATE_STORAGE_SERVICE` (template body), `CONTENT_GENERATION_SERVICE` (the LLM pass), `OUTPUT_VALIDATION_SERVICE`, `AGENT_SELECTION_SERVICE` (not reached when the user picks the ids), `ENHANCED_PROMPTS_SERVICE`, and the workspace-intelligence analyzers.
  - **Platform file system:** the port is backed by Node `fs`, as the CLI host's is.
  - **Why this was possible:** the orchestrator class is not exported from the barrel, but `registerAgentGenerationServices` and its token are, so the real orchestrator resolves without a deep import.

## Verification (output tailed)

- `npx nx run-many -t typecheck,lint -p @ptah-extension/shared,@ptah-extension/rpc-handlers --skip-nx-cache`: "Successfully ran targets typecheck, lint for 2 projects".
- `npx nx run-many -t test -p @ptah-extension/shared,@ptah-extension/rpc-handlers --maxWorkers=2 --skip-nx-cache`: "Successfully ran target test for 2 projects".
  - shared: 83/83 suites, 2277/2277 tests.
  - rpc-handlers: 137/137 suites, 3981 passed and 7 skipped (3988 total). The 7 skips were already there. B-2b had 3962 passed, so this batch adds 19.
- Prettier: run on the three handler and spec files, whose HEAD versions were already formatted. `rpc-setup.types.ts` was not formatted at HEAD (`:40-44`); I did not reformat it, and my added section is already prettier-clean.
- No TODO, stub, `skip` or `only` was added.

## Deviations and observations

1. **`max-lines` warning (lint warning, not an error).** `wizard-generation-rpc.handlers.ts` now has 861 counted lines against a limit of 700; HEAD had no warning. The batch's six-file list allows no new file. If the warning should go, the follow-up is to move the four preview methods into their own file. `preserve-caught-error` at `resolveService` was already there.
2. **Additions beyond the plan.** All three come from PR6: the reserved-slug rule, the `policyUnknown` condition, and the nested-folder warning.
3. **Edge case not covered.** If every selected agent comes back `unchanged`, `writtenCount === 0`. The wizard then neither grants consent nor propagates (`:361`). A workspace whose gate was disabled before would get none of the rival copies the preview listed as `definite`. Contents are unknown before generation, so the preview cannot detect this. The B-4 re-preview on confirm does not change it either.
4. **Fidelity spec wrote into the real home during development; cleaned up.** My first draft redirected the home directory through `HOME`/`USERPROFILE`. Jest gives the sandbox a copy of `process.env`, so `os.homedir()` still returned the real home. Two development runs created four directories under `C:\Users\abdal\.ptah\user\agents\`:
   - `workspace-47aa3df4a0ad03d9`, `workspace-70521223f545ad46`, `workspace-8ad749a0248e0659` and `workspace-e9f96b206fc69dad`.
   - Each held copies of the fixture agents, two of them seeded from the user's legacy flat root, plus a seed-quarantine marker.
   - I deleted exactly those four directories. A listing of files modified in the window showed nothing else under `~/.ptah` touched by the runs: the legacy flat root was not modified, and the SQLite files predate the runs.
   - The spec now mocks the `os` module (`homedir` returns the fixture's temp home) and checks it in `beforeEach`. The refresher also refuses to mirror unless the user-layer root is under the temp home.
   - After the fix, three runs left `~/.ptah/user/agents` unchanged (34 entries before and after; `find -newer` returned nothing).
