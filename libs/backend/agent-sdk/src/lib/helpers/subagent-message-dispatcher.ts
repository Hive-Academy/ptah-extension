/**
 * SubagentMessageDispatcher — bidirectional messaging for running subagents.
 *
 * Provides four operations:
 *   - `sendToSubagent` — relay a user message toward a running subagent via
 *     a coordinator nudge on the session's streamInput channel.
 *   - `stopSubagent` — call Query.stopTask(taskId) to gracefully stop a
 *     running subagent and write its output file.
 *   - `interruptSession` — call Query.interrupt() to abort the entire
 *     session, stopping all subagents.
 *   - `backgroundTask` — call Query.backgroundTasks(toolUseId) to move an
 *     in-flight foreground task to the background.
 *
 * `pushParentMessage` streams a host-authored user turn (the subagent budget
 * monitor's handoff) through the same ordering lock as `sendToSubagent`.
 *
 * All of them surface typed errors when the session is not active, ensuring
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
import type {
  Query,
  SDKUserMessage,
  SessionLifecycleManager,
} from './session-lifecycle-manager';

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
 * Upper bound on a single `streamInput` push toward a running session.
 *
 * `streamInput` resolves only when the CLI reads the message off its input
 * channel. A session whose transport is stalled never reads, so the push simply
 * never settles: on 2026-08-31 the `subagent:send-message` RPC handler blocked
 * for 180 018 ms and settled only when a session abort closed the transport.
 * The renderer had already surfaced `RPC timeout: subagent:send-message` to the
 * user.
 *
 * The push is bounded here because the RPC caller cannot wait for the session
 * watchdog — that watchdog measures stream silence in minutes, while the RPC
 * boundary must answer in seconds. A bounded push turns a hung handler into a
 * typed `SEND_TIMEOUT` the UI can render.
 */
export const SUBAGENT_SEND_TIMEOUT_MS = 10_000;

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
   * Relay a user message toward a running subagent via the SDK's `SendMessage`
   * fabric, keyed by the subagent's `agentId`.
   *
   * Note on inbound routing: there is no direct parent→subagent input channel
   * over `streamInput`. `parent_tool_use_id` on an incoming `SDKUserMessage` is
   * output-labeling only — verified against the vendored CLI (claude.exe 2.1.150
   * in `@anthropic-ai/claude-agent-sdk` 0.3.150), the stdin ingest handler copies
   * `priority`/`shouldQuery`/`uuid`/`clientPlatform` off the incoming message but
   * never reads `parent_tool_use_id` and never assigns an `agentId`, so every
   * streamed message is enqueued into the ROOT coordinator conversation
   * regardless of that field. (On the OUTBOUND side the same
   * `parent_tool_use_id` labels forwarded subagent transcript text — see
   * `forwardSubagentText` in SdkQueryOptionsBuilder.)
   *
   * The real relay mechanism the SDK honours is the model-side `SendMessage`
   * tool, keyed by the SDK short-hex `agentId` (the same value the SubagentStart
   * hook stores in `SubagentRecord.agentId`). So we always push the user's text
   * to the root session as a normal `human` message (`parent_tool_use_id: null`)
   * and, when we know the live subagent's `agentId`, instruct the coordinator to
   * relay it verbatim via `SendMessage`. Without a record or agentId we fall back
   * to a generic reference the coordinator can act on.
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
    const teammateName = record?.teammateName;
    // Prefer an explicit SendMessage instruction keyed by the live subagent's
    // agentId — the only mechanism the CLI is PROVEN to honour, so it stays the
    // literal `to:` target. When the coordinator gave the teammate a
    // human-legible name we surface it in the prose so the instruction reads
    // naturally, but the addressing target is still the agentId. Fall back to a
    // generic reference when we have no record or no agentId to target.
    const humanRef = teammateName
      ? `the '${teammateName}' teammate (the running '${agentType}' subagent, id: ${agentId})`
      : `the running '${agentType}' subagent (id: ${agentId})`;
    const content = agentId
      ? `The user wants to steer ${humanRef}. Use the SendMessage tool with to: '${agentId}' to deliver this to it verbatim: ${text}`
      : `Regarding the running subagent (toolUseId=${parentToolUseId}): ${text}`;

    this.logger.debug('[SubagentMessageDispatcher] sendToSubagent', {
      sessionId,
      parentToolUseId,
      agentType,
      agentId,
      teammateName,
      mode: agentId ? 'sendmessage-instruction' : 'generic-nudge',
      textLength: text.length,
    });
    await this.pushUserMessage(sessionId, query, content);
  }

  /**
   * Push one host-authored user turn to the parent session (the subagent
   * budget monitor's handoff). It goes through the same per-session ordering
   * lock, `origin` and send timeout as {@link sendToSubagent}, so a steer and
   * a handoff pushed in the same tick reach the CLI in call order.
   *
   * @throws RpcUserError `SESSION_NOT_FOUND` when the session or its query is
   *   not active, `SEND_TIMEOUT` when the session does not read its input in
   *   time, `SESSION_ENDED` when the push fails.
   */
  async pushParentMessage(sessionId: string, content: string): Promise<void> {
    const session = this.sessionLifecycle.find(sessionId);
    if (!session?.query) {
      throw new RpcUserError(
        `Session '${sessionId}' is not active — cannot deliver message`,
        'SESSION_NOT_FOUND',
      );
    }
    this.logger.debug('[SubagentMessageDispatcher] pushParentMessage', {
      sessionId,
      contentLength: content.length,
    });
    await this.pushUserMessage(sessionId, session.query, content);
  }

  /** Stream one user turn to `query` inside the session's ordering lock, bounded by the send timeout. */
  private async pushUserMessage(
    sessionId: string,
    query: Pick<Query, 'streamInput'>,
    content: string,
  ): Promise<void> {
    await serialisedPush(sessionId, async () => {
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
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          query.streamInput(single()),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              reject(
                new RpcUserError(
                  'Message not accepted within 10s — the session did not read its input channel',
                  'SEND_TIMEOUT',
                ),
              );
            }, SUBAGENT_SEND_TIMEOUT_MS);
          }),
        ]);
      } catch (error: unknown) {
        // The timeout above is already a typed RpcUserError — re-wrapping it as
        // SESSION_ENDED would report the wrong cause (the session is alive, it
        // just never read its input).
        if (error instanceof RpcUserError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new RpcUserError(
          `Session ended before message could be delivered: ${message}`,
          'SESSION_ENDED',
        );
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
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
