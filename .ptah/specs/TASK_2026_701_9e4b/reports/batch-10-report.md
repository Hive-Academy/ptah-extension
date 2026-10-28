# Backend implementation — `TASK_2026_701_9e4b`, batch 10

**Tasks completed**: 10.1 (guarded `writeAgent(agent, guard)`; `writeAgentsBatch`/`rollback` deleted),
10.2 (orchestrator output root, file guards, `onAgentWritten`, pure model resolution).

## Files

All paths are under `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/backend/agent-generation/src/`.

- MODIFIED `lib/interfaces/agent-file-writer.interface.ts`: adds `AgentWriteBaseline`, `AgentWriteGuard`
  (per plan :336-337), `AgentWriteStatus` (`written | unchanged | kept | changed-since-preview`) and
  `AgentWriteResult`. `writeAgent(agent, guard)` now takes a required guard. `writeAgentsBatch` is removed.
- MODIFIED `lib/services/file-writer.service.ts`: the guarded writer.
  - It reads the target first. `ENOENT` or `FileNotFound` (VS Code FS; same rule as
    `lane-routing/.../capability-matrix.store.ts:629`) means absent. Any other read error returns
    `kept` with a warn, and no write happens.
  - Equal bytes → `unchanged`.
  - The guard is then applied: create-only on an existing file → `kept`. replace-allowed with a
    `missing` baseline and a file now present → `changed-since-preview`. replace-allowed with a
    `present` baseline whose `hashContent` no longer matches → `changed-since-preview`.
  - Otherwise it creates the directory and writes → `written`. A write error → `Result.err`.
  - `writeAgentsBatch`, `rollback` and `writeIfChanged` are deleted. `writeIfChanged` had a catch
    that silently swallowed read errors; it is replaced by `readCurrent`.
  - The local `AgentWriteResult` type moved to the interface file.
- MODIFIED `lib/services/file-writer.service.spec.ts`:
  - Batch tests deleted. Existing tests go through a `write(agent, guard = create-only)` helper.
  - New `write guards` block covering: differs (create-only → kept); identical (both modes →
    unchanged); missing (create-only and replace-from-missing → written); VS Code `FileNotFound`
    → absent; unreadable EACCES under each guard → kept and never written; missing→present →
    changed-since-preview; changed hash → changed-since-preview; present baseline but file deleted
    → written; write error → `Result.err` with the original bytes intact.
  - All file-system activity uses the in-memory `createMockFileSystemProvider`. Nothing touches the
    real disk or home directory.
- MODIFIED `lib/types/core.types.ts`:
  - New types: `AgentFileGuard = AgentWriteGuard | {mode:'keep'}`, `KeptAgentOutcome`
    (`kept | changed-since-preview`) and `WrittenAgentFile`.
  - `OrchestratorGenerationOptions` gains `outputRoot?`, `fileGuards?` and `onAgentWritten?`.
  - `GenerationSummary` gains `keptCount?`, `changedSincePreviewCount?` and `keptOutcomes?`. They
    are optional; see the Decisions section.
- MODIFIED `lib/services/orchestrator.service.ts`:
  - Agent files go to `{outputRoot ?? projectContext.rootPath}/.claude/agents`. Analysis still reads
    `workspacePath`.
  - Guards are looked up by own property only; an agent with no entry is `create-only`.
  - A `keep` guard skips the template load, the render (no LLM call) and the write, and records a
    `kept` outcome.
  - When the writer returns `kept` or `changed-since-preview`, the agent goes to `keptOutcomes`.
  - The "nothing rendered" and "all writes failed" errors, and the `failed` lifecycle, now count
    kept agents as settled. A run where every agent was kept completes.
  - `onAgentWritten` runs only for `written` agents. If the hook throws, the error is logged and the
    agent stays written.
  - `resolveClaudeModel` is replaced by `resolveModel`, which delegates to the pure function and
    keeps the existing warn for an ignored override.
  - Unused shared imports are removed.
- MODIFIED `lib/services/orchestrator.service.spec.ts`:
  - The `writeAgentsBatch` mock is removed.
  - New `file decisions and output root` block covering: keep skips `generateContent` and
    `writeAgent`; all kept → `completed`, with no LLM call and no write; missing guard is passed as
    `create-only` and an explicit guard is passed through unchanged; an inherited `constructor` key
    is ignored; writer `kept` and `changed-since-preview` count as settled, not failed; all writes
    failing is still an error; `outputRoot` is used; `onAgentWritten` fires for written agents only
    and survives a hook that throws.
  - Existing model-override tests (including the ignored `gpt-5` case) still pass through
    `resolveModel`.
- CREATED `lib/services/agent-model-resolution.ts`:
  - Pure `resolveClaudeAgentModel(layers, templateId, templateModel): AgentModelPreview`. It uses
    the shared `AgentModelPreview`/`AgentModelOrigin` (`rpc-setup-decisions.types.ts:65-77`), so
    Batch 11's preview can use it directly.
  - Returns `{value, origin: workspace|machine|template|none, ignoredOverride?}`.
- CREATED `lib/services/agent-model-resolution.spec.ts`: cases for workspace, machine, template
  (trimmed), none, ignored `gpt-5` (with and without a template model), and the other provider's
  leaf never being read.
- MODIFIED `index.ts` (additive only, one block after the `OrchestratorGenerationOptions` export):
  - type exports `AgentFileGuard`, `KeptAgentOutcome`, `WrittenAgentFile`, `AgentWriteBaseline`,
    `AgentWriteGuard`, `AgentWriteResult`, `AgentWriteStatus`;
  - value export `resolveClaudeAgentModel`.

## Stack observed

- tsyringe with `@inject` tokens; the writer constructor is unchanged
  (`file-writer.service.ts` constructor). No new DI registration.
- Results use `Result` from `@ptah-extension/shared`. File I/O goes through the platform
  `IFileSystemProvider` port (`platform-core/src/interfaces/file-system-provider.interface.ts`).
- `hashContent` comes from `@ptah-extension/harness-sync` (`content-hash.ts:121`). The lib already
  depends on harness-sync (`orchestrator.service.ts:32`).
- Logging goes through the injected `Logger`, with real `Error` objects passed to `logger.error`.

## Verification

- `npm run verify -- -p @ptah-extension/agent-generation,@ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-cli`
  - First run: 60/61 tasks passed. `@ptah-extension/agent-generation:test` failed with three
    ts-jest type errors in my new orchestrator spec tests: two untyped `jest.fn()` mocks and one
    untyped hook mock. I fixed these with typed `jest.fn<...>()`.
  - Re-run: **"61 tasks: 61 succeeded, 52 cached"**, lock released with exit code 0. This covers
    lint, test and typecheck for all 5 requested projects.
  - Neither accepted pre-existing failure (agent-sdk lint D21, webview lint D19) is in this
    project list. No failure came from Batch 14's files.
- Degradation audit:
  `node scripts/verify.mjs --exec --task degradation-audit -- npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`
  exited with code 0.
  - `libs/backend/agent-generation: 1 ok (baseline 1)`. The one site is the existing one at
    `user-layer-mirror.service.ts:2229`; the new writer catches return typed states, not literals.
  - The audit also prints an `orphaned-suppression` at `agent-sdk/session-importer.service.ts:993`.
    That file is not mine and the run still exits 0.
- The run did not include `tools/di-lint` (constructor injections are unchanged) or any
  `build`/`e2e` target.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| `kept` / `changed-since-preview` outcomes are reported in a separate `GenerationSummary.keptOutcomes` list. `onAgentOutcome` is not called for them. `outcomes` keeps the shared `GenerationAgentOutcome[]` type. | (a) widen `outcomes` and `onAgentOutcome` to a local wide union; (b) separate list | D18: do not widen the shared union in this batch. With (a), rpc-handlers stops compiling: `wizard-generation-run.supervisor.ts:149` assigns `summary.outcomes` to `GenerationAgentOutcome[]`, and `wizard-generation-rpc.handlers.ts:1471,1669` pass the outcome to `checkpoints.recordOutcome(…, GenerationAgentOutcome)`. Those files are outside Batch 10. Task 12.1 can fold `keptOutcomes` into `outcomes` once it widens the shared type and updates the checkpoint. | yes |
| `keptCount`, `changedSincePreviewCount` and `keptOutcomes` are optional on `GenerationSummary`, although the orchestrator always sets them. | required; optional | ts-jest type-checks specs (`rpc-handlers/jest.config.ts:10`). Required fields would break `GenerationSummary` literals in `core.types.spec.ts:223`, `guidance-generation-run.supervisor.spec.ts:40` and `wizard-generation-rpc.handlers.spec.ts:1097`, none of which is in this batch. | yes |
| A replace-allowed agent with a `present` baseline whose file was deleted after the preview is **written**. | write; `changed-since-preview` | The plan (:340-341) covers only a hash mismatch. A deleted file has nothing to lose, and the user chose to have the new content there. A spec pins this behaviour. | yes |
| A `keep` guard skips the template load as well as the render. | skip render only; skip load and render | Plan :365 says "skips render and write". Loading the template serves no purpose for a kept file, and skipping it means a broken template cannot turn a kept agent into `failed`. | yes |
| `onAgentWritten` receives `{agentId, filePath}`. | pass content or hash; path only | B4's `recordWritten(harnessRoot, slug, hash)` hashes the file on disk with `computeSourceHash(file)` (plan :393). The caller has the path and the harness root. | yes |
| `resolveClaudeAgentModel` returns the shared `AgentModelPreview`. | a new local type; the shared one | `rpc-setup-decisions.types.ts:65-77` already defines `{value, origin, ignoredOverride?}` for B5's model origins. | yes |

## Plan deviations

- `GenerationSummary` fields are optional, and kept outcomes are in a separate list (see
  Decisions). Both follow from D18 and from the rule to edit only listed files.

## Behaviour change for reviewers

- Missing guard = create-only (plan :366). Until Batch 11/12 pass explicit guards, a wizard re-run
  keeps every existing agent file instead of overwriting it.
- In the current wizard payload (`buildCompletePayload`), those agents show up in neither `agents`
  nor the counts, because they are only in `keptOutcomes`.
- A retry (`wizard-generation-rpc.handlers.ts:1515-1530`) of an agent whose file exists ends `kept`,
  so it does not report success.
- Batch 12 (counts, statuses) and Batch 17 (UI) are planned to surface `keptOutcomes`. This is the
  intended safety floor for P2 work in progress.

## Out-of-scope observations

- `libs/backend/agent-generation/src/lib/types/index.ts` does not re-export the new core types, so
  I exported them from the lib `index.ts`. That barrel is not in Batch 10.
- Task 12.1 should merge `keptOutcomes` into `outcomes` when it widens
  `GenerationAgentOutcome.status`, and make the summary counts required. It also needs to update
  `buildCompletePayload` (`wizard-generation-run.supervisor.ts:145-189`) to count kept agents.
- Pre-existing `orphaned-suppression` at `libs/backend/agent-sdk/src/lib/session-importer.service.ts:993`.
