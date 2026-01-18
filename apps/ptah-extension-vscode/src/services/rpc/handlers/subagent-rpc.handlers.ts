/**
 * Subagent RPC Handlers
 *
 * Handles subagent-related RPC methods: subagent:resume, subagent:query
 * Provides frontend access to subagent resumption functionality.
 *
 * TASK_2025_103: Subagent Resumption Feature
 *
 * RPC Methods:
 * - subagent:resume - Resume an interrupted subagent by toolCallId
 * - subagent:query - Query subagents (resumable or by specific ID)
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { SdkAgentAdapter } from '@ptah-extension/agent-sdk';
import {
  SubagentResumeParams,
  SubagentResumeResult,
  SubagentQueryParams,
  SubagentQueryResult,
} from '@ptah-extension/shared';

/**
 * RPC handlers for subagent operations (resumption and query)
 *
 * @example
 * ```typescript
 * // Frontend: Resume an interrupted subagent
 * const result = await rpcService.call('subagent:resume', { toolCallId: 'toolu_abc123' });
 *
 * // Frontend: Query all resumable subagents
 * const { subagents } = await rpcService.call('subagent:query', {});
 * ```
 */
@injectable()
export class SubagentRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly registry: SubagentRegistryService,
    @inject('SdkAgentAdapter') private readonly sdkAdapter: SdkAgentAdapter
  ) {}

  /**
   * Register all subagent RPC methods
   */
  register(): void {
    this.registerSubagentResume();
    this.registerSubagentQuery();

    this.logger.debug('Subagent RPC handlers registered', {
      methods: ['subagent:resume', 'subagent:query'],
    });
  }

  /**
   * subagent:resume - Resume an interrupted subagent
   *
   * Looks up the subagent record by toolCallId and initiates
   * SDK resumption if the subagent is in 'interrupted' status.
   *
   * @returns Success if resume initiated, error if subagent not found or not resumable
   */
  private registerSubagentResume(): void {
    this.rpcHandler.registerMethod<SubagentResumeParams, SubagentResumeResult>(
      'subagent:resume',
      async (params) => {
        try {
          const { toolCallId } = params;

          this.logger.info('RPC: subagent:resume called', { toolCallId });

          // Look up the subagent record
          const record = this.registry.get(toolCallId);

          if (!record) {
            this.logger.warn(
              'RPC: subagent:resume failed - subagent not found',
              { toolCallId }
            );
            return {
              success: false,
              error: 'Subagent not found or expired',
            };
          }

          if (record.status !== 'interrupted') {
            this.logger.warn(
              'RPC: subagent:resume failed - subagent not resumable',
              {
                toolCallId,
                status: record.status,
              }
            );
            return {
              success: false,
              error: `Subagent is not resumable (status: ${record.status})`,
            };
          }

          // Resume the subagent via SDK adapter
          this.logger.info('RPC: subagent:resume initiating SDK resume', {
            toolCallId,
            sessionId: record.sessionId,
            agentType: record.agentType,
            parentSessionId: record.parentSessionId,
          });

          // Call the SDK adapter to resume the subagent
          // This returns a streaming response that will be handled separately
          await this.sdkAdapter.resumeSubagent(record);

          // Remove from registry to prevent double-resume
          this.registry.remove(toolCallId);

          this.logger.info('RPC: subagent:resume successful', {
            toolCallId,
            sessionId: record.sessionId,
          });

          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: subagent:resume failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    );
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
      'subagent:query',
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
            error instanceof Error ? error : new Error(String(error))
          );
          // Return empty array on error
          return { subagents: [] };
        }
      }
    );
  }
}
