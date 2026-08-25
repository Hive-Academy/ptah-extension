# @ptah-extension/agent-generation

[Back to Main](../../../CLAUDE.md)

## Purpose

Project-adaptive agent generation: analyzes a workspace, applies orchestration patterns, and synthesizes agent files into `{ws}/.claude/agents` plus skill prompts. Powers the setup wizard. Also owns `UserLayerMirrorService`, which publishes plugin, synthesized and hand-authored sources into `~/.ptah/user/`.

**Per-CLI agent transformation is NOT here.** `MultiCliAgentWriterService` and the Codex/Copilot/Cursor transformers moved to `@ptah-extension/harness-sync` in TASK_2026_278 Batch 2. Generation writes ONE format; the reconciler fans it out to whichever CLIs are installed, so generation no longer has to detect them and a CLI installed afterwards is populated by the next reconcile instead of never.

The boundary in one sentence: **agent-generation decides what a skill is and mirrors it; harness-sync copies it outward.** `UserLayerMirrorService` publishes plugin, synthesized and hand-authored sources into `~/.ptah/user/{skills,commands,agents}` — that IS the desired state `harness-sync` reconciles from into every CLI's harness dir. Nothing downstream of the mirror belongs in this lib.

## Boundaries

**Belongs here**:

- Template storage and Markdown content generation
- Analysis pipeline (`AgenticAnalysisService`, `MultiPhaseAnalysisService`)
- Output validation, agent selection/recommendation services
- `AgentFileWriterService` — writes ONE generated format to `.claude/agents/` /
  `.claude/commands/`, the source `harness-sync` mirrors from, never a rival
  CLI's target dir
- Setup wizard child services + analysis zod schema

**Does NOT belong**:

- RPC handlers (those live in `rpc-handlers`)
- Platform IO (use `platform-core` ports / `vscode-core` wrappers)
- LLM provider implementations (use `agent-sdk`)

## Public API

Services: `TemplateStorageService`, `ContentGenerationService`, `OutputValidationService`, `AgentFileWriterService`, `AgentSelectionService`, `AgentRecommendationService`, `SetupStatusService`, `AnalysisStorageService`, `WizardWebviewLifecycleService`, `AgenticAnalysisService`, `MultiPhaseAnalysisService`.
Types/schemas: `ProjectAnalysisZodSchema`, `ProjectAnalysisZodOutput`, `OrchestratorGenerationOptions`, `CustomMessageHandler`, `WizardPanelInitialData`.
Helpers: `normalizeAgentOutput`, `resolveProjectType`.
DI: tokens via `./lib/di`, interfaces via `./lib/interfaces`, errors via `./lib/errors`.
Plus content processor utilities and orchestration patterns.

## Internal Structure

- `src/lib/services/` — generation, validation, writer, selection, recommendation, analysis storage
- `src/lib/services/wizard/` — wizard lifecycle + analysis services
- `src/lib/services/user-layer/` — `UserLayerMirrorService` + fs ops + orphan reaper
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
- A new rival CLI needs NOTHING here. Add a target in `harness-sync`'s `rival-targets.ts`.
- `catch (error: unknown)`.

## Cross-Lib Rules

Used by `rpc-handlers` (wizard handlers). Should not import `rpc-handlers` (cycle).
