import type {
  CodexChatAdapterPorts,
  CodexChatEventCallbacks,
  CodexChatTurnIdentity,
} from '@ptah-extension/agent-sdk';
import {
  MESSAGE_TYPES,
  type FlatStreamEventUnion,
  type SessionId,
} from '@ptah-extension/shared';
import type { ChatStreamDeliveryCoordinator } from '../streaming/chat-stream-delivery-coordinator.service';
import type { WebviewManager } from '../streaming/chat-stream-broadcaster.service';

export interface CodexChatEventCallbacksDeps {
  sessionId: SessionId;
  tabId: string;
  /**
   * The native App Server turn the adapter passes to `CodexChatAdapterPorts.callbacks`.
   * Undefined only for session-level errors raised outside a turn.
   */
  turn: CodexChatTurnIdentity | undefined;
  logger: Pick<CodexChatAdapterPorts['logger'], 'error'>;
  /** Share the coordinator used by ChatStreamBroadcaster (including hidden-tab retention). */
  delivery: Pick<ChatStreamDeliveryCoordinator, 'publish' | 'publishTerminal'>;
  webviewManager: Pick<WebviewManager, 'broadcastMessage'>;
  surfaceMode?: boolean;
  now?: () => number;
}

/** Create once per turn, just as CodexChatAdapterPorts.callbacks is called once per turn. */
export function createCodexChatEventCallbacks(
  deps: CodexChatEventCallbacksDeps,
): CodexChatEventCallbacks {
  let sequence = 0;
  const text = new Map<number, string>();
  let highestBlock = -1;
  // Same message id as CodexChatEvents, so complete content replaces streamed content.
  const messageId = deps.turn
    ? JSON.stringify([deps.turn.threadId, deps.turn.turnId])
    : undefined;
  const failed = (reason: unknown) => {
    deps.logger.error(
      'Codex chat event presentation failed.',
      reason instanceof Error ? reason : new Error(String(reason)),
    );
  };
  const safe = (work: () => void | Promise<void>) => {
    try {
      void Promise.resolve(work()).catch(failed);
    } catch (error) {
      failed(error);
    }
  };
  const base = () => {
    if (messageId === undefined)
      throw new Error('Codex turn content arrived without a native turn.');
    return {
      id: `codex-callback:${messageId}:${++sequence}`,
      sessionId: deps.sessionId,
      messageId,
      timestamp: (deps.now ?? Date.now)(),
      source: 'complete' as const,
    };
  };
  const publish = (event: FlatStreamEventUnion) =>
    Promise.resolve(
      deps.delivery.publish(
        deps.tabId,
        deps.sessionId,
        event,
        deps.surfaceMode,
      ),
    ).catch(failed);
  const error = (message: string) =>
    deps.delivery.publishTerminal(deps.tabId, MESSAGE_TYPES.CHAT_ERROR, {
      tabId: deps.tabId,
      sessionId: deps.sessionId,
      error: message,
      ...(deps.surfaceMode ? { surfaceMode: true } : {}),
    });
  return {
    content: (item) =>
      safe(() => {
        highestBlock = Math.max(highestBlock, item.blockIndex);
        if (item.kind === 'text') text.set(item.blockIndex, item.text);
        return publish({
          ...base(),
          eventType:
            item.kind === 'reasoning' ? 'thinking_delta' : 'text_delta',
          blockIndex: item.blockIndex,
          delta: item.text,
        });
      }),
    result: (result) =>
      safe(async () => {
        // The broadcaster owns message_complete / chat:complete, and the adapter
        // owns result stats. Reconcile final text without a second terminal or cost.
        if (text.size === 0) text.set(highestBlock + 1, result.text);
        await Promise.all(
          [...text].map(([blockIndex, delta]) =>
            publish({ ...base(), eventType: 'text_delta', blockIndex, delta }),
          ),
        );
      }),
    // A failed compaction only clears the banner. The turn itself is not ended here:
    // if the App Server fails the turn, its own error/terminal reaches `error`.
    compaction: (phase) =>
      safe(() =>
        publish(
          phase === 'started'
            ? {
                ...base(),
                eventType: 'compaction_start',
                trigger: 'auto',
                preTokens: 0,
              }
            : { ...base(), eventType: 'compaction_complete', trigger: 'auto' },
        ),
      ),
    live: (event) =>
      safe(async () => {
        // Approvals have one owner: the adapter's approval sink calls
        // CodexChatAdapterPorts.presentation, which also tracks host attention.
        // Presenting them here too would show every request twice.
        if (
          event.type === 'approvalRequested' ||
          event.type === 'approvalSettled'
        )
          return;
        const route = { sessionId: deps.sessionId, tabId: deps.tabId };
        // Reuse the existing tool-output channel for file and image artifacts.
        const toolCallId = `codex:${event.itemId}`;
        const start = publish({
          ...base(),
          messageId: JSON.stringify([event.threadId, event.turnId]),
          eventType: 'tool_start',
          toolCallId,
          toolName: event.type === 'file' ? 'Edit' : 'Image',
          isTaskTool: false,
          toolInput: event.type === 'file' ? { file_path: event.path } : {},
        });
        const finish = publish({
          ...base(),
          messageId: JSON.stringify([event.threadId, event.turnId]),
          eventType: 'tool_result',
          toolCallId,
          isError: false,
          output:
            event.type === 'file'
              ? {
                  file_path: event.path,
                  operation: event.operation,
                  diff: event.diff,
                }
              : [
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      data: event.image.data,
                      media_type: event.image.mediaType,
                    },
                  },
                ],
        });
        await Promise.all([start, finish]);
        if (event.type === 'file')
          await deps.webviewManager.broadcastMessage(
            MESSAGE_TYPES.FILE_CONTENT_CHANGED,
            { ...route, filePaths: [event.path], truncated: false },
          );
      }),
    error: (message) => safe(() => error(message)),
  };
}
