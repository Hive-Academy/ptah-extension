/**
 * copilot-mcp.installer — unit specs.
 *
 * Covers the CopilotMcpInstaller which writes MCP server configs to the
 * user-global GitHub Copilot CLI config at `~/.copilot/mcp-config.json`.
 *
 * Invariants under test:
 *   - `getConfigPath` resolves under `os.homedir()` on every platform
 *     (this is a user-global installer — no workspace required, no
 *     LOCALAPPDATA / XDG_CONFIG_HOME override).
 *   - `install` performs a read → merge → write round-trip that preserves
 *     unrelated server entries under the `mcpServers` root.
 *   - Corrupted JSON on disk surfaces as a clean empty default; `install`
 *     still succeeds and writes a valid file rather than throwing.
 *   - The Copilot target does NOT emit a discriminant `type` field
 *     (INCLUDE_TYPE = false in the installer).
 *   - Windows path assertions use `expectNormalizedPath` so the CI matrix
 *     passes on win32 (backslashes) and POSIX (forward slashes).
 *
 * Mocks:
 *   - `node:fs/promises` (required by task brief, though this installer
 *     uses synchronous `fs`; the promises mock is a safety net in case a
 *     dependency ever touches it during the spec).
 *   - `fs` (synchronous APIs actually used by `mcp-config-io.utils.ts`).
 *   - `os.homedir()` for deterministic path resolution.
 */

import 'reflect-metadata';
import type { McpServerConfig } from '@ptah-extension/shared';
import { expectNormalizedPath } from '@ptah-extension/shared/testing';

// fs/promises mock — task requirement. This installer's IO path is sync,
// but any transitive import that uses fs/promises is kept deterministic.
jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn(),
}));

// The installer and its helpers (`mcp-config-io.utils.ts`) use synchronous
// `fs` — this is the mock that actually drives test behaviour.
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
import { CopilotMcpInstaller } from './copilot-mcp.installer';

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

// Snapshot & restore process.platform so individual tests can simulate
// win32 / linux / darwin without polluting sibling suites.
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

// Capture the buffer handed to writeFileSync (the atomic-write tmp file).
function capturedWrite(): { tmpPath: string; contents: string } {
  const lastCall = mockedWriteFileSync.mock.calls.at(-1);
  if (!lastCall) throw new Error('writeFileSync was not called');
  const [tmpPath, contents] = lastCall;
  return {
    tmpPath: String(tmpPath),
    contents: typeof contents === 'string' ? contents : String(contents),
  };
}

describe('CopilotMcpInstaller', () => {
  let installer: CopilotMcpInstaller;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedHomedir.mockReturnValue('/home/testuser');
    installer = new CopilotMcpInstaller();
  });

  afterEach(() => {
    restorePlatform();
  });

  describe('target identity', () => {
    it('declares target "copilot"', () => {
      expect(installer.target).toBe('copilot');
    });
  });

  // -------------------------------------------------------------------------
  // getConfigPath — user-global, always under homedir.
  // -------------------------------------------------------------------------

  describe('getConfigPath', () => {
    it('resolves under $HOME/.copilot/mcp-config.json on POSIX', () => {
      setPlatform('linux');
      mockedHomedir.mockReturnValue('/home/alice');

      expectNormalizedPath(
        installer.getConfigPath(),
        '/home/alice/.copilot/mcp-config.json',
      );
    });

    it('resolves under homedir on win32 (ignores LOCALAPPDATA)', () => {
      setPlatform('win32');
      mockedHomedir.mockReturnValue('C:\\Users\\alice');
      process.env['LOCALAPPDATA'] = 'C:\\Users\\alice\\AppData\\Local';

      try {
        expectNormalizedPath(
          installer.getConfigPath(),
          'C:/Users/alice/.copilot/mcp-config.json',
        );
      } finally {
        delete process.env['LOCALAPPDATA'];
      }
    });

    it('resolves under homedir on darwin', () => {
      setPlatform('darwin');
      mockedHomedir.mockReturnValue('/Users/alice');

      expectNormalizedPath(
        installer.getConfigPath(),
        '/Users/alice/.copilot/mcp-config.json',
      );
    });

    it('ignores workspaceRoot (user-global installer)', () => {
      setPlatform('linux');
      mockedHomedir.mockReturnValue('/home/alice');

      const p1 = installer.getConfigPath();
      const p2 = installer.getConfigPath('/some/workspace');
      expect(p1).toBe(p2);
    });
  });

  // -------------------------------------------------------------------------
  // install — JSON round-trip: read existing → merge → write.
  // -------------------------------------------------------------------------

  describe('install', () => {
    beforeEach(() => {
      setPlatform('linux');
      mockedHomedir.mockReturnValue('/home/testuser');
    });

    it('writes a fresh config when the file does not exist', async () => {
      // Dir exists=false → mkdirSync is invoked; config file exists=false.
      mockedExistsSync.mockReturnValue(false);

      const config: McpServerConfig = {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@ptah-extension/example'],
      };

      const result = await installer.install('example', config);

      expect(result.success).toBe(true);
      expect(result.target).toBe('copilot');
      expectNormalizedPath(
        result.configPath,
        '/home/testuser/.copilot/mcp-config.json',
      );

      // Parent dir created recursively.
      expect(mockedMkdirSync).toHaveBeenCalledWith(expect.any(String), {
        recursive: true,
      });

      // Atomic write: tmp file then rename.
      const { tmpPath, contents } = capturedWrite();
      expect(tmpPath.endsWith('.tmp')).toBe(true);
      expect(mockedRenameSync).toHaveBeenCalledTimes(1);

      // Parsed payload contains our server under `mcpServers` without `type`.
      const parsed = JSON.parse(contents) as {
        mcpServers: Record<string, Record<string, unknown>>;
      };
      expect(parsed.mcpServers['example']).toEqual({
        command: 'npx',
        args: ['-y', '@ptah-extension/example'],
      });
      // INCLUDE_TYPE = false — never emit the discriminant.
      expect(parsed.mcpServers['example']['type']).toBeUndefined();
    });

    it('preserves unrelated server entries when merging into an existing file', async () => {
      // Config file exists with two siblings; dir also exists → no mkdir.
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce(
        JSON.stringify({
          mcpServers: {
            filesystem: { command: 'node', args: ['./fs.js'] },
            github: { command: 'npx', args: ['@gh/mcp'] },
          },
          // Unrelated top-level keys also preserved.
          someOtherKey: { keep: true },
        }),
      );

      const result = await installer.install('example', {
        type: 'stdio',
        command: 'npx',
        args: ['@example/new'],
      });

      expect(result.success).toBe(true);

      const { contents } = capturedWrite();
      const parsed = JSON.parse(contents) as {
        mcpServers: Record<string, unknown>;
        someOtherKey?: unknown;
      };

      // New entry added.
      expect(parsed.mcpServers['example']).toEqual({
        command: 'npx',
        args: ['@example/new'],
      });
      // Siblings untouched.
      expect(parsed.mcpServers['filesystem']).toEqual({
        command: 'node',
        args: ['./fs.js'],
      });
      expect(parsed.mcpServers['github']).toEqual({
        command: 'npx',
        args: ['@gh/mcp'],
      });
      // Unrelated top-level keys untouched.
      expect(parsed.someOtherKey).toEqual({ keep: true });
      // Backup of the prior file created.
      expect(mockedCopyFileSync).toHaveBeenCalledTimes(1);
    });

    it('falls back to a clean default when existing JSON is corrupted (never throws)', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce('{ not valid json');

      const result = await installer.install('example', {
        type: 'stdio',
        command: 'npx',
      });

      // Corruption is swallowed by readJsonConfig → empty object → install
      // still succeeds.
      expect(result.success).toBe(true);

      const { contents } = capturedWrite();
      const parsed = JSON.parse(contents) as {
        mcpServers: Record<string, unknown>;
      };
      // Prior garbage discarded — only the new server present.
      expect(Object.keys(parsed.mcpServers)).toEqual(['example']);
    });

    it('reshapes http transport without the discriminant type field', async () => {
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
      expect(parsed.mcpServers['remote']).toEqual({
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer x' },
      });
      expect(parsed.mcpServers['remote']['type']).toBeUndefined();
    });

    it('returns success=false when the filesystem write fails', async () => {
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
      expect(result.target).toBe('copilot');
    });
  });

  // -------------------------------------------------------------------------
  // uninstall — removes entry, preserves siblings, is idempotent.
  // -------------------------------------------------------------------------

  describe('uninstall', () => {
    beforeEach(() => {
      setPlatform('linux');
      mockedHomedir.mockReturnValue('/home/testuser');
    });

    it('removes the target server while preserving siblings', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce(
        JSON.stringify({
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
        mcpServers: Record<string, unknown>;
      };
      expect(parsed.mcpServers['example']).toBeUndefined();
      expect(parsed.mcpServers['keep']).toEqual({ command: 'node' });
    });

    it('is a no-op when the server key does not exist', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce(
        JSON.stringify({ mcpServers: { keep: { command: 'node' } } }),
      );

      const result = await installer.uninstall('missing');

      expect(result.success).toBe(true);
      // No write performed when nothing changed.
      expect(mockedWriteFileSync).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // listInstalled — parses entries, normalizes stdio / http / sse.
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

    it('returns [] when the config file is corrupted', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce('{ broken');

      await expect(installer.listInstalled()).resolves.toEqual([]);
    });

    it('parses stdio, http, and sse entries (inferring type when absent)', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValueOnce(
        JSON.stringify({
          mcpServers: {
            localFs: { command: 'node', args: ['./fs.js'] },
            remoteHttp: { url: 'https://example.com/mcp' },
            remoteSse: { url: 'https://example.com/sse' },
          },
        }),
      );

      const listed = await installer.listInstalled();
      expect(listed).toHaveLength(3);

      const byKey = Object.fromEntries(
        listed.map((entry) => [entry.serverKey, entry]),
      );
      expect(byKey['localFs'].config.type).toBe('stdio');
      expect(byKey['remoteHttp'].config.type).toBe('http');
      // `/sse` in URL triggers SSE inference in `inferTransportType`.
      expect(byKey['remoteSse'].config.type).toBe('sse');

      // All entries point at the same user-global config path.
      for (const entry of listed) {
        expectNormalizedPath(
          entry.configPath,
          '/home/testuser/.copilot/mcp-config.json',
        );
        expect(entry.target).toBe('copilot');
        expect(entry.managedByPtah).toBe(false);
      }
    });
  });
});
