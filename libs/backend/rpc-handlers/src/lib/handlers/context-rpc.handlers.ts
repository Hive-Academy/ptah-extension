/**
 * Context RPC Handlers
 *
 * Handles context-related RPC methods: context:getAllFiles, context:getFileSuggestions.
 * Uses ContextOrchestrationService for workspace file operations.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import {
  ContextGetAllFilesParams,
  ContextGetFileSuggestionsParams,
} from '@ptah-extension/shared';
import type { RpcMethodName } from '@ptah-extension/shared';
import {
  parseContextGetAllFilesParams,
  parseContextGetFileSuggestionsParams,
} from './context-rpc.schema';

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
        // Validate BEFORE the try: a malformed payload is a caller fault, not
        // an orchestration failure, so it must not be wrapped as one or shipped
        // to Sentry as a backend error.
        const parsed = parseContextGetAllFilesParams(params);
        if (!parsed) {
          throw new Error(
            'Invalid context:getAllFiles parameters: expected optional ' +
              'includeImages (boolean), limit (non-negative integer) and ' +
              'workspaceRoot (non-empty absolute path).',
          );
        }
        try {
          this.logger.debug('RPC: context:getAllFiles called', {
            includeImages: parsed.includeImages,
            limit: parsed.limit,
            // Which workspace answered is the whole point of TASK_2026_200 —
            // log it so a wrong-workspace report is diagnosable from the log
            // alone. `undefined` here means "process-global active folder".
            workspaceRoot: parsed.workspaceRoot,
          });
          const result = await this.contextOrchestration.getAllFiles(parsed);
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
        // Validate BEFORE the try — see registerGetAllFiles.
        const parsed = parseContextGetFileSuggestionsParams(params);
        if (!parsed) {
          throw new Error(
            'Invalid context:getFileSuggestions parameters: expected ' +
              'optional query (string), limit (non-negative integer) and ' +
              'workspaceRoot (non-empty absolute path).',
          );
        }
        try {
          this.logger.debug('RPC: context:getFileSuggestions called', {
            query: parsed.query,
            limit: parsed.limit,
            workspaceRoot: parsed.workspaceRoot,
          });
          const result =
            await this.contextOrchestration.getFileSuggestions(parsed);
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
