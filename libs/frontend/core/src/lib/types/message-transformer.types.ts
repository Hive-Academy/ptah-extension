/**
 * Message Transformer Types - STUB IMPLEMENTATION
 *
 * These types were originally part of ClaudeMessageTransformerService
 * which was deleted in Phase 0 (RPC Migration).
 *
 * This file provides stub types to maintain compilation during the transition.
 * Components using these types should eventually migrate to StrictChatMessage.
 *
 * TODO (Phase 4): Migrate components to use StrictChatMessage directly
 * TODO (Phase 4): Remove this stub file once all components updated
 */

import { StrictChatMessage } from '@ptah-extension/shared';

/**
 * Processed Claude Message - STUB
 *
 * Extended StrictChatMessage with legacy properties for backward compatibility.
 * Components still expect old interface with content, tokenUsage, toolsUsed, hasImages.
 *
 * TODO (Phase 4): Migrate components to use StrictChatMessage.contentBlocks directly
 */
export interface ProcessedClaudeMessage extends StrictChatMessage {
  readonly content?: string; // Legacy: mapped from contentBlocks
  readonly tokenUsage?: {
    // Legacy: mapped from tokens
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  };
  readonly toolsUsed?: readonly string[]; // Legacy: extracted from contentBlocks
  readonly hasImages?: boolean; // Legacy: detected from files array
}

/**
 * Claude Content Block - STUB
 *
 * Represents individual content blocks in Claude messages.
 */
export interface ClaudeContent {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | unknown[];
}

/**
 * Extracted File Info - STUB
 *
 * File metadata extracted from message content.
 */
export interface ExtractedFileInfo {
  path: string;
  type: string;
  extension?: string;
  isImage?: boolean;
}

/**
 * Tool Usage Summary - STUB
 */
export interface ToolUsageSummary {
  toolName: string;
  count: number;
  status: 'success' | 'error' | 'pending';
}

/**
 * Content Processing Result - STUB
 */
export interface ContentProcessingResult {
  contentBlocks: ClaudeContent[];
  extractedFiles: ExtractedFileInfo[];
  toolSummary: ToolUsageSummary[];
}

/**
 * Type guard - Check if content is text
 * @param content - Content block to check
 * @returns True if content is text type
 */
export function isTextContent(content: ClaudeContent): boolean {
  return content.type === 'text';
}

/**
 * Type guard - Check if content is tool use
 * @param content - Content block to check
 * @returns True if content is tool use type
 */
export function isToolUseContent(content: ClaudeContent): boolean {
  return content.type === 'tool_use';
}

/**
 * Type guard - Check if content is tool result
 * @param content - Content block to check
 * @returns True if content is tool result type
 */
export function isToolResultContent(content: ClaudeContent): boolean {
  return content.type === 'tool_result';
}

/**
 * Type guard - Check if content is thinking
 * @param content - Content block to check
 * @returns True if content is thinking type
 */
export function isThinkingContent(content: ClaudeContent): boolean {
  return content.type === 'thinking';
}

/**
 * Extract file paths from text content - STUB
 *
 * TODO: Implement or remove usage
 *
 * @param text - Text to extract from
 * @returns Array of file paths (empty stub)
 */
export function extractFilePathsFromText(_text: string): string[] {
  // Stub implementation - returns empty array
  return [];
}

/**
 * Detect file type from path - STUB
 *
 * TODO: Implement or remove usage
 *
 * @param path - File path to detect type from
 * @returns File type string ('unknown' stub)
 */
export function detectFileType(_path: string): string {
  // Stub implementation - returns 'unknown'
  return 'unknown';
}
