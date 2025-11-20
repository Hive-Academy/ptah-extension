/**
 * JSONL Stream Parser - Parse Claude CLI JSONL output into typed events
 * SOLID: Single Responsibility - Only parses JSONL streams
 */

import {
  ClaudeContentChunk,
  ClaudeThinkingEvent,
  ClaudeToolEvent,
  ClaudePermissionRequest,
  ClaudeAgentStartEvent,
  ClaudeAgentActivityEvent,
  ClaudeAgentCompleteEvent,
  ContentBlock,
} from '@ptah-extension/shared';

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

export interface ParsedEvent {
  readonly type:
    | 'content'
    | 'thinking'
    | 'tool'
    | 'permission'
    | 'system'
    | 'unknown';
  readonly data: unknown;
  readonly rawJson: unknown;
}

/**
 * Agent Metadata for Task Tool Tracking
 */
interface AgentMetadata {
  readonly agentId: string;
  readonly subagentType: string;
  readonly description: string;
  readonly prompt: string;
  readonly model?: string;
  readonly startTime: number;
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
  onAgentStart?: (event: ClaudeAgentStartEvent) => void;
  onAgentActivity?: (event: ClaudeAgentActivityEvent) => void;
  onAgentComplete?: (event: ClaudeAgentCompleteEvent) => void;
  onMessageStop?: () => void; // NEW: Called when message streaming completes
  onResult?: (result: JSONLResultMessage) => void; // NEW: Called with final result (cost, usage, duration)
  onError?: (error: Error, rawLine?: string) => void;
}

/**
 * Configuration for tool filtering and formatting
 */
export interface ToolFilterConfig {
  /** Tools to hide from output (e.g., verbose internal tools) */
  readonly hiddenTools?: readonly string[];
  /** Enable special formatting for specific tools */
  readonly enableSpecialFormatting?: boolean;
}

/**
 * Streaming JSONL parser with event callbacks
 */
export class JSONLStreamParser {
  private buffer = '';
  private readonly config: ToolFilterConfig;
  private readonly activeAgents = new Map<string, AgentMetadata>();

  // Default hidden tools (verbose internal tools that clutter the UI)
  private static readonly DEFAULT_HIDDEN_TOOLS = [
    'Read',
    'Edit',
    'MultiEdit',
    'TodoWrite',
  ];

  constructor(
    private readonly callbacks: JSONLParserCallbacks,
    config?: ToolFilterConfig
  ) {
    this.config = {
      hiddenTools:
        config?.hiddenTools ?? JSONLStreamParser.DEFAULT_HIDDEN_TOOLS,
      enableSpecialFormatting: config?.enableSpecialFormatting ?? true,
    };
  }

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
    this.activeAgents.clear();
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

      case 'stream_event':
        this.handleStreamEvent(json);
        break;

      case 'result':
        this.handleResultMessage(json);
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

    // Check for agent activity correlation via parent_tool_use_id
    if (msg.parent_tool_use_id) {
      this.correlateAgentActivity(msg.parent_tool_use_id, msg);
    }

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

    // Convert JSONL message to ContentBlock array and emit single MESSAGE_CHUNK event
    const blocks: ContentBlock[] = [];

    // Streaming content delta (simple text)
    if (msg.delta) {
      blocks.push({
        type: 'text',
        text: msg.delta,
        index: msg.index,
      });
    }

    // Full content (non-streaming, simple text)
    if (msg.content) {
      blocks.push({
        type: 'text',
        text: msg.content,
        index: msg.index,
      });
    }

    // Messages API format (from --output-format stream-json)
    // Convert message.content array to ContentBlock array (preserves structure)
    if (msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text) {
          blocks.push({
            type: 'text',
            text: block.text,
            index: msg.index,
          });
        } else if (block.type === 'tool_use' && block.id && block.name) {
          // Include tool_use blocks in contentBlocks (NOT separate TOOL_START events)
          blocks.push({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: (block.input as Record<string, unknown>) || {},
            index: msg.index,
          });
        }
      }
    }

    // Emit single MESSAGE_CHUNK event with all content blocks
    if (blocks.length > 0) {
      const contentChunk: ClaudeContentChunk = {
        type: 'content',
        blocks,
        index: msg.index,
        timestamp,
      };
      this.callbacks.onContent?.(contentChunk);
    }
  }

  /**
   * Correlate agent activity from assistant messages with parent_tool_use_id
   * ONLY processes if the parent is actually a Task tool (tracked in activeAgents)
   * Regular tools with parent_tool_use_id are NOT agents, just nested tool calls
   */
  private correlateAgentActivity(
    parentToolUseId: string,
    msg: JSONLAssistantMessage
  ): void {
    const agent = this.activeAgents.get(parentToolUseId);
    if (!agent) {
      // NOT an error - regular tools can have parent_tool_use_id without being agents
      // Only Task tools create agents tracked in activeAgents map
      // Silently skip correlation if parent is not an active agent
      return;
    }

    // Extract tool information from message content (only for real agents)
    if (msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_use' && block.name) {
          const activityEvent: ClaudeAgentActivityEvent = {
            type: 'agent_activity',
            agentId: parentToolUseId,
            toolName: block.name,
            toolInput: (block.input as Record<string, unknown>) || {},
            timestamp: Date.now(),
          };
          this.callbacks.onAgentActivity?.(activityEvent);
        }
      }
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

    const toolName = msg.tool || 'unknown';

    // Check for Task tool events
    if (toolName === 'Task') {
      this.handleTaskToolEvent(msg, timestamp);
      // Continue processing as regular tool event
    }

    // Check for agent activity correlation via parent_tool_use_id
    if (msg.parent_tool_use_id) {
      this.correlateToolActivity(msg.parent_tool_use_id, msg);
    }

    // Apply tool filtering - skip hidden tools
    if (this.shouldHideTool(toolName, msg.subtype)) {
      return;
    }

    switch (msg.subtype) {
      case 'start': {
        const event: ClaudeToolEvent = {
          type: 'start',
          toolCallId: msg.tool_call_id,
          tool: toolName,
          args: this.formatToolArgs(toolName, msg.args || {}),
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
          output: this.formatToolOutput(toolName, msg.output),
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
   * Handle Task tool events for agent lifecycle tracking
   */
  private handleTaskToolEvent(msg: JSONLToolMessage, timestamp: number): void {
    if (!msg.tool_call_id || !msg.subtype) {
      return;
    }

    switch (msg.subtype) {
      case 'start': {
        // Extract agent metadata from Task tool args
        const args = msg.args || {};
        const subagentType = this.extractString(args, 'subagent_type');
        const description = this.extractString(args, 'description');
        const prompt = this.extractString(args, 'prompt');
        const model = this.extractStringOptional(args, 'model');

        if (!subagentType || !description || !prompt) {
          // Missing required fields - log warning
          this.callbacks.onError?.(
            new Error('Task tool start missing required args'),
            JSON.stringify(args)
          );
          return;
        }

        // Store agent metadata
        const metadata: AgentMetadata = {
          agentId: msg.tool_call_id,
          subagentType,
          description,
          prompt,
          model,
          startTime: timestamp,
        };
        this.activeAgents.set(msg.tool_call_id, metadata);

        // Emit agent start event
        const startEvent: ClaudeAgentStartEvent = {
          type: 'agent_start',
          agentId: msg.tool_call_id,
          subagentType,
          description,
          prompt,
          model,
          timestamp,
        };
        this.callbacks.onAgentStart?.(startEvent);
        break;
      }

      case 'result': {
        // Task tool completion
        const agent = this.activeAgents.get(msg.tool_call_id);
        if (!agent) {
          // Agent not found - may have been already cleaned up or never started
          return;
        }

        const duration = timestamp - agent.startTime;
        const result = this.extractStringOptional(msg.output, 'result');

        // Emit agent complete event
        const completeEvent: ClaudeAgentCompleteEvent = {
          type: 'agent_complete',
          agentId: msg.tool_call_id,
          duration,
          result,
          timestamp,
        };
        this.callbacks.onAgentComplete?.(completeEvent);

        // Cleanup: Remove from activeAgents map to prevent memory leaks
        this.activeAgents.delete(msg.tool_call_id);
        break;
      }

      case 'error': {
        // Task tool error - cleanup agent state
        const agent = this.activeAgents.get(msg.tool_call_id);
        if (agent) {
          const duration = timestamp - agent.startTime;

          // Emit agent complete event with error indication
          const completeEvent: ClaudeAgentCompleteEvent = {
            type: 'agent_complete',
            agentId: msg.tool_call_id,
            duration,
            result: `Error: ${msg.error || 'Unknown error'}`,
            timestamp,
          };
          this.callbacks.onAgentComplete?.(completeEvent);

          // Cleanup
          this.activeAgents.delete(msg.tool_call_id);
        }
        break;
      }

      // 'progress' subtype not handled for Task tool
    }
  }

  /**
   * Correlate tool activity from tool messages with parent_tool_use_id
   * ONLY processes if the parent is actually a Task tool (tracked in activeAgents)
   * Regular tools with parent_tool_use_id are NOT agents, just nested tool calls
   */
  private correlateToolActivity(
    parentToolUseId: string,
    msg: JSONLToolMessage
  ): void {
    const agent = this.activeAgents.get(parentToolUseId);
    if (!agent) {
      // NOT an error - regular tools can have parent_tool_use_id without being agents
      // Only Task tools create agents tracked in activeAgents map
      // Silently skip correlation if parent is not an active agent
      return;
    }

    // Only emit activity for tool start events (only for real agents)
    if (msg.subtype === 'start' && msg.tool) {
      const activityEvent: ClaudeAgentActivityEvent = {
        type: 'agent_activity',
        agentId: parentToolUseId,
        toolName: msg.tool,
        toolInput: msg.args || {},
        timestamp: Date.now(),
      };
      this.callbacks.onAgentActivity?.(activityEvent);
    }
  }

  /**
   * Extract string from unknown record
   */
  private extractString(
    record: Record<string, unknown>,
    key: string
  ): string | undefined {
    const value = record[key];
    return typeof value === 'string' ? value : undefined;
  }

  /**
   * Extract optional string from unknown value
   */
  private extractStringOptional(
    value: unknown,
    key?: string
  ): string | undefined {
    if (key && typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>;
      const extracted = record[key];
      return typeof extracted === 'string' ? extracted : undefined;
    }
    return typeof value === 'string' ? value : undefined;
  }

  /**
   * Determine if a tool should be hidden from output
   */
  private shouldHideTool(toolName: string, subtype: string): boolean {
    // Only hide result messages (keep start/error for transparency)
    if (subtype !== 'result') {
      return false;
    }

    return this.config.hiddenTools?.includes(toolName) ?? false;
  }

  /**
   * Format tool arguments with special formatting
   */
  private formatToolArgs(
    toolName: string,
    args: Record<string, unknown>
  ): Record<string, unknown> {
    if (!this.config.enableSpecialFormatting) {
      return args;
    }

    // Add special formatting for specific tools if needed
    // Currently args are passed through unchanged
    return args;
  }

  /**
   * Format tool output with special formatting (e.g., TodoWrite)
   */
  private formatToolOutput(toolName: string, output: unknown): unknown {
    if (!this.config.enableSpecialFormatting) {
      return output;
    }

    // Special formatting for TodoWrite
    if (toolName === 'TodoWrite' && this.isTodoWriteOutput(output)) {
      return this.formatTodoWriteOutput(output);
    }

    return output;
  }

  /**
   * Check if output is TodoWrite format
   */
  private isTodoWriteOutput(
    output: unknown
  ): output is { todos: Array<{ content: string; status: string }> } {
    return (
      typeof output === 'object' &&
      output !== null &&
      'todos' in output &&
      Array.isArray((output as { todos?: unknown }).todos)
    );
  }

  /**
   * Format TodoWrite output with checkmarks
   */
  private formatTodoWriteOutput(output: {
    todos: Array<{ content: string; status: string }>;
  }): string {
    let formatted = '📝 Todo List Update:\n';

    for (const todo of output.todos) {
      const status =
        todo.status === 'completed'
          ? '✅'
          : todo.status === 'in_progress'
          ? '🔄'
          : '⏳';
      formatted += `${status} ${todo.content}\n`;
    }

    return formatted.trim();
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

  /**
   * Handle result messages (final response with cost/usage/duration)
   */
  private handleResultMessage(msg: JSONLResultMessage): void {
    console.log('[JSONLStreamParser] result message received:', {
      subtype: msg.subtype,
      duration: msg.duration_ms,
      cost: msg.total_cost_usd,
      tokens: msg.usage,
    });

    this.callbacks.onResult?.(msg);
  }

  /**
   * Handle stream_event messages (with --include-partial-messages flag)
   *
   * Stream events have the format:
   * {"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello! "}}}
   * {"type":"stream_event","event":{"type":"message_start","message":{"model":"...","id":"msg_..."}}}
   */
  private handleStreamEvent(msg: JSONLStreamEvent): void {
    const timestamp = Date.now();

    // Handle message_start event (contains session_id and model info)
    if (msg.event.type === 'message_start' && msg.session_id) {
      const model = msg.event.message?.model;
      this.callbacks.onSessionInit?.(msg.session_id, model);
      return;
    }

    // Handle content_block_delta events (streaming text chunks)
    if (msg.event.type === 'content_block_delta' && msg.event.delta) {
      // Handle text deltas (actual content)
      if (msg.event.delta.type === 'text_delta' && msg.event.delta.text) {
        const contentChunk: ClaudeContentChunk = {
          type: 'content',
          blocks: [
            {
              type: 'text',
              text: msg.event.delta.text,
              index: msg.event.index,
            },
          ],
          index: msg.event.index,
          timestamp,
        };
        this.callbacks.onContent?.(contentChunk);
      }
      // Skip input_json_delta (tool input construction) - not user-facing content
      return;
    }

    // CRITICAL: Handle message_stop to signal end of streaming
    if (msg.event.type === 'message_stop') {
      console.log(
        '[JSONLStreamParser] message_stop received - streaming complete'
      );
      this.callbacks.onMessageStop?.();
      return;
    }

    // Other stream events (content_block_start, content_block_stop, message_delta)
    // are metadata events that we don't need to process for content streaming
  }
}
