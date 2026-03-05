import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService, ModelStateService } from '@ptah-extension/core';
import type {
  AgentRecommendation,
  EnhancedPromptsRunWizardResponse,
  EnhancedPromptsGetStatusResponse,
  MultiPhaseAnalysisResponse,
  SavedAnalysisMetadata,
} from '@ptah-extension/shared';
import { AgentSelection } from './setup-wizard-state.service';

/**
 * Agent selection acknowledgment response from backend.
 */
export interface AgentSelectionResponse {
  /** Whether the selection was successfully received and processed */
  success: boolean;
  /** Error message if the selection failed */
  error?: string;
}

/**
 * WizardRpcService
 *
 * Thin facade for wizard-specific RPC calls.
 * Delegates to ClaudeRpcService for actual RPC communication.
 *
 * Pattern: Facade pattern - provides wizard-specific API over unified RPC
 *
 * Supported RPC methods:
 * - setup-wizard:launch - Launch the wizard webview
 * - wizard:submit-selection - Submit agent selection and trigger generation
 * - wizard:cancel - Cancel the wizard session
 * - wizard:retry-item - Retry a failed generation item
 * - wizard:cancel-analysis - Cancel a running analysis
 * - wizard:deep-analyze - Deep workspace analysis
 * - wizard:recommend-agents - Get agent recommendations
 * - enhancedPrompts:runWizard - Run Enhanced Prompts wizard
 * - enhancedPrompts:getStatus - Get Enhanced Prompts status
 * - enhancedPrompts:toggle - Toggle enhanced prompts on/off
 * - enhancedPrompts:regenerate - Force regenerate enhanced prompts
 * - enhancedPrompts:getPromptContent - Get generated prompt content
 * - enhancedPrompts:download - Download prompt as .md file
 */
@Injectable({
  providedIn: 'root',
})
export class WizardRpcService {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly modelState = inject(ModelStateService);

  /**
   * Launch the setup wizard webview
   * This uses the existing `setup-wizard:launch` RPC handler
   */
  public async launchWizard(): Promise<void> {
    const result = await this.rpcService.call('setup-wizard:launch', {});
    if (!result.success) {
      throw new Error(result.error || 'Failed to launch wizard');
    }
  }

  /**
   * Submit agent selection (Step 4 -> Step 5 transition).
   * Triggers agent generation with selected agents.
   *
   * Returns acknowledgment response to verify backend received the selection.
   * The caller should check response.success before transitioning to generation step.
   *
   * Uses a 5-minute timeout since agent generation is a long-running operation.
   *
   * @param selections - Agent selections from the wizard
   * @param analysisDir - Multi-phase analysis directory path
   */
  public async submitAgentSelection(
    selections: AgentSelection[],
    analysisDir?: string
  ): Promise<AgentSelectionResponse> {
    const selectedIds = selections.filter((s) => s.selected).map((s) => s.id);
    const result = await this.rpcService.call(
      'wizard:submit-selection',
      {
        selectedAgentIds: selectedIds,
        analysisDir,
        model: this.modelState.currentModel() || undefined,
      },
      { timeout: 300_000 }
    );

    if (result.isSuccess()) {
      return (result.data as AgentSelectionResponse) ?? { success: true };
    }
    throw new Error(result.error || 'Failed to submit agent selection');
  }

  /**
   * Cancel wizard (any step -> close).
   * Optionally saves progress for resuming later.
   *
   * Safe to call even if no active session exists (backend handles gracefully).
   */
  public async cancelWizard(saveProgress = true): Promise<void> {
    const result = await this.rpcService.call('wizard:cancel', {
      saveProgress,
    });
    if (!result.isSuccess()) {
      console.warn('[WizardRpcService] cancelWizard failed:', result.error);
    }
  }

  /**
   * Retry a failed generation item.
   * Triggers regeneration of a specific agent.
   *
   * @param itemId - Identifier of the generation item to retry
   */
  public async retryGenerationItem(itemId: string): Promise<void> {
    const result = await this.rpcService.call('wizard:retry-item', { itemId });
    if (!result.isSuccess()) {
      throw new Error(result.error || 'Failed to retry generation item');
    }
  }

  // === Analysis Cancellation (TASK_2025_145 SERIOUS-6) ===

  /**
   * Cancel a running agentic workspace analysis.
   *
   * Sends the `wizard:cancel-analysis` RPC call to the backend, which aborts
   * the active AbortController in AgenticAnalysisService. This terminates the
   * SDK query stream, preventing further token usage after the user clicks
   * "Cancel Scan" in the frontend.
   *
   * Safe to call even if no analysis is running (backend handles gracefully).
   */
  public async cancelAnalysis(): Promise<void> {
    try {
      await this.rpcService.call('wizard:cancel-analysis', {});
    } catch (error) {
      // Log but don't throw -- cancel is best-effort.
      // The analysis may have already completed or the service may be unavailable.
      console.warn(
        '[WizardRpcService] cancelAnalysis failed:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  // === Deep Analysis Methods (TASK_2025_111) ===

  /**
   * Deep analyze the workspace project structure.
   * Calls wizard:deep-analyze backend handler (registered in RpcMethodRegistry).
   *
   * Returns MultiPhaseAnalysisResponse (premium + MCP required).
   */
  public async deepAnalyze(): Promise<MultiPhaseAnalysisResponse> {
    const result = await this.rpcService.call(
      'wizard:deep-analyze',
      { model: this.modelState.currentModel() || undefined },
      { timeout: 3_660_000 } // 1 hour + 1 minute buffer
    );
    if (result.isSuccess() && result.data) {
      return result.data as MultiPhaseAnalysisResponse;
    }
    throw new Error(result.error || 'Deep analysis failed');
  }

  /**
   * Get agent recommendations based on analysis results.
   * Calls wizard:recommend-agents backend handler (registered in RpcMethodRegistry).
   *
   * Passes { isMultiPhase: true } to trigger all-agents-recommended path.
   */
  public async recommendAgents(
    analysis: MultiPhaseAnalysisResponse
  ): Promise<AgentRecommendation[]> {
    const payload = { isMultiPhase: true, analysisDir: analysis.analysisDir };

    const result = await this.rpcService.call(
      'wizard:recommend-agents',
      payload,
      { timeout: 60000 }
    );
    if (result.isSuccess() && result.data) {
      return result.data as AgentRecommendation[];
    }
    throw new Error(result.error || 'Agent recommendation failed');
  }

  // === Enhanced Prompts Methods ===

  /**
   * Run Enhanced Prompts wizard to generate project-specific prompt guidance.
   * Uses the existing enhancedPrompts:runWizard RPC handler.
   *
   * @param workspacePath - Workspace path to analyze
   * @param analysisDir - Multi-phase analysis directory path (optional)
   * @returns Enhanced Prompts wizard response
   */
  public async runEnhancedPromptsWizard(
    workspacePath: string,
    analysisDir?: string
  ): Promise<EnhancedPromptsRunWizardResponse> {
    const result = await this.rpcService.call(
      'enhancedPrompts:runWizard',
      {
        workspacePath,
        ...(analysisDir ? { analysisDir } : {}),
        model: this.modelState.currentModel() || undefined,
      },
      { timeout: 300_000 } // 5 minutes: LLM generation via SDK
    );

    if (result.isSuccess() && result.data) {
      return result.data as EnhancedPromptsRunWizardResponse;
    }

    return {
      success: false,
      error: result.error || 'Failed to run Enhanced Prompts wizard',
    };
  }

  /**
   * Get Enhanced Prompts status for a workspace.
   * Uses the existing enhancedPrompts:getStatus RPC handler.
   *
   * @param workspacePath - Workspace path to check
   * @returns Enhanced Prompts status response
   */
  public async getEnhancedPromptsStatus(
    workspacePath: string
  ): Promise<EnhancedPromptsGetStatusResponse> {
    const result = await this.rpcService.call('enhancedPrompts:getStatus', {
      workspacePath,
    });

    if (result.isSuccess() && result.data) {
      return result.data as EnhancedPromptsGetStatusResponse;
    }

    return {
      enabled: false,
      hasGeneratedPrompt: false,
      generatedAt: null,
      detectedStack: null,
      cacheValid: false,
      error: result.error || 'Failed to get Enhanced Prompts status',
    };
  }

  // === Enhanced Prompts Settings Methods (TASK_2025_149 Batch 5) ===

  /**
   * Toggle enhanced prompts on or off for a workspace.
   * Calls the enhancedPrompts:setEnabled RPC handler.
   *
   * @param workspacePath - Workspace path to toggle for
   * @param enabled - Whether to enable or disable enhanced prompts
   */
  public async toggleEnhancedPrompts(
    workspacePath: string,
    enabled: boolean
  ): Promise<void> {
    const result = await this.rpcService.call('enhancedPrompts:setEnabled', {
      workspacePath,
      enabled,
    });

    if (!result.isSuccess()) {
      throw new Error(result.error || 'Failed to toggle enhanced prompts');
    }
  }

  /**
   * Regenerate enhanced prompts for a workspace.
   * Calls the enhancedPrompts:regenerate RPC handler.
   * Uses a 5-minute timeout since regeneration is a long-running operation.
   *
   * @param workspacePath - Workspace path to regenerate for
   * @returns Regeneration response with success status
   */
  public async regenerateEnhancedPrompts(
    workspacePath: string
  ): Promise<EnhancedPromptsRunWizardResponse> {
    const result = await this.rpcService.call(
      'enhancedPrompts:regenerate',
      { workspacePath, force: true },
      { timeout: 300_000 }
    );

    if (result.isSuccess() && result.data) {
      return result.data as EnhancedPromptsRunWizardResponse;
    }

    return {
      success: false,
      error: result.error || 'Failed to regenerate enhanced prompts',
    };
  }

  /**
   * Get the generated enhanced prompt content for a workspace.
   * Returns the full prompt text for preview, or null if not available.
   *
   * @param workspacePath - Workspace path to get content for
   * @returns The prompt content string, or null if no prompt exists
   */
  public async getEnhancedPromptContent(
    workspacePath: string
  ): Promise<string | null> {
    const result = await this.rpcService.call(
      'enhancedPrompts:getPromptContent',
      { workspacePath }
    );

    if (result.isSuccess() && result.data) {
      return (result.data as { content: string | null }).content;
    }

    return null;
  }

  /**
   * Download the generated enhanced prompt as a .md file.
   * Opens a native VS Code save dialog and writes the prompt content.
   *
   * @param workspacePath - Workspace path to download prompt for
   * @returns Download result with success status and optional file path
   */
  public async downloadEnhancedPrompt(
    workspacePath: string
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    const result = await this.rpcService.call('enhancedPrompts:download', {
      workspacePath,
    });

    if (result.isSuccess() && result.data) {
      return result.data as {
        success: boolean;
        filePath?: string;
        error?: string;
      };
    }

    return {
      success: false,
      error: result.error || 'Failed to download enhanced prompt',
    };
  }

  // === Analysis History Methods (Persistent Analysis) ===

  /**
   * List all saved analyses from .claude/analysis/ directory.
   * Returns metadata only (lightweight, for listing cards).
   *
   * @returns Array of saved analysis metadata sorted by date (newest first)
   */
  public async listAnalyses(): Promise<SavedAnalysisMetadata[]> {
    const result = await this.rpcService.call(
      'wizard:list-analyses',
      {},
      { timeout: 10_000 }
    );

    if (result.isSuccess() && result.data) {
      return (result.data as { analyses: SavedAnalysisMetadata[] }).analyses;
    }

    return [];
  }

  /**
   * Load a specific saved analysis by slug directory name.
   * Returns the full multi-phase analysis response.
   *
   * @param filename - Slug directory name from .claude/analysis/
   * @returns Multi-phase analysis response with manifest and phase contents
   */
  public async loadAnalysis(filename: string): Promise<MultiPhaseAnalysisResponse> {
    const result = await this.rpcService.call(
      'wizard:load-analysis',
      { filename },
      { timeout: 10_000 }
    );

    if (result.isSuccess() && result.data) {
      return result.data as MultiPhaseAnalysisResponse;
    }

    throw new Error(result.error || 'Failed to load analysis');
  }
}
