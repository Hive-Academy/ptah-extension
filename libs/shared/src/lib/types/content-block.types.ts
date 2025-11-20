/**
 * Content Block Types - Foundation Layer
 * CRITICAL: These types MUST match Claude CLI v0.3+ contentBlocks format exactly
 */

/**
 * Base content block type discriminator
 */
export type ContentBlockType = 'text' | 'thinking' | 'tool_use' | 'tool_result';

/**
 * Text content block (standard Claude response)
 */
export interface TextContentBlock {
  type: 'text';
  text: string;
}

/**
 * Thinking content block (Claude's reasoning process)
 */
export interface ThinkingContentBlock {
  type: 'thinking';
  thinking: string;
}

/**
 * Tool use content block (Claude invoking tools)
 */
export interface ToolUseContentBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Tool result content block (tool execution results)
 */
export interface ToolResultContentBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<{ type: string; [key: string]: unknown }>;
  is_error?: boolean;
}

/**
 * Union type for all content blocks
 */
export type ContentBlock =
  | TextContentBlock
  | ThinkingContentBlock
  | ToolUseContentBlock
  | ToolResultContentBlock;

/**
 * Type guards for content blocks
 */
export const isTextBlock = (block: ContentBlock): block is TextContentBlock =>
  block.type === 'text';

export const isThinkingBlock = (
  block: ContentBlock
): block is ThinkingContentBlock => block.type === 'thinking';

export const isToolUseBlock = (
  block: ContentBlock
): block is ToolUseContentBlock => block.type === 'tool_use';

export const isToolResultBlock = (
  block: ContentBlock
): block is ToolResultContentBlock => block.type === 'tool_result';
