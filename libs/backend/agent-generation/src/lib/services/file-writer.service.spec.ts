/**
 * Agent File Writer Service Tests
 *
 * Test suite for AgentFileWriterService covering:
 * - Single agent writing (overwrite semantics)
 * - Batch agent writing
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
    mockAccess.mockRejectedValue(new Error('File does not exist'));
  });

  describe('writeAgent', () => {
    it('should successfully write agent to file', async () => {
      const agent = { ...sampleAgent };

      const result = await service.writeAgent(agent);

      expect(result.isOk()).toBe(true);
      expect(result.value).toContain('backend-developer.md');
      expect(mockMkdir).toHaveBeenCalledTimes(1);
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('backend-developer.md'),
        agent.content,
        'utf-8',
      );
    });

    it('should create directory if it does not exist', async () => {
      const agent = {
        ...sampleAgent,
        filePath: '.claude/commands/new-folder/command.md',
      };

      const result = await service.writeAgent(agent);

      expect(result.isOk()).toBe(true);
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('new-folder'),
        { recursive: true },
      );
    });

    it('should overwrite existing file without creating backup', async () => {
      const agent = { ...sampleAgent };
      mockAccess.mockResolvedValue(undefined); // File exists

      const result = await service.writeAgent(agent);

      expect(result.isOk()).toBe(true);
      expect(mockCopyFile).not.toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
    });

    it('should return error when agent content is empty', async () => {
      const agent = { ...sampleAgent, content: '' };

      const result = await service.writeAgent(agent);

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(FileWriteError);
      expect(result.error?.message).toContain('Agent content cannot be empty');
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('should return error when agent content is only whitespace', async () => {
      const agent = { ...sampleAgent, content: '   \n\t   ' };

      const result = await service.writeAgent(agent);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Agent content cannot be empty');
    });

    it('should return error on path traversal attempt', async () => {
      const agent = { ...sampleAgent, filePath: '.claude/../../../etc/passwd' };

      const result = await service.writeAgent(agent);

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(FileWriteError);
      expect(result.error?.message).toContain('Path traversal detected');
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Path traversal attempt detected',
        expect.any(Object),
      );
    });

    it('should return error when writing outside .claude directory', async () => {
      const agent = { ...sampleAgent, filePath: 'outside/agents/backend.md' };

      const result = await service.writeAgent(agent);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain(
        'must be within .claude/ directory',
      );
    });

    it('should handle permission denied error', async () => {
      const agent = { ...sampleAgent };
      const error: NodeJS.ErrnoException = new Error('Permission denied');
      error.code = 'EACCES';
      mockWriteFile.mockRejectedValue(error);

      const result = await service.writeAgent(agent);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Permission denied');
    });

    it('should handle disk full error', async () => {
      const agent = { ...sampleAgent };
      const error: NodeJS.ErrnoException = new Error('No space left on device');
      error.code = 'ENOSPC';
      mockWriteFile.mockRejectedValue(error);

      const result = await service.writeAgent(agent);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Insufficient disk space');
    });
  });

  describe('writeAgentsBatch', () => {
    it('should successfully write multiple agents', async () => {
      const agents: GeneratedAgent[] = [
        { ...sampleAgent, filePath: '.claude/agents/backend-developer.md' },
        { ...sampleAgent, filePath: '.claude/agents/frontend-developer.md' },
        { ...sampleAgent, filePath: '.claude/commands/orchestrate.md' },
      ];

      const result = await service.writeAgentsBatch(agents);

      expect(result.isOk()).toBe(true);
      expect(result.value).toHaveLength(3);
      expect(mockWriteFile).toHaveBeenCalledTimes(3);
      expect(mockMkdir).toHaveBeenCalledTimes(3);
    });

    it('should return empty array for empty agents array', async () => {
      const agents: GeneratedAgent[] = [];

      const result = await service.writeAgentsBatch(agents);

      expect(result.isOk()).toBe(true);
      expect(result.value).toEqual([]);
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Empty agents array provided, returning empty result',
      );
    });

    it('should overwrite existing files without creating backups', async () => {
      const agents: GeneratedAgent[] = [
        { ...sampleAgent, filePath: '.claude/agents/agent1.md' },
        { ...sampleAgent, filePath: '.claude/agents/agent2.md' },
      ];
      mockAccess.mockResolvedValue(undefined); // All files exist

      const result = await service.writeAgentsBatch(agents);

      expect(result.isOk()).toBe(true);
      expect(mockCopyFile).not.toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalledTimes(2);
    });

    it('should clean up partial writes on failure', async () => {
      const agents: GeneratedAgent[] = [
        { ...sampleAgent, filePath: '.claude/agents/agent1.md' },
        { ...sampleAgent, filePath: '.claude/agents/agent2.md' },
        { ...sampleAgent, filePath: '.claude/agents/agent3.md' },
      ];

      // First write succeeds, second write fails
      mockWriteFile
        .mockResolvedValueOnce(undefined) // agent1 succeeds
        .mockRejectedValueOnce(new Error('Write failed')); // agent2 fails

      const result = await service.writeAgentsBatch(agents);

      expect(result.isErr()).toBe(true);
      expect(mockUnlink).toHaveBeenCalledTimes(1); // Delete agent1 (partial write)
    });

    it('should validate all agents before writing any', async () => {
      const agents: GeneratedAgent[] = [
        { ...sampleAgent, filePath: '.claude/agents/agent1.md' },
        { ...sampleAgent, filePath: '.claude/agents/agent2.md', content: '' }, // Invalid
        { ...sampleAgent, filePath: '.claude/agents/agent3.md' },
      ];

      const result = await service.writeAgentsBatch(agents);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Agent content cannot be empty');
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('should reject batch with path traversal attempt', async () => {
      const agents: GeneratedAgent[] = [
        { ...sampleAgent, filePath: '.claude/agents/agent1.md' },
        { ...sampleAgent, filePath: '.claude/../../../etc/passwd' }, // Invalid
      ];

      const result = await service.writeAgentsBatch(agents);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Path traversal detected');
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('should create all directories before writing', async () => {
      const agents: GeneratedAgent[] = [
        { ...sampleAgent, filePath: '.claude/agents/backend-developer.md' },
        { ...sampleAgent, filePath: '.claude/commands/orchestrate.md' },
        { ...sampleAgent, filePath: '.claude/agents/subfolder/agent.md' },
      ];

      const result = await service.writeAgentsBatch(agents);

      expect(result.isOk()).toBe(true);
      expect(mockMkdir).toHaveBeenCalledTimes(3);
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('agents'),
        { recursive: true },
      );
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('commands'),
        { recursive: true },
      );
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('subfolder'),
        { recursive: true },
      );
    });
  });

  describe('error handling', () => {
    it('should handle directory creation failure', async () => {
      const agent = { ...sampleAgent };
      const error: NodeJS.ErrnoException = new Error('Permission denied');
      error.code = 'EACCES';
      mockMkdir.mockRejectedValue(error);

      const result = await service.writeAgent(agent);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Permission denied');
    });

    it('should handle read-only file system error', async () => {
      const agent = { ...sampleAgent };
      const error: NodeJS.ErrnoException = new Error('Read-only file system');
      error.code = 'EROFS';
      mockWriteFile.mockRejectedValue(error);

      const result = await service.writeAgent(agent);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Read-only file system');
    });

    it('should handle too many open files error', async () => {
      const agent = { ...sampleAgent };
      const error: NodeJS.ErrnoException = new Error('Too many open files');
      error.code = 'EMFILE';
      mockWriteFile.mockRejectedValue(error);

      const result = await service.writeAgent(agent);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Too many open files');
    });

    it('should reject path exceeding maximum length', async () => {
      const longPath = '.claude/agents/' + 'a'.repeat(300) + '.md';
      const agent = { ...sampleAgent, filePath: longPath };

      const result = await service.writeAgent(agent);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('exceeds maximum length');
    });
  });

  describe('path security', () => {
    it('should allow valid paths within .claude/agents/', async () => {
      const agent = {
        ...sampleAgent,
        filePath: '.claude/agents/backend-developer.md',
      };

      const result = await service.writeAgent(agent);

      expect(result.isOk()).toBe(true);
    });

    it('should allow valid paths within .claude/commands/', async () => {
      const agent = {
        ...sampleAgent,
        filePath: '.claude/commands/orchestrate.md',
      };

      const result = await service.writeAgent(agent);

      expect(result.isOk()).toBe(true);
    });

    it('should reject paths with parent directory references', async () => {
      const agent = {
        ...sampleAgent,
        filePath: '.claude/agents/../../../passwd',
      };

      const result = await service.writeAgent(agent);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Path traversal detected');
    });

    it('should reject absolute paths outside .claude/', async () => {
      const agent = { ...sampleAgent, filePath: '/etc/passwd' };

      const result = await service.writeAgent(agent);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain(
        'must be within .claude/ directory',
      );
    });
  });

  describe('edge cases', () => {
    it('should handle Windows-style paths', async () => {
      const agent = {
        ...sampleAgent,
        filePath: '.claude\\agents\\backend-developer.md',
      };

      const result = await service.writeAgent(agent);

      expect(result.isOk()).toBe(true);
    });

    it('should handle deeply nested directories', async () => {
      const agent = {
        ...sampleAgent,
        filePath: '.claude/agents/nested/deep/folder/agent.md',
      };

      const result = await service.writeAgent(agent);

      expect(result.isOk()).toBe(true);
      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining('nested'),
        { recursive: true },
      );
    });

    it('should handle content with special characters', async () => {
      const agent = {
        ...sampleAgent,
        content: '# Agent\n\nContent with émojis 🚀 and spëcial çharacters',
      };

      const result = await service.writeAgent(agent);

      expect(result.isOk()).toBe(true);
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.any(String),
        agent.content,
        'utf-8',
      );
    });

    it('should handle large content (> 1MB)', async () => {
      const largeContent = 'x'.repeat(2 * 1024 * 1024); // 2MB
      const agent = { ...sampleAgent, content: largeContent };

      const result = await service.writeAgent(agent);

      expect(result.isOk()).toBe(true);
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.any(String),
        largeContent,
        'utf-8',
      );
    });
  });
});
