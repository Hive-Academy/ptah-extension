/**
 * SessionProxy Unit Tests
 * Testing file system access patterns for ~/.claude/projects/{encoded}/ directory
 *
 * Test Coverage:
 * - Empty directory returns []
 * - Directory with 5 sessions returns 5 summaries
 * - Corrupt JSONL file is skipped gracefully
 * - Non-existent directory returns [] (not error)
 * - getSessionDetails returns parsed session
 * - getSessionDetails with invalid ID returns null
 * - 373 sessions parsed successfully (performance test)
 * - Path encoding verified (Windows path → encoded directory)
 */

import 'reflect-metadata'; // Required for tsyringe
import { SessionProxy } from './session-proxy';
import { WorkspacePathEncoder } from './workspace-path-encoder';
import { JsonlSessionParser } from './jsonl-session-parser';
import { promises as fs } from 'fs';
import * as path from 'path';

// Mock fs.promises
jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    readdir: jest.fn(),
    readFile: jest.fn(),
  },
}));

// Mock WorkspacePathEncoder
jest.mock('./workspace-path-encoder');

// Mock JsonlSessionParser
jest.mock('./jsonl-session-parser');

// Mock path (use actual implementation but allow spying)
jest.mock('path', () => {
  const actualPath = jest.requireActual('path');
  return {
    ...actualPath,
    join: jest.fn((...args: string[]) => actualPath.join(...args)),
    basename: jest.fn((...args: string[]) => actualPath.basename(...args)),
  };
});

describe('SessionProxy', () => {
  let sessionProxy: SessionProxy;
  const mockWorkspaceRoot = 'D:\\projects\\ptah-extension';
  const mockEncodedPath = 'd--projects-ptah-extension';
  const mockSessionsDir = `C:\\Users\\testuser\\.claude\\projects\\${mockEncodedPath}`;

  beforeEach(() => {
    sessionProxy = new SessionProxy();
    jest.clearAllMocks();

    // Setup default mock for WorkspacePathEncoder
    (WorkspacePathEncoder.getSessionsDirectory as jest.Mock).mockReturnValue(
      mockSessionsDir
    );
    (WorkspacePathEncoder.encodeWorkspacePath as jest.Mock).mockReturnValue(
      mockEncodedPath
    );
  });

  describe('listSessions', () => {
    it('should return empty array when directory does not exist', async () => {
      // Arrange: fs.access throws (directory doesn't exist)
      (fs.access as jest.Mock).mockRejectedValue(
        new Error('ENOENT: no such file or directory')
      );

      // Act
      const result = await sessionProxy.listSessions(mockWorkspaceRoot);

      // Assert
      expect(result).toEqual([]);
      expect(WorkspacePathEncoder.getSessionsDirectory).toHaveBeenCalledWith(
        mockWorkspaceRoot
      );
      expect(fs.access).toHaveBeenCalledWith(mockSessionsDir);
      expect(fs.readdir).not.toHaveBeenCalled();
    });

    it('should return empty array when directory is empty', async () => {
      // Arrange: Directory exists but has no files
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await sessionProxy.listSessions(mockWorkspaceRoot);

      // Assert
      expect(result).toEqual([]);
      expect(fs.readdir).toHaveBeenCalled();
    });

    it('should return empty array when directory has no JSONL files', async () => {
      // Arrange: Directory has non-JSONL files
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue([
        'readme.txt',
        '.gitignore',
        'old-session.json',
      ]);

      // Act
      const result = await sessionProxy.listSessions(mockWorkspaceRoot);

      // Assert
      expect(result).toEqual([]);
    });

    it('should return 5 session summaries when directory has 5 valid JSONL sessions', async () => {
      // Arrange: Directory with 5 JSONL session files
      const sessionFiles = [
        'abc-123.jsonl',
        'def-456.jsonl',
        'ghi-789.jsonl',
        'jkl-012.jsonl',
        'mno-345.jsonl',
      ];

      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue(sessionFiles);

      // Mock JsonlSessionParser for each session
      (JsonlSessionParser.parseSessionFile as jest.Mock).mockImplementation(
        (filePath: string) => {
          const filename =
            filePath.split('\\').pop() || filePath.split('/').pop();
          const sessionId = filename?.replace('.jsonl', '') || 'unknown';
          const index = parseInt(sessionId.split('-')[1] || '0');

          return Promise.resolve({
            name: `Session ${sessionId}`,
            messageCount: 10 + index,
            lastActiveAt: 1000000 + index,
            createdAt: 900000 + index,
          });
        }
      );

      // Act
      const result = await sessionProxy.listSessions(mockWorkspaceRoot);

      // Assert
      expect(result).toHaveLength(5);
      expect(result[0]).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        messageCount: expect.any(Number),
        lastActiveAt: expect.any(Number),
        createdAt: expect.any(Number),
      });
      // Verify sorted by lastActiveAt (newest first)
      expect(result[0].lastActiveAt).toBeGreaterThanOrEqual(
        result[1].lastActiveAt
      );
      // Verify JsonlSessionParser was called
      expect(JsonlSessionParser.parseSessionFile).toHaveBeenCalledTimes(5);
    });

    it('should skip corrupt JSONL files gracefully', async () => {
      // Arrange: 3 JSONL files, 1 corrupt
      const sessionFiles = ['good-1.jsonl', 'corrupt.jsonl', 'good-2.jsonl'];

      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue(sessionFiles);

      // Mock JsonlSessionParser: good files return metadata, corrupt throws
      (JsonlSessionParser.parseSessionFile as jest.Mock).mockImplementation(
        (filePath: string) => {
          if (filePath.includes('corrupt')) {
            return Promise.reject(
              new Error('Failed to parse session file: Invalid JSONL')
            );
          }
          return Promise.resolve({
            name: 'Valid Session',
            messageCount: 10,
            lastActiveAt: 1000000,
            createdAt: 900000,
          });
        }
      );

      // Spy on console.warn to verify graceful degradation
      const consoleWarnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => {
          // Intentionally empty - suppress console.warn during test
        });

      // Act
      const result = await sessionProxy.listSessions(mockWorkspaceRoot);

      // Assert
      expect(result).toHaveLength(2); // Only 2 good sessions
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping corrupt file'),
        expect.anything()
      );

      consoleWarnSpy.mockRestore();
    });

    it('should use workspace root path encoding', async () => {
      // Arrange
      const customWorkspace = 'D:\\custom\\workspace';
      const customEncoded = 'd--custom-workspace';
      const customSessionsDir = `C:\\Users\\testuser\\.claude\\projects\\${customEncoded}`;

      (WorkspacePathEncoder.getSessionsDirectory as jest.Mock).mockReturnValue(
        customSessionsDir
      );
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue([]);

      // Act
      await sessionProxy.listSessions(customWorkspace);

      // Assert
      expect(WorkspacePathEncoder.getSessionsDirectory).toHaveBeenCalledWith(
        customWorkspace
      );
      expect(fs.access).toHaveBeenCalledWith(customSessionsDir);
    });

    it('should sort sessions by lastActiveAt (newest first)', async () => {
      // Arrange: 3 JSONL sessions with different lastActiveAt
      const sessionFiles = [
        'old-session.jsonl',
        'newest-session.jsonl',
        'middle-session.jsonl',
      ];

      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue(sessionFiles);

      (JsonlSessionParser.parseSessionFile as jest.Mock).mockImplementation(
        (filePath: string) => {
          const fileName =
            filePath.split('\\').pop()?.replace('.jsonl', '') || '';
          const timestamps: Record<string, number> = {
            'old-session': 1000000,
            'middle-session': 2000000,
            'newest-session': 3000000,
          };
          return Promise.resolve({
            name: fileName,
            messageCount: 10,
            lastActiveAt: timestamps[fileName] || 1000000,
            createdAt: 900000,
          });
        }
      );

      // Act
      const result = await sessionProxy.listSessions(mockWorkspaceRoot);

      // Assert
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('newest-session');
      expect(result[1].id).toBe('middle-session');
      expect(result[2].id).toBe('old-session');
    });

    it('should parse 373 sessions successfully (performance test)', async () => {
      // Arrange: 373 JSONL session files
      const sessionFiles = Array.from(
        { length: 373 },
        (_, i) => `session-${i.toString().padStart(3, '0')}.jsonl`
      );

      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue(sessionFiles);

      (JsonlSessionParser.parseSessionFile as jest.Mock).mockImplementation(
        (filePath: string) => {
          const fileName =
            filePath.split('\\').pop()?.replace('.jsonl', '') || '';
          return Promise.resolve({
            name: `Session ${fileName}`,
            messageCount: Math.floor(Math.random() * 50) + 1,
            lastActiveAt: Date.now() - Math.floor(Math.random() * 1000000),
            createdAt: Date.now() - Math.floor(Math.random() * 2000000),
          });
        }
      );

      // Act
      const result = await sessionProxy.listSessions(mockWorkspaceRoot);

      // Assert
      expect(result).toHaveLength(373);
      expect(JsonlSessionParser.parseSessionFile).toHaveBeenCalledTimes(373);
      expect(result[0]).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        messageCount: expect.any(Number),
        lastActiveAt: expect.any(Number),
        createdAt: expect.any(Number),
      });
    });
  });

  describe('getSessionDetails', () => {
    it('should return JSONL content for valid session ID', async () => {
      // Arrange
      const sessionId = 'abc-123-def';
      const jsonlContent = `{"type":"summary","summary":"Test Session"}
{"uuid":"msg-1","sessionId":"${sessionId}","timestamp":"2025-01-21T10:00:00.000Z","message":{"role":"user","content":"Hello"}}
{"uuid":"msg-2","sessionId":"${sessionId}","timestamp":"2025-01-21T10:01:00.000Z","message":{"role":"assistant","content":"World"}}`;

      (fs.readFile as jest.Mock).mockResolvedValue(jsonlContent);

      // Act
      const result = await sessionProxy.getSessionDetails(
        sessionId,
        mockWorkspaceRoot
      );

      // Assert
      expect(result).toEqual({ content: jsonlContent });
      expect(WorkspacePathEncoder.getSessionsDirectory).toHaveBeenCalledWith(
        mockWorkspaceRoot
      );
      expect(fs.readFile).toHaveBeenCalledWith(
        path.join(mockSessionsDir, `${sessionId}.jsonl`),
        'utf-8'
      );
    });

    it('should return null when session file does not exist', async () => {
      // Arrange
      const sessionId = 'non-existent-session';
      (fs.readFile as jest.Mock).mockRejectedValue(
        new Error('ENOENT: no such file')
      );

      // Act
      const result = await sessionProxy.getSessionDetails(
        sessionId,
        mockWorkspaceRoot
      );

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when session file is corrupt/unreadable', async () => {
      // Arrange
      const sessionId = 'corrupt-session';
      (fs.readFile as jest.Mock).mockRejectedValue(
        new Error('Permission denied')
      );

      // Act
      const result = await sessionProxy.getSessionDetails(
        sessionId,
        mockWorkspaceRoot
      );

      // Assert
      expect(result).toBeNull();
    });

    it('should use custom workspace root when provided', async () => {
      // Arrange
      const customWorkspace = 'D:\\custom\\workspace';
      const customSessionsDir =
        'C:\\Users\\testuser\\.claude\\projects\\d--custom-workspace';
      const sessionId = 'test-session';

      (WorkspacePathEncoder.getSessionsDirectory as jest.Mock).mockReturnValue(
        customSessionsDir
      );
      (fs.readFile as jest.Mock).mockResolvedValue(
        '{"type":"summary","summary":"Test"}'
      );

      // Act
      await sessionProxy.getSessionDetails(sessionId, customWorkspace);

      // Assert
      expect(WorkspacePathEncoder.getSessionsDirectory).toHaveBeenCalledWith(
        customWorkspace
      );
      expect(fs.readFile).toHaveBeenCalledWith(
        path.join(customSessionsDir, `${sessionId}.jsonl`),
        'utf-8'
      );
    });
  });

  describe('Performance', () => {
    it('should list 373 sessions in under 100ms', async () => {
      // Arrange: 373 JSONL session files
      const sessionFiles = Array.from(
        { length: 373 },
        (_, i) => `session-${i.toString().padStart(3, '0')}.jsonl`
      );

      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue(sessionFiles);

      (JsonlSessionParser.parseSessionFile as jest.Mock).mockImplementation(
        (filePath: string) => {
          const fileName =
            filePath.split('\\').pop()?.replace('.jsonl', '') || '';
          return Promise.resolve({
            name: `Session ${fileName}`,
            messageCount: Math.floor(Math.random() * 50) + 1,
            lastActiveAt: Date.now() - Math.floor(Math.random() * 1000000),
            createdAt: Date.now() - Math.floor(Math.random() * 2000000),
          });
        }
      );

      // Act
      const startTime = performance.now();
      const result = await sessionProxy.listSessions(mockWorkspaceRoot);
      const duration = performance.now() - startTime;

      // Assert
      expect(result).toHaveLength(373);
      expect(duration).toBeLessThan(100); // < 100ms requirement
      expect(JsonlSessionParser.parseSessionFile).toHaveBeenCalledTimes(373);
    });
  });

  describe('getSessionMessages', () => {
    it('should return messages for existing session', async () => {
      // Arrange
      const sessionId = 'abc-123-def';
      const mockMessages = [
        {
          id: 'msg-1',
          sessionId: 'abc-123-def',
          type: 'user',
          contentBlocks: [{ type: 'text', text: 'Hello' }],
          timestamp: 1000000,
          streaming: false,
          isComplete: true,
        },
        {
          id: 'msg-2',
          sessionId: 'abc-123-def',
          type: 'assistant',
          contentBlocks: [{ type: 'text', text: 'Hi there' }],
          timestamp: 1000001,
          streaming: false,
          isComplete: true,
        },
      ];

      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (JsonlSessionParser.parseSessionMessages as jest.Mock).mockResolvedValue(
        mockMessages
      );

      // Act
      const result = await sessionProxy.getSessionMessages(
        sessionId as any,
        mockWorkspaceRoot
      );

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].contentBlocks).toEqual([
        { type: 'text', text: 'Hello' },
      ]);
      expect(result[1].contentBlocks).toEqual([
        { type: 'text', text: 'Hi there' },
      ]);
      expect(JsonlSessionParser.parseSessionMessages).toHaveBeenCalledWith(
        path.join(mockSessionsDir, `${sessionId}.jsonl`)
      );
    });

    it('should return empty array for non-existent session', async () => {
      // Arrange
      const sessionId = 'non-existent-session';
      (fs.access as jest.Mock).mockRejectedValue(
        new Error('ENOENT: no such file')
      );

      // Act
      const result = await sessionProxy.getSessionMessages(
        sessionId as any,
        mockWorkspaceRoot
      );

      // Assert
      expect(result).toEqual([]);
      expect(JsonlSessionParser.parseSessionMessages).not.toHaveBeenCalled();
    });

    it('should return empty array on parsing error', async () => {
      // Arrange
      const sessionId = 'corrupt-session';
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (JsonlSessionParser.parseSessionMessages as jest.Mock).mockRejectedValue(
        new Error('Parsing failed')
      );

      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {
          // Suppress console.error during test
        });

      // Act
      const result = await sessionProxy.getSessionMessages(
        sessionId as any,
        mockWorkspaceRoot
      );

      // Assert
      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('getSessionMessages failed'),
        expect.anything()
      );

      consoleErrorSpy.mockRestore();
    });

    it('should update sessionId for all messages', async () => {
      // Arrange
      const sessionId = 'new-session-id';
      const mockMessages = [
        {
          id: 'msg-1',
          sessionId: 'old-session-id', // Different session ID
          type: 'user',
          contentBlocks: [{ type: 'text', text: 'Test' }],
          timestamp: 1000000,
          streaming: false,
          isComplete: true,
        },
      ];

      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (JsonlSessionParser.parseSessionMessages as jest.Mock).mockResolvedValue(
        mockMessages
      );

      // Act
      const result = await sessionProxy.getSessionMessages(
        sessionId as any,
        mockWorkspaceRoot
      );

      // Assert
      expect(result[0].sessionId).toBe(sessionId);
    });

    it('should use custom workspace root when provided', async () => {
      // Arrange
      const customWorkspace = 'D:\\custom\\workspace';
      const customSessionsDir =
        'C:\\Users\\testuser\\.claude\\projects\\d--custom-workspace';
      const sessionId = 'test-session';

      (WorkspacePathEncoder.getSessionsDirectory as jest.Mock).mockReturnValue(
        customSessionsDir
      );
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (JsonlSessionParser.parseSessionMessages as jest.Mock).mockResolvedValue(
        []
      );

      // Act
      await sessionProxy.getSessionMessages(sessionId as any, customWorkspace);

      // Assert
      expect(WorkspacePathEncoder.getSessionsDirectory).toHaveBeenCalledWith(
        customWorkspace
      );
      expect(JsonlSessionParser.parseSessionMessages).toHaveBeenCalledWith(
        path.join(customSessionsDir, `${sessionId}.jsonl`)
      );
    });
  });
});
