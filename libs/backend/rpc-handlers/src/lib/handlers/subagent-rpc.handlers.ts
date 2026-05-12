/**
 * Subagent RPC Handlers
 *
 * Handles subagent-related RPC methods.
 *
 * TASK_2025_103: Subagent Resumption Feature (original implementation)
 * TASK_2025_109: Streamlined - removed resume RPC, now uses context injection
 * Phase 2: Added bidirectional messaging + stop/interrupt methods
 *
 * RPC Methods:
 * - chat:subagent-query    — Query subagents (resumable or by specific ID)
 * - subagent:send-message  — Push a user message into a running subagent
 * - subagent:stop          — Stop a specific subagent by taskId
 * - subagent:interrupt     — Interrupt the entire session
 *
 * NOTE: The chat:subagent-resume RPC has been removed (TASK_2025_109).
 * Subagent resumption is now handled via context injection in chat:continue,
 * allowing Claude to naturally resume interrupted agents through conversation.
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  RpcUserError,
  TOKENS,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import {
  SubagentQueryParams,
  SubagentQueryResult,
  SubagentSendMessageParams,
  SubagentStopParams,
  SubagentInterruptParams,
  SubagentCommandResult,
} from '@ptah-extension/shared';
import type { RpcMethodName } from '@ptah-extension/shared';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { SubagentMessageDispatcher } from '@ptah-extension/agent-sdk';
import {
  SubagentSendMessageSchema,
  SubagentStopSchema,
  SubagentInterruptSchema,
} from './subagent-rpc.schema';

/**
 * RPC handlers for subagent operations
 *
 * @example
 * ```typescript
 * // Frontend: Query all resumable subagents
 * const { subagents } = await rpcService.call('chat:subagent-query', {});
 *
 * // Frontend: Send message to subagent
 * await rpcService.call('subagent:send-message', { sessionId, parentToolUseId, text: 'hello' });
 *
 * // Frontend: Stop a specific subagent
 * await rpcService.call('subagent:stop', { sessionId, taskId });
 *
 * // Frontend: Interrupt the whole session
 * await rpcService.call('subagent:interrupt', { sessionId });
 * ```
 */
@injectable()
export class SubagentRpcHandlers {
  static readonly METHODS = [
    'chat:subagent-query',
    'subagent:send-message',
    'subagent:stop',
    'subagent:interrupt',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly registry: SubagentRegistryService,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(SDK_TOKENS.SDK_SUBAGENT_MESSAGE_DISPATCHER)
    private readonly dispatcher: SubagentMessageDispatcher,
  ) {}

  /**
   * Register all subagent RPC methods
   */
  register(): void {
    this.registerSubagentQuery();
    this.registerSendMessage();
    this.registerStop();
    this.registerInterrupt();

    this.logger.debug('Subagent RPC handlers registered', {
      methods: SubagentRpcHandlers.METHODS,
    });
  }

  /**
   * chat:subagent-query - Query subagents from the registry
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

  /**
   * subagent:send-message — Push a user message into a running subagent.
   *
   * Uses the SDK's streamInput channel with parent_tool_use_id set so the
   * message is routed to the correct subagent rather than the root coordinator.
   */
  private registerSendMessage(): void {
    this.rpcHandler.registerMethod<
      SubagentSendMessageParams,
      SubagentCommandResult
    >('subagent:send-message', async (params) => {
      const parsed = SubagentSendMessageSchema.safeParse(params);
      if (!parsed.success) {
        throw new RpcUserError(
          `subagent:send-message: invalid params — ${parsed.error.message}`,
          'INVALID_PARAMS',
        );
      }

      const { sessionId, parentToolUseId, text } = parsed.data;

      this.logger.debug('RPC: subagent:send-message called', {
        sessionId,
        parentToolUseId,
        textLength: text.length,
      });

      await this.dispatcher.sendToSubagent(sessionId, parentToolUseId, text);
      return { ok: true };
    });
  }

  /**
   * subagent:stop — Gracefully stop a specific subagent.
   *
   * Calls Query.stopTask(taskId). The SDK writes the subagent's output to
   * its output_file and emits a task_notification with status='stopped'.
   */
  private registerStop(): void {
    this.rpcHandler.registerMethod<SubagentStopParams, SubagentCommandResult>(
      'subagent:stop',
      async (params) => {
        const parsed = SubagentStopSchema.safeParse(params);
        if (!parsed.success) {
          throw new RpcUserError(
            `subagent:stop: invalid params — ${parsed.error.message}`,
            'INVALID_PARAMS',
          );
        }

        const { sessionId, taskId } = parsed.data;

        this.logger.debug('RPC: subagent:stop called', { sessionId, taskId });

        await this.dispatcher.stopSubagent(sessionId, taskId);
        return { ok: true };
      },
    );
  }

  /**
   * subagent:interrupt — Interrupt the entire session, stopping all subagents.
   */
  private registerInterrupt(): void {
    this.rpcHandler.registerMethod<
      SubagentInterruptParams,
      SubagentCommandResult
    >('subagent:interrupt', async (params) => {
      const parsed = SubagentInterruptSchema.safeParse(params);
      if (!parsed.success) {
        throw new RpcUserError(
          `subagent:interrupt: invalid params — ${parsed.error.message}`,
          'INVALID_PARAMS',
        );
      }

      const { sessionId } = parsed.data;

      this.logger.debug('RPC: subagent:interrupt called', { sessionId });

      await this.dispatcher.interruptSession(sessionId);
      return { ok: true };
    });
  }
}
