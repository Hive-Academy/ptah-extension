/**
 * JSONL Stream Parser - Parse Claude CLI JSONL output into typed events
 * SOLID: Single Responsibility - Only parses JSONL streams
 */

import {
  ClaudeContentChunk,
  ClaudeThinkingEvent,
  ClaudeToolEvent,
  ClaudePermissionRequest,
} from '@ptah-extension/shared';

export type JSONLMessage =
  | JSONLSystemMessage
  | JSONLAssistantMessage
  | JSONLToolMessage
  | JSONLPermissionMessage;

export interface JSONLSystemMessage {
  readonly type: 'system';
  readonly subtype?: 'init';
  readonly session_id?: string;
  readonly model?: string;
  readonly tools?: unknown[];
  readonly cwd?: string;
}

export interface JSONLAssistantMessage {
  readonly type: 'assistant';
  readonly delta?: string;
  readonly content?: string;
  readonly thinking?: string;
  readonly index?: number;
}

export interface JSONLToolMessage {
  readonly type: 'tool';
  readonly subtype?: 'start' | 'progress' | 'result' | 'error';
  readonly tool_call_id?: string;
  readonly tool?: string;
  readonly args?: Record<string, unknown>;
  readonly output?: unknown;
  readonly message?: string;
  readonly error?: string;
}

export interface JSONLPermissionMessage {
  readonly type: 'permission';
  readonly subtype: 'request';
  readonly tool_call_id: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly description?: string;
}

export interface ParsedEvent {
  readonly type: 'content' | 'thinking' | 'tool' | 'permission' | 'system' | 'unknown';
  readonly data: unknown;
  readonly rawJson: unknown;
}

/**
 * Callback handlers for parsed events
 */
export interface JSONLParserCallbacks {
  onSessionInit?: (sessionId: string, model?: string) => void;
  onContent?: (chunk: ClaudeContentChunk) => void;
  onThinking?: (event: ClaudeThinkingEvent) => void;
  onTool?: (event: ClaudeToolEvent) => void;
  onPermission?: (request: ClaudePermissionRequest) => void;
  onError?: (error: Error, rawLine?: string) => void;
}

/**
 * Streaming JSONL parser with event callbacks
 */
export class JSONLStreamParser {
  private buffer = '';

  constructor(private readonly callbacks: JSONLParserCallbacks) {}

  /**
   * Process incoming chunk of data
   */
  processChunk(chunk: Buffer | string): void {
    this.buffer += chunk.toString();
    const lines = this.buffer.split('\n');

    // Keep incomplete line in buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      this.processLine(line);
    }
  }

  /**
   * Process final buffer on stream end
   */
  processEnd(): void {
    if (this.buffer.trim()) {
      this.processLine(this.buffer);
      this.buffer = '';
    }
  }

  /**
   * Reset parser state
   */
  reset(): void {
    this.buffer = '';
  }

  /**
   * Process individual JSONL line
   */
  private processLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      const json = JSON.parse(trimmed) as JSONLMessage;
      this.handleMessage(json);
    } catch (error) {
      this.callbacks.onError?.(
        error instanceof Error
          ? error
          : new Error('JSON parse error'),
        trimmed
      );
    }
  }

  /**
   * Route message to appropriate handler
   */
  private handleMessage(json: JSONLMessage): void {
    switch (json.type) {
      case 'system':
        this.handleSystemMessage(json);
        break;

      case 'assistant':
        this.handleAssistantMessage(json);
        break;

      case 'tool':
        this.handleToolMessage(json);
        break;

      case 'permission':
        this.handlePermissionMessage(json);
        break;

      default:
        // Unknown message type - silently ignore
        break;
    }
  }

  /**
   * Handle system initialization message
   */
  private handleSystemMessage(msg: JSONLSystemMessage): void {
    if (msg.subtype === 'init' && msg.session_id) {
      this.callbacks.onSessionInit?.(msg.session_id, msg.model);
    }
  }

  /**
   * Handle assistant content/thinking messages
   */
  private handleAssistantMessage(msg: JSONLAssistantMessage): void {
    const timestamp = Date.now();

    // Thinking content
    if (msg.thinking) {
      const thinkingEvent: ClaudeThinkingEvent = {
        type: 'thinking',
        content: msg.thinking,
        timestamp,
      };
      this.callbacks.onThinking?.(thinkingEvent);
      return;
    }

    // Streaming content delta
    if (msg.delta) {
      const contentChunk: ClaudeContentChunk = {
        type: 'content',
        delta: msg.delta,
        index: msg.index,
        timestamp,
      };
      this.callbacks.onContent?.(contentChunk);
      return;
    }

    // Full content (non-streaming)
    if (msg.content) {
      const contentChunk: ClaudeContentChunk = {
        type: 'content',
        delta: msg.content,
        index: msg.index,
        timestamp,
      };
      this.callbacks.onContent?.(contentChunk);
    }
  }

  /**
   * Handle tool execution messages
   */
  private handleToolMessage(msg: JSONLToolMessage): void {
    const timestamp = Date.now();

    if (!msg.tool_call_id || !msg.subtype) {
      return;
    }

    switch (msg.subtype) {
      case 'start': {
        const event: ClaudeToolEvent = {
          type: 'start',
          toolCallId: msg.tool_call_id,
          tool: msg.tool || 'unknown',
          args: msg.args || {},
          timestamp,
        };
        this.callbacks.onTool?.(event);
        break;
      }

      case 'progress': {
        const event: ClaudeToolEvent = {
          type: 'progress',
          toolCallId: msg.tool_call_id,
          message: msg.message || '',
          timestamp,
        };
        this.callbacks.onTool?.(event);
        break;
      }

      case 'result': {
        const event: ClaudeToolEvent = {
          type: 'result',
          toolCallId: msg.tool_call_id,
          output: msg.output,
          duration: 0, // Duration not provided by CLI
          timestamp,
        };
        this.callbacks.onTool?.(event);
        break;
      }

      case 'error': {
        const event: ClaudeToolEvent = {
          type: 'error',
          toolCallId: msg.tool_call_id,
          error: msg.error || 'Unknown tool error',
          timestamp,
        };
        this.callbacks.onTool?.(event);
        break;
      }
    }
  }

  /**
   * Handle permission request messages
   */
  private handlePermissionMessage(msg: JSONLPermissionMessage): void {
    if (msg.subtype !== 'request') {
      return;
    }

    const request: ClaudePermissionRequest = {
      toolCallId: msg.tool_call_id,
      tool: msg.tool,
      args: msg.args,
      description: msg.description,
      timestamp: Date.now(),
    };

    this.callbacks.onPermission?.(request);
  }
}
