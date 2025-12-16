import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import { AgentSelection } from './setup-wizard-state.service';

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
 * - startSetupWizard → needs `wizard:start` RPC handler
 * - submitAgentSelection → needs `wizard:submit-selection` RPC handler
 * - cancelWizard → needs `wizard:cancel` RPC handler
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
   * Start the setup wizard (Step 1 → Step 2 transition)
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
   * Submit agent selection (Step 4 → Step 5 transition)
   * Triggers agent generation with selected agents
   *
   * TODO: Backend handler not implemented yet
   * When implemented, add 'wizard:submit-selection' to RpcMethodRegistry
   */
  async submitAgentSelection(_selections: AgentSelection[]): Promise<void> {
    // TODO: Implement when backend handler is ready
    // const selectedIds = selections.filter((s) => s.selected).map((s) => s.id);
    // const result = await this.rpcService.call('wizard:submit-selection', { agentIds: selectedIds });
    console.warn(
      '[WizardRpcService] submitAgentSelection: Backend handler not implemented'
    );
    throw new Error('Agent selection submission not yet implemented');
  }

  /**
   * Cancel wizard (any step → close)
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
}
