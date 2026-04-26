import type {
  AnalysisCompletePayload,
  AnalysisStreamPayload,
  AvailableAgentsPayload,
  ScanProgressPayload,
} from '@ptah-extension/shared';
import type {
  AgentSelection,
  AnalysisResults,
} from '../setup-wizard-state.types';
import type { WizardInternalState } from './wizard-internal-state';
import type { WizardSurfaceFacade } from '../setup-wizard-state.service';

/**
 * WizardPhaseAnalysis — handlers for the scan + analysis lifecycle.
 *
 * Owns no signals. Translates scan/analysis/available-agents messages
 * into signal updates on the shared {@link WizardInternalState} and
 * forwards flat-events through {@link WizardSurfaceFacade} so they reach
 * the canonical streaming pipeline (TASK_2026_107 Phase 3).
 */
export class WizardPhaseAnalysis {
  public constructor(
    private readonly state: WizardInternalState,
    private readonly surfaces: WizardSurfaceFacade,
  ) {}

  /**
   * Handle scan progress updates (fileScanned counts + agentic phase fields).
   * Also derives generationProgress percent and extracts multi-phase fields
   * (TASK_2025_154).
   */
  public handleScanProgress(payload: ScanProgressPayload): void {
    this.state.scanProgress.set({
      filesScanned: payload.filesScanned,
      totalFiles: payload.totalFiles,
      detections: payload.detections,
      currentPhase: payload.currentPhase,
      phaseLabel: payload.phaseLabel,
      agentReasoning: payload.agentReasoning,
      completedPhases: payload.completedPhases,
    });

    this.state.generationProgress.set({
      phase: 'analysis',
      percentComplete:
        payload.totalFiles > 0
          ? Math.round((payload.filesScanned / payload.totalFiles) * 100)
          : 0,
      filesScanned: payload.filesScanned,
      totalFiles: payload.totalFiles,
      detections: payload.detections,
    });

    // TASK_2025_154: Extract multi-phase analysis progress fields
    if (payload.currentPhaseNumber !== undefined) {
      this.state.currentPhaseNumber.set(payload.currentPhaseNumber);
    }
    if (payload.totalPhaseCount !== undefined) {
      this.state.totalPhaseCount.set(payload.totalPhaseCount);
    }
    if (payload.phaseStatuses) {
      this.state.phaseStatuses.set(payload.phaseStatuses);
    }
  }

  /**
   * Handle analysis stream messages for live transcript display.
   * Appends each message to the flat accumulator (stats dashboard uses it)
   * and forwards flat events into the canonical streaming pipeline via the
   * surface façade. The phaseKey is `event.messageId` (matches the legacy
   * accumulator's keying — backend sets messageId to `wizard-phase-${N}`).
   */
  public handleAnalysisStream(payload: AnalysisStreamPayload): void {
    this.state.analysisStream.update((messages) => [...messages, payload]);
    if (payload.flatEvent) {
      // TASK_2026_107 Phase 3: route through StreamRouter instead of the
      // deleted WizardStreamAccumulator. The façade lazy-mints the surface
      // on first event for a given phaseKey, so wizard backends that don't
      // emit a discrete "phase start" continue to work.
      this.surfaces.routePhaseEvent(
        payload.flatEvent.messageId,
        payload.flatEvent,
      );
    }
  }

  /** Handle enhanced-prompts stream messages (live transcript only). */
  public handleEnhanceStream(payload: AnalysisStreamPayload): void {
    this.state.enhanceStream.update((msgs) => [...msgs, payload]);
  }

  /** Handle analysis completion — persists analysisResults + projectContext. */
  public handleAnalysisComplete(payload: AnalysisCompletePayload): void {
    const analysisResults: AnalysisResults = {
      projectContext: {
        type: payload.projectContext.type,
        techStack: payload.projectContext.techStack,
        architecture: payload.projectContext.architecture,
        isMonorepo: payload.projectContext.isMonorepo,
        monorepoType: payload.projectContext.monorepoType,
        packageCount: payload.projectContext.packageCount,
      },
    };

    this.state.analysisResults.set(analysisResults);
    this.state.projectContext.set(analysisResults.projectContext);
    this.state.setStepToAnalysis();

    // TASK_2026_107 Phase 3: tear down all analysis-phase routing bindings.
    // The accumulated StreamingStates remain visible in the public
    // `phaseStreamingStates` signal (so the transcript keeps rendering
    // completed phases), but the routing/registry state is cleaned up.
    this.surfaces.unregisterAllPhaseSurfaces();
  }

  /** Handle the list of available agents from the backend. */
  public handleAvailableAgents(payload: AvailableAgentsPayload): void {
    const agents: AgentSelection[] = payload.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      selected: agent.selected,
      score: agent.score,
      reason: agent.reason,
      autoInclude: agent.autoInclude,
    }));
    this.state.availableAgents.set(agents);
  }
}
