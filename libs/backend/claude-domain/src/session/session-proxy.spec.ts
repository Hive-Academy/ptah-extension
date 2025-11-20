/**
 * SessionProxy Unit Tests
 * Testing file system access patterns for .claude_sessions/ directory
 *
 * Test Coverage:
 * - Empty directory returns []
 * - Directory with 5 sessions returns 5 summaries
 * - Corrupt JSON file is skipped gracefully
 * - Non-existent directory returns [] (not error)
 * - getSessionDetails returns parsed session
 * - getSessionDetails with invalid ID returns null
 */

import 'reflect-metadata'; // Required for tsyringe
import { SessionProxy } from './session-proxy';
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

// Mock os.homedir
jest.mock('os', () => ({
  homedir: jest.fn(() => '/home/testuser'),
}));

// Mock path (use actual implementation but allow spying)
jest.mock('path', () => {
  const actualPath = jest.requireActual('path');
  return {
    ...actualPath,
    join: jest.fn((...args: string[]) => actualPath.join(...args)),
  };
});

describe('SessionProxy', () => {
  let sessionProxy: SessionProxy;

  beforeEach(() => {
    sessionProxy = new SessionProxy();
    jest.clearAllMocks();
  });

  describe('listSessions', () => {
    it('should return empty array when directory does not exist', async () => {
      // Arrange: fs.access throws (directory doesn't exist)
      (fs.access as jest.Mock).mockRejectedValue(
        new Error('ENOENT: no such file or directory')
      );

      // Act
      const result = await sessionProxy.listSessions();

      // Assert
      expect(result).toEqual([]);
      expect(fs.access).toHaveBeenCalledWith(
        path.join('/home/testuser', '.claude_sessions')
      );
      expect(fs.readdir).not.toHaveBeenCalled();
    });

    it('should return empty array when directory is empty', async () => {
      // Arrange: Directory exists but has no files
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await sessionProxy.listSessions();

      // Assert
      expect(result).toEqual([]);
      expect(fs.readdir).toHaveBeenCalled();
    });

    it('should return empty array when directory has no JSON files', async () => {
      // Arrange: Directory has non-JSON files
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue(['readme.txt', '.gitignore']);

      // Act
      const result = await sessionProxy.listSessions();

      // Assert
      expect(result).toEqual([]);
    });

    it('should return 5 session summaries when directory has 5 valid sessions', async () => {
      // Arrange: Directory with 5 session files
      const sessionFiles = [
        'session-1.json',
        'session-2.json',
        'session-3.json',
        'session-4.json',
        'session-5.json',
      ];

      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue(sessionFiles);

      // Mock readFile for each session
      (fs.readFile as jest.Mock).mockImplementation((filePath: string) => {
        const sessionId = path.basename(filePath as string, '.json');
        const sessionData = {
          name: `Session ${sessionId}`,
          messages: [
            { timestamp: 1000000 + parseInt(sessionId.split('-')[1]) },
          ],
          createdAt: 900000,
        };
        return Promise.resolve(JSON.stringify(sessionData));
      });

      // Act
      const result = await sessionProxy.listSessions();

      // Assert
      expect(result).toHaveLength(5);
      expect(result[0]).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        messageCount: 1,
        lastActiveAt: expect.any(Number),
        createdAt: expect.any(Number),
      });
      // Verify sorted by lastActiveAt (newest first)
      expect(result[0].lastActiveAt).toBeGreaterThanOrEqual(
        result[1].lastActiveAt
      );
    });

    it('should skip corrupt JSON files gracefully', async () => {
      // Arrange: 3 files, 1 corrupt
      const sessionFiles = [
        'session-good-1.json',
        'session-corrupt.json',
        'session-good-2.json',
      ];

      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue(sessionFiles);

      // Mock readFile: good files return valid JSON, corrupt throws
      (fs.readFile as jest.Mock).mockImplementation((filePath: string) => {
        if ((filePath as string).includes('corrupt')) {
          return Promise.resolve('{ invalid json syntax }');
        }
        const sessionId = path.basename(filePath as string, '.json');
        return Promise.resolve(
          JSON.stringify({
            name: `Session ${sessionId}`,
            messages: [{ timestamp: 1000000 }],
            createdAt: 900000,
          })
        );
      });

      // Spy on console.warn to verify graceful degradation
      const consoleWarnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => {
          // Intentionally empty - suppress console.warn during test
        });

      // Act
      const result = await sessionProxy.listSessions();

      // Assert
      expect(result).toHaveLength(2); // Only 2 good sessions
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping corrupt file'),
        expect.anything()
      );

      consoleWarnSpy.mockRestore();
    });

    it('should use workspace root when provided', async () => {
      // Arrange
      const workspaceRoot = '/custom/workspace';
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue([]);

      // Act
      await sessionProxy.listSessions(workspaceRoot);

      // Assert
      expect(fs.access).toHaveBeenCalledWith(
        path.join(workspaceRoot, '.claude_sessions')
      );
    });

    it('should sort sessions by lastActiveAt (newest first)', async () => {
      // Arrange: 3 sessions with different lastActiveAt
      const sessionFiles = [
        'session-old.json',
        'session-newest.json',
        'session-middle.json',
      ];

      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue(sessionFiles);

      (fs.readFile as jest.Mock).mockImplementation((filePath: string) => {
        const fileName = path.basename(filePath as string, '.json');
        const timestamps: Record<string, number> = {
          'session-old': 1000000,
          'session-middle': 2000000,
          'session-newest': 3000000,
        };
        return Promise.resolve(
          JSON.stringify({
            name: fileName,
            messages: [{ timestamp: timestamps[fileName] }],
            createdAt: 900000,
          })
        );
      });

      // Act
      const result = await sessionProxy.listSessions();

      // Assert
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('session-newest');
      expect(result[1].id).toBe('session-middle');
      expect(result[2].id).toBe('session-old');
    });

    it('should handle sessions without messages (use createdAt)', async () => {
      // Arrange: Session with no messages
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue(['session-empty.json']);

      (fs.readFile as jest.Mock).mockResolvedValue(
        JSON.stringify({
          name: 'Empty Session',
          messages: [],
          createdAt: 1000000,
        })
      );

      // Act
      const result = await sessionProxy.listSessions();

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].messageCount).toBe(0);
      expect(result[0].lastActiveAt).toBe(1000000); // Should use createdAt
    });
  });

  describe('getSessionDetails', () => {
    it('should return parsed session JSON for valid session ID', async () => {
      // Arrange
      const sessionId = 'abc-123-def';
      const sessionData = {
        name: 'Test Session',
        messages: [
          { id: '1', content: 'Hello', timestamp: 1000000 },
          { id: '2', content: 'World', timestamp: 1000001 },
        ],
        createdAt: 900000,
        metadata: { userId: 'test-user' },
      };

      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(sessionData));

      // Act
      const result = await sessionProxy.getSessionDetails(sessionId);

      // Assert
      expect(result).toEqual(sessionData);
      expect(fs.readFile).toHaveBeenCalledWith(
        path.join('/home/testuser', '.claude_sessions', `${sessionId}.json`),
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
      const result = await sessionProxy.getSessionDetails(sessionId);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when session file is corrupt', async () => {
      // Arrange
      const sessionId = 'corrupt-session';
      (fs.readFile as jest.Mock).mockResolvedValue('{ invalid json }');

      // Act
      const result = await sessionProxy.getSessionDetails(sessionId);

      // Assert
      expect(result).toBeNull();
    });

    it('should use workspace root when provided', async () => {
      // Arrange
      const workspaceRoot = '/custom/workspace';
      const sessionId = 'test-session';
      (fs.readFile as jest.Mock).mockResolvedValue(
        JSON.stringify({ name: 'Test' })
      );

      // Act
      await sessionProxy.getSessionDetails(sessionId, workspaceRoot);

      // Assert
      expect(fs.readFile).toHaveBeenCalledWith(
        path.join(workspaceRoot, '.claude_sessions', `${sessionId}.json`),
        'utf-8'
      );
    });
  });

  describe('Performance', () => {
    it('should list 50 sessions in under 100ms', async () => {
      // Arrange: 50 session files
      const sessionFiles = Array.from(
        { length: 50 },
        (_, i) => `session-${i}.json`
      );

      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readdir as jest.Mock).mockResolvedValue(sessionFiles);

      (fs.readFile as jest.Mock).mockImplementation((filePath: string) => {
        const sessionId = path.basename(filePath as string, '.json');
        return Promise.resolve(
          JSON.stringify({
            name: `Session ${sessionId}`,
            messages: [{ timestamp: 1000000 }],
            createdAt: 900000,
          })
        );
      });

      // Act
      const startTime = performance.now();
      const result = await sessionProxy.listSessions();
      const duration = performance.now() - startTime;

      // Assert
      expect(result).toHaveLength(50);
      expect(duration).toBeLessThan(100); // < 100ms requirement
    });
  });
});
