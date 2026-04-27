/**
 * vscode-mcp.installer — unit specs.
 *
 * Covers the VscodeMcpInstaller which writes MCP server configs to the
 * workspace-scoped VS Code config at `<workspaceRoot>/.vscode/mcp.json`.
 *
 * VS-Code-specific invariants:
 *   - Workspace-scoped: `getConfigPath` throws `SdkError` when no workspace
 *     root is provided. This is distinct from the user-global installers.
 *   - Root key is `servers` (NOT `mcpServers`).
 *   - Discriminant `type` field IS emitted — VS Code uses it to select
 *     the transport implementation.
 *   - JSON round-trip preserves unrelated sibling servers and top-level
 *     keys; corrupted JSON degrades to a clean empty default.
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
import { VscodeMcpInstaller } from './vscode-mcp.installer';
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

// Use posix joins for expected fixtures so the comparison is deterministic
// when expectNormalizedPath normalizes both sides.
const POSIX_WORKSPACE = '/workspace/project';
const WIN_WORKSPACE = 'C:\\workspace\\project';

describe('VscodeMcpInstaller', () => {
  let installer: VscodeMcpInstaller;

  beforeEach(() => {
    jest.clearAllMocks();
    installer = new VscodeMcpInstaller();
  });

  afterEach(() => {
    restorePlatform();
  });

  describe('target identity', () => {
    it('declares target "vscode"', () => {
      expect(installer.target).toBe('vscode');
    });
  });

  // -------------------------------------------------------------------------
  // getConfigPath — workspace-scoped, requires a workspace root.
  // -------------------------------------------------------------------------

  describe('getConfigPath', () => {
    it('resolves <workspace>/.vscode/mcp.json on POSIX', () => {
      setPlatform('linux');
      expectNormalizedPath(
        installer.getConfigPath(POSIX_WORKSPACE),
        path.posix.join(POSIX_WORKSPACE, '.vscode', 'mcp.json'),
      );
    });

    it('resolves <workspace>\\.vscode\\mcp.json on win32', () => {
      setPlatform('win32');
      expectNormalizedPath(
        installer.getConfigPath(WIN_WORKSPACE),
        'C:/workspace/project/.vscode/mcp.json',
      );
    });

    it('throws SdkError when workspaceRoot is missing', () => {
      expect(() => installer.getConfigPath()).toThrow(SdkError);
      expect(() => installer.getConfigPath()).toThrow(/workspace root/i);
    });

    it('throws SdkError when workspaceRoot is an empty string', () => {
      // Empty string is falsy → same branch as undefined.
      expect(() => installer.getConfigPath('')).toThrow(SdkError);
    });
  });

  // -------------------------------------------------------------------------
  // install — emits discriminant type, merges, preserves siblings.
  // -------------------------------------------------------------------------

  describe('install', () => {
    beforeEach(() => {
      setPlatform('linux');
    });

    it('writes a fresh config with discriminant type field under "servers"', async () => {
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
      expect(result.target).toBe('vscode');
      expectNormalizedPath(
        result.configPath,
        path.posix.join(POSIX_WORKSPACE, '.vscode', 'mcp.json'),
      );

      const { contents } = capturedWrite();
      const parsed = JSON.parse(contents) as {
        servers: Record<string, Record<string, unknown>>;
      };
      // INCLUDE_TYPE = true — VS Code needs the discriminant.
      expect(parsed.servers['example']).toEqual({
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@example/mcp'],
      });
    });

    it('emits http transport under "servers" with type="http"', async () => {
      mockedExistsSync.mockReturnValue(false);

      await installer.install(
        'remote',
        { type: 'http', url: 'https://example.com/mcp' },
        POSIX_WORKSPACE,
      );

      const { contents } = capturedWrite();
      const parsed = JSON.parse(contents) as {
        servers: Record<string, Record<string, unknown>>;
      };
      expect(parsed.servers['remote']).toEqual({
        type: 'http',
        url: 'https://example.com/mcp',
      });
    });

    it('preserves unrelated servers and unrelated top-level keys', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce(
        JSON.stringify({
          inputs: [{ id: 'api-key', type: 'promptString' }],
          servers: {
            filesystem: { type: 'stdio', command: 'node' },
            github: { type: 'http', url: 'https://api.github.com' },
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
        inputs?: unknown;
        servers: Record<string, unknown>;
      };
      // VS Code-specific top-level "inputs" must survive the round-trip.
      expect(parsed.inputs).toEqual([{ id: 'api-key', type: 'promptString' }]);
      expect(parsed.servers['filesystem']).toEqual({
        type: 'stdio',
        command: 'node',
      });
      expect(parsed.servers['github']).toEqual({
        type: 'http',
        url: 'https://api.github.com',
      });
      expect(parsed.servers['example']).toBeDefined();
      expect(mockedCopyFileSync).toHaveBeenCalledTimes(1);
    });

    it('starts fresh when existing JSON is corrupted', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce('{ invalid');

      const result = await installer.install(
        'example',
        { type: 'stdio', command: 'npx' },
        POSIX_WORKSPACE,
      );

      expect(result.success).toBe(true);
      const { contents } = capturedWrite();
      const parsed = JSON.parse(contents) as {
        servers: Record<string, unknown>;
      };
      expect(Object.keys(parsed.servers)).toEqual(['example']);
    });

    it('creates .vscode directory recursively when missing', async () => {
      mockedExistsSync.mockReturnValue(false);

      await installer.install(
        'example',
        { type: 'stdio', command: 'npx' },
        POSIX_WORKSPACE,
      );

      expect(mockedMkdirSync).toHaveBeenCalledWith(expect.any(String), {
        recursive: true,
      });
    });

    it('throws SdkError synchronously when workspaceRoot is missing', () => {
      // install() is declared `Promise<McpInstallResult>` but has no `async`
      // keyword — `getConfigPath` runs synchronously on entry, so a missing
      // workspace throws before the promise-wrapping `installServer` call.
      expect(() =>
        installer.install('example', { type: 'stdio', command: 'npx' }),
      ).toThrow(SdkError);
    });

    it('returns success=false when the write fails', async () => {
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

    it('uses atomic write via tmp file + rename', async () => {
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

    it('removes the server and preserves siblings under "servers"', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce(
        JSON.stringify({
          servers: {
            example: { type: 'stdio', command: 'npx' },
            keep: { type: 'stdio', command: 'node' },
          },
        }),
      );

      const result = await installer.uninstall('example', POSIX_WORKSPACE);

      expect(result.success).toBe(true);
      const { contents } = capturedWrite();
      const parsed = JSON.parse(contents) as {
        servers: Record<string, unknown>;
      };
      expect(parsed.servers['example']).toBeUndefined();
      expect(parsed.servers['keep']).toEqual({
        type: 'stdio',
        command: 'node',
      });
    });

    it('is a no-op when the server key is absent', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce(
        JSON.stringify({
          servers: { keep: { type: 'stdio', command: 'node' } },
        }),
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

    it('parses servers with explicit type discriminants', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce(
        JSON.stringify({
          servers: {
            localFs: {
              type: 'stdio',
              command: 'node',
              args: ['./fs.js'],
            },
            remoteHttp: {
              type: 'http',
              url: 'https://example.com/mcp',
            },
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
        expect(entry.target).toBe('vscode');
        expect(entry.managedByPtah).toBe(false);
        expectNormalizedPath(
          entry.configPath,
          path.posix.join(POSIX_WORKSPACE, '.vscode', 'mcp.json'),
        );
      }
    });

    it('throws SdkError synchronously when workspaceRoot is missing', () => {
      expect(() => installer.listInstalled()).toThrow(SdkError);
    });
  });
});
