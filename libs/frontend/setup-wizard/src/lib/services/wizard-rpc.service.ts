import { Injectable, inject } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { AgentSelection } from './setup-wizard-state.service';

/**
 * RPC message types for setup wizard communication
 * These match the message types defined in Batch 0 (RPC types)
 */

interface StartSetupWizardMessage {
  type: 'setup-wizard:start';
  workspaceUri: string;
}

interface SubmitAgentSelectionMessage {
  type: 'setup-wizard:submit-selection';
  selectedAgents: AgentSelection[];
}

interface CancelWizardMessage {
  type: 'setup-wizard:cancel';
  saveProgress: boolean;
}

/**
 * WizardRpcService
 *
 * Type-safe RPC message sending service for setup wizard.
 * Communicates with the VS Code extension backend via webview messaging.
 * Handles promise-based responses with timeout protection.
 *
 * Pattern: Follows libs/frontend/core VSCodeService RPC communication pattern
 * Integration: Uses VSCodeService.postMessage() for message sending
 */
@Injectable({
  providedIn: 'root',
})
export class WizardRpcService {
  private readonly vscodeService = inject(VSCodeService);
  private readonly DEFAULT_TIMEOUT_MS = 30000; // 30 seconds
  private readonly pendingResponses = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeoutId: ReturnType<typeof setTimeout>;
    }
  >();

  constructor() {
    this.setupMessageListener();
  }

  /**
   * Start the setup wizard (Step 1 → Step 2 transition)
   */
  async startSetupWizard(): Promise<void> {
    const message: StartSetupWizardMessage = {
      type: 'setup-wizard:start',
      workspaceUri: this.vscodeService.config().workspaceRoot,
    };

    await this.sendMessage<void>(message);
  }

  /**
   * Submit agent selection (Step 4 → Step 5 transition)
   */
  async submitAgentSelection(selections: AgentSelection[]): Promise<void> {
    const message: SubmitAgentSelectionMessage = {
      type: 'setup-wizard:submit-selection',
      selectedAgents: selections,
    };

    await this.sendMessage<void>(message);
  }

  /**
   * Cancel wizard (any step → close)
   */
  async cancelWizard(saveProgress = true): Promise<void> {
    const message: CancelWizardMessage = {
      type: 'setup-wizard:cancel',
      saveProgress,
    };

    await this.sendMessage<void>(message);
  }

  /**
   * Generic message sender with promise-based response handling and timeout
   *
   * Pattern: Promise-based RPC with timeout protection
   * Error Handling: Rejects on timeout or RPC error
   */
  private async sendMessage<T>(message: object & { type: string }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const messageId = this.generateMessageId();
      const messageWithId = { ...message, messageId };

      // Setup timeout
      const timeoutId = setTimeout(() => {
        this.pendingResponses.delete(messageId);
        reject(
          new Error(
            `RPC timeout after ${this.DEFAULT_TIMEOUT_MS}ms: ${message.type}`
          )
        );
      }, this.DEFAULT_TIMEOUT_MS);

      // Store promise callbacks
      this.pendingResponses.set(messageId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
      });

      // Send message via VSCodeService with error handling
      try {
        this.vscodeService.postMessage(messageWithId);
      } catch (error) {
        // Clean up on send failure
        this.pendingResponses.delete(messageId);
        clearTimeout(timeoutId);
        reject(
          new Error(
            `Failed to send RPC message: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        );
      }
    });
  }

  /**
   * Setup listener for RPC responses from extension backend
   */
  private setupMessageListener(): void {
    window.addEventListener('message', (event) => {
      const message = event.data;

      // Handle RPC responses
      if (message.type === 'rpc:response' && message.messageId) {
        const pending = this.pendingResponses.get(message.messageId);
        if (pending) {
          clearTimeout(pending.timeoutId);
          this.pendingResponses.delete(message.messageId);

          if (message.error) {
            pending.reject(new Error(message.error));
          } else {
            pending.resolve(message.payload);
          }
        }
      }

      // Note: Progress and event messages are handled by SetupWizardStateService
      // via direct subscription to VSCodeService message events
    });
  }

  /**
   * Generate unique message ID for request/response correlation
   */
  private generateMessageId(): string {
    return `wizard-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
