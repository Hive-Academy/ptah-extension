/**
 * claude-mcp.installer — unit specs.
 *
 * Covers the ClaudeMcpInstaller which writes MCP server configs to the
 * workspace-scoped shared `<workspaceRoot>/.mcp.json` (consumed by Claude
 * Code, Codex, and the Ptah CLI).
 *
 * Claude-specific invariants:
 *   - Workspace-scoped: `getConfigPath` throws `SdkError` without a workspace.
 *   - Config lives at `<workspaceRoot>/.mcp.json` (dotfile at the repo root,
 *     NOT under `.claude/`).
 *   - Root key is `mcpServers`, and the discriminant `type` field is
 *     omitted (Claude infers from the presence of `command` vs `url`).
 *   - Read → merge → write preserves unrelated entries; corrupted JSON
 *     degrades to a clean empty default.
 */

import 'reflect-metadata';
import * as path from 'path';
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
import { ClaudeMcpInstaller } from './claude-mcp.installer';
import { SdkError } from '../../../errors';

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

const POSIX_WORKSPACE = '/workspace/project';
const WIN_WORKSPACE = 'C:\\workspace\\project';

describe('ClaudeMcpInstaller', () => {
  let installer: ClaudeMcpInstaller;

  beforeEach(() => {
    jest.clearAllMocks();
    installer = new ClaudeMcpInstaller();
  });

  afterEach(() => {
    restorePlatform();
  });

  describe('target identity', () => {
    it('declares target "claude"', () => {
      expect(installer.target).toBe('claude');
    });
  });

  // -------------------------------------------------------------------------
  // getConfigPath
  // -------------------------------------------------------------------------

  describe('getConfigPath', () => {
    it('resolves <workspace>/.mcp.json on POSIX (repo-root dotfile, not under .claude/)', () => {
      setPlatform('linux');
      expectNormalizedPath(
        installer.getConfigPath(POSIX_WORKSPACE),
        path.posix.join(POSIX_WORKSPACE, '.mcp.json'),
      );
    });

    it('resolves under the workspace root on win32', () => {
      setPlatform('win32');
      expectNormalizedPath(
        installer.getConfigPath(WIN_WORKSPACE),
        'C:/workspace/project/.mcp.json',
      );
    });

    it('throws SdkError when workspaceRoot is missing', () => {
      expect(() => installer.getConfigPath()).toThrow(SdkError);
      expect(() => installer.getConfigPath()).toThrow(/workspace root/i);
    });

    it('throws SdkError when workspaceRoot is an empty string', () => {
      expect(() => installer.getConfigPath('')).toThrow(SdkError);
    });
  });

  // -------------------------------------------------------------------------
  // install — NO discriminant type, under "mcpServers".
  // -------------------------------------------------------------------------

  describe('install', () => {
    beforeEach(() => {
      setPlatform('linux');
    });

    it('writes stdio entries under mcpServers without a type discriminant', async () => {
      mockedExistsSync.mockReturnValue(false);

      const config: McpServerConfig = {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@example/mcp'],
      };

      const result = await installer.install(
        'example',
        config,
        POSIX_WORKSPACE,
      );

      expect(result.success).toBe(true);
      expect(result.target).toBe('claude');
      expectNormalizedPath(
        result.configPath,
        path.posix.join(POSIX_WORKSPACE, '.mcp.json'),
      );

      const { contents } = capturedWrite();
      const parsed = JSON.parse(contents) as {
        mcpServers: Record<string, Record<string, unknown>>;
      };
      expect(parsed.mcpServers['example']).toEqual({
        command: 'npx',
        args: ['-y', '@example/mcp'],
      });
      // INCLUDE_TYPE = false — Claude infers from `command` vs `url`.
      expect(parsed.mcpServers['example']['type']).toBeUndefined();
    });

    it('writes http entries with url (no type) under mcpServers', async () => {
      mockedExistsSync.mockReturnValue(false);

      await installer.install(
        'remote',
        { type: 'http', url: 'https://example.com/mcp' },
        POSIX_WORKSPACE,
      );

      const { contents } = capturedWrite();
      const parsed = JSON.parse(contents) as {
        mcpServers: Record<string, Record<string, unknown>>;
      };
      expect(parsed.mcpServers['remote']).toEqual({
        url: 'https://example.com/mcp',
      });
      expect(parsed.mcpServers['remote']['type']).toBeUndefined();
    });

    it('preserves unrelated servers when merging into an existing file', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce(
        JSON.stringify({
          mcpServers: {
            filesystem: { command: 'node', args: ['./fs.js'] },
            github: { command: 'npx', args: ['@gh/mcp'] },
          },
        }),
      );

      await installer.install(
        'example',
        { type: 'stdio', command: 'npx' },
        POSIX_WORKSPACE,
      );

      const { contents } = capturedWrite();
      const parsed = JSON.parse(contents) as {
        mcpServers: Record<string, unknown>;
      };
      expect(parsed.mcpServers['filesystem']).toEqual({
        command: 'node',
        args: ['./fs.js'],
      });
      expect(parsed.mcpServers['github']).toEqual({
        command: 'npx',
        args: ['@gh/mcp'],
      });
      expect(parsed.mcpServers['example']).toBeDefined();
      expect(mockedCopyFileSync).toHaveBeenCalledTimes(1);
    });

    it('starts fresh when existing JSON is corrupted (never throws)', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce('{ invalid json');

      const result = await installer.install(
        'example',
        { type: 'stdio', command: 'npx' },
        POSIX_WORKSPACE,
      );

      expect(result.success).toBe(true);
      const { contents } = capturedWrite();
      const parsed = JSON.parse(contents) as {
        mcpServers: Record<string, unknown>;
      };
      expect(Object.keys(parsed.mcpServers)).toEqual(['example']);
    });

    it('throws SdkError synchronously when workspaceRoot is missing', () => {
      expect(() =>
        installer.install('example', { type: 'stdio', command: 'npx' }),
      ).toThrow(SdkError);
    });

    it('returns success=false when the filesystem write fails', async () => {
      mockedExistsSync.mockReturnValue(false);
      mockedWriteFileSync.mockImplementationOnce(() => {
        throw new Error('EACCES');
      });

      const result = await installer.install(
        'example',
        { type: 'stdio', command: 'npx' },
        POSIX_WORKSPACE,
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/EACCES/);
    });

    it('uses atomic write (tmp file + rename)', async () => {
      mockedExistsSync.mockReturnValue(false);

      await installer.install(
        'example',
        { type: 'stdio', command: 'npx' },
        POSIX_WORKSPACE,
      );

      const { tmpPath } = capturedWrite();
      expect(tmpPath.endsWith('.tmp')).toBe(true);
      expect(mockedRenameSync).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // uninstall
  // -------------------------------------------------------------------------

  describe('uninstall', () => {
    beforeEach(() => {
      setPlatform('linux');
    });

    it('removes the target server and preserves siblings', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce(
        JSON.stringify({
          mcpServers: {
            example: { command: 'npx' },
            keep: { command: 'node' },
          },
        }),
      );

      const result = await installer.uninstall('example', POSIX_WORKSPACE);

      expect(result.success).toBe(true);
      const { contents } = capturedWrite();
      const parsed = JSON.parse(contents) as {
        mcpServers: Record<string, unknown>;
      };
      expect(parsed.mcpServers['example']).toBeUndefined();
      expect(parsed.mcpServers['keep']).toEqual({ command: 'node' });
    });

    it('is a no-op when the server key is not present', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce(
        JSON.stringify({ mcpServers: { keep: { command: 'node' } } }),
      );

      const result = await installer.uninstall('missing', POSIX_WORKSPACE);

      expect(result.success).toBe(true);
      expect(mockedWriteFileSync).not.toHaveBeenCalled();
    });

    it('throws SdkError synchronously when workspaceRoot is missing', () => {
      expect(() => installer.uninstall('example')).toThrow(SdkError);
    });
  });

  // -------------------------------------------------------------------------
  // listInstalled
  // -------------------------------------------------------------------------

  describe('listInstalled', () => {
    beforeEach(() => {
      setPlatform('linux');
    });

    it('returns [] when the config file does not exist', async () => {
      mockedExistsSync.mockReturnValue(false);
      await expect(installer.listInstalled(POSIX_WORKSPACE)).resolves.toEqual(
        [],
      );
    });

    it('returns [] when the config is corrupted', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce('{ bad');
      await expect(installer.listInstalled(POSIX_WORKSPACE)).resolves.toEqual(
        [],
      );
    });

    it('infers transport type from command vs url when not set', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce(
        JSON.stringify({
          mcpServers: {
            localFs: { command: 'node', args: ['./fs.js'] },
            remoteHttp: { url: 'https://example.com/mcp' },
          },
        }),
      );

      const listed = await installer.listInstalled(POSIX_WORKSPACE);
      const byKey = Object.fromEntries(
        listed.map((entry) => [entry.serverKey, entry]),
      );
      expect(byKey['localFs'].config.type).toBe('stdio');
      expect(byKey['remoteHttp'].config.type).toBe('http');

      for (const entry of listed) {
        expect(entry.target).toBe('claude');
        expectNormalizedPath(
          entry.configPath,
          path.posix.join(POSIX_WORKSPACE, '.mcp.json'),
        );
        expect(entry.managedByPtah).toBe(false);
      }
    });

    it('throws SdkError synchronously when workspaceRoot is missing', () => {
      expect(() => installer.listInstalled()).toThrow(SdkError);
    });
  });
});
