# @ptah-extension/agent-generation

[Back to Main](../../../CLAUDE.md)

## Purpose

Project-adaptive agent generation: analyzes a workspace, applies orchestration patterns, and synthesizes per-CLI agent files (Claude/Codex/etc.) plus skill prompts. Powers the setup wizard.

## Boundaries

**Belongs here**:

- Template storage and Markdown content generation
- Analysis pipeline (`AgenticAnalysisService`, `MultiPhaseAnalysisService`)
- Output validation, agent selection/recommendation services
- Multi-CLI agent file writers and transformers
- Setup wizard child services + analysis zod schema

**Does NOT belong**:

- RPC handlers (those live in `rpc-handlers`)
- Platform IO (use `platform-core` ports / `vscode-core` wrappers)
- LLM provider implementations (use `agent-sdk`)

## Public API

Services: `TemplateStorageService`, `ContentGenerationService`, `OutputValidationService`, `AgentFileWriterService`, `AgentSelectionService`, `AgentRecommendationService`, `SetupStatusService`, `AnalysisStorageService`, `MultiCliAgentWriterService`, `WizardWebviewLifecycleService`, `AgenticAnalysisService`, `MultiPhaseAnalysisService`.
Types/schemas: `ProjectAnalysisZodSchema`, `ProjectAnalysisZodOutput`, `OrchestratorGenerationOptions`, `ICliAgentTransformer`, `CustomMessageHandler`, `WizardPanelInitialData`.
Helpers: `normalizeAgentOutput`, `resolveProjectType`.
DI: tokens via `./lib/di`, interfaces via `./lib/interfaces`, errors via `./lib/errors`.
Plus content processor utilities and orchestration patterns.

## Internal Structure

- `src/lib/services/` — generation, validation, writer, selection, recommendation, analysis storage
- `src/lib/services/wizard/` — wizard lifecycle + analysis services
- `src/lib/services/cli-agent-transforms/` — multi-CLI agent transformers (Claude, Codex, etc.)
- `src/lib/patterns/` — orchestration patterns
- `src/lib/utils/content-processor/` — Markdown/frontmatter helpers
- `src/lib/types/`, `interfaces/`, `errors/`, `di/`

## Dependencies

**Internal**: `@ptah-extension/shared`, `@ptah-extension/platform-core`, `@ptah-extension/vscode-core`, `@ptah-extension/workspace-intelligence`, `@ptah-extension/agent-sdk`
**External**: `tsyringe`, `zod`, `gray-matter`

## Guidelines

- LLM calls go through `InternalQueryService` (agent-sdk), not raw SDK.
- All analysis outputs validated via `ProjectAnalysisZodSchema` before downstream consumption.
- File writes go through `IFileSystemProvider` (platform-core); never use `node:fs` directly.
- `MultiCliAgentWriterService` fan-outs through `ICliAgentTransformer` instances — add a transformer to support a new CLI.
- `catch (error: unknown)`.

## Cross-Lib Rules

Used by `rpc-handlers` (wizard handlers). Should not import `rpc-handlers` (cycle).
