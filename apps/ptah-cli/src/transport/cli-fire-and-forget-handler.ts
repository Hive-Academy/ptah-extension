/**
 * CLI Fire-and-Forget Handler
 *
 * TASK_2025_263 Batch 3
 *
 * Handles fire-and-forget messages from the TUI (permission responses, question answers).
 * Replaces IpcBridge.handleFireAndForgetMessage() (ipc-bridge.ts:215-301).
 *
 * In Electron, these flow through IPC channels. In CLI, they are direct
 * function calls from CLI components (PermissionPrompt, UserQuestionPrompt).
 */

import type { DependencyContainer } from 'tsyringe';
import type { ISdkPermissionHandler } from '@ptah-extension/shared';

const SDK_PERMISSION_HANDLER = Symbol.for('SdkPermissionHandler');

export class CliFireAndForgetHandler {
  constructor(private readonly container: DependencyContainer) {}

  /**
   * Handle a permission decision from the TUI.
   * Called when user presses Y/N on a PermissionPrompt component.
   *
   * MUST check container.isRegistered() before resolving --
   * the SDK permission handler may not be initialized yet
   * (e.g., if no API key is configured).
   */
  handlePermissionResponse(response: {
    id: string;
    decision: 'allow' | 'deny' | 'deny_with_message' | 'always_allow';
    reason?: string;
    modifiedInput?: Record<string, unknown>;
  }): void {
    if (!this.container.isRegistered(SDK_PERMISSION_HANDLER)) {
      return;
    }

    try {
      const handler = this.container.resolve<ISdkPermissionHandler>(
        SDK_PERMISSION_HANDLER,
      );
      handler.handleResponse(response.id, response);
    } catch (error) {
      console.error(
        '[CliFireAndForget] Failed to process SDK permission response',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Handle a user question answer from the TUI.
   * Called when user submits answers on a UserQuestionPrompt component.
   *
   * MUST check container.isRegistered() before resolving --
   * same guard as handlePermissionResponse().
   */
  handleQuestionResponse(response: {
    id: string;
    answers: Record<string, string>;
  }): void {
    if (!this.container.isRegistered(SDK_PERMISSION_HANDLER)) {
      return;
    }

    try {
      const handler = this.container.resolve<ISdkPermissionHandler>(
        SDK_PERMISSION_HANDLER,
      );
      handler.handleQuestionResponse(response);
    } catch (error) {
      console.error(
        '[CliFireAndForget] Failed to process AskUserQuestion response',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
