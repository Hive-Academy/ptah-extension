/**
 * Context RPC Handlers
 *
 * Handles context-related RPC methods: context:getAllFiles, context:getFileSuggestions
 * Uses ContextOrchestrationService for workspace file operations.
 *
 * TASK_2025_074: Extracted from monolithic RpcMethodRegistrationService
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import {
  ContextGetAllFilesParams,
  ContextGetFileSuggestionsParams,
} from '@ptah-extension/shared';
import type { RpcMethodName } from '@ptah-extension/shared';

interface ContextOrchestrationService {
  getAllFiles(params: ContextGetAllFilesParams): Promise<unknown>;
  getFileSuggestions(params: ContextGetFileSuggestionsParams): Promise<unknown>;
}

/**
 * RPC handlers for context operations
 */
@injectable()
export class ContextRpcHandlers {
  static readonly METHODS = [
    'context:getAllFiles',
    'context:getFileSuggestions',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.CONTEXT_ORCHESTRATION_SERVICE)
    private readonly contextOrchestration: ContextOrchestrationService,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  /**
   * Register all context RPC methods
   */
  register(): void {
    this.registerGetAllFiles();
    this.registerGetFileSuggestions();

    this.logger.debug('Context RPC handlers registered', {
      methods: ['context:getAllFiles', 'context:getFileSuggestions'],
    });
  }

  /**
   * context:getAllFiles - Get all files in workspace
   */
  private registerGetAllFiles(): void {
    this.rpcHandler.registerMethod<ContextGetAllFilesParams, unknown>(
      'context:getAllFiles',
      async (params) => {
        try {
          this.logger.debug('RPC: context:getAllFiles called', {
            includeImages: params?.includeImages,
            limit: params?.limit,
          });
          const result = await this.contextOrchestration.getAllFiles(params);
          return result;
        } catch (error) {
          this.logger.error(
            'RPC: context:getAllFiles failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'ContextRpcHandlers.registerGetAllFiles' },
          );
          throw new Error(
            `Failed to get all files: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      },
    );
  }

  /**
   * context:getFileSuggestions - Get file suggestions for autocomplete
   */
  private registerGetFileSuggestions(): void {
    this.rpcHandler.registerMethod<ContextGetFileSuggestionsParams, unknown>(
      'context:getFileSuggestions',
      async (params) => {
        try {
          this.logger.debug('RPC: context:getFileSuggestions called', {
            query: params?.query,
            limit: params?.limit,
          });
          const result =
            await this.contextOrchestration.getFileSuggestions(params);
          return result;
        } catch (error) {
          this.logger.error(
            'RPC: context:getFileSuggestions failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'ContextRpcHandlers.registerGetFileSuggestions' },
          );
          throw new Error(
            `Failed to get file suggestions: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      },
    );
  }
}
