# Setup Wizard

↩️ [Back to Main](../../../CLAUDE.md)

## Purpose

Premium-gated multi-step wizard that scans a workspace, analyzes the project, lets the user pick agents, generates them, and enhances prompts — driven by streamed backend events routed through the canonical streaming pipeline.

## Boundaries

**Belongs here**: wizard step components, signal-based wizard state, RPC client, internal-state contract token, message dispatcher for streamed phases.
**Does NOT belong**: scanning/analysis/generation logic (backend), license verification logic (core), generic chat streaming primitives (`chat-routing`).

## Public API

From `src/index.ts`:

- Services: `SetupWizardStateService`, `WizardRpcService`, `ToolOutputFormatterService`.
- DI contract: `WIZARD_INTERNAL_STATE` injection token, `WizardInternalState` type, `provideWizardInternalState()` provider (TASK_2026_103 Wave F1 — mirrors B1's `STREAMING_CONTROL` inverted-dependency pattern).
- Container: `WizardViewComponent`.
- Step components: `WelcomeComponent`, `ScanProgressComponent`, `AnalysisResultsComponent`, `AgentSelectionComponent`, `PromptEnhancementComponent`, `GenerationProgressComponent`, `CompletionComponent`.
- Utility components: `ConfirmationModalComponent`, `PremiumUpsellComponent`, `AnalysisTranscriptComponent`, `AnalysisStatsDashboardComponent`, `EnhancedPromptsSummaryCardComponent`.
- Types: `WizardStep`, `ProjectContext`, `AgentSelection`, `GenerationProgress`, `AgentProgress`, `ScanProgress`, `AnalysisResults`, `CompletionData`, `ErrorState`, `EnhancedPromptsWizardStatus`.

## Step Order

1. `welcome` → 2. `scan` → 3. `analysis` → 4. `agent-selection` → 5. `prompt-enhancement` → 6. `generation` → 7. `completion`. The container gates on premium license before rendering any step (shows `PremiumUpsellComponent` when invalid).

## Internal Structure

- `src/lib/components/` — step components plus utility components and `cards/` for summary cards.
- `src/lib/services/` — `setup-wizard-state.service.ts` (orchestrator), `wizard-rpc.service.ts`, `tool-output-formatter.service.ts`, `wizard-internal-state.provider.ts`, plus `setup-wizard/` subdirectory of decomposed state collaborators.
- `src/lib/services/setup-wizard/` — `WizardMessageDispatcher`, `WizardPhaseAnalysis`, `WizardPhaseGeneration`, `WizardFlowState`, `WizardScanState`, `WizardAnalysisState`, `WizardGenerationState`, `WizardCommunityPacksState`, `WizardComputeds`, `wizard-internal-state.ts`.

## Key Files

- `src/lib/components/wizard-view.component.ts:62` — container; license check (`'checking' | 'valid' | 'invalid'`), step routing, progress indicator.
- `src/lib/services/setup-wizard-state.service.ts:1` — orchestrator; composes the eight collaborators in `setup-wizard/`; exposes a façade to `WizardPhaseAnalysis`/`WizardPhaseGeneration` so they route flat events through `StreamRouter`/`StreamingSurfaceRegistry` (TASK_2026_107 Phase 3 — replaces deleted `WizardStreamAccumulator`). On analysis-complete, phase surfaces unregister but accumulated `StreamingState` remains visible.
- `src/lib/services/wizard-internal-state.provider.ts` — composition-root binding for `WIZARD_INTERNAL_STATE`.

## State Management / Architecture

- Signals + `computed`; collaborators decomposed by phase (analysis, generation, scan, community-packs, flow).
- Inverted-dependency via `WIZARD_INTERNAL_STATE` token so the composition root binds the internal-state map.
- Streaming runs through canonical pipeline (`@ptah-extension/chat-routing`).

## Dependencies

**Internal**: `@ptah-extension/core` (`VSCodeService`, `ClaudeRpcService`), `@ptah-extension/chat-types`, `@ptah-extension/chat-state`, `@ptah-extension/chat-routing`, `@ptah-extension/shared` (wizard DTOs).
**External**: `@angular/common`, `@angular/forms`.

## Angular Conventions Observed

Standalone, OnPush, signals + `inject()`, fade-in keyframe animations, decomposition of large state services into single-responsibility collaborators.

## Guidelines

- Premium gate is enforced in the container — never bypass it in individual step components.
- Stream accumulation must go through `StreamRouter` / `StreamingSurfaceRegistry` — do not reintroduce a hand-rolled accumulator (removed in TASK_2026_107 Phase 3).
- `WIZARD_INTERNAL_STATE` must be bound by the composition root via `provideWizardInternalState()`; never construct it ad-hoc.
- All wizard types originate from `setup-wizard-state.types.ts` (re-exported via barrel) or `@ptah-extension/shared`'s `wizard/` subfolder.
