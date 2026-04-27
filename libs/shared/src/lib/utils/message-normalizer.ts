/**
 * MessageNormalizer - Convert all message formats to contentBlocks
 *
 * Handles:
 * - content: string → contentBlocks: [{type:'text',text}]
 * - content: Array → contentBlocks: Array (map types)
 * - Edge cases: empty, malformed, tool_use, thinking blocks
 *
 * Location: libs/shared/src/lib/utils/message-normalizer.ts
 */

import type {
  ContentBlock,
  TextContentBlock,
  ThinkingContentBlock,
  ToolUseContentBlock,
  ToolResultContentBlock,
} from '../types/content-block.types';

export class MessageNormalizer {
  /**
   * Normalize any message format to contentBlocks: Array
   *
   * @param message - Message with content: string OR content: Array
   * @returns Normalized message with contentBlocks: Array
   */
  static normalize(message: { role: string; content: string | unknown[] }): {
    contentBlocks: ContentBlock[];
  } {
    // Case 1: String content (legacy format)
    if (typeof message.content === 'string') {
      return {
        contentBlocks: [
          {
            type: 'text',
            text: message.content,
          } as TextContentBlock,
        ],
      };
    }

    // Case 2: Array content (Claude CLI format)
    if (Array.isArray(message.content)) {
      return {
        contentBlocks: message.content.map((block) =>
          this.normalizeContentBlock(block),
        ),
      };
    }

    // Case 3: Empty/null/undefined content
    return {
      contentBlocks: [
        {
          type: 'text',
          text: '',
        } as TextContentBlock,
      ],
    };
  }

  /**
   * Normalize individual content block
   *
   * Maps Claude API types to our ContentBlock union
   */
  private static normalizeContentBlock(block: unknown): ContentBlock {
    if (!block || typeof block !== 'object') {
      return { type: 'text', text: '' } as TextContentBlock;
    }

    const obj = block as Record<string, unknown>;

    // Text block
    if (obj['type'] === 'text' && typeof obj['text'] === 'string') {
      return { type: 'text', text: obj['text'] } as TextContentBlock;
    }

    // Tool use block
    if (obj['type'] === 'tool_use') {
      return {
        type: 'tool_use',
        id: String(obj['id'] || ''),
        name: String(obj['name'] || ''),
        input: obj['input'] as Record<string, unknown>,
      } as ToolUseContentBlock;
    }

    // Thinking block
    if (obj['type'] === 'thinking' && typeof obj['thinking'] === 'string') {
      return {
        type: 'thinking',
        thinking: obj['thinking'],
      } as ThinkingContentBlock;
    }

    // Tool result block
    if (obj['type'] === 'tool_result') {
      return {
        type: 'tool_result',
        tool_use_id: String(obj['tool_use_id'] || ''),
        content: Array.isArray(obj['content'])
          ? (obj['content'] as ToolResultContentBlock['content'])
          : String(obj['content'] ?? ''),
        is_error: Boolean(obj['is_error']),
      } as ToolResultContentBlock;
    }

    // Unknown type - default to text
    return {
      type: 'text',
      text: JSON.stringify(block),
    } as TextContentBlock;
  }

  /**
   * Validate contentBlocks structure (defensive check)
   */
  static isValidContentBlocks(
    contentBlocks: unknown,
  ): contentBlocks is ContentBlock[] {
    if (!Array.isArray(contentBlocks)) {
      return false;
    }

    return contentBlocks.every(
      (block) =>
        block &&
        typeof block === 'object' &&
        'type' in block &&
        typeof block.type === 'string',
    );
  }
}
