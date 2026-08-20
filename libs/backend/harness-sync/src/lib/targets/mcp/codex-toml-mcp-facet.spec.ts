/**
 * `~/.codex/config.toml` fenced-block MCP facet (E18) — the user's config is
 * hand-edited (comments, `model = "..."`, their own `[mcp_servers.*]` tables),
 * so Ptah must only ever touch bytes between its own `# ptah:begin` /
 * `# ptah:end` markers.
 *
 * Source-under-test: `CodexTomlMcpFacet`.
 */

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
});
