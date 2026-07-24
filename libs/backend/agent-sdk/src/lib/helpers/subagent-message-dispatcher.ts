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
 * All four surface typed errors when the session is not active, ensuring
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
import type { SubagentTranscriptMessage } from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import type { SessionLifecycleManager } from './session-lifecycle-manager';
import type { SDKUserMessage } from './session-lifecycle-manager';

/** DI token for SubagentMessageDispatcher */
export const SUBAGENT_DISPATCHER_TOKEN = Symbol.for(
  'SubagentMessageDispatcher',
);

/**
 * Minimal shape of the SDK's `getSubagentMessages` export, narrowed here to
 * avoid an ESM `resolution-mode` static import (the SDK is ESM-only and loaded
 * via dynamic `import()`, matching SessionForkService).
 */
interface SubagentTranscriptSdkModule {
  getSubagentMessages?: (
    sessionId: string,
    agentId: string,
    options?: { dir?: string; limit?: number; offset?: number },
  ) => Promise<RawSubagentSessionMessage[]>;
}

/**
 * Subset of the SDK's `SessionMessage` used for normalization. `message` is the
 * raw Anthropic message payload (`{ role, content }`); `timestamp` is read
 * defensively since the SDK's declared type omits it.
 */
interface RawSubagentSessionMessage {
  type: 'user' | 'assistant' | 'system';
  message: unknown;
  timestamp?: string;
}

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

    await serialisedPush(sessionId, async () => {
      this.logger.debug('[SubagentMessageDispatcher] sendToSubagent', {
        sessionId,
        parentToolUseId,
        agentType,
        agentId,
        teammateName,
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

  /**
   * Read a subagent's full historical transcript and normalize it to the
   * UI-friendly {@link SubagentTranscriptMessage} shape.
   *
   * Backed by the SDK's `getSubagentMessages(sessionId, agentId, { limit,
   * offset })`, which parses the subagent's JSONL transcript into chronological
   * user/assistant messages. `dir` is intentionally omitted so the SDK searches
   * all projects. The SDK is ESM-only, so it is loaded via dynamic `import()`
   * (matching SessionForkService) — which is why this read lives here in
   * agent-sdk rather than in the rpc-handlers boundary.
   *
   * Defensive: returns `[]` on missing SDK export / not-found / read failure
   * rather than throwing, so the RPC boundary can surface "no transcript yet".
   */
  async getSubagentTranscript(
    sessionId: string,
    agentId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<SubagentTranscriptMessage[]> {
    try {
      const sdkModule =
        (await import('@anthropic-ai/claude-agent-sdk')) as SubagentTranscriptSdkModule;
      const getSubagentMessages = sdkModule.getSubagentMessages;
      if (typeof getSubagentMessages !== 'function') {
        this.logger.warn(
          '[SubagentMessageDispatcher] getSubagentMessages export unavailable',
          { exportType: typeof getSubagentMessages },
        );
        return [];
      }

      const raw = await getSubagentMessages(sessionId, agentId, {
        limit: options?.limit,
        offset: options?.offset,
      });
      return this.normalizeTranscript(raw);
    } catch (error: unknown) {
      this.logger.warn('[SubagentMessageDispatcher] transcript read failed', {
        sessionId,
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Normalize the SDK's `SessionMessage[]` down to the UI-friendly
   * {@link SubagentTranscriptMessage} shape: keep user/assistant turns, drop
   * system turns and tool noise, and concatenate text content blocks. Messages
   * with no rendered text are omitted so the viewer only sees meaningful turns.
   */
  private normalizeTranscript(
    raw: RawSubagentSessionMessage[],
  ): SubagentTranscriptMessage[] {
    const messages: SubagentTranscriptMessage[] = [];

    for (const item of raw) {
      if (item.type !== 'user' && item.type !== 'assistant') {
        continue;
      }

      const text = this.renderMessageText(item.message);
      if (!text.trim()) {
        continue;
      }

      const timestamp =
        typeof item.timestamp === 'string' ? item.timestamp : undefined;

      messages.push({
        role: item.type,
        text,
        ...(timestamp ? { timestamp } : {}),
      });
    }

    return messages;
  }

  /**
   * Extract and concatenate the text content from a raw Anthropic message
   * payload. String content is used verbatim; array content keeps only `text`
   * blocks (tool_use / tool_result / thinking noise is dropped).
   */
  private renderMessageText(message: unknown): string {
    const content = (message as { content?: unknown } | undefined)?.content;

    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .filter(
          (block): block is { type: 'text'; text: string } =>
            typeof block === 'object' &&
            block !== null &&
            'type' in block &&
            (block as { type: unknown }).type === 'text' &&
            'text' in block &&
            typeof (block as { text: unknown }).text === 'string',
        )
        .map((block) => block.text)
        .join('\n');
    }

    return '';
  }
}
