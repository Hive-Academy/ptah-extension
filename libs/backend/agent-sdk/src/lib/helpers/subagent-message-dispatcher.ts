/**
 * SubagentMessageDispatcher — bidirectional messaging for running subagents.
 *
 * Provides three operations:
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
   * Nudge the coordinator to re-steer a running subagent.
   *
   * There is NO direct parent→subagent input channel over `streamInput`.
   * `parent_tool_use_id` on an incoming `SDKUserMessage` is output-labeling
   * only: verified against the vendored CLI (claude.exe 2.1.150 in
   * `@anthropic-ai/claude-agent-sdk` 0.3.150), the stdin ingest handler copies
   * `priority`/`shouldQuery`/`uuid`/`clientPlatform` off the incoming message
   * but never reads `parent_tool_use_id` and never assigns an `agentId`, so
   * every streamed message is enqueued into the ROOT coordinator conversation
   * regardless of that field.
   *
   * The only real relay mechanism is the model-side `SendMessage` tool, keyed
   * by the SDK short-hex `agentId` (the same value the SubagentStart hook
   * stores in `SubagentRecord.agentId`). So we always push the user's text to
   * the root session as a normal `human` message (`parent_tool_use_id: null`)
   * and, when we know the live subagent's `agentId`, instruct the coordinator
   * to relay it verbatim via `SendMessage`. Without a record or agentId we fall
   * back to a generic reference the coordinator can act on.
   *
   * Pushes are serialised per session to avoid races with other input.
   *
   * @param sessionId - The parent session that owns the subagent
   * @param parentToolUseId - The Task tool_use ID that spawned the subagent
   * @param text - Message text from the user
   */
  async sendToSubagent(
    sessionId: string,
    parentToolUseId: string,
    text: string,
  ): Promise<void> {
    const session = this.sessionLifecycle.find(sessionId as string);
    if (!session) {
      throw new RpcUserError(
        `Session '${sessionId}' is not active — cannot deliver message`,
        'SESSION_NOT_FOUND',
      );
    }

    if (!session.query) {
      throw new RpcUserError(
        `Session '${sessionId}' query is not ready — cannot deliver message`,
        'SESSION_NOT_FOUND',
      );
    }

    const query = session.query;
    const record = this.registry.get(parentToolUseId);
    const agentType = record?.agentType ?? 'unknown';
    const agentId = record?.agentId;
    // Prefer an explicit SendMessage instruction keyed by the live subagent's
    // agentId — the only mechanism the CLI actually honours. Fall back to a
    // generic reference when we have no record or no agentId to target.
    const content = agentId
      ? `The user wants to steer the running '${agentType}' subagent (id: ${agentId}). Use the SendMessage tool with to: '${agentId}' to deliver this to it verbatim: ${text}`
      : `Regarding the running subagent (toolUseId=${parentToolUseId}): ${text}`;

    await serialisedPush(sessionId, async () => {
      this.logger.debug('[SubagentMessageDispatcher] sendToSubagent', {
        sessionId,
        parentToolUseId,
        agentType,
        agentId,
        mode: agentId ? 'sendmessage-instruction' : 'generic-nudge',
        textLength: text.length,
      });
      const msg: SDKUserMessage = {
        type: 'user',
        message: { role: 'user', content },
        parent_tool_use_id: null,
        origin: { kind: 'human' } as unknown as SDKUserMessage['origin'],
        shouldQuery: true,
        uuid: randomUUID(),
        session_id: sessionId,
        timestamp: new Date().toISOString(),
      } as SDKUserMessage;
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
   * Move in-flight foreground task(s) to the background (Ctrl+B parity).
   *
   * Calls `Query.backgroundTasks(toolUseId)`. With no `toolUseId`, all
   * foreground tasks are backgrounded. With a `toolUseId`, only that task is
   * targeted and the SDK resolves to `false` when the id matched no foreground
   * task.
   *
   * @param sessionId - The session that owns the running task(s)
   * @param toolUseId - Optional SDK tool_use ID of a single foreground task
   * @returns Whether any foreground task was moved to the background
   */
  async backgroundTask(
    sessionId: string,
    toolUseId?: string,
  ): Promise<boolean> {
    const session = this.sessionLifecycle.find(sessionId as string);
    if (!session) {
      throw new RpcUserError(
        `Session '${sessionId}' is not active — cannot background task`,
        'SESSION_NOT_FOUND',
      );
    }

    if (!session.query) {
      throw new RpcUserError(
        `Session '${sessionId}' query is not ready — cannot background task`,
        'SESSION_NOT_FOUND',
      );
    }

    this.logger.debug('[SubagentMessageDispatcher] backgroundTask', {
      sessionId,
      toolUseId,
    });

    try {
      return await session.query.backgroundTasks(toolUseId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new RpcUserError(
        `Session ended before task could be backgrounded: ${message}`,
        'SESSION_ENDED',
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
