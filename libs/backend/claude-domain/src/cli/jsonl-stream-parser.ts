/**
 * JSONL Stream Parser - Parse Claude CLI JSONL output into typed events
 * SOLID: Single Responsibility - Only parses JSONL streams
 * SIMPLIFIED: Parse once, forward typed object (no transformation layers)
 */

import { ClaudePermissionRequest } from '@ptah-extension/shared';

export type JSONLMessage =
  | JSONLSystemMessage
  | JSONLAssistantMessage
  | JSONLToolMessage
  | JSONLPermissionMessage
  | JSONLStreamEvent
  | JSONLResultMessage;

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
  readonly parent_tool_use_id?: string; // For agent activity correlation
  // Messages API format (from --output-format stream-json)
  readonly message?: {
    readonly model?: string;
    readonly id?: string;
    readonly role?: 'assistant';
    readonly content?: Array<{
      readonly type: 'text' | 'tool_use';
      readonly text?: string;
      readonly id?: string;
      readonly name?: string;
      readonly input?: Record<string, unknown>;
    }>;
  };
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
  readonly parent_tool_use_id?: string; // For agent activity correlation
}

export interface JSONLPermissionMessage {
  readonly type: 'permission';
  readonly subtype: 'request';
  readonly tool_call_id: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly description?: string;
}

export interface JSONLStreamEvent {
  readonly type: 'stream_event';
  readonly event: {
    readonly type: string;
    readonly index?: number;
    readonly delta?: {
      readonly type: 'text_delta' | 'input_json_delta';
      readonly text?: string;
      readonly partial_json?: string;
    };
    readonly content_block?: {
      readonly type: string;
      readonly text: string;
    };
    readonly message?: {
      readonly model?: string;
      readonly id?: string;
    };
  };
  readonly session_id?: string;
}

export interface JSONLResultMessage {
  readonly type: 'result';
  readonly subtype: 'success' | 'error';
  readonly session_id?: string;
  readonly result?: string;
  readonly duration_ms?: number;
  readonly duration_api_ms?: number;
  readonly num_turns?: number;
  readonly total_cost_usd?: number;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_read_input_tokens?: number;
    readonly cache_creation_input_tokens?: number;
  };
  readonly modelUsage?: Record<
    string,
    {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cacheReadInputTokens: number;
      readonly cacheCreationInputTokens: number;
      readonly costUSD: number;
    }
  >;
}

/**
 * Callback handlers for parsed events
 * SIMPLIFIED: Single callback for all JSONL messages (forwarded to webview)
 */
export interface JSONLParserCallbacks {
  /** Single callback for all parsed JSONL messages (forwarded to webview) */
  onMessage: (message: JSONLMessage) => void;

  /** Permission requests require special handling (user input) */
  onPermission?: (request: ClaudePermissionRequest) => void;

  /** Errors handled separately for logging/debugging */
  onError?: (error: Error, rawLine?: string) => void;
}

/**
 * Streaming JSONL parser with event callbacks
 * SIMPLIFIED: Parse JSON, validate, forward typed object (no transformation)
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
      // Graceful error handling: log warning and continue processing
      this.callbacks.onError?.(
        error instanceof Error ? error : new Error('JSON parse error'),
        trimmed
      );
    }
  }

  /**
   * Route message to appropriate handler
   * SIMPLIFIED: Forward all messages except permissions to single callback
   */
  private handleMessage(json: JSONLMessage): void {
    // Special case: Permission requests need user interaction
    if (json.type === 'permission' && json.subtype === 'request') {
      const request: ClaudePermissionRequest = {
        toolCallId: json.tool_call_id,
        tool: json.tool,
        args: json.args,
        description: json.description,
        timestamp: Date.now(),
      };
      this.callbacks.onPermission?.(request);
      return;
    }

    // Forward all other message types directly
    this.callbacks.onMessage(json);
  }
}
