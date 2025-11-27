import { MessageNormalizer } from './message-normalizer';
import type { ContentBlock } from '../types/content-block.types';

describe('MessageNormalizer', () => {
  describe('normalize()', () => {
    it('should normalize string content to contentBlocks', () => {
      const result = MessageNormalizer.normalize({
        role: 'user',
        content: 'Hello world',
      });

      expect(result.contentBlocks).toEqual([
        { type: 'text', text: 'Hello world' },
      ]);
    });

    it('should normalize empty string content', () => {
      const result = MessageNormalizer.normalize({
        role: 'user',
        content: '',
      });

      expect(result.contentBlocks).toEqual([{ type: 'text', text: '' }]);
    });

    it('should normalize array content to contentBlocks', () => {
      const result = MessageNormalizer.normalize({
        role: 'assistant',
        content: [
          { type: 'text', text: 'Response' },
          { type: 'thinking', thinking: 'Analysis...' },
        ],
      });

      expect(result.contentBlocks).toHaveLength(2);
      expect(result.contentBlocks[0]).toEqual({
        type: 'text',
        text: 'Response',
      });
      expect(result.contentBlocks[1]).toEqual({
        type: 'thinking',
        thinking: 'Analysis...',
      });
    });

    it('should handle tool_use blocks', () => {
      const result = MessageNormalizer.normalize({
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-123',
            name: 'read_file',
            input: { path: '/test.ts' },
          },
        ],
      });

      expect(result.contentBlocks[0]).toEqual({
        type: 'tool_use',
        id: 'tool-123',
        name: 'read_file',
        input: { path: '/test.ts' },
      });
    });

    it('should handle tool_result blocks', () => {
      const result = MessageNormalizer.normalize({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-123',
            content: 'File contents here',
            is_error: false,
          },
        ],
      });

      expect(result.contentBlocks[0]).toEqual({
        type: 'tool_result',
        tool_use_id: 'tool-123',
        content: 'File contents here',
        is_error: false,
      });
    });

    it('should handle tool_result blocks with errors', () => {
      const result = MessageNormalizer.normalize({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-456',
            content: 'Error: File not found',
            is_error: true,
          },
        ],
      });

      expect(result.contentBlocks[0]).toEqual({
        type: 'tool_result',
        tool_use_id: 'tool-456',
        content: 'Error: File not found',
        is_error: true,
      });
    });

    it('should handle mixed content blocks', () => {
      const result = MessageNormalizer.normalize({
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Let me check...' },
          { type: 'text', text: 'I found the answer.' },
          {
            type: 'tool_use',
            id: 'search-1',
            name: 'search',
            input: { query: 'test' },
          },
        ],
      });

      expect(result.contentBlocks).toHaveLength(3);
      expect(result.contentBlocks[0].type).toBe('thinking');
      expect(result.contentBlocks[1].type).toBe('text');
      expect(result.contentBlocks[2].type).toBe('tool_use');
    });

    it('should handle null content by returning empty text block', () => {
      const result = MessageNormalizer.normalize({
        role: 'user',
        content: null as unknown as string,
      });

      expect(result.contentBlocks).toEqual([{ type: 'text', text: '' }]);
    });

    it('should handle undefined content by returning empty text block', () => {
      const result = MessageNormalizer.normalize({
        role: 'user',
        content: undefined as unknown as string,
      });

      expect(result.contentBlocks).toEqual([{ type: 'text', text: '' }]);
    });

    it('should handle malformed block by converting to text', () => {
      const result = MessageNormalizer.normalize({
        role: 'assistant',
        content: [{ unknownType: 'something', data: 123 }],
      });

      expect(result.contentBlocks).toHaveLength(1);
      expect(result.contentBlocks[0].type).toBe('text');
      expect(result.contentBlocks[0]).toEqual({
        type: 'text',
        text: JSON.stringify({ unknownType: 'something', data: 123 }),
      });
    });

    it('should handle empty array content', () => {
      const result = MessageNormalizer.normalize({
        role: 'user',
        content: [],
      });

      expect(result.contentBlocks).toEqual([]);
    });

    it('should handle missing required fields in tool_use block', () => {
      const result = MessageNormalizer.normalize({
        role: 'assistant',
        content: [{ type: 'tool_use' }],
      });

      expect(result.contentBlocks[0]).toEqual({
        type: 'tool_use',
        id: '',
        name: '',
        input: undefined,
      });
    });

    it('should handle missing required fields in tool_result block', () => {
      const result = MessageNormalizer.normalize({
        role: 'user',
        content: [{ type: 'tool_result' }],
      });

      expect(result.contentBlocks[0]).toEqual({
        type: 'tool_result',
        tool_use_id: '',
        content: '',
        is_error: false,
      });
    });
  });

  describe('isValidContentBlocks()', () => {
    it('should return true for valid contentBlocks array', () => {
      const blocks: ContentBlock[] = [
        { type: 'text', text: 'Hello' },
        { type: 'thinking', thinking: 'Analyzing...' },
      ];

      expect(MessageNormalizer.isValidContentBlocks(blocks)).toBe(true);
    });

    it('should return false for non-array input', () => {
      expect(MessageNormalizer.isValidContentBlocks('not an array')).toBe(
        false
      );
      expect(MessageNormalizer.isValidContentBlocks(null)).toBe(false);
      expect(MessageNormalizer.isValidContentBlocks(undefined)).toBe(false);
      expect(MessageNormalizer.isValidContentBlocks({})).toBe(false);
    });

    it('should return false for array with invalid blocks', () => {
      const invalidBlocks = [{ type: 'text', text: 'Valid' }, 'invalid block'];

      expect(MessageNormalizer.isValidContentBlocks(invalidBlocks)).toBe(false);
    });

    it('should return false for array with blocks missing type field', () => {
      const invalidBlocks = [{ text: 'No type field' }];

      expect(MessageNormalizer.isValidContentBlocks(invalidBlocks)).toBe(false);
    });

    it('should return true for empty array', () => {
      expect(MessageNormalizer.isValidContentBlocks([])).toBe(true);
    });
  });
});
