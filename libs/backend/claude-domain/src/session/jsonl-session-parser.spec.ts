import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { JsonlSessionParser } from './jsonl-session-parser';
import { SessionId, MessageId } from '@ptah-extension/shared';

describe('JsonlSessionParser', () => {
  let testFilePath: string;

  beforeEach(async () => {
    testFilePath = join(
      tmpdir(),
      `test-session-${Date.now()}-${Math.random()}.jsonl`
    );
  });

  afterEach(async () => {
    try {
      await fs.unlink(testFilePath);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  describe('parseSessionMessages()', () => {
    it('should parse messages with string content', async () => {
      const jsonlContent = [
        JSON.stringify({
          type: 'summary',
          summary: 'Test Session',
          leafUuid: 'msg-3',
        }),
        JSON.stringify({
          uuid: 'msg-1',
          sessionId: 'test-session-123',
          timestamp: '2025-01-21T10:00:00.000Z',
          message: {
            role: 'user',
            content: 'Hello world',
          },
        }),
        JSON.stringify({
          uuid: 'msg-2',
          sessionId: 'test-session-123',
          timestamp: '2025-01-21T10:01:00.000Z',
          message: {
            role: 'assistant',
            content: 'Hi there!',
          },
        }),
      ].join('\n');

      await fs.writeFile(testFilePath, jsonlContent);

      const messages = await JsonlSessionParser.parseSessionMessages(
        testFilePath
      );

      expect(messages).toHaveLength(2);
      expect(messages[0].type).toBe('user');
      expect(messages[0].contentBlocks).toEqual([
        { type: 'text', text: 'Hello world' },
      ]);
      expect(messages[1].type).toBe('assistant');
      expect(messages[1].contentBlocks).toEqual([
        { type: 'text', text: 'Hi there!' },
      ]);
    });

    it('should parse messages with array content (contentBlocks)', async () => {
      const jsonlContent = [
        JSON.stringify({
          type: 'summary',
          summary: 'Test Session',
        }),
        JSON.stringify({
          uuid: 'msg-1',
          sessionId: 'test-session-123',
          timestamp: '2025-01-21T10:00:00.000Z',
          message: {
            role: 'user',
            content: [
              { type: 'text', text: 'Hello' },
              { type: 'text', text: 'world' },
            ],
          },
        }),
      ].join('\n');

      await fs.writeFile(testFilePath, jsonlContent);

      const messages = await JsonlSessionParser.parseSessionMessages(
        testFilePath
      );

      expect(messages).toHaveLength(1);
      expect(messages[0].contentBlocks).toHaveLength(2);
      expect(messages[0].contentBlocks[0]).toEqual({
        type: 'text',
        text: 'Hello',
      });
      expect(messages[0].contentBlocks[1]).toEqual({
        type: 'text',
        text: 'world',
      });
    });

    it('should parse mixed format session (string and array content)', async () => {
      const jsonlContent = [
        JSON.stringify({
          type: 'summary',
          summary: 'Mixed Session',
        }),
        JSON.stringify({
          uuid: 'msg-1',
          sessionId: 'test-session-123',
          timestamp: '2025-01-21T10:00:00.000Z',
          message: {
            role: 'user',
            content: 'Legacy string message',
          },
        }),
        JSON.stringify({
          uuid: 'msg-2',
          sessionId: 'test-session-123',
          timestamp: '2025-01-21T10:01:00.000Z',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'New array message' }],
          },
        }),
      ].join('\n');

      await fs.writeFile(testFilePath, jsonlContent);

      const messages = await JsonlSessionParser.parseSessionMessages(
        testFilePath
      );

      expect(messages).toHaveLength(2);
      // Both should have normalized contentBlocks
      expect(messages[0].contentBlocks).toEqual([
        { type: 'text', text: 'Legacy string message' },
      ]);
      expect(messages[1].contentBlocks).toEqual([
        { type: 'text', text: 'New array message' },
      ]);
    });

    it('should handle corrupt JSONL lines gracefully', async () => {
      const jsonlContent = [
        JSON.stringify({
          type: 'summary',
          summary: 'Test Session',
        }),
        'CORRUPT LINE - NOT JSON',
        JSON.stringify({
          uuid: 'msg-2',
          sessionId: 'test-session-123',
          timestamp: '2025-01-21T10:01:00.000Z',
          message: {
            role: 'user',
            content: 'Valid message',
          },
        }),
      ].join('\n');

      await fs.writeFile(testFilePath, jsonlContent);

      const messages = await JsonlSessionParser.parseSessionMessages(
        testFilePath
      );

      // Should skip corrupt line and only return valid message
      expect(messages).toHaveLength(1);
      expect(messages[0].contentBlocks).toEqual([
        { type: 'text', text: 'Valid message' },
      ]);
    });

    it('should skip non-message lines (summary, file-history-snapshot)', async () => {
      const jsonlContent = [
        JSON.stringify({
          type: 'summary',
          summary: 'Test Session',
        }),
        JSON.stringify({
          type: 'file-history-snapshot',
          data: {},
        }),
        JSON.stringify({
          uuid: 'msg-1',
          sessionId: 'test-session-123',
          timestamp: '2025-01-21T10:00:00.000Z',
          message: {
            role: 'user',
            content: 'Actual message',
          },
        }),
      ].join('\n');

      await fs.writeFile(testFilePath, jsonlContent);

      const messages = await JsonlSessionParser.parseSessionMessages(
        testFilePath
      );

      // Should only include actual message, skip summary and snapshot
      expect(messages).toHaveLength(1);
      expect(messages[0].contentBlocks).toEqual([
        { type: 'text', text: 'Actual message' },
      ]);
    });

    it('should extract sessionId from filename', async () => {
      const sessionId = '0a32ee44-4d5c-409a-8047-3ee94a591dcb';
      const customPath = join(tmpdir(), `${sessionId}.jsonl`);

      const jsonlContent = JSON.stringify({
        uuid: 'msg-1',
        sessionId: 'different-id',
        timestamp: '2025-01-21T10:00:00.000Z',
        message: {
          role: 'user',
          content: 'Test',
        },
      });

      await fs.writeFile(customPath, jsonlContent);

      try {
        const messages = await JsonlSessionParser.parseSessionMessages(
          customPath
        );

        expect(messages[0].sessionId).toBe(sessionId);
      } finally {
        await fs.unlink(customPath);
      }
    });

    it('should generate MessageId from uuid', async () => {
      const uuid = 'msg-12345';
      const jsonlContent = JSON.stringify({
        uuid,
        sessionId: 'test-session-123',
        timestamp: '2025-01-21T10:00:00.000Z',
        message: {
          role: 'user',
          content: 'Test',
        },
      });

      await fs.writeFile(testFilePath, jsonlContent);

      const messages = await JsonlSessionParser.parseSessionMessages(
        testFilePath
      );

      expect(messages[0].id).toBe(uuid);
    });

    it('should parse timestamps correctly', async () => {
      const isoTimestamp = '2025-01-21T10:30:45.123Z';
      const jsonlContent = JSON.stringify({
        uuid: 'msg-1',
        sessionId: 'test-session-123',
        timestamp: isoTimestamp,
        message: {
          role: 'user',
          content: 'Test',
        },
      });

      await fs.writeFile(testFilePath, jsonlContent);

      const messages = await JsonlSessionParser.parseSessionMessages(
        testFilePath
      );

      expect(messages[0].timestamp).toBe(new Date(isoTimestamp).getTime());
    });

    it('should handle tool_use content blocks', async () => {
      const jsonlContent = JSON.stringify({
        uuid: 'msg-1',
        sessionId: 'test-session-123',
        timestamp: '2025-01-21T10:00:00.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-123',
              name: 'read_file',
              input: { path: '/test.ts' },
            },
          ],
        },
      });

      await fs.writeFile(testFilePath, jsonlContent);

      const messages = await JsonlSessionParser.parseSessionMessages(
        testFilePath
      );

      expect(messages[0].contentBlocks[0]).toEqual({
        type: 'tool_use',
        id: 'tool-123',
        name: 'read_file',
        input: { path: '/test.ts' },
      });
    });

    it('should return empty array for empty file', async () => {
      await fs.writeFile(testFilePath, '');

      const messages = await JsonlSessionParser.parseSessionMessages(
        testFilePath
      );

      expect(messages).toEqual([]);
    });

    it('should handle messages without uuid (generate new)', async () => {
      const jsonlContent = JSON.stringify({
        // No uuid field
        sessionId: 'test-session-123',
        timestamp: '2025-01-21T10:00:00.000Z',
        message: {
          role: 'user',
          content: 'Test',
        },
      });

      await fs.writeFile(testFilePath, jsonlContent);

      const messages = await JsonlSessionParser.parseSessionMessages(
        testFilePath
      );

      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBeDefined();
      expect(typeof messages[0].id).toBe('string');
    });
  });
});
