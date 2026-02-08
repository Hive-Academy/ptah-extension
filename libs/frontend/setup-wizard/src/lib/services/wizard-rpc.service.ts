import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  AgentRecommendation,
  EnhancedPromptsRunWizardResponse,
  EnhancedPromptsGetStatusResponse,
  ProjectAnalysisResult,
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
 * REFACTORED (TASK_2025_078): Removed duplicate RPC infrastructure.
 * Previously had its own pendingResponses map, setupMessageListener(), and
 * generateMessageId() which duplicated ClaudeRpcService's implementation.
 * Now delegates to ClaudeRpcService's unified RPC layer.
 *
 * Pattern: Facade pattern - provides wizard-specific API over unified RPC
 *
 * NOTE (TASK_2025_074): Backend RPC handlers for wizard operations are pending.
 * Currently only `setup-wizard:launch` is implemented in backend.
 * The following methods need backend handlers before they will work:
 * - startSetupWizard -> needs `wizard:start` RPC handler
 * - submitAgentSelection -> needs `wizard:submit-selection` RPC handler
 * - cancelWizard -> needs `wizard:cancel` RPC handler
 */
@Injectable({
  providedIn: 'root',
})
export class WizardRpcService {
  private readonly rpcService = inject(ClaudeRpcService);

  /**
   * Launch the setup wizard webview
   * This uses the existing `setup-wizard:launch` RPC handler
   */
  async launchWizard(): Promise<void> {
    const result = await this.rpcService.call('setup-wizard:launch', {});
    if (!result.success) {
      throw new Error(result.error || 'Failed to launch wizard');
    }
  }

  /**
   * Start the setup wizard (Step 1 -> Step 2 transition)
   * Triggers workspace scanning and agent detection
   *
   * TODO: Backend handler not implemented yet
   * When implemented, add 'wizard:start' to RpcMethodRegistry
   */
  async startSetupWizard(_workspaceUri: string): Promise<void> {
    // TODO: Implement when backend handler is ready
    // const result = await this.rpcService.call('wizard:start', { workspaceUri });
    console.warn(
      '[WizardRpcService] startSetupWizard: Backend handler not implemented'
    );
    throw new Error(
      'Setup wizard backend not fully implemented. Use launchWizard() instead.'
    );
  }

  /**
   * Submit agent selection (Step 4 -> Step 5 transition)
   * Triggers agent generation with selected agents
   *
   * Returns acknowledgment response to verify backend received the selection.
   * The caller should check response.success before transitioning to generation step.
   *
   * TODO: Backend handler not implemented yet
   * When implemented, add 'wizard:submit-selection' to RpcMethodRegistry
   */
  async submitAgentSelection(
    _selections: AgentSelection[]
  ): Promise<AgentSelectionResponse> {
    // TODO: Implement when backend handler is ready
    // const selectedIds = selections.filter((s) => s.selected).map((s) => s.id);
    // const result = await this.rpcService.call<{ agentIds: string[] }, AgentSelectionResponse>(
    //   'wizard:submit-selection',
    //   { agentIds: selectedIds },
    //   { timeout: 30000 }
    // );
    // if (result.success) {
    //   return result.data;
    // } else {
    //   throw new Error(result.error);
    // }
    console.warn(
      '[WizardRpcService] submitAgentSelection: Backend handler not implemented'
    );
    throw new Error('Agent selection submission not yet implemented');
  }

  /**
   * Cancel wizard (any step -> close)
   * Optionally saves progress for resuming later
   *
   * TODO: Backend handler not implemented yet
   * When implemented, add 'wizard:cancel' to RpcMethodRegistry
   */
  async cancelWizard(_saveProgress = true): Promise<void> {
    // TODO: Implement when backend handler is ready
    // const result = await this.rpcService.call('wizard:cancel', { saveProgress });
    console.warn(
      '[WizardRpcService] cancelWizard: Backend handler not implemented'
    );
    throw new Error('Wizard cancellation not yet implemented');
  }

  /**
   * Retry a failed generation item.
   * Triggers regeneration of a specific agent, command, or skill file.
   *
   * TODO: Backend handler not implemented yet
   * When implemented, add 'wizard:retry-item' to RpcMethodRegistry
   */
  async retryGenerationItem(_itemId: string): Promise<void> {
    // TODO: Implement when backend handler is ready
    // const result = await this.rpcService.call('wizard:retry-item', { itemId });
    console.warn(
      '[WizardRpcService] retryGenerationItem: Backend handler not implemented'
    );
    throw new Error('Retry generation item not yet implemented');
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
  async cancelAnalysis(): Promise<void> {
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
   * Returns comprehensive project analysis (architecture, key files, code health).
   */
  async deepAnalyze(): Promise<ProjectAnalysisResult> {
    const result = await this.rpcService.call(
      'wizard:deep-analyze',
      {},
      { timeout: 120000 }
    );
    if (result.isSuccess() && result.data) {
      return result.data as ProjectAnalysisResult;
    }
    throw new Error(result.error || 'Deep analysis failed');
  }

  /**
   * Get agent recommendations based on deep analysis results.
   * Calls wizard:recommend-agents backend handler (registered in RpcMethodRegistry).
   * Returns scored recommendations for all 13 agents.
   */
  async recommendAgents(
    analysis: ProjectAnalysisResult
  ): Promise<AgentRecommendation[]> {
    const result = await this.rpcService.call(
      'wizard:recommend-agents',
      analysis as unknown as Record<string, unknown>,
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
   * @returns Enhanced Prompts wizard response
   */
  async runEnhancedPromptsWizard(
    workspacePath: string
  ): Promise<EnhancedPromptsRunWizardResponse> {
    const result = await this.rpcService.call('enhancedPrompts:runWizard', {
      workspacePath,
    });

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
  async getEnhancedPromptsStatus(
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
}
