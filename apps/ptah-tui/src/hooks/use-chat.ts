import { useCallback, useEffect, useMemo, useState } from 'react';
import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatToolRow {
  readonly id: string;
  readonly toolName: string;
  readonly status: 'running' | 'ok' | 'error';
}

export interface ChatMessage {
  readonly id: string;
  readonly role: ChatRole;
  content: string;
  thinking: string;
  tools: ChatToolRow[];
  readonly timestamp: string;
  isStreaming?: boolean;
}

export interface ChatStatusNotice {
  readonly id: string;
  readonly text: string;
}

export interface ChatRpcResponse {
  readonly success: boolean;
  readonly data?: { readonly sessionId?: string };
  readonly error?: string;
  readonly errorCode?: string;
}

export interface ChatTransport {
  call<TParams = unknown, TResult = unknown>(
    method: string,
    params: TParams,
  ): Promise<{
    success: boolean;
    data?: TResult;
    error?: string;
    errorCode?: string;
  }>;
}

export type ChatPushAdapter = Pick<EventEmitter, 'on' | 'off' | 'emit'>;

export interface ChatControllerOptions {
  readonly transport: ChatTransport;
  readonly pushAdapter: ChatPushAdapter;
  readonly workspacePath?: string;
  readonly onChange: () => void;
  readonly flushIntervalMs?: number;
  readonly watchdogMs?: number;
}

interface ChatChunkPayload {
  readonly tabId?: string;
  readonly sessionId?: string;
  readonly event?: FlatStreamEventUnion;
}

interface ChatCompletePayload {
  readonly tabId?: string;
  readonly sessionId?: string;
}

interface ChatErrorPayload {
  readonly tabId?: string;
  readonly sessionId?: string;
  readonly error?: string;
}

const DEFAULT_FLUSH_INTERVAL_MS = 100;
const DEFAULT_WATCHDOG_MS = 60_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asChunk(payload: unknown): ChatChunkPayload | null {
  if (!isObject(payload)) return null;
  if (typeof payload['tabId'] !== 'string') return null;
  return payload as ChatChunkPayload;
}

function asComplete(payload: unknown): ChatCompletePayload | null {
  if (!isObject(payload)) return null;
  if (typeof payload['tabId'] !== 'string') return null;
  return payload as ChatCompletePayload;
}

function asError(payload: unknown): ChatErrorPayload | null {
  if (!isObject(payload)) return null;
  if (typeof payload['tabId'] !== 'string') return null;
  return payload as ChatErrorPayload;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Framework-free chat streaming controller. Owns the conversation identity
 * (UUID-v4 tabId), the demux of the current `chat:chunk`/`chat:complete`/
 * `chat:error` push contract, the debounced text-delta flush, the streaming
 * watchdog, and the in-flight double-submit guard. The React hook is a thin
 * wrapper; unit tests drive this class directly through a bare EventEmitter.
 */
export class ChatStreamController {
  private readonly transport: ChatTransport;
  private readonly pushAdapter: ChatPushAdapter;
  private readonly workspacePath?: string;
  private readonly onChange: () => void;
  private readonly flushIntervalMs: number;
  private readonly watchdogMs: number;

  private readonly tabId: string = randomUUID();
  private sessionId: string | null = null;

  messages: ChatMessage[] = [];
  status: ChatStatusNotice | null = null;
  isStreaming = false;

  private pendingText = '';
  private streamingMessageId: string | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;

  private readonly onChunk: (payload: unknown) => void;
  private readonly onComplete: (payload: unknown) => void;
  private readonly onError: (payload: unknown) => void;

  constructor(options: ChatControllerOptions) {
    this.transport = options.transport;
    this.pushAdapter = options.pushAdapter;
    this.workspacePath = options.workspacePath;
    this.onChange = options.onChange;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.watchdogMs = options.watchdogMs ?? DEFAULT_WATCHDOG_MS;

    this.onChunk = (payload) => this.handleChunk(payload);
    this.onComplete = (payload) => this.handleComplete(payload);
    this.onError = (payload) => this.handleError(payload);

    this.pushAdapter.on('chat:chunk', this.onChunk);
    this.pushAdapter.on('chat:complete', this.onComplete);
    this.pushAdapter.on('chat:error', this.onError);
  }

  dispose(): void {
    this.pushAdapter.off('chat:chunk', this.onChunk);
    this.pushAdapter.off('chat:complete', this.onComplete);
    this.pushAdapter.off('chat:error', this.onError);
    this.clearFlushTimer();
    this.clearWatchdog();
  }

  async send(message: string): Promise<void> {
    if (this.inFlight) return;
    const trimmed = message.trim();
    if (trimmed.length === 0) return;

    this.inFlight = true;

    const userMessage = this.makeMessage('user', message);
    const assistant = this.makeMessage('assistant', '');
    assistant.isStreaming = true;
    this.streamingMessageId = assistant.id;
    this.pendingText = '';
    this.messages = [...this.messages, userMessage, assistant];
    this.isStreaming = true;
    this.emit();

    const isFirstTurn = this.sessionId === null;
    const method = isFirstTurn ? 'chat:start' : 'chat:continue';
    const params = isFirstTurn
      ? {
          tabId: this.tabId,
          prompt: message,
          workspacePath: this.workspacePath,
        }
      : {
          tabId: this.tabId,
          sessionId: this.sessionId,
          prompt: message,
          workspacePath: this.workspacePath,
        };

    try {
      const response = (await this.transport.call(
        method,
        params,
      )) as ChatRpcResponse;
      if (!response.success) {
        this.failTurn(response.error ?? 'Failed to start chat');
        return;
      }
      if (response.data?.sessionId && this.sessionId === null) {
        this.sessionId = response.data.sessionId;
      }
      this.armWatchdog();
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : String(error);
      this.failTurn(`Failed to start chat: ${text}`);
    }
  }

  async stop(): Promise<void> {
    const abortId = this.sessionId ?? this.tabId;
    try {
      await this.transport.call('chat:abort', { sessionId: abortId });
    } catch {
      // best effort — backend may have already stopped
    }
    this.finalizeStreaming();
  }

  addSystemMessage(text: string): void {
    this.messages = [...this.messages, this.makeMessage('system', text)];
    this.emit();
  }

  clear(): void {
    this.messages = [];
    this.status = null;
    this.emit();
  }

  private handleChunk(payload: unknown): void {
    const chunk = asChunk(payload);
    if (!chunk || chunk.tabId !== this.tabId) return;
    const event = chunk.event;
    if (!event) return;

    this.captureSessionId(event.sessionId ?? chunk.sessionId);

    switch (event.eventType) {
      case 'message_start':
        this.armWatchdog();
        return;
      case 'text_delta':
        this.pendingText += event.delta;
        this.scheduleFlush();
        this.armWatchdog();
        return;
      case 'thinking_delta':
        this.appendThinking(event.delta);
        this.armWatchdog();
        return;
      case 'tool_start':
        this.upsertTool(event.toolCallId, event.toolName, 'running');
        this.armWatchdog();
        return;
      case 'tool_result':
        this.upsertTool(
          event.toolCallId,
          undefined,
          event.isError ? 'error' : 'ok',
        );
        this.armWatchdog();
        return;
      case 'message_complete':
        this.flushPending();
        return;
      case 'compaction_start':
        this.setStatus('Compacting conversation context…');
        return;
      case 'compaction_complete':
        this.setStatus('Context compaction complete.');
        return;
      default:
        return;
    }
  }

  private handleComplete(payload: unknown): void {
    const complete = asComplete(payload);
    if (!complete || complete.tabId !== this.tabId) return;
    this.captureSessionId(complete.sessionId);
    this.finalizeStreaming();
  }

  private handleError(payload: unknown): void {
    const errorPayload = asError(payload);
    if (!errorPayload || errorPayload.tabId !== this.tabId) return;
    this.captureSessionId(errorPayload.sessionId);
    this.failTurn(errorPayload.error ?? 'Unknown streaming error');
  }

  private captureSessionId(candidate: string | undefined): void {
    if (this.sessionId === null && candidate && candidate.length > 0) {
      this.sessionId = candidate;
    }
  }

  private failTurn(text: string): void {
    this.clearWatchdog();
    this.clearFlushTimer();
    this.flushPending(true);
    this.markStreamingDone();
    this.messages = [...this.messages, this.makeMessage('system', text)];
    this.isStreaming = false;
    this.streamingMessageId = null;
    this.inFlight = false;
    this.emit();
  }

  private finalizeStreaming(): void {
    this.clearWatchdog();
    this.clearFlushTimer();
    this.flushPending(true);
    this.markStreamingDone();
    this.isStreaming = false;
    this.streamingMessageId = null;
    this.inFlight = false;
    this.emit();
  }

  private markStreamingDone(): void {
    const id = this.streamingMessageId;
    if (!id) return;
    this.messages = this.messages.map((m) =>
      m.id === id ? { ...m, isStreaming: false } : m,
    );
  }

  private appendThinking(delta: string): void {
    const id = this.streamingMessageId;
    if (!id || delta.length === 0) return;
    this.messages = this.messages.map((m) =>
      m.id === id ? { ...m, thinking: m.thinking + delta } : m,
    );
    this.emit();
  }

  private upsertTool(
    toolCallId: string,
    toolName: string | undefined,
    status: ChatToolRow['status'],
  ): void {
    const id = this.streamingMessageId;
    if (!id) return;
    this.messages = this.messages.map((m) => {
      if (m.id !== id) return m;
      const existing = m.tools.find((t) => t.id === toolCallId);
      if (existing) {
        return {
          ...m,
          tools: m.tools.map((t) =>
            t.id === toolCallId
              ? { ...t, status, toolName: toolName ?? t.toolName }
              : t,
          ),
        };
      }
      return {
        ...m,
        tools: [
          ...m.tools,
          { id: toolCallId, toolName: toolName ?? 'tool', status },
        ],
      };
    });
    this.emit();
  }

  private setStatus(text: string): void {
    this.status = { id: randomUUID(), text };
    this.emit();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushPending();
    }, this.flushIntervalMs);
  }

  private flushPending(force = false): void {
    const id = this.streamingMessageId;
    const pending = this.pendingText;
    if (!id || pending.length === 0) {
      if (force) this.clearFlushTimer();
      return;
    }
    this.pendingText = '';
    this.messages = this.messages.map((m) =>
      m.id === id ? { ...m, content: m.content + pending } : m,
    );
    this.emit();
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = null;
      this.flushPending(true);
      this.markStreamingDone();
      this.messages = [
        ...this.messages,
        this.makeMessage(
          'system',
          'Streaming timed out — no response from backend.',
        ),
      ];
      this.isStreaming = false;
      this.streamingMessageId = null;
      this.inFlight = false;
      this.emit();
    }, this.watchdogMs);
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer !== null) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private clearFlushTimer(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private makeMessage(role: ChatRole, content: string): ChatMessage {
    return {
      id: randomUUID(),
      role,
      content,
      thinking: '',
      tools: [],
      timestamp: nowIso(),
    };
  }

  private emit(): void {
    this.onChange();
  }

  getTabId(): string {
    return this.tabId;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }
}

export interface UseChatResult {
  messages: ChatMessage[];
  status: ChatStatusNotice | null;
  isStreaming: boolean;
  tabId: string;
  sessionId: string | null;
  send: (message: string) => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
  addSystemMessage: (text: string) => void;
}

export function useChat(
  transport: ChatTransport,
  pushAdapter: ChatPushAdapter,
  workspacePath?: string,
): UseChatResult {
  const [, setVersion] = useState(0);

  const controller = useMemo(() => {
    return new ChatStreamController({
      transport,
      pushAdapter,
      workspacePath,
      onChange: () => setVersion((v) => v + 1),
    });
  }, [transport, pushAdapter, workspacePath]);

  useEffect(() => {
    return () => controller.dispose();
  }, [controller]);

  const send = useCallback(
    (message: string) => controller.send(message),
    [controller],
  );
  const stop = useCallback(() => controller.stop(), [controller]);
  const clear = useCallback(() => controller.clear(), [controller]);
  const addSystemMessage = useCallback(
    (text: string) => controller.addSystemMessage(text),
    [controller],
  );

  return {
    messages: controller.messages,
    status: controller.status,
    isStreaming: controller.isStreaming,
    tabId: controller.getTabId(),
    sessionId: controller.getSessionId(),
    send,
    stop,
    clear,
    addSystemMessage,
  };
}
