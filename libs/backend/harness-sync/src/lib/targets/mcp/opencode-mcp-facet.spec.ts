/**
 * `{ws}/opencode.json` — the project config opencode reads its MCP servers from.
 *
 * OpenCode's dialect diverges from every other JSON target in three ways at
 * once, all three verified against the published schema
 * (https://opencode.ai/config.json — `McpRemoteConfig` / `McpLocalConfig`, both
 * `additionalProperties: false`) and against a live opencode v2.0.12 server on
 * 2026-09-22:
 *
 * 1. the transport discriminant is REQUIRED and spelled `remote` / `local`;
 * 2. a local server's `command` is one array — there is no `args` key;
 * 3. the environment is `environment`, not `env`.
 *
 * This spec is where those three are pinned, together with the rule every facet
 * shares: the file belongs to the user, so nothing outside the one key being
 * written is ever touched.
 *
 * Source-under-test: `JsonMcpFacet` as configured by `createMcpFacet('opencode')`.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { McpServerConfig } from '@ptah-extension/shared';
import type { IHarnessMcpFacet } from './mcp-facet.port';
import { PTAH_SPAWN_MCP_KEY } from './mcp-facet.port';
import { createMcpFacet } from './mcp-facet.registry';
import { hashMcpConfig } from './mcp-json-format';

describe('OpenCode MCP facet (opencode.json)', () => {
  let ws: string;
  let configPath: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-sync-opencode-ws-'));
    configPath = join(ws, 'opencode.json');
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
  });

  function makeFacet(): IHarnessMcpFacet {
    return createMcpFacet('opencode');
  }

  function readConfig(): Record<string, Record<string, unknown>> {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as Record<
      string,
      Record<string, unknown>
    >;
  }

  function seedConfig(content: unknown): void {
    writeFileSync(configPath, JSON.stringify(content, null, 2), 'utf-8');
  }

  /** Ptah's own server, as the spawn path declares it. */
  const ptahServer: McpServerConfig = {
    type: 'http',
    url: 'http://localhost:51820/agent/abc/workspace/D%3A%5Cprojects',
  };

  // ------------------------------------------------------------------ paths

  it('resolves the workspace-scoped `opencode.json` at the project root', () => {
    const facet = makeFacet();
    expect(facet.configPath(ws)).toBe(configPath);
    expect(facet.configRelPath()).toBe('opencode.json');
  });

  // ----------------------------------------------------------------- schema

  it('writes a remote server under `mcp` with the REQUIRED `type: "remote"`', async () => {
    const facet = makeFacet();
    await facet.write(ws, PTAH_SPAWN_MCP_KEY, ptahServer);

    const config = readConfig();
    expect(Object.keys(config)).toEqual(['mcp']);
    expect(config['mcp'][PTAH_SPAWN_MCP_KEY]).toEqual({
      type: 'remote',
      url: 'http://localhost:51820/agent/abc/workspace/D%3A%5Cprojects',
    });
  });

  it('writes the flat `mcp.<name>` map, not the nested `mcp.servers` one', () => {
    // The flat form is what the published schema documents and what Ptah's own
    // spawn path puts in `OPENCODE_CONFIG_CONTENT`; opencode normalizes it
    // internally. Writing `mcp.servers` here would give Ptah two shapes.
    return makeFacet()
      .write(ws, PTAH_SPAWN_MCP_KEY, ptahServer)
      .then(() => {
        expect(readConfig()['mcp']['servers']).toBeUndefined();
        expect(readConfig()['mcp'][PTAH_SPAWN_MCP_KEY]).toBeDefined();
      });
  });

  it('writes a local server as `type: "local"` with command+args in ONE array', async () => {
    const facet = makeFacet();
    await facet.write(ws, 'github', {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@foo/github-mcp'],
      env: { TOKEN: 'abc' },
    });

    const entry = readConfig()['mcp']['github'] as Record<string, unknown>;
    expect(entry).toEqual({
      type: 'local',
      command: ['npx', '-y', '@foo/github-mcp'],
      environment: { TOKEN: 'abc' },
    });
    // `args` and `env` are not keys opencode's schema allows.
    expect(entry['args']).toBeUndefined();
    expect(entry['env']).toBeUndefined();
  });

  it('never writes `enabled`, which defaults true and is not modelled by the hash', async () => {
    const facet = makeFacet();
    await facet.write(ws, PTAH_SPAWN_MCP_KEY, ptahServer);
    expect(
      (readConfig()['mcp'][PTAH_SPAWN_MCP_KEY] as Record<string, unknown>)[
        'enabled'
      ],
    ).toBeUndefined();
  });

  // ------------------------------------------------------------- round-trip

  it.each<[string, McpServerConfig]>([
    ['remote http', ptahServer],
    ['remote sse', { type: 'sse', url: 'https://mcp.example.com/sse' }],
    [
      'local',
      { type: 'stdio', command: 'npx', args: ['-y', '@foo/x'], env: { A: 'b' } },
    ],
    ['local without args', { type: 'stdio', command: 'my-server' }],
  ])(
    'reads a %s entry back to the config it was written from, so a reconcile is a no-op',
    async (_label, desired) => {
      const facet = makeFacet();
      await facet.write(ws, 'entry', desired);

      const roundTripped = facet.readAll(ws).get('entry');
      expect(roundTripped).toEqual(desired);
      // The planner compares these hashes; unequal means a rewrite every pass.
      expect(hashMcpConfig(roundTripped as McpServerConfig)).toBe(
        hashMcpConfig(desired),
      );
    },
  );

  it('re-writing an unchanged entry leaves the file byte-identical', async () => {
    const facet = makeFacet();
    await facet.write(ws, PTAH_SPAWN_MCP_KEY, ptahServer);
    const first = readFileSync(configPath, 'utf-8');

    await makeFacet().write(ws, PTAH_SPAWN_MCP_KEY, ptahServer);
    expect(readFileSync(configPath, 'utf-8')).toBe(first);
  });

  it('reads a hand-written opencode entry in opencode spelling', () => {
    seedConfig({
      mcp: {
        theirs: { type: 'remote', url: 'https://theirs.example.com/mcp' },
        local: { type: 'local', command: ['bun', 'x', 'srv'] },
      },
    });

    const servers = makeFacet().readAll(ws);
    expect(servers.get('theirs')).toEqual({
      type: 'http',
      url: 'https://theirs.example.com/mcp',
    });
    expect(servers.get('local')).toEqual({
      type: 'stdio',
      command: 'bun',
      args: ['x', 'srv'],
    });
  });

  // ---------------------------------------------------- the user's own file

  it('preserves every other top-level key in opencode.json', async () => {
    seedConfig({
      $schema: 'https://opencode.ai/config.json',
      model: 'anthropic/claude-sonnet-4-5',
      agent: { reviewer: { description: 'mine', mode: 'subagent' } },
      permission: { edit: 'ask' },
    });

    const facet = makeFacet();
    await facet.write(ws, PTAH_SPAWN_MCP_KEY, ptahServer);

    const config = readConfig();
    expect(config['$schema'] as unknown).toBe('https://opencode.ai/config.json');
    expect(config['model'] as unknown).toBe('anthropic/claude-sonnet-4-5');
    expect(config['agent']).toEqual({
      reviewer: { description: 'mine', mode: 'subagent' },
    });
    expect(config['permission']).toEqual({ edit: 'ask' });
    expect(config['mcp'][PTAH_SPAWN_MCP_KEY]).toBeDefined();
  });

  it("a server the user hand-wrote survives every write and every removal", async () => {
    seedConfig({
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        mine: { type: 'local', command: ['my-own-server', '--flag'] },
        'remote-mine': { type: 'remote', url: 'https://mine.example.com/mcp' },
      },
    });

    const facet = makeFacet();
    await facet.write(ws, PTAH_SPAWN_MCP_KEY, ptahServer);
    await facet.write(ws, 'github', { type: 'stdio', command: 'github-server' });
    await facet.remove(ws, 'github');
    await facet.remove(ws, PTAH_SPAWN_MCP_KEY);

    const config = readConfig();
    expect(config['mcp']['mine']).toEqual({
      type: 'local',
      command: ['my-own-server', '--flag'],
    });
    expect(config['mcp']['remote-mine']).toEqual({
      type: 'remote',
      url: 'https://mine.example.com/mcp',
    });
    expect(config['$schema'] as unknown).toBe('https://opencode.ai/config.json');
  });

  it('an uninstall removes only the named key', async () => {
    const facet = makeFacet();
    await facet.write(ws, PTAH_SPAWN_MCP_KEY, ptahServer);
    await facet.write(ws, 'github', { type: 'stdio', command: 'github-server' });

    await facet.remove(ws, 'github');

    const servers = readConfig()['mcp'];
    expect(servers['github']).toBeUndefined();
    expect(servers[PTAH_SPAWN_MCP_KEY]).toEqual({
      type: 'remote',
      url: ptahServer.type === 'http' ? ptahServer.url : '',
    });
  });

  it('a missing or malformed opencode.json reads as empty rather than throwing', () => {
    expect(makeFacet().readAll(ws).size).toBe(0);
    writeFileSync(configPath, '{ not json', 'utf-8');
    expect(makeFacet().readAll(ws).size).toBe(0);
  });

  // ------------------------------------------------------------- concurrency

  it('a reconcile write and a spawn write issued concurrently both land', async () => {
    const reconcilerFacet = makeFacet();
    const adapterFacet = makeFacet();

    await Promise.all([
      reconcilerFacet.write(ws, 'github', {
        type: 'stdio',
        command: 'github-server',
      }),
      adapterFacet.write(ws, PTAH_SPAWN_MCP_KEY, ptahServer),
    ]);

    const servers = readConfig()['mcp'];
    expect(servers['github']).toEqual({
      type: 'local',
      command: ['github-server'],
    });
    expect(servers[PTAH_SPAWN_MCP_KEY]).toBeDefined();
  });
});
