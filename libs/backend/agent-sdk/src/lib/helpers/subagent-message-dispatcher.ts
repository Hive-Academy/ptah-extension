/**
 * SubagentMessageDispatcher — bidirectional messaging for running subagents
 *
 * Phase 2 addition. Provides three operations:
 *   - `sendToSubagent` — push a user message into a running subagent via
 *     the session's streamInput channel, scoped by parentToolUseId.
 *   - `stopSubagent` — call Query.stopTask(taskId) to gracefully stop a
 *     running subagent and write its output file.
 *   - `interruptSession` — call Query.interrupt() to abort the entire
 *     session, stopping all subagents.
 *
 * All three surface typed errors when the session is not active, ensuring
 * the RPC boundary receives a clear, handleable error rather than an
 * untyped throw.
 *
 * @see libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts
 */

import { injectable, inject } from 'tsyringe';
import { randomUUID } from 'crypto';
import {
  Logger,
  TOKENS,
  RpcUserError,
  type SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '../di/tokens';
import type { SessionLifecycleManager } from './session-lifecycle-manager';
import type { SDKUserMessage } from './session-lifecycle-manager';

/** DI token for SubagentMessageDispatcher */
export const SUBAGENT_DISPATCHER_TOKEN = Symbol.for(
  'SubagentMessageDispatcher',
);

/**
 * Per-session serialisation lock — prevents races when multiple pushes
 * arrive in the same tick. Tracks the tail of the promise chain so each
 * push awaits the previous one.
 */
const sessionPushLocks = new Map<string, Promise<void>>();

/**
 * Acquire a serialised push slot for the session and run `fn` inside it.
 * Releases the slot when `fn` completes (resolves or rejects).
 */
async function serialisedPush(
  sessionId: string,
  fn: () => Promise<void>,
): Promise<void> {
  const prev = sessionPushLocks.get(sessionId) ?? Promise.resolve();
  const next = prev.then(
    () => fn(),
    () => fn(),
  ); // run even if prev rejected
  sessionPushLocks.set(sessionId, next);
  try {
    await next;
  } finally {
    // Only clean up if our slot is still the tail (no new push arrived)
    if (sessionPushLocks.get(sessionId) === next) {
      sessionPushLocks.delete(sessionId);
    }
  }
}

@injectable()
export class SubagentMessageDispatcher {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
    private readonly sessionLifecycle: SessionLifecycleManager,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly registry: SubagentRegistryService,
  ) {}

  /**
   * Send a user message into a running subagent.
   *
   * Uses the SDK's `streamInput` channel with `parent_tool_use_id` set so
   * the message is routed to the correct subagent rather than the root
   * coordinator. Pushes are serialised per session to avoid races.
   *
   * @param sessionId - The parent session that owns the subagent
   * @param parentToolUseId - The Task tool_use ID that spawned the subagent
   * @param text - Message text to send
   */
  async sendToSubagent(
    sessionId: string,
    parentToolUseId: string,
    text: string,
  ): Promise<void> {
    const session = this.sessionLifecycle.find(sessionId as string);
    if (!session) {
      throw new RpcUserError(
        `Session '${sessionId}' is not active — cannot send message to subagent`,
        'SESSION_NOT_FOUND',
      );
    }

    if (!session.query) {
      throw new RpcUserError(
        `Session '${sessionId}' query is not ready — cannot send message`,
        'SESSION_NOT_FOUND',
      );
    }

    const query = session.query;

    await serialisedPush(sessionId, async () => {
      this.logger.debug(
        '[SubagentMessageDispatcher] sendToSubagent: pushing message',
        { sessionId, parentToolUseId, textLength: text.length },
      );

      // Build SDKUserMessage with parent_tool_use_id for subagent routing
      const msg: SDKUserMessage = {
        type: 'user',
        message: { role: 'user', content: text },
        parent_tool_use_id: parentToolUseId,
        origin: { kind: 'coordinator' } as unknown as SDKUserMessage['origin'],
        shouldQuery: true,
        uuid: randomUUID(),
        session_id: sessionId,
        timestamp: new Date().toISOString(),
      } as SDKUserMessage;

      // Deliver via streamInput so the SDK routes it to the subagent
      async function* single(): AsyncGenerator<SDKUserMessage> {
        yield msg;
      }
      try {
        await query.streamInput(single());
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new RpcUserError(
          `Session ended before message could be delivered: ${message}`,
          'SESSION_ENDED',
        );
      }
    });
  }

  /**
   * Stop a specific running subagent by its SDK task_id.
   *
   * The SDK writes the subagent's partial output to its output_file and
   * emits a task_notification with status='stopped'.
   *
   * @param sessionId - The parent session that owns the subagent
   * @param taskId - The SDK task_id from SDKTaskStartedMessage
   */
  async stopSubagent(sessionId: string, taskId: string): Promise<void> {
    const session = this.sessionLifecycle.find(sessionId as string);
    if (!session) {
      throw new RpcUserError(
        `Session '${sessionId}' is not active — cannot stop subagent`,
        'SESSION_NOT_FOUND',
      );
    }

    if (!session.query) {
      throw new RpcUserError(
        `Session '${sessionId}' query is not ready — cannot stop subagent`,
        'SESSION_NOT_FOUND',
      );
    }

    this.logger.debug('[SubagentMessageDispatcher] stopSubagent', {
      sessionId,
      taskId,
    });

    try {
      await session.query.stopTask(taskId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new RpcUserError(
        `Task already completed or not found: ${message}`,
        'TASK_NOT_FOUND',
      );
    }
  }

  /**
   * Interrupt the entire session, stopping all running subagents.
   *
   * @param sessionId - The session to interrupt
   */
  async interruptSession(sessionId: string): Promise<void> {
    const session = this.sessionLifecycle.find(sessionId as string);
    if (!session) {
      throw new RpcUserError(
        `Session '${sessionId}' is not active — cannot interrupt`,
        'SESSION_NOT_FOUND',
      );
    }

    if (!session.query) {
      throw new RpcUserError(
        `Session '${sessionId}' query is not ready — cannot interrupt`,
        'SESSION_NOT_FOUND',
      );
    }

    this.logger.debug('[SubagentMessageDispatcher] interruptSession', {
      sessionId,
    });

    try {
      await session.query.interrupt();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new RpcUserError(
        `Session ended before interrupt could be delivered: ${message}`,
        'SESSION_ENDED',
      );
    }
  }
}
