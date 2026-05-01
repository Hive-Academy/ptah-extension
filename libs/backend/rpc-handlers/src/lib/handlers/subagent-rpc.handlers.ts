/**
 * Subagent RPC Handlers
 *
 * Handles subagent-related RPC methods: chat:subagent-query
 * Provides frontend access to query subagent state.
 *
 * TASK_2025_103: Subagent Resumption Feature (original implementation)
 * TASK_2025_109: Streamlined - removed resume RPC, now uses context injection
 *
 * RPC Methods:
 * - chat:subagent-query - Query subagents (resumable or by specific ID)
 *
 * NOTE: The chat:subagent-resume RPC has been removed (TASK_2025_109).
 * Subagent resumption is now handled via context injection in chat:continue,
 * allowing Claude to naturally resume interrupted agents through conversation.
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import {
  SubagentQueryParams,
  SubagentQueryResult,
} from '@ptah-extension/shared';
import type { RpcMethodName } from '@ptah-extension/shared';

/**
 * RPC handlers for subagent operations (query only)
 *
 * @example
 * ```typescript
 * // Frontend: Query all resumable subagents
 * const { subagents } = await rpcService.call('chat:subagent-query', {});
 * ```
 */
@injectable()
export class SubagentRpcHandlers {
  static readonly METHODS = [
    'chat:subagent-query',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly registry: SubagentRegistryService,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  /**
   * Register all subagent RPC methods
   */
  register(): void {
    this.registerSubagentQuery();

    this.logger.debug('Subagent RPC handlers registered', {
      methods: ['chat:subagent-query'],
    });
  }

  /**
   * subagent:query - Query subagents from the registry
   *
   * Supports three query modes:
   * 1. By toolCallId: Returns specific subagent record
   * 2. By sessionId: Returns resumable subagents for a specific session
   * 3. No params: Returns all resumable subagents
   *
   * @returns Array of matching SubagentRecord objects
   */
  private registerSubagentQuery(): void {
    this.rpcHandler.registerMethod<SubagentQueryParams, SubagentQueryResult>(
      'chat:subagent-query',
      async (params) => {
        try {
          const { toolCallId, sessionId } = params;

          this.logger.debug('RPC: subagent:query called', {
            toolCallId,
            sessionId,
          });

          // Query by specific toolCallId
          if (toolCallId) {
            const record = this.registry.get(toolCallId);
            return { subagents: record ? [record] : [] };
          }

          // Query by session ID (return only resumable for that session)
          if (sessionId) {
            const subagents = this.registry.getResumableBySession(sessionId);
            this.logger.debug('RPC: subagent:query by session result', {
              sessionId,
              count: subagents.length,
            });
            return { subagents };
          }

          // Return all resumable subagents
          const subagents = this.registry.getResumable();
          this.logger.debug('RPC: subagent:query all resumable result', {
            count: subagents.length,
          });
          return { subagents };
        } catch (error) {
          this.logger.error(
            'RPC: subagent:query failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'SubagentRpcHandlers.registerSubagentQuery' },
          );
          // Return empty array on error
          return { subagents: [] };
        }
      },
    );
  }
}
