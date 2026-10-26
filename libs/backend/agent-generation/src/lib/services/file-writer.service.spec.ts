/**
 * Agent File Writer Service Tests
 *
 * Covers:
 * - Single agent writing through the platform file-system port
 * - `written` vs `unchanged` (equal bytes are never rewritten)
 * - Write guards: `kept` and `changed-since-preview` leave the file alone,
 *   an unreadable file is always `kept`
 * - Path traversal protection and file-system error mapping
 * - Explicit parent-directory creation before every write
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { dirname, normalize } from 'path';

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
import { hashContent } from '@ptah-extension/harness-sync';
import { AgentFileWriterService } from './file-writer.service';
import { GeneratedAgent } from '../types/core.types';
import { FileWriteError } from '../errors/file-write.error';
import type { AgentWriteGuard } from '../interfaces/agent-file-writer.interface';

const CREATE_ONLY: AgentWriteGuard = { mode: 'create-only' };
const REPLACE_FROM_MISSING: AgentWriteGuard = {
  mode: 'replace-allowed',
  baseline: { state: 'missing' },
};
function replaceFrom(previewedContent: string): AgentWriteGuard {
  return {
    mode: 'replace-allowed',
    baseline: { state: 'present', hash: hashContent(previewedContent) },
  };
}

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
    filePath: '/workspace/.claude/agents/backend-developer.md',
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

  /** Write under `create-only` unless a test names the guard. */
  function write(agent: GeneratedAgent, guard: AgentWriteGuard = CREATE_ONLY) {
    return service.writeAgent(agent, guard);
  }

  describe('writeAgent', () => {
    it('writes a new file and reports status "written"', async () => {
      const result = await write({ ...sampleAgent });

      expect(result.isOk()).toBe(true);
      expect(result.value!.status).toBe('written');
      expect(result.value!.filePath).toContain('backend-developer.md');
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('backend-developer.md'),
        sampleAgent.content,
      );
      expect(await fs.readFile(normalize(sampleAgent.filePath))).toBe(
        sampleAgent.content,
      );
    });

    it('creates the parent directory through the port before writing', async () => {
      const agent = {
        ...sampleAgent,
        filePath: '/workspace/.claude/commands/new-folder/command.md',
      };

      const result = await write(agent);

      expect(result.isOk()).toBe(true);
      expect(fs.createDirectory).toHaveBeenCalledWith(
        dirname(normalize(agent.filePath)),
      );
      const createOrder = fs.createDirectory.mock.invocationCallOrder[0];
      const writeOrder = fs.writeFile.mock.invocationCallOrder[0];
      expect(createOrder).toBeLessThan(writeOrder);
    });

    it('reports "unchanged" and does not write when the bytes already match', async () => {
      await fs.writeFile(normalize(sampleAgent.filePath), sampleAgent.content);
      fs.writeFile.mockClear();

      const result = await write({ ...sampleAgent });

      expect(result.isOk()).toBe(true);
      expect(result.value!.status).toBe('unchanged');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('overwrites in place and reports "written" when the bytes differ and the replace baseline still matches', async () => {
      await fs.writeFile(normalize(sampleAgent.filePath), 'old content');
      fs.writeFile.mockClear();

      const result = await write(
        { ...sampleAgent },
        replaceFrom('old content'),
      );

      expect(result.isOk()).toBe(true);
      expect(result.value!.status).toBe('written');
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      expect(fs.copy).not.toHaveBeenCalled();
      expect(await fs.readFile(normalize(sampleAgent.filePath))).toBe(
        sampleAgent.content,
      );
    });

    it('returns an error when agent content is empty', async () => {
      const result = await write({ ...sampleAgent, content: '' });

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(FileWriteError);
      expect(result.error?.message).toContain('Agent content cannot be empty');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('returns an error when agent content is only whitespace', async () => {
      const result = await write({
        ...sampleAgent,
        content: '   \n\t   ',
      });

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Agent content cannot be empty');
    });

    it('rejects a path traversal attempt', async () => {
      const result = await write({
        ...sampleAgent,
        filePath: '.claude/../../../etc/passwd',
      });

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(FileWriteError);
      // Relative AND traversing: the security error wins over the
      // absolute-path one, so the violation flag is not lost.
      expect(result.error?.message).toContain('Path traversal detected');
      expect((result.error as FileWriteError).context).toMatchObject({
        securityViolation: true,
      });
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('rejects a write outside the .claude directory', async () => {
      const result = await write({
        ...sampleAgent,
        filePath: '/workspace/outside/agents/backend.md',
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

      const result = await write({ ...sampleAgent });

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Permission denied');
    });

    it('maps ENOSPC to a disk-full error', async () => {
      fs.writeFile.mockRejectedValueOnce(
        errnoError('No space left on device', 'ENOSPC'),
      );

      const result = await write({ ...sampleAgent });

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Insufficient disk space');
    });
  });

  describe('write guards', () => {
    const target = normalize(sampleAgent.filePath);

    it('keeps a file that differs under create-only and leaves its bytes alone', async () => {
      await fs.writeFile(target, 'user content');
      fs.writeFile.mockClear();

      const result = await write({ ...sampleAgent }, CREATE_ONLY);

      expect(result.isOk()).toBe(true);
      expect(result.value).toEqual({ filePath: target, status: 'kept' });
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(fs.createDirectory).not.toHaveBeenCalled();
      expect(await fs.readFile(target)).toBe('user content');
    });

    it.each([
      ['create-only', CREATE_ONLY],
      ['replace-allowed', replaceFrom('# Backend Developer\n\nAgent content here.')],
    ] as const)(
      'reports "unchanged" for identical bytes under %s',
      async (_label, guard) => {
        await fs.writeFile(target, sampleAgent.content);
        fs.writeFile.mockClear();

        const result = await write({ ...sampleAgent }, guard);

        expect(result.value!.status).toBe('unchanged');
        expect(fs.writeFile).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['create-only', CREATE_ONLY],
      ['replace-allowed from missing', REPLACE_FROM_MISSING],
    ] as const)(
      'writes a missing file under %s',
      async (_label, guard) => {
        const result = await write({ ...sampleAgent }, guard);

        expect(result.value).toEqual({ filePath: target, status: 'written' });
        expect(await fs.readFile(target)).toBe(sampleAgent.content);
      },
    );

    it('treats the VS Code FileNotFound read error as a missing file', async () => {
      const notFound = errnoError('File not found', 'FileNotFound');
      fs.readFile.mockRejectedValueOnce(notFound);

      const result = await write({ ...sampleAgent }, CREATE_ONLY);

      expect(result.value!.status).toBe('written');
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['create-only', CREATE_ONLY],
      ['replace-allowed', replaceFrom('anything')],
      ['replace-allowed from missing', REPLACE_FROM_MISSING],
    ] as const)(
      'keeps an unreadable file (EACCES) under %s and never writes it',
      async (_label, guard) => {
        await fs.writeFile(target, 'locked content');
        fs.writeFile.mockClear();
        fs.readFile.mockRejectedValueOnce(
          errnoError('Permission denied', 'EACCES'),
        );

        const result = await write({ ...sampleAgent }, guard);

        expect(result.isOk()).toBe(true);
        expect(result.value).toEqual({ filePath: target, status: 'kept' });
        expect(fs.writeFile).not.toHaveBeenCalled();
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('cannot be read'),
          expect.objectContaining({ code: 'EACCES' }),
        );
      },
    );

    it('reports "changed-since-preview" when a file appeared after a missing baseline', async () => {
      await fs.writeFile(target, 'created after the preview');
      fs.writeFile.mockClear();

      const result = await write({ ...sampleAgent }, REPLACE_FROM_MISSING);

      expect(result.value).toEqual({
        filePath: target,
        status: 'changed-since-preview',
      });
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(await fs.readFile(target)).toBe('created after the preview');
    });

    it('reports "changed-since-preview" when the file hash no longer matches the baseline', async () => {
      await fs.writeFile(target, 'edited after the preview');
      fs.writeFile.mockClear();

      const result = await write(
        { ...sampleAgent },
        replaceFrom('content the user previewed'),
      );

      expect(result.value!.status).toBe('changed-since-preview');
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(await fs.readFile(target)).toBe('edited after the preview');
    });

    it('writes when a file with a present baseline was deleted since the preview', async () => {
      const result = await write(
        { ...sampleAgent },
        replaceFrom('content the user previewed'),
      );

      expect(result.value!.status).toBe('written');
      expect(await fs.readFile(target)).toBe(sampleAgent.content);
    });

    it('returns an error (never a status) when the guarded write fails', async () => {
      await fs.writeFile(target, 'old content');
      fs.writeFile.mockClear();
      fs.writeFile.mockRejectedValueOnce(
        errnoError('Permission denied', 'EACCES'),
      );

      const result = await write({ ...sampleAgent }, replaceFrom('old content'));

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(FileWriteError);
      expect(await fs.readFile(target)).toBe('old content');
    });
  });

  describe('error handling', () => {
    it('reports a directory creation failure', async () => {
      fs.createDirectory.mockRejectedValueOnce(
        errnoError('Permission denied', 'EACCES'),
      );

      const result = await write({ ...sampleAgent });

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Failed to create directory');
      expect(result.error?.message).toContain('Permission denied');
    });

    it('maps EROFS to a read-only file system error', async () => {
      fs.writeFile.mockRejectedValueOnce(
        errnoError('Read-only file system', 'EROFS'),
      );

      const result = await write({ ...sampleAgent });

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Read-only file system');
    });

    it('maps EMFILE to a too-many-open-files error', async () => {
      fs.writeFile.mockRejectedValueOnce(
        errnoError('Too many open files', 'EMFILE'),
      );

      const result = await write({ ...sampleAgent });

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Too many open files');
    });

    it('rejects a path exceeding the maximum length', async () => {
      const longPath = '/workspace/.claude/agents/' + 'a'.repeat(300) + '.md';

      const result = await write({
        ...sampleAgent,
        filePath: longPath,
      });

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('exceeds maximum length');
    });
  });

  describe('path security', () => {
    it.each(['.claude/agents/x.md', 'C:.claude/agents/x.md'])(
      'rejects non-absolute path %s without filesystem access',
      async (filePath) => {
        const result = await write({ ...sampleAgent, filePath });

        expect(result.isErr()).toBe(true);
        expect(result.error).toBeInstanceOf(FileWriteError);
        expect(result.error).toMatchObject({ filePath, operation: 'write' });
        expect(result.error?.message).toContain(filePath);
        expect(result.error?.message).toContain('An absolute path is required');
        expect(fs.createDirectory).not.toHaveBeenCalled();
        expect(fs.readFile).not.toHaveBeenCalled();
        expect(fs.writeFile).not.toHaveBeenCalled();
      },
    );

    it('accepts an absolute POSIX path', async () => {
      const filePath = '/workspace/.claude/agents/x.md';
      const result = await write({ ...sampleAgent, filePath });

      expect(result.isOk()).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        normalize(filePath),
        sampleAgent.content,
      );
    });

    (process.platform === 'win32' ? it : it.skip)(
      'accepts an absolute UNC path',
      async () => {
        const filePath = '\\\\server\\share\\.claude\\agents\\x.md';
        const result = await write({ ...sampleAgent, filePath });

        expect(result.isOk()).toBe(true);
        expect(fs.writeFile).toHaveBeenCalledWith(
          normalize(filePath),
          sampleAgent.content,
        );
      },
    );

    it('allows paths within .claude/agents/', async () => {
      const result = await write({
        ...sampleAgent,
        filePath: '/workspace/.claude/agents/backend-developer.md',
      });
      expect(result.isOk()).toBe(true);
    });

    it('allows paths within .claude/commands/', async () => {
      const result = await write({
        ...sampleAgent,
        filePath: '/workspace/.claude/commands/orchestrate.md',
      });
      expect(result.isOk()).toBe(true);
    });

    it('rejects paths with parent directory references', async () => {
      const result = await write({
        ...sampleAgent,
        filePath: '.claude/agents/../../../passwd',
      });
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Path traversal detected');
    });

    it.each([
      ['a relative path outside .claude', 'C:foo'],
      ['a relative path outside .claude', 'agents/x.md'],
      ['a relative traversal', '.claude/../x.md'],
    ])(
      'flags %s (%s) as a security violation before the absolute-path check',
      async (_label, filePath) => {
        const result = await write({ ...sampleAgent, filePath });

        expect(result.isErr()).toBe(true);
        expect(result.error).toBeInstanceOf(FileWriteError);
        expect(result.error?.message).not.toContain(
          'An absolute path is required',
        );
        expect((result.error as FileWriteError).context).toMatchObject({
          securityViolation: true,
        });
        expect(fs.createDirectory).not.toHaveBeenCalled();
        expect(fs.writeFile).not.toHaveBeenCalled();
      },
    );

    it('rejects absolute paths outside .claude/', async () => {
      const result = await write({
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
    (process.platform === 'win32' ? it : it.skip)(
      'handles absolute Windows-style paths',
      async () => {
        const result = await write({
          ...sampleAgent,
          filePath: 'C:\\workspace\\.claude\\agents\\backend-developer.md',
        });
        expect(result.isOk()).toBe(true);
      },
    );

    it('handles deeply nested directories', async () => {
      const agent = {
        ...sampleAgent,
        filePath: '/workspace/.claude/agents/nested/deep/folder/agent.md',
      };

      const result = await write(agent);

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

      const result = await write(agent);

      expect(result.isOk()).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        agent.content,
      );
    });

    it('handles large content (> 1MB)', async () => {
      const largeContent = 'x'.repeat(2 * 1024 * 1024);

      const result = await write({
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
