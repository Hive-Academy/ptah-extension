/**
 * gemini-mcp.installer — unit specs.
 *
 * Covers the GeminiMcpInstaller which writes MCP server configs to the
 * user-global Gemini CLI settings at `~/.gemini/settings.json`.
 *
 * Gemini-specific invariants:
 *   - Root key is `mcpServers`, no discriminant `type` field.
 *   - HTTP / SSE transports must be rewritten to use `httpUrl` instead of
 *     `url` in the stored file; `listInstalled` must reverse that on read.
 *   - `getConfigPath` resolves under `os.homedir()` on every platform.
 *   - Read → merge → write preserves sibling server entries.
 *   - Corrupted JSON yields a clean empty default; `install` still succeeds
 *     and writes a valid file.
 */

import 'reflect-metadata';
import type { McpServerConfig } from '@ptah-extension/shared';
import { expectNormalizedPath } from '@ptah-extension/shared/testing';

jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  copyFileSync: jest.fn(),
  renameSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

jest.mock('node:os', () => ({
  ...jest.requireActual('node:os'),
  homedir: jest.fn(() => '/home/testuser'),
}));

jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/home/testuser'),
}));

import * as fs from 'fs';
import * as os from 'os';
import { GeminiMcpInstaller } from './gemini-mcp.installer';

const mockedExistsSync = fs.existsSync as jest.MockedFunction<
  typeof fs.existsSync
>;
const mockedReadFileSync = fs.readFileSync as jest.MockedFunction<
  typeof fs.readFileSync
>;
const mockedWriteFileSync = fs.writeFileSync as jest.MockedFunction<
  typeof fs.writeFileSync
>;
const mockedCopyFileSync = fs.copyFileSync as jest.MockedFunction<
  typeof fs.copyFileSync
>;
const mockedRenameSync = fs.renameSync as jest.MockedFunction<
  typeof fs.renameSync
>;
const mockedMkdirSync = fs.mkdirSync as jest.MockedFunction<
  typeof fs.mkdirSync
>;
const mockedHomedir = os.homedir as jest.MockedFunction<typeof os.homedir>;

const ORIGINAL_PLATFORM = process.platform;
function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true,
    writable: false,
  });
}
function restorePlatform(): void {
  Object.defineProperty(process, 'platform', {
    value: ORIGINAL_PLATFORM,
    configurable: true,
    writable: false,
  });
}

function capturedWrite(): { tmpPath: string; contents: string } {
  const lastCall = mockedWriteFileSync.mock.calls.at(-1);
  if (!lastCall) throw new Error('writeFileSync was not called');
  const [tmpPath, contents] = lastCall;
  return {
    tmpPath: String(tmpPath),
    contents: typeof contents === 'string' ? contents : String(contents),
  };
}

describe('GeminiMcpInstaller', () => {
  let installer: GeminiMcpInstaller;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedHomedir.mockReturnValue('/home/testuser');
    installer = new GeminiMcpInstaller();
  });

  afterEach(() => {
    restorePlatform();
  });

  describe('target identity', () => {
    it('declares target "gemini"', () => {
      expect(installer.target).toBe('gemini');
    });
  });

  // -------------------------------------------------------------------------
  // getConfigPath
  // -------------------------------------------------------------------------

  describe('getConfigPath', () => {
    it('resolves under $HOME/.gemini/settings.json on POSIX', () => {
      setPlatform('linux');
      mockedHomedir.mockReturnValue('/home/alice');

      expectNormalizedPath(
        installer.getConfigPath(),
        '/home/alice/.gemini/settings.json',
      );
    });

    it('resolves under homedir on win32', () => {
      setPlatform('win32');
      mockedHomedir.mockReturnValue('C:\\Users\\alice');

      expectNormalizedPath(
        installer.getConfigPath(),
        'C:/Users/alice/.gemini/settings.json',
      );
    });

    it('resolves under homedir on darwin', () => {
      setPlatform('darwin');
      mockedHomedir.mockReturnValue('/Users/alice');

      expectNormalizedPath(
        installer.getConfigPath(),
        '/Users/alice/.gemini/settings.json',
      );
    });

    it('ignores workspaceRoot (user-global installer)', () => {
      mockedHomedir.mockReturnValue('/home/alice');
      expect(installer.getConfigPath()).toBe(
        installer.getConfigPath('/some/workspace'),
      );
    });
  });

  // -------------------------------------------------------------------------
  // install — JSON round-trip with httpUrl rewrite for http/sse transports.
  // -------------------------------------------------------------------------

  describe('install', () => {
    beforeEach(() => {
      setPlatform('linux');
      mockedHomedir.mockReturnValue('/home/testuser');
    });

    it('stores stdio entries unchanged under mcpServers', async () => {
      mockedExistsSync.mockReturnValue(false);

      const config: McpServerConfig = {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@example/mcp'],
      };

      const result = await installer.install('example', config);

      expect(result.success).toBe(true);
      expect(result.target).toBe('gemini');
      expectNormalizedPath(
        result.configPath,
        '/home/testuser/.gemini/settings.json',
      );

      const { contents } = capturedWrite();
      const parsed = JSON.parse(contents) as {
        mcpServers: Record<string, Record<string, unknown>>;
      };
      expect(parsed.mcpServers['example']).toEqual({
        command: 'npx',
        args: ['-y', '@example/mcp'],
      });
      // Gemini never includes the discriminant.
      expect(parsed.mcpServers['example']['type']).toBeUndefined();
      // Tmp-file atomic write + rename happened once.
      expect(mockedRenameSync).toHaveBeenCalledTimes(1);
    });

    it('rewrites http transport url → httpUrl on write', async () => {
      mockedExistsSync.mockReturnValue(false);

      const result = await installer.install('remote', {
        type: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer x' },
      });

      expect(result.success).toBe(true);
      const { contents } = capturedWrite();
      const parsed = JSON.parse(contents) as {
        mcpServers: Record<string, Record<string, unknown>>;
      };
      // httpUrl (Gemini's native key) present; url field dropped.
      expect(parsed.mcpServers['remote']['httpUrl']).toBe(
        'https://example.com/mcp',
      );
      expect(parsed.mcpServers['remote']['url']).toBeUndefined();
      expect(parsed.mcpServers['remote']['headers']).toEqual({
        Authorization: 'Bearer x',
      });
    });

    it('rewrites sse transport url → httpUrl on write', async () => {
      mockedExistsSync.mockReturnValue(false);

      await installer.install('remote-sse', {
        type: 'sse',
        url: 'https://example.com/sse',
      });

      const { contents } = capturedWrite();
      const parsed = JSON.parse(contents) as {
        mcpServers: Record<string, Record<string, unknown>>;
      };
      expect(parsed.mcpServers['remote-sse']['httpUrl']).toBe(
        'https://example.com/sse',
      );
      expect(parsed.mcpServers['remote-sse']['url']).toBeUndefined();
    });

    it('preserves unrelated server entries and top-level keys', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce(
        JSON.stringify({
          theme: 'dark',
          mcpServers: {
            filesystem: { command: 'node', args: ['./fs.js'] },
          },
        }),
      );

      await installer.install('example', {
        type: 'stdio',
        command: 'npx',
      });

      const { contents } = capturedWrite();
      const parsed = JSON.parse(contents) as {
        theme?: string;
        mcpServers: Record<string, unknown>;
      };
      // Unrelated top-level Gemini settings preserved.
      expect(parsed.theme).toBe('dark');
      expect(parsed.mcpServers['filesystem']).toEqual({
        command: 'node',
        args: ['./fs.js'],
      });
      expect(parsed.mcpServers['example']).toBeDefined();
      // Backup of the prior file created.
      expect(mockedCopyFileSync).toHaveBeenCalledTimes(1);
    });

    it('starts fresh when existing JSON is corrupted (never throws)', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce('{ not json');

      const result = await installer.install('example', {
        type: 'stdio',
        command: 'npx',
      });

      expect(result.success).toBe(true);
      const { contents } = capturedWrite();
      const parsed = JSON.parse(contents) as {
        mcpServers: Record<string, unknown>;
      };
      expect(Object.keys(parsed.mcpServers)).toEqual(['example']);
    });

    it('creates parent directory recursively when missing', async () => {
      mockedExistsSync.mockReturnValue(false);

      await installer.install('example', {
        type: 'stdio',
        command: 'npx',
      });

      expect(mockedMkdirSync).toHaveBeenCalledWith(expect.any(String), {
        recursive: true,
      });
    });

    it('returns success=false when the write fails', async () => {
      mockedExistsSync.mockReturnValue(false);
      mockedWriteFileSync.mockImplementationOnce(() => {
        throw new Error('EACCES');
      });

      const result = await installer.install('example', {
        type: 'stdio',
        command: 'npx',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/EACCES/);
    });
  });

  // -------------------------------------------------------------------------
  // listInstalled — reverses httpUrl → url so callers see canonical types.
  // -------------------------------------------------------------------------

  describe('listInstalled', () => {
    beforeEach(() => {
      setPlatform('linux');
      mockedHomedir.mockReturnValue('/home/testuser');
    });

    it('returns [] when the config file does not exist', async () => {
      mockedExistsSync.mockReturnValue(false);
      await expect(installer.listInstalled()).resolves.toEqual([]);
    });

    it('returns [] when the config is corrupted', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce('not json');
      await expect(installer.listInstalled()).resolves.toEqual([]);
    });

    it('normalizes Gemini httpUrl back to url when listing', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce(
        JSON.stringify({
          mcpServers: {
            remote: { httpUrl: 'https://example.com/mcp' },
            localFs: { command: 'node', args: ['./fs.js'] },
          },
        }),
      );

      const listed = await installer.listInstalled();
      const byKey = Object.fromEntries(
        listed.map((entry) => [entry.serverKey, entry]),
      );

      expect(byKey['remote'].config.type).toBe('http');
      if (byKey['remote'].config.type !== 'stdio') {
        expect(byKey['remote'].config.url).toBe('https://example.com/mcp');
      }
      expect(byKey['localFs'].config.type).toBe('stdio');

      for (const entry of listed) {
        expect(entry.target).toBe('gemini');
        expect(entry.managedByPtah).toBe(false);
        expectNormalizedPath(
          entry.configPath,
          '/home/testuser/.gemini/settings.json',
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // uninstall — shared helper path.
  // -------------------------------------------------------------------------

  describe('uninstall', () => {
    beforeEach(() => {
      setPlatform('linux');
      mockedHomedir.mockReturnValue('/home/testuser');
    });

    it('removes the target server and preserves siblings', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce(
        JSON.stringify({
          theme: 'dark',
          mcpServers: {
            example: { command: 'npx' },
            keep: { command: 'node' },
          },
        }),
      );

      const result = await installer.uninstall('example');

      expect(result.success).toBe(true);
      const { contents } = capturedWrite();
      const parsed = JSON.parse(contents) as {
        theme?: string;
        mcpServers: Record<string, unknown>;
      };
      expect(parsed.mcpServers['example']).toBeUndefined();
      expect(parsed.mcpServers['keep']).toEqual({ command: 'node' });
      expect(parsed.theme).toBe('dark');
    });

    it('is a no-op when the server key is not present', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce(
        JSON.stringify({ mcpServers: { keep: { command: 'node' } } }),
      );

      const result = await installer.uninstall('missing');

      expect(result.success).toBe(true);
      expect(mockedWriteFileSync).not.toHaveBeenCalled();
    });
  });
});
