/**
 * SDK Message Transformer - Converts SDK messages to ExecutionNode format
 *
 * Transforms messages from the official Claude Agent SDK into the ExecutionNode
 * tree structure required by the Ptah UI layer.
 */

import { injectable, inject } from 'tsyringe';
import {
  ExecutionNode,
  ExecutionNodeType,
  ExecutionStatus,
  SessionId,
  createExecutionNode,
  calculateMessageCost,
} from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';

/**
 * SDK Types - Manually defined to avoid ESM/CommonJS import issues
 *
 * The SDK package is ESM-only ("type": "module"), but this library is CommonJS.
 * We manually define the types we need from the SDK to avoid TS1479 errors.
 * These types are extracted from @anthropic-ai/claude-agent-sdk/sdk.d.ts
 *
 * Note: These types use structural typing to match SDK types without imports.
 * We use `any` strategically in nested types to maintain compatibility while
 * preserving type safety at the API boundary.
 */

/**
 * Generic SDK message type - accepts any SDK message
 * We perform runtime type checking via switch/case on the 'type' field
 */
type SDKMessage = {
  type: string;
  [key: string]: any;
};

/**
 * Assistant message type (for internal type hints)
 */
type SDKAssistantMessage = SDKMessage & {
  type: 'assistant';
};

/**
 * User message type (for internal type hints)
 */
type SDKUserMessage = SDKMessage & {
  type: 'user';
};

/**
 * System message type (for internal type hints)
 */
type SDKSystemMessage = SDKMessage & {
  type: 'system';
  subtype: string;
};

/**
 * Result message type (for internal type hints)
 * Strict type with all required stats fields
 */
type SDKResultMessage = SDKMessage & {
  type: 'result';
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  duration_ms: number;
};

/**
 * Content block types from Anthropic SDK
 * (defined locally to avoid ESM import issues)
 */
interface TextBlock {
  type: 'text';
  text: string;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultBlockParam {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | unknown;
  is_error?: boolean;
}

/**
 * Type guard for TextBlock from Anthropic SDK
 */
function isTextBlock(block: unknown): block is TextBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    block.type === 'text' &&
    'text' in block
  );
}

/**
 * Type guard for ToolUseBlock from Anthropic SDK
 */
function isToolUseBlock(block: unknown): block is ToolUseBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    block.type === 'tool_use' &&
    'id' in block &&
    'name' in block &&
    'input' in block
  );
}

/**
 * Type guard for ToolResultBlockParam
 */
function isToolResultBlock(block: unknown): block is ToolResultBlockParam {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    block.type === 'tool_result' &&
    'tool_use_id' in block
  );
}

/**
 * Type guard for SDKResultMessage
 * Validates that result message has all required stats fields.
 * Uses bracket notation for index signature compatibility (TS4111).
 */
function isSDKResultMessage(msg: SDKMessage): msg is SDKResultMessage {
  if (msg.type !== 'result') return false;

  // Check top-level required fields exist and have correct types
  if (
    !('total_cost_usd' in msg) ||
    !('usage' in msg) ||
    !('duration_ms' in msg) ||
    typeof msg['total_cost_usd'] !== 'number' ||
    typeof msg['duration_ms'] !== 'number'
  ) {
    return false;
  }

  // Validate nested usage object
  const usage = msg['usage'];
  if (typeof usage !== 'object' || usage === null) return false;

  return (
    'input_tokens' in usage &&
    'output_tokens' in usage &&
    typeof usage.input_tokens === 'number' &&
    typeof usage.output_tokens === 'number'
  );
}

/**
 * Export type guard for external use
 */
export { isSDKResultMessage };

/**
 * SdkMessageTransformer - Transforms SDK messages to ExecutionNode hierarchy
 *
 * Handles message transformation with proper parent-child relationships,
 * agent detection (Task tool), and metadata preservation.
 */
@injectable()
export class SdkMessageTransformer {
  constructor(@inject(TOKENS.LOGGER) private logger: Logger) {}

  /**
   * Transform SDK message to ExecutionNode array
   *
   * A single SDK message may produce multiple ExecutionNodes:
   * - SDKAssistantMessage → message node + children (text, tool_use, tool_result)
   * - SDKUserMessage → message node with raw content
   * - SDKSystemMessage → system node
   * - SDKResultMessage → system node with result summary
   *
   * @param sdkMessage - SDK message to transform (uses structural typing to match SDK types)
   * @param sessionId - Optional session ID for node correlation
   * @returns Array of ExecutionNode (typically 1, but could be multiple for nested content)
   */
  transform(sdkMessage: SDKMessage, sessionId?: SessionId): ExecutionNode[] {
    try {
      switch (sdkMessage.type) {
        case 'assistant':
          return this.transformAssistantMessage(
            sdkMessage as SDKAssistantMessage,
            sessionId
          );

        case 'user':
          return this.transformUserMessage(
            sdkMessage as SDKUserMessage,
            sessionId
          );

        case 'system':
          // Skip system messages (init, etc.) - they contain metadata
          // that shouldn't be displayed as chat messages in the UI.
          // Session info can be shown in a separate UI element if needed.
          return [];

        case 'result':
          // Skip result messages - they contain session summary metadata
          // (cost, duration, tokens) that shouldn't appear as chat bubbles.
          // This data can be shown in a session info panel if needed.
          return [];

        case 'stream_event':
          // Skip partial streaming events - the complete 'assistant' message
          // will contain all accumulated text. Processing stream_events causes
          // duplicate messages (each chunk + the final complete message).
          return [];

        default:
          this.logger.warn(
            '[SdkMessageTransformer] Unknown message type',
            sdkMessage
          );
          return [];
      }
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        '[SdkMessageTransformer] Transformation failed',
        errorObj
      );
      return [];
    }
  }

  /**
   * Transform SDKAssistantMessage to ExecutionNode
   *
   * Assistant messages contain content blocks: text, tool_use, thinking.
   * Each block becomes a child node of the message node.
   */
  private transformAssistantMessage(
    sdkMessage: SDKAssistantMessage,
    sessionId?: SessionId
  ): ExecutionNode[] {
    const { uuid, message, parent_tool_use_id } = sdkMessage;

    // Extract content blocks from Anthropic SDK message
    const content = message.content || [];

    // Determine completion status from stop_reason
    // If stop_reason exists, message is complete; otherwise still streaming
    const isMessageComplete = !!message.stop_reason;
    const messageStatus: ExecutionStatus = isMessageComplete
      ? 'complete'
      : 'streaming';

    // Create child nodes from content blocks
    const children: ExecutionNode[] = [];

    for (const block of content) {
      if (isTextBlock(block)) {
        // Text content block - use dynamic status based on stop_reason
        children.push(
          createExecutionNode({
            id: `${uuid}-text-${children.length}`,
            type: 'text' as ExecutionNodeType,
            status: messageStatus,
            content: block.text,
          })
        );
      } else if (isToolUseBlock(block)) {
        // Tool use block - check if it's a Task tool (agent spawn)
        const isTaskTool = block.name === 'Task';

        // Extract agent info from Task tool input
        const agentType = isTaskTool
          ? (block.input as { subagent_type?: string }).subagent_type
          : undefined;
        const agentDescription = isTaskTool
          ? (block.input as { description?: string }).description
          : undefined;
        const agentPrompt = isTaskTool
          ? (block.input as { prompt?: string }).prompt
          : undefined;

        children.push(
          createExecutionNode({
            id: block.id,
            type: isTaskTool
              ? ('agent' as ExecutionNodeType)
              : ('tool' as ExecutionNodeType),
            status: 'pending' as ExecutionStatus, // Will be updated when tool_result arrives
            content: null,
            toolName: block.name,
            toolInput: block.input as Record<string, unknown>,
            toolCallId: block.id,
            // Agent-specific fields (only for Task tool)
            agentType,
            agentDescription,
            agentPrompt,
          })
        );
      }
      // TODO: Handle thinking blocks if SDK exposes them
    }

    // Extract usage metrics if available
    const tokenUsage =
      message.usage &&
      'input_tokens' in message.usage &&
      'output_tokens' in message.usage
        ? {
            input: message.usage.input_tokens,
            output: message.usage.output_tokens,
          }
        : undefined;

    // Calculate cost from usage (using model for accurate pricing)
    const cost = tokenUsage
      ? calculateMessageCost(message.model || '', tokenUsage)
      : undefined;

    // Create message node - use dynamic status based on stop_reason
    const messageNode = createExecutionNode({
      id: uuid,
      type: 'message' as ExecutionNodeType,
      status: messageStatus,
      content: null, // Content is in children
      children,
      tokenUsage,
      cost,
      model: message.model,
      // Link to parent if nested under agent
      // parent_tool_use_id is used for correlation but not stored in ExecutionNode
    });

    return [messageNode];
  }

  /**
   * Transform SDKUserMessage to ExecutionNode
   */
  private transformUserMessage(
    sdkMessage: SDKUserMessage,
    sessionId?: SessionId
  ): ExecutionNode[] {
    const { uuid, message } = sdkMessage;

    // Extract text content from user message
    let textContent = '';
    if (typeof message.content === 'string') {
      textContent = message.content;
    } else if (Array.isArray(message.content)) {
      // Concatenate text blocks
      textContent = message.content
        .filter(isTextBlock)
        .map((block: TextBlock) => block.text)
        .join('\n');
    }

    const userNode = createExecutionNode({
      id: uuid || `user-${Date.now()}`,
      type: 'message' as ExecutionNodeType,
      status: 'complete' as ExecutionStatus,
      content: textContent,
    });

    return [userNode];
  }

  /**
   * Transform SDKSystemMessage to ExecutionNode
   */
  private transformSystemMessage(
    sdkMessage: SDKSystemMessage,
    sessionId?: SessionId
  ): ExecutionNode[] {
    const { uuid, subtype, session_id, model, cwd, tools, mcp_servers } =
      sdkMessage;

    // Create system initialization message
    const systemContent = [
      `Session: ${session_id}`,
      `Model: ${model}`,
      `Working Directory: ${cwd}`,
      `Tools: ${tools.join(', ')}`,
      mcp_servers.length > 0
        ? `MCP Servers: ${mcp_servers
            .map((s: any) => `${s.name} (${s.status})`)
            .join(', ')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');

    const systemNode = createExecutionNode({
      id: uuid,
      type: 'system' as ExecutionNodeType,
      status: 'complete' as ExecutionStatus,
      content: systemContent,
    });

    return [systemNode];
  }

  /**
   * Transform SDKResultMessage to ExecutionNode
   */
  private transformResultMessage(
    sdkMessage: SDKResultMessage,
    sessionId?: SessionId
  ): ExecutionNode[] {
    const { uuid, subtype, duration_ms, total_cost_usd, usage, num_turns } =
      sdkMessage;

    // Check if error result
    const isError = sdkMessage['subtype'] !== 'success';
    const errorInfo =
      isError && 'errors' in sdkMessage
        ? (sdkMessage as unknown as { errors: string[] }).errors.join('\n')
        : undefined;

    // Create result summary content
    const resultContent = [
      `Status: ${subtype}`,
      `Turns: ${num_turns}`,
      `Duration: ${(duration_ms / 1000).toFixed(2)}s`,
      `Cost: $${total_cost_usd.toFixed(4)}`,
      `Tokens: ${usage['input_tokens']} in / ${usage['output_tokens']} out`,
      errorInfo ? `Errors: ${errorInfo}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const resultNode = createExecutionNode({
      id: uuid,
      type: 'system' as ExecutionNodeType,
      status: isError
        ? ('error' as ExecutionStatus)
        : ('complete' as ExecutionStatus),
      content: resultContent,
      error: errorInfo,
      duration: duration_ms,
      tokenUsage: {
        input: usage['input_tokens'],
        output: usage['output_tokens'],
      },
    });

    return [resultNode];
  }

  /**
   * Transform SDK stream_event (partial assistant message) to ExecutionNode
   *
   * stream_event messages contain real-time streaming content from the API.
   * The event field contains RawMessageStreamEvent with various event types:
   * - content_block_start: New content block beginning
   * - content_block_delta: Partial text or other content
   * - content_block_stop: Content block finished
   * - message_start/message_delta/message_stop: Message lifecycle events
   */
  private transformStreamEvent(
    sdkMessage: SDKMessage,
    sessionId?: SessionId
  ): ExecutionNode[] {
    const { uuid, event } = sdkMessage;

    // Skip non-content events
    if (!event || typeof event !== 'object') {
      return [];
    }

    const eventType = (event as { type?: string }).type;

    // Handle content_block_delta events - these contain streaming text
    if (eventType === 'content_block_delta') {
      const delta = (event as { delta?: { type?: string; text?: string } })
        .delta;
      if (delta?.type === 'text_delta' && delta.text) {
        // Create a text node with streaming status
        const textNode = createExecutionNode({
          id: uuid || `stream-${Date.now()}`,
          type: 'text' as ExecutionNodeType,
          status: 'streaming' as ExecutionStatus,
          content: delta.text,
        });
        return [textNode];
      }
    }

    // Handle content_block_start for new content blocks
    if (eventType === 'content_block_start') {
      const contentBlock = (
        event as { content_block?: { type?: string; text?: string } }
      ).content_block;
      if (contentBlock?.type === 'text' && contentBlock.text) {
        const textNode = createExecutionNode({
          id: uuid || `stream-start-${Date.now()}`,
          type: 'text' as ExecutionNodeType,
          status: 'streaming' as ExecutionStatus,
          content: contentBlock.text,
        });
        return [textNode];
      }
    }

    // Other event types (message_start, message_stop, etc.) don't need nodes
    return [];
  }

  /**
   * Update existing node with tool result
   *
   * When a tool_result message arrives, find the corresponding tool_use node
   * and update it with the result.
   *
   * This method is called externally when processing tool_result blocks.
   */
  updateToolResult(
    toolUseId: string,
    output: unknown,
    isError: boolean,
    nodes: readonly ExecutionNode[]
  ): void {
    // Find the tool node by toolCallId
    const toolNode = this.findNodeById(toolUseId, nodes);

    if (!toolNode) {
      this.logger.warn(
        `[SdkMessageTransformer] Tool node not found: ${toolUseId}`
      );
      return;
    }

    // Update tool node with result
    // Note: ExecutionNode is readonly, so this is a conceptual update
    // In practice, the caller should recreate the node with updated fields
    this.logger.debug(
      `[SdkMessageTransformer] Updating tool result for: ${toolUseId}`,
      {
        isError,
        output,
      }
    );
  }

  /**
   * Find node by ID in tree (recursive search)
   */
  private findNodeById(
    id: string,
    nodes: readonly ExecutionNode[]
  ): ExecutionNode | null {
    for (const node of nodes) {
      if (node.id === id || node.toolCallId === id) {
        return node;
      }

      // Search children recursively
      if (node.children.length > 0) {
        const found = this.findNodeById(id, node.children);
        if (found) {
          return found;
        }
      }
    }

    return null;
  }
}
