import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { EventBus } from '@ptah-extension/vscode-core';
import type { ContextOrchestrationService } from '@ptah-extension/workspace-intelligence';
import {
  CONTEXT_MESSAGE_TYPES,
  type ContextIncludeFilePayload,
  type ContextExcludeFilePayload,
  type CorrelationId,
} from '@ptah-extension/shared';

/**
 * Architectural bridge service that handles context-related EventBus messages.
 *
 * **Purpose**: Enable file include/exclude functionality while maintaining clean
 * separation of concerns. This service exists in the main app layer where it can
 * safely import VS Code modules, unlike MessageHandlerService which is in the
 * claude-domain library.
 *
 * **Architecture**:
 * - Subscribes to INCLUDE_FILE and EXCLUDE_FILE messages from EventBus
 * - Converts filePath strings to vscode.Uri objects
 * - Delegates to contextOrchestration service (workspace-intelligence)
 * - Publishes response events back through EventBus
 *
 * **Why Bridge Pattern?**
 * - MessageHandlerService (claude-domain) can't depend on vscode module
 * - ContextOrchestrationService requires vscode.Uri objects
 * - EventBus messages contain string file paths
 * - Bridge converts between these layers without violating boundaries
 *
 * @see {@link https://en.wikipedia.org/wiki/Bridge_pattern Bridge Pattern}
 */
@injectable()
export class ContextMessageBridgeService {
  constructor(
    @inject(TOKENS.EVENT_BUS) private readonly eventBus: EventBus,
    @inject(TOKENS.CONTEXT_ORCHESTRATION_SERVICE)
    private readonly contextOrchestration: ContextOrchestrationService,
    @inject(TOKENS.LOGGER) private readonly logger: any
  ) {}

  /**
   * Initialize bridge by subscribing to context messages.
   * Called during extension activation.
   */
  initialize(): void {
    this.subscribeToIncludeFile();
    this.subscribeToExcludeFile();
    this.logger.info('ContextMessageBridge initialized');
  }

  /**
   * Handle INCLUDE_FILE messages.
   * Converts filePath string to vscode.Uri and delegates to contextOrchestration.
   */
  private subscribeToIncludeFile(): void {
    this.eventBus.subscribe(CONTEXT_MESSAGE_TYPES.INCLUDE_FILE).subscribe({
      next: async (event) => {
        try {
          const payload = event.payload as ContextIncludeFilePayload;
          const { filePath } = payload;
          const correlationId = event.correlationId;

          this.logger.info(
            `[ContextMessageBridge] Processing INCLUDE_FILE: ${filePath}`
          );

          // Convert string path to vscode.Uri
          const uri = vscode.Uri.file(filePath);

          // Delegate to workspace-intelligence service
          // Note: contextOrchestration.includeFile expects (request, uri)
          const result = await this.contextOrchestration.includeFile(
            {
              requestId: correlationId,
              filePath,
            },
            uri
          );

          if (result.success) {
            this.logger.info(
              `[ContextMessageBridge] Successfully included file: ${filePath}`
            );
          } else {
            this.logger.error(
              `[ContextMessageBridge] Failed to include file: ${result.error?.message}`
            );
          }

          // Publish response event (no dedicated FILE_INCLUDED event in message-types.ts)
          // EventBus will handle request-response correlation
        } catch (error) {
          this.logger.error('[ContextMessageBridge] Failed to include file', {
            error,
            filePath: (event.payload as ContextIncludeFilePayload).filePath,
          });
        }
      },
    });
  }

  /**
   * Handle EXCLUDE_FILE messages.
   * Converts filePath string to vscode.Uri and delegates to contextOrchestration.
   */
  private subscribeToExcludeFile(): void {
    this.eventBus.subscribe(CONTEXT_MESSAGE_TYPES.EXCLUDE_FILE).subscribe({
      next: async (event) => {
        try {
          const payload = event.payload as ContextExcludeFilePayload;
          const { filePath } = payload;
          const correlationId = event.correlationId;

          this.logger.info(
            `[ContextMessageBridge] Processing EXCLUDE_FILE: ${filePath}`
          );

          // Convert string path to vscode.Uri
          const uri = vscode.Uri.file(filePath);

          // Delegate to workspace-intelligence service
          // Note: contextOrchestration.excludeFile expects (request, uri)
          const result = await this.contextOrchestration.excludeFile(
            {
              requestId: correlationId,
              filePath,
            },
            uri
          );

          if (result.success) {
            this.logger.info(
              `[ContextMessageBridge] Successfully excluded file: ${filePath}`
            );
          } else {
            this.logger.error(
              `[ContextMessageBridge] Failed to exclude file: ${result.error?.message}`
            );
          }

          // Publish response event (no dedicated FILE_EXCLUDED event in message-types.ts)
          // EventBus will handle request-response correlation
        } catch (error) {
          this.logger.error('[ContextMessageBridge] Failed to exclude file', {
            error,
            filePath: (event.payload as ContextExcludeFilePayload).filePath,
          });
        }
      },
    });
  }

  /**
   * Cleanup subscriptions on extension deactivation.
   */
  dispose(): void {
    // Subscriptions auto-cleanup via EventBus
    this.logger.info('ContextMessageBridge disposed');
  }
}
