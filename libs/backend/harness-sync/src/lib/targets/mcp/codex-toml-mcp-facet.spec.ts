/**
 * `~/.codex/config.toml` fenced-block MCP facet (E18) — the user's config is
 * hand-edited (comments, `model = "..."`, their own `[mcp_servers.*]` tables),
 * so Ptah must only ever touch bytes between its own `# ptah:begin` /
 * `# ptah:end` markers.
 *
 * Source-under-test: `CodexTomlMcpFacet`.
 */

// Both readers are wrapped (pass-through by default) so a test can make ONE
// path fail with EACCES: `readFile` from `fs/promises` for `inspect`, and
// `readFileSync` for the legacy `readAll`. `chmod` cannot do that on Windows,
// and an unreadable config is exactly the case `inspect` exists to report (N9).
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return { ...actual, readFileSync: jest.fn(actual.readFileSync) };
});
jest.mock('fs/promises', () => {
  const actual = jest.requireActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, readFile: jest.fn(actual.readFile) };
});

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { McpServerConfig } from '@ptah-extension/shared';
import { CodexTomlMcpFacet } from './codex-toml-mcp-facet';

const actualFs = jest.requireActual<typeof import('fs')>('fs');
const actualFsPromises =
  jest.requireActual<typeof import('fs/promises')>('fs/promises');

function permissionDenied(path: string): Error {
  return Object.assign(new Error(`EACCES: permission denied, open '${path}'`), {
    code: 'EACCES',
  });
}

/** Make every read of `path`, sync or async, fail like a permission-denied open. */
function denyReadsOf(path: string): void {
  jest.mocked(fs.readFileSync).mockImplementation(((
    file: fs.PathOrFileDescriptor,
    options?: Parameters<typeof actualFs.readFileSync>[1],
  ) => {
    if (file === path) throw permissionDenied(path);
    return actualFs.readFileSync(file, options);
  }) as typeof fs.readFileSync);
  jest.mocked(fsPromises.readFile).mockImplementation(((
    file: Parameters<typeof actualFsPromises.readFile>[0],
    options?: Parameters<typeof actualFsPromises.readFile>[1],
  ) => {
    if (file === path) return Promise.reject(permissionDenied(path));
    return actualFsPromises.readFile(file, options);
  }) as typeof fsPromises.readFile);
}

afterEach(() => {
  jest.mocked(fs.readFileSync).mockImplementation(actualFs.readFileSync);
  jest
    .mocked(fsPromises.readFile)
    .mockImplementation(actualFsPromises.readFile);
});

describe('CodexTomlMcpFacet (E18)', () => {
  let tempHome: string;
  let ws: string;
  let configPath: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'harness-sync-codex-home-'));
    ws = mkdtempSync(join(tmpdir(), 'harness-sync-codex-ws-'));
    configPath = join(tempHome, '.codex', 'config.toml');
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    rmSync(ws, { recursive: true, force: true });
  });

  function makeFacet(): CodexTomlMcpFacet {
    return new CodexTomlMcpFacet({ homeDir: tempHome });
  }

  function seedConfig(content: string): void {
    mkdirSync(join(tempHome, '.codex'), { recursive: true });
    writeFileSync(configPath, content, 'utf-8');
  }

  const stdio = (command: string, args?: string[]): McpServerConfig => ({
    type: 'stdio',
    command,
    ...(args === undefined ? {} : { args }),
  });

  it('[E18] writing a stdio server appends a fenced `[mcp_servers.<key>]` block with begin/end markers', async () => {
    const facet = makeFacet();
    await facet.write(ws, 'github', stdio('npx', ['-y', '@foo/github-mcp']));

    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain('# ptah:begin github');
    expect(content).toContain('[mcp_servers.github]');
    expect(content).toContain('command = "npx"');
    expect(content).toContain('args = ["-y", "@foo/github-mcp"]');
    expect(content).toContain('# ptah:end github');
  });

  it("[E18] a user's pre-existing config content is byte-preserved", async () => {
    const original = [
      '# personal codex config',
      'model = "gpt-5-codex"',
      '',
      '[mcp_servers.mine]',
      'command = "mine-cmd"',
      '',
    ].join('\n');
    seedConfig(original);

    const facet = makeFacet();
    await facet.write(ws, 'github', stdio('npx'));

    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain('# personal codex config');
    expect(content).toContain('model = "gpt-5-codex"');
    expect(content).toContain('[mcp_servers.mine]');
    expect(content).toContain('command = "mine-cmd"');

    const all = facet.readAll();
    expect(all.get('mine')).toEqual({ type: 'stdio', command: 'mine-cmd' });
  });

  it('[E18] re-writing the same key REPLACES the block in place — no duplicate table, old value gone', async () => {
    const facet = makeFacet();
    await facet.write(ws, 'github', stdio('cmd-a'));
    await facet.write(ws, 'github', stdio('cmd-b'));

    const content = readFileSync(configPath, 'utf-8');
    const tableOccurrences = content.split('[mcp_servers.github]').length - 1;
    expect(tableOccurrences).toBe(1);
    expect(content).toContain('command = "cmd-b"');
    expect(content).not.toContain('command = "cmd-a"');
  });

  it("[E18] remove() deletes only the fenced block; user content and 'mine' survive", async () => {
    seedConfig(
      [
        '# my config',
        'model = "gpt-5-codex"',
        '',
        '[mcp_servers.mine]',
        'command = "mine-cmd"',
        '',
      ].join('\n'),
    );
    const facet = makeFacet();
    await facet.write(ws, 'github', stdio('npx'));
    expect(readFileSync(configPath, 'utf-8')).toContain('# ptah:begin github');

    await facet.remove(ws, 'github');

    const content = readFileSync(configPath, 'utf-8');
    expect(content).not.toContain('ptah:begin github');
    expect(content).not.toContain('[mcp_servers.github]');
    expect(content).toContain('# my config');
    expect(content).toContain('model = "gpt-5-codex"');
    expect(content).toContain('[mcp_servers.mine]');
    expect(content).toContain('command = "mine-cmd"');
  });

  it('[E18] remove() of an absent key is a no-op that does not rewrite the file', async () => {
    const original = ['# my config', 'model = "gpt-5-codex"', ''].join('\n');
    seedConfig(original);
    const facet = makeFacet();

    await facet.remove(ws, 'never-existed');

    // Content identical — not merely "still valid" — proving no rewrite path
    // was taken (a rewrite would also have dropped a `.bak` file next to it).
    expect(readFileSync(configPath, 'utf-8')).toBe(original);
  });

  it("[E18] readAll() returns both Ptah's and the user's servers, with transports parsed (stdio from command, http from url)", async () => {
    seedConfig(
      ['[mcp_servers.myhttp]', 'url = "https://example.com/mcp"', ''].join(
        '\n',
      ),
    );
    const facet = makeFacet();
    await facet.write(ws, 'github', stdio('npx', ['-y', 'gh']));

    const all = facet.readAll();
    expect(all.get('github')).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'gh'],
    });
    expect(all.get('myhttp')).toEqual({
      type: 'http',
      url: 'https://example.com/mcp',
    });
  });

  it('[E18] write() THROWS when a non-fenced [mcp_servers.<key>] already exists — duplicate TOML table would break Codex', async () => {
    seedConfig(
      ['[mcp_servers.dup]', 'command = "hand-written"', ''].join('\n'),
    );
    const facet = makeFacet();

    await expect(facet.write(ws, 'dup', stdio('npx'))).rejects.toThrow();
  });

  it('[E18] env / headers become sub-tables and round-trip through readAll', async () => {
    const facet = makeFacet();
    await facet.write(ws, 'httpsrv', {
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer xyz' },
      env: { FOO: 'bar' },
    });

    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain('[mcp_servers.httpsrv.headers]');
    expect(content).toContain('[mcp_servers.httpsrv.env]');

    const all = facet.readAll();
    expect(all.get('httpsrv')).toEqual({
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer xyz' },
      env: { FOO: 'bar' },
    });
  });

  // ---------------------------------------------------------------- inspect

  describe('inspect (N9)', () => {
    it('reports `ok` with every declared server when the file is readable', async () => {
      seedConfig(['[mcp_servers.mine]', 'command = "mine-cmd"', ''].join('\n'));
      const facet = makeFacet();
      await facet.write(ws, 'github', stdio('npx'));

      const result = await facet.inspect();
      expect(result.status).toBe('ok');
      expect(result.error).toBeUndefined();
      expect([...result.servers.keys()].sort()).toEqual(['github', 'mine']);
      expect(result.servers.get('mine')).toEqual(stdio('mine-cmd'));
    });

    it('reports `ok` and no servers for a readable file that declares none', async () => {
      seedConfig('model = "gpt-5-codex"\n');

      const result = await makeFacet().inspect();
      expect(result).toEqual({ status: 'ok', servers: new Map() });
    });

    it('reports `missing` — not `error` — when the config file does not exist (ENOENT)', async () => {
      const result = await makeFacet().inspect();
      expect(result).toEqual({ status: 'missing', servers: new Map() });
    });

    it('reports `missing` for a workspace-scoped facet with no workspace', async () => {
      const facet = new CodexTomlMcpFacet({
        homeDir: tempHome,
        scope: 'workspace',
      });
      await expect(facet.inspect('')).resolves.toEqual({
        status: 'missing',
        servers: new Map(),
      });
    });

    it('reads the workspace-scoped file under the given root', async () => {
      mkdirSync(join(ws, '.codex'), { recursive: true });
      writeFileSync(
        join(ws, '.codex', 'config.toml'),
        ['[mcp_servers.local]', 'url = "https://example.com/mcp"', ''].join(
          '\n',
        ),
        'utf-8',
      );
      const facet = new CodexTomlMcpFacet({
        homeDir: tempHome,
        scope: 'workspace',
      });

      const result = await facet.inspect(ws);
      expect(result.status).toBe('ok');
      expect(result.servers.get('local')).toEqual({
        type: 'http',
        url: 'https://example.com/mcp',
      });
    });

    it('reports `error` for an unreadable config (EACCES), while legacy readAll still reads it as empty', async () => {
      seedConfig(['[mcp_servers.mine]', 'command = "mine-cmd"', ''].join('\n'));
      denyReadsOf(configPath);
      const facet = makeFacet();

      const result = await facet.inspect();
      expect(result.status).toBe('error');
      expect(result.error).toContain('EACCES');
      // Nothing is KNOWN, so nothing is reported — the status is the signal.
      expect(result.servers.size).toBe(0);

      // The legacy contract is unchanged: readAll never throws and folds an
      // unreadable file into "declares nothing".
      expect(facet.readAll().size).toBe(0);
      expect(facet.foreignServerKeys().size).toBe(0);
    });

    it('reports `error` when the config path is a directory, not a file', async () => {
      mkdirSync(configPath, { recursive: true });

      const result = await makeFacet().inspect();
      expect(result.status).toBe('error');
      expect(result.error).toBeDefined();
      expect(result.servers.size).toBe(0);
    });
  });
});
