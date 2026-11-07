# @ptah-extension/agent-generation

Generates project-adaptive agent files for a workspace. The
`AgentGenerationOrchestratorService` (`src/lib/services/orchestrator.service.ts`) runs four
phases: workspace analysis, template selection, rendering with LLM-driven content through
`InternalQueryService` from `@ptah-extension/agent-sdk`, and guarded per-agent file writes.

## Entry points

- `registerAgentGenerationServices` and `AGENT_GENERATION_TOKENS` (`src/lib/di/`): DI
  registration and tokens. The host calls the register function after the services it depends on.
- Services exported from `src/index.ts`: `ContentGenerationService`, `AgentSelectionService`,
  `AgentRecommendationService`, `AgentFileWriterService`, `OutputValidationService`,
  `TemplateStorageService`, `AnalysisStorageService`, `SetupStatusService`.
- `src/lib/patterns/`: small generic helpers (`generateWithPartialSuccess`, `GenerationPipeline`,
  `BasePromptBuilder`). See its README.

The bundled agent templates live in `templates/`.

## Constraints

- Nx tags `scope:extension`, `type:feature` (`project.json`). Consumed by the Electron app
  (`apps/ptah-electron`) and by backend libs such as `rpc-handlers`, `cli-engine` and
  `skill-synthesis`.
- Depends on `vscode-core` (logger, tokens), `workspace-intelligence`, `settings-core` and
  `harness-sync`.

## Tests

```bash
npm run verify -- -t test -p agent-generation
```
