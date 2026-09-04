/**
 * Agent File Writer Service Tests
 *
 * Covers:
 * - Single agent writing through the platform file-system port
 * - `written` vs `unchanged` (equal bytes are never rewritten)
 * - Batch writing with rollback of newly written files only
 * - Path traversal protection and file-system error mapping
 * - Explicit parent-directory creation before every write
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { homedir } from 'os';
import { dirname, join, normalize } from 'path';

// Mock vscode-core to avoid VS Code dependency
jest.mock('@ptah-extension/vscode-core', () => ({
  Logger: jest.fn(),
  TOKENS: {
    LOGGER: Symbol.for('Logger'),
  },
}));

import {
  createMockFileSystemProvider,
  type MockFileSystemProvider,
} from '@ptah-extension/platform-core/testing';
import { AgentFileWriterService } from './file-writer.service';
import { GeneratedAgent } from '../types/core.types';
import { FileWriteError } from '../errors/file-write.error';

interface MockLogger {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

function errnoError(message: string, code: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = code;
  return error;
}

/** Where the service resolves a relative `.claude/...` path (homedir). */
function absolutePathFor(relativePath: string): string {
  return normalize(join(homedir(), relativePath));
}

describe('AgentFileWriterService', () => {
  let service: AgentFileWriterService;
  let fs: MockFileSystemProvider;
  let mockLogger: MockLogger;

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
    jest.clearAllMocks();
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    fs = createMockFileSystemProvider();
    service = new AgentFileWriterService(mockLogger as never, fs);
  });

  describe('writeAgent', () => {
    it('writes a new file and reports status "written"', async () => {
      const result = await service.writeAgent({ ...sampleAgent });

      expect(result.isOk()).toBe(true);
      expect(result.value!.status).toBe('written');
      expect(result.value!.filePath).toContain('backend-developer.md');
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('backend-developer.md'),
        sampleAgent.content,
      );
      expect(await fs.readFile(absolutePathFor(sampleAgent.filePath))).toBe(
        sampleAgent.content,
      );
    });

    it('creates the parent directory through the port before writing', async () => {
      const agent = {
        ...sampleAgent,
        filePath: '.claude/commands/new-folder/command.md',
      };

      const result = await service.writeAgent(agent);

      expect(result.isOk()).toBe(true);
      expect(fs.createDirectory).toHaveBeenCalledWith(
        dirname(absolutePathFor(agent.filePath)),
      );
      const createOrder = fs.createDirectory.mock.invocationCallOrder[0];
      const writeOrder = fs.writeFile.mock.invocationCallOrder[0];
      expect(createOrder).toBeLessThan(writeOrder);
    });

    it('reports "unchanged" and does not write when the bytes already match', async () => {
      await fs.writeFile(
        absolutePathFor(sampleAgent.filePath),
        sampleAgent.content,
      );
      fs.writeFile.mockClear();

      const result = await service.writeAgent({ ...sampleAgent });

      expect(result.isOk()).toBe(true);
      expect(result.value!.status).toBe('unchanged');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('overwrites in place and reports "written" when the bytes differ', async () => {
      await fs.writeFile(absolutePathFor(sampleAgent.filePath), 'old content');
      fs.writeFile.mockClear();

      const result = await service.writeAgent({ ...sampleAgent });

      expect(result.isOk()).toBe(true);
      expect(result.value!.status).toBe('written');
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      expect(fs.copy).not.toHaveBeenCalled();
      expect(await fs.readFile(absolutePathFor(sampleAgent.filePath))).toBe(
        sampleAgent.content,
      );
    });

    it('returns an error when agent content is empty', async () => {
      const result = await service.writeAgent({ ...sampleAgent, content: '' });

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(FileWriteError);
      expect(result.error?.message).toContain('Agent content cannot be empty');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('returns an error when agent content is only whitespace', async () => {
      const result = await service.writeAgent({
        ...sampleAgent,
        content: '   \n\t   ',
      });

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Agent content cannot be empty');
    });

    it('rejects a path traversal attempt', async () => {
      const result = await service.writeAgent({
        ...sampleAgent,
        filePath: '.claude/../../../etc/passwd',
      });

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(FileWriteError);
      expect(result.error?.message).toContain('Path traversal detected');
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Path traversal attempt detected',
        expect.any(Object),
      );
    });

    it('rejects a write outside the .claude directory', async () => {
      const result = await service.writeAgent({
        ...sampleAgent,
        filePath: 'outside/agents/backend.md',
      });

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain(
        'must be within .claude/ directory',
      );
    });

    it('maps EACCES to a permission-denied error', async () => {
      fs.writeFile.mockRejectedValueOnce(
        errnoError('Permission denied', 'EACCES'),
      );

      const result = await service.writeAgent({ ...sampleAgent });

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Permission denied');
    });

    it('maps ENOSPC to a disk-full error', async () => {
      fs.writeFile.mockRejectedValueOnce(
        errnoError('No space left on device', 'ENOSPC'),
      );

      const result = await service.writeAgent({ ...sampleAgent });

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Insufficient disk space');
    });
  });

  describe('writeAgentsBatch', () => {
    const agentA = { ...sampleAgent, filePath: '.claude/agents/agent-a.md' };
    const agentB = {
      ...sampleAgent,
      content: '# B',
      filePath: '.claude/agents/agent-b.md',
    };

    it('writes multiple agents and reports one result per agent', async () => {
      const result = await service.writeAgentsBatch([agentA, agentB]);

      expect(result.isOk()).toBe(true);
      expect(result.value).toHaveLength(2);
      expect(result.value!.map((r) => r.status)).toEqual([
        'written',
        'written',
      ]);
      expect(fs.writeFile).toHaveBeenCalledTimes(2);
    });

    it('returns an empty array for an empty batch', async () => {
      const result = await service.writeAgentsBatch([]);

      expect(result.isOk()).toBe(true);
      expect(result.value).toEqual([]);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('distinguishes unchanged from written inside one batch', async () => {
      await fs.writeFile(absolutePathFor(agentA.filePath), agentA.content);
      fs.writeFile.mockClear();

      const result = await service.writeAgentsBatch([agentA, agentB]);

      expect(result.isOk()).toBe(true);
      expect(result.value!.map((r) => r.status)).toEqual([
        'unchanged',
        'written',
      ]);
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
    });

    it('rolls back files it newly wrote when a later write fails, and keeps unchanged ones', async () => {
      const agentC = {
        ...sampleAgent,
        content: '# C',
        filePath: '.claude/agents/agent-c.md',
      };
      await fs.writeFile(absolutePathFor(agentA.filePath), agentA.content);
      fs.writeFile.mockClear();
      fs.writeFile.mockImplementationOnce(async (path, content) => {
        fs.__state.files.set(path, new TextEncoder().encode(content));
      });
      fs.writeFile.mockRejectedValueOnce(errnoError('Disk full', 'ENOSPC'));

      const result = await service.writeAgentsBatch([agentA, agentB, agentC]);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('index 2');
      expect(fs.delete).toHaveBeenCalledTimes(1);
      expect(fs.delete).toHaveBeenCalledWith(absolutePathFor(agentB.filePath));
      expect(await fs.exists(absolutePathFor(agentA.filePath))).toBe(true);
    });

    it('validates every agent before writing any', async () => {
      const result = await service.writeAgentsBatch([
        agentA,
        { ...agentB, content: '' },
      ]);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Agent content cannot be empty');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('rejects a batch containing a path traversal attempt', async () => {
      const result = await service.writeAgentsBatch([
        agentA,
        { ...agentB, filePath: '.claude/../../../etc/passwd' },
      ]);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Path traversal detected');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('creates every directory before the first write', async () => {
      const nested = {
        ...agentB,
        filePath: '.claude/commands/nested/deep/cmd.md',
      };

      const result = await service.writeAgentsBatch([agentA, nested]);

      expect(result.isOk()).toBe(true);
      const lastCreate = Math.max(
        ...fs.createDirectory.mock.invocationCallOrder,
      );
      const firstWrite = Math.min(...fs.writeFile.mock.invocationCallOrder);
      expect(lastCreate).toBeLessThan(firstWrite);
    });
  });

  describe('error handling', () => {
    it('reports a directory creation failure', async () => {
      fs.createDirectory.mockRejectedValueOnce(
        errnoError('Permission denied', 'EACCES'),
      );

      const result = await service.writeAgent({ ...sampleAgent });

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Failed to create directory');
      expect(result.error?.message).toContain('Permission denied');
    });

    it('maps EROFS to a read-only file system error', async () => {
      fs.writeFile.mockRejectedValueOnce(
        errnoError('Read-only file system', 'EROFS'),
      );

      const result = await service.writeAgent({ ...sampleAgent });

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Read-only file system');
    });

    it('maps EMFILE to a too-many-open-files error', async () => {
      fs.writeFile.mockRejectedValueOnce(
        errnoError('Too many open files', 'EMFILE'),
      );

      const result = await service.writeAgent({ ...sampleAgent });

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Too many open files');
    });

    it('rejects a path exceeding the maximum length', async () => {
      const longPath = '.claude/agents/' + 'a'.repeat(300) + '.md';

      const result = await service.writeAgent({
        ...sampleAgent,
        filePath: longPath,
      });

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('exceeds maximum length');
    });
  });

  describe('path security', () => {
    it('allows paths within .claude/agents/', async () => {
      const result = await service.writeAgent({
        ...sampleAgent,
        filePath: '.claude/agents/backend-developer.md',
      });
      expect(result.isOk()).toBe(true);
    });

    it('allows paths within .claude/commands/', async () => {
      const result = await service.writeAgent({
        ...sampleAgent,
        filePath: '.claude/commands/orchestrate.md',
      });
      expect(result.isOk()).toBe(true);
    });

    it('rejects paths with parent directory references', async () => {
      const result = await service.writeAgent({
        ...sampleAgent,
        filePath: '.claude/agents/../../../passwd',
      });
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Path traversal detected');
    });

    it('rejects absolute paths outside .claude/', async () => {
      const result = await service.writeAgent({
        ...sampleAgent,
        filePath: '/etc/passwd',
      });
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain(
        'must be within .claude/ directory',
      );
    });
  });

  describe('edge cases', () => {
    it('handles Windows-style paths', async () => {
      const result = await service.writeAgent({
        ...sampleAgent,
        filePath: '.claude\\agents\\backend-developer.md',
      });
      expect(result.isOk()).toBe(true);
    });

    it('handles deeply nested directories', async () => {
      const agent = {
        ...sampleAgent,
        filePath: '.claude/agents/nested/deep/folder/agent.md',
      };

      const result = await service.writeAgent(agent);

      expect(result.isOk()).toBe(true);
      expect(fs.createDirectory).toHaveBeenCalledWith(
        expect.stringContaining('nested'),
      );
    });

    it('handles content with special characters', async () => {
      const agent = {
        ...sampleAgent,
        content: '# Agent\n\nContent with émojis 🚀 and spëcial çharacters',
      };

      const result = await service.writeAgent(agent);

      expect(result.isOk()).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        agent.content,
      );
    });

    it('handles large content (> 1MB)', async () => {
      const largeContent = 'x'.repeat(2 * 1024 * 1024);

      const result = await service.writeAgent({
        ...sampleAgent,
        content: largeContent,
      });

      expect(result.isOk()).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        largeContent,
      );
    });
  });
});
