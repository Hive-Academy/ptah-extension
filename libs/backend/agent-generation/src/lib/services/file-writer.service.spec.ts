/**
 * Agent File Writer Service Tests
 *
 * Comprehensive test suite for AgentFileWriterService covering:
 * - Single agent writing
 * - Batch agent writing with atomic operations
 * - Backup creation with timestamp format
 * - Transaction rollback on failure
 * - Path traversal protection
 * - File system error handling
 * - Directory creation
 * - Edge cases (empty content, empty batch, etc.)
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  mkdir,
  writeFile,
  readFile,
  copyFile,
  unlink,
  access,
} from 'fs/promises';

// Mock vscode-core to avoid VS Code dependency
jest.mock('@ptah-extension/vscode-core', () => ({
  Logger: jest.fn(),
  TOKENS: {
    LOGGER: Symbol.for('Logger'),
  },
}));

// Mock fs/promises
jest.mock('fs/promises');

import { AgentFileWriterService } from './file-writer.service';
import { GeneratedAgent } from '../types/core.types';
import { FileWriteError } from '../errors/file-write.error';

const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockCopyFile = copyFile as jest.MockedFunction<typeof copyFile>;
const mockUnlink = unlink as jest.MockedFunction<typeof unlink>;
const mockAccess = access as jest.MockedFunction<typeof access>;

// Mock Logger interface
interface MockLogger {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  logWithContext: jest.Mock;
  show: jest.Mock;
  dispose: jest.Mock;
}

describe('AgentFileWriterService', () => {
  let service: AgentFileWriterService;
  let mockLogger: MockLogger;

  // Sample generated agent
  const sampleAgent: GeneratedAgent = {
    sourceTemplateId: 'backend-developer',
    sourceTemplateVersion: '1.0.0',
    content: '# Backend Developer\n\nAgent content here.',
    variables: { projectName: 'test-project' },
    customizations: [],
    generatedAt: new Date('2023-12-10T14:30:22.000Z'),
    filePath: '.claude/agents/backend-developer.md',
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock logger
    mockLogger = {
      debug: jest.fn() as any,
      info: jest.fn() as any,
      warn: jest.fn() as any,
      error: jest.fn() as any,
      logWithContext: jest.fn() as any,
      show: jest.fn() as any,
      dispose: jest.fn() as any,
    };

    // Create service instance
    service = new AgentFileWriterService(mockLogger as any);

    // Default mock behavior
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockAccess.mockRejectedValue(new Error('File does not exist')); // Default: file doesn't exist
  });

  describe('writeAgent', () => {
    it('should successfully write agent to file', async () => {
      // Arrange
      const agent = { ...sampleAgent };

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isOk()).toBe(true);
      expect(result.value).toContain('backend-developer.md');
      expect(mockMkdir).toHaveBeenCalledTimes(1);
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('backend-developer.md'),
        agent.content,
        'utf-8'
      );
    });

    it('should create directory if it does not exist', async () => {
      // Arrange
      const agent = {
        ...sampleAgent,
        filePath: '.claude/commands/new-folder/command.md',
      };

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isOk()).toBe(true);
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('new-folder'),
        { recursive: true }
      );
    });

    it('should create backup of existing file before overwriting', async () => {
      // Arrange
      const agent = { ...sampleAgent };
      mockAccess.mockResolvedValue(undefined); // File exists

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isOk()).toBe(true);
      expect(mockCopyFile).toHaveBeenCalledTimes(1);
      expect(mockCopyFile).toHaveBeenCalledWith(
        expect.stringContaining('backend-developer.md'),
        expect.stringMatching(/backend-developer\.backup-\d{8}-\d{6}\.md$/)
      );
    });

    it('should create backup with correct timestamp format', async () => {
      // Arrange
      const agent = { ...sampleAgent };
      mockAccess.mockResolvedValue(undefined); // File exists

      // Act
      await service.writeAgent(agent);

      // Assert
      const copyFileCall = mockCopyFile.mock.calls[0];
      const backupPath = copyFileCall[1] as string;
      // Format: backend-developer.backup-YYYYMMDD-HHmmss.md
      expect(backupPath).toMatch(/backend-developer\.backup-\d{8}-\d{6}\.md$/);
    });

    it('should skip backup if file does not exist', async () => {
      // Arrange
      const agent = { ...sampleAgent };
      mockAccess.mockRejectedValue(new Error('File does not exist'));

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isOk()).toBe(true);
      expect(mockCopyFile).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'No existing file to backup',
        expect.any(Object)
      );
    });

    it('should return error when agent content is empty', async () => {
      // Arrange
      const agent = { ...sampleAgent, content: '' };

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(FileWriteError);
      expect(result.error?.message).toContain('Agent content cannot be empty');
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('should return error when agent content is only whitespace', async () => {
      // Arrange
      const agent = { ...sampleAgent, content: '   \n\t   ' };

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Agent content cannot be empty');
    });

    it('should return error on path traversal attempt', async () => {
      // Arrange
      const agent = { ...sampleAgent, filePath: '.claude/../../../etc/passwd' };

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(FileWriteError);
      expect(result.error?.message).toContain('Path traversal detected');
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Path traversal attempt detected',
        expect.any(Object)
      );
    });

    it('should return error when writing outside .claude directory', async () => {
      // Arrange
      const agent = { ...sampleAgent, filePath: 'outside/agents/backend.md' };

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain(
        'must be within .claude/ directory'
      );
    });

    it('should handle permission denied error', async () => {
      // Arrange
      const agent = { ...sampleAgent };
      const error: NodeJS.ErrnoException = new Error('Permission denied');
      error.code = 'EACCES';
      mockWriteFile.mockRejectedValue(error);

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Permission denied');
    });

    it('should handle disk full error', async () => {
      // Arrange
      const agent = { ...sampleAgent };
      const error: NodeJS.ErrnoException = new Error('No space left on device');
      error.code = 'ENOSPC';
      mockWriteFile.mockRejectedValue(error);

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Insufficient disk space');
    });

    it('should restore backup on write failure', async () => {
      // Arrange
      const agent = { ...sampleAgent };
      mockAccess.mockResolvedValue(undefined); // File exists (will create backup)
      mockWriteFile.mockRejectedValue(new Error('Write failed'));

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isErr()).toBe(true);
      expect(mockCopyFile).toHaveBeenCalledTimes(2); // 1 for backup, 1 for restore
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Backup restored',
        expect.any(Object)
      );
    });
  });

  describe('writeAgentsBatch', () => {
    it('should successfully write multiple agents', async () => {
      // Arrange
      const agents: GeneratedAgent[] = [
        { ...sampleAgent, filePath: '.claude/agents/backend-developer.md' },
        { ...sampleAgent, filePath: '.claude/agents/frontend-developer.md' },
        { ...sampleAgent, filePath: '.claude/commands/orchestrate.md' },
      ];

      // Act
      const result = await service.writeAgentsBatch(agents);

      // Assert
      expect(result.isOk()).toBe(true);
      expect(result.value).toHaveLength(3);
      expect(mockWriteFile).toHaveBeenCalledTimes(3);
      expect(mockMkdir).toHaveBeenCalledTimes(3);
    });

    it('should return empty array for empty agents array', async () => {
      // Arrange
      const agents: GeneratedAgent[] = [];

      // Act
      const result = await service.writeAgentsBatch(agents);

      // Assert
      expect(result.isOk()).toBe(true);
      expect(result.value).toEqual([]);
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Empty agents array provided, returning empty result'
      );
    });

    it('should create backups for all existing files', async () => {
      // Arrange
      const agents: GeneratedAgent[] = [
        { ...sampleAgent, filePath: '.claude/agents/agent1.md' },
        { ...sampleAgent, filePath: '.claude/agents/agent2.md' },
      ];
      mockAccess.mockResolvedValue(undefined); // All files exist

      // Act
      const result = await service.writeAgentsBatch(agents);

      // Assert
      expect(result.isOk()).toBe(true);
      expect(mockCopyFile).toHaveBeenCalledTimes(2); // 2 backups created
    });

    it('should rollback all writes on partial failure', async () => {
      // Arrange
      const agents: GeneratedAgent[] = [
        { ...sampleAgent, filePath: '.claude/agents/agent1.md' },
        { ...sampleAgent, filePath: '.claude/agents/agent2.md' },
        { ...sampleAgent, filePath: '.claude/agents/agent3.md' },
      ];

      // First write succeeds, second write fails
      mockWriteFile
        .mockResolvedValueOnce(undefined) // agent1 succeeds
        .mockRejectedValueOnce(new Error('Write failed')); // agent2 fails

      // Act
      const result = await service.writeAgentsBatch(agents);

      // Assert
      expect(result.isErr()).toBe(true);
      expect(mockUnlink).toHaveBeenCalledTimes(1); // Delete agent1 (partial write)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Rolling back transaction',
        expect.any(Object)
      );
    });

    it('should restore all backups on rollback', async () => {
      // Arrange
      const agents: GeneratedAgent[] = [
        { ...sampleAgent, filePath: '.claude/agents/agent1.md' },
        { ...sampleAgent, filePath: '.claude/agents/agent2.md' },
      ];
      mockAccess.mockResolvedValue(undefined); // Both files exist
      mockWriteFile
        .mockResolvedValueOnce(undefined) // agent1 succeeds
        .mockRejectedValueOnce(new Error('Write failed')); // agent2 fails

      // Act
      const result = await service.writeAgentsBatch(agents);

      // Assert
      expect(result.isErr()).toBe(true);
      // 2 backups created + 2 restores during rollback = 4 copyFile calls
      expect(mockCopyFile).toHaveBeenCalledTimes(4);
      expect(mockUnlink).toHaveBeenCalledTimes(1); // Delete agent1
    });

    it('should validate all agents before writing any', async () => {
      // Arrange
      const agents: GeneratedAgent[] = [
        { ...sampleAgent, filePath: '.claude/agents/agent1.md' },
        { ...sampleAgent, filePath: '.claude/agents/agent2.md', content: '' }, // Invalid
        { ...sampleAgent, filePath: '.claude/agents/agent3.md' },
      ];

      // Act
      const result = await service.writeAgentsBatch(agents);

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Agent content cannot be empty');
      expect(mockWriteFile).not.toHaveBeenCalled(); // No writes should occur
    });

    it('should reject batch with path traversal attempt', async () => {
      // Arrange
      const agents: GeneratedAgent[] = [
        { ...sampleAgent, filePath: '.claude/agents/agent1.md' },
        { ...sampleAgent, filePath: '.claude/../../../etc/passwd' }, // Invalid
      ];

      // Act
      const result = await service.writeAgentsBatch(agents);

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Path traversal detected');
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('should create all directories before writing', async () => {
      // Arrange
      const agents: GeneratedAgent[] = [
        { ...sampleAgent, filePath: '.claude/agents/backend-developer.md' },
        { ...sampleAgent, filePath: '.claude/commands/orchestrate.md' },
        { ...sampleAgent, filePath: '.claude/agents/subfolder/agent.md' },
      ];

      // Act
      const result = await service.writeAgentsBatch(agents);

      // Assert
      expect(result.isOk()).toBe(true);
      expect(mockMkdir).toHaveBeenCalledTimes(3); // One for each directory
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('agents'),
        { recursive: true }
      );
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('commands'),
        { recursive: true }
      );
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('subfolder'),
        { recursive: true }
      );
    });
  });

  describe('backupExisting', () => {
    it('should create backup with timestamp for existing file', async () => {
      // Arrange
      const filePath = '/workspace/.claude/agents/backend-developer.md';
      mockAccess.mockResolvedValue(undefined); // File exists

      // Act
      const result = await service.backupExisting(filePath);

      // Assert
      expect(result.isOk()).toBe(true);
      expect(result.value).toMatch(
        /backend-developer\.backup-\d{8}-\d{6}\.md$/
      );
      expect(mockCopyFile).toHaveBeenCalledTimes(1);
    });

    it('should return empty string if file does not exist', async () => {
      // Arrange
      const filePath = '/workspace/.claude/agents/non-existent.md';
      mockAccess.mockRejectedValue(new Error('File does not exist'));

      // Act
      const result = await service.backupExisting(filePath);

      // Assert
      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('');
      expect(mockCopyFile).not.toHaveBeenCalled();
    });

    it('should handle backup creation failure', async () => {
      // Arrange
      const filePath = '/workspace/.claude/agents/backend-developer.md';
      mockAccess.mockResolvedValue(undefined); // File exists
      const error: NodeJS.ErrnoException = new Error('Permission denied');
      error.code = 'EACCES';
      mockCopyFile.mockRejectedValue(error);

      // Act
      const result = await service.backupExisting(filePath);

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Permission denied');
    });
  });

  describe('error handling', () => {
    it('should handle directory creation failure', async () => {
      // Arrange
      const agent = { ...sampleAgent };
      const error: NodeJS.ErrnoException = new Error('Permission denied');
      error.code = 'EACCES';
      mockMkdir.mockRejectedValue(error);

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Permission denied');
    });

    it('should handle read-only file system error', async () => {
      // Arrange
      const agent = { ...sampleAgent };
      const error: NodeJS.ErrnoException = new Error('Read-only file system');
      error.code = 'EROFS';
      mockWriteFile.mockRejectedValue(error);

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Read-only file system');
    });

    it('should handle too many open files error', async () => {
      // Arrange
      const agent = { ...sampleAgent };
      const error: NodeJS.ErrnoException = new Error('Too many open files');
      error.code = 'EMFILE';
      mockWriteFile.mockRejectedValue(error);

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Too many open files');
    });

    it('should reject path exceeding maximum length', async () => {
      // Arrange
      const longPath = '.claude/agents/' + 'a'.repeat(300) + '.md';
      const agent = { ...sampleAgent, filePath: longPath };

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('exceeds maximum length');
    });
  });

  describe('path security', () => {
    it('should allow valid paths within .claude/agents/', async () => {
      // Arrange
      const agent = {
        ...sampleAgent,
        filePath: '.claude/agents/backend-developer.md',
      };

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isOk()).toBe(true);
    });

    it('should allow valid paths within .claude/commands/', async () => {
      // Arrange
      const agent = {
        ...sampleAgent,
        filePath: '.claude/commands/orchestrate.md',
      };

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isOk()).toBe(true);
    });

    it('should reject paths with parent directory references', async () => {
      // Arrange
      const agent = {
        ...sampleAgent,
        filePath: '.claude/agents/../../../passwd',
      };

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Path traversal detected');
    });

    it('should reject absolute paths outside .claude/', async () => {
      // Arrange
      const agent = { ...sampleAgent, filePath: '/etc/passwd' };

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain(
        'must be within .claude/ directory'
      );
    });
  });

  describe('edge cases', () => {
    it('should handle Windows-style paths', async () => {
      // Arrange
      const agent = {
        ...sampleAgent,
        filePath: '.claude\\agents\\backend-developer.md',
      };

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isOk()).toBe(true);
    });

    it('should handle deeply nested directories', async () => {
      // Arrange
      const agent = {
        ...sampleAgent,
        filePath: '.claude/agents/nested/deep/folder/agent.md',
      };

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isOk()).toBe(true);
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('nested'),
        { recursive: true }
      );
    });

    it('should handle content with special characters', async () => {
      // Arrange
      const agent = {
        ...sampleAgent,
        content: '# Agent\n\nContent with émojis 🚀 and spëcial çharacters',
      };

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isOk()).toBe(true);
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.any(String),
        agent.content,
        'utf-8'
      );
    });

    it('should handle large content (> 1MB)', async () => {
      // Arrange
      const largeContent = 'x'.repeat(2 * 1024 * 1024); // 2MB
      const agent = { ...sampleAgent, content: largeContent };

      // Act
      const result = await service.writeAgent(agent);

      // Assert
      expect(result.isOk()).toBe(true);
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.any(String),
        largeContent,
        'utf-8'
      );
    });
  });
});
