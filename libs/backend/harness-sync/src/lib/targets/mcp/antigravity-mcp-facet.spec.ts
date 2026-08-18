/**
 * `~/.gemini/config/mcp_config.json` — the one MCP config file with TWO writers
 * (TASK_2026_285).
 *
 * The reconciler installs the USER's servers into it; `AntigravityCliAdapter`
 * writes Ptah's own ephemeral `ptah` server into it before every spawn and
 * removes that key after `done`. Both go through this facet, so this spec is
 * where the file's schema and the key partition are pinned:
 *
 * 1. The schema `agy` actually reads — `mcpServers`, `{command,args,env}` for
 *    stdio, `{serverUrl}` (NOT `url`) for remote, no `type` discriminant.
 * 2. Neither writer may reap the other's keys, and neither may touch a key the
 *    user hand-wrote.
 * 3. A read-modify-write from each side, interleaved, keeps both entries.
 *
 * Source-under-test: `JsonMcpFacet` as configured by `createMcpFacet('antigravity')`.
 */

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { McpServerConfig } from '@ptah-extension/shared';
import type { IHarnessMcpFacet } from './mcp-facet.port';
import { PTAH_SPAWN_MCP_KEY } from './mcp-facet.port';
import { createMcpFacet } from './mcp-facet.registry';
import { hashMcpConfig, jsonToConfig } from './mcp-json-format';

describe('Antigravity MCP facet (TASK_2026_285)', () => {
  let tempHome: string;
  let ws: string;
  let configPath: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'harness-sync-agy-home-'));
    ws = mkdtempSync(join(tmpdir(), 'harness-sync-agy-ws-'));
    configPath = join(tempHome, '.gemini', 'config', 'mcp_config.json');
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    rmSync(ws, { recursive: true, force: true });
  });

  function makeFacet(): IHarnessMcpFacet {
    return createMcpFacet('antigravity', { homeDir: tempHome });
  }

  function readConfig(): Record<string, Record<string, unknown>> {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as Record<
      string,
      Record<string, unknown>
    >;
  }

  function seedConfig(content: unknown): void {
    mkdirSync(join(tempHome, '.gemini', 'config'), { recursive: true });
    writeFileSync(configPath, JSON.stringify(content, null, 2), 'utf-8');
  }

  const stdio = (command: string, args?: string[]): McpServerConfig => ({
    type: 'stdio',
    command,
    ...(args === undefined ? {} : { args }),
  });

  const spawnEntry = (port: number): McpServerConfig => ({
    type: 'sse',
    url: `http://localhost:${port}`,
  });

  // ------------------------------------------------------------------ schema

  it('resolves the home-scoped path `agy` reads, honouring the homeDir override', () => {
    const facet = makeFacet();
    expect(facet.configPath(ws)).toBe(configPath);
    expect(facet.configRelPath()).toBe('~/.gemini/config/mcp_config.json');
  });

  it('writes a stdio server as {command,args,env} under `mcpServers`, with no `type` key', async () => {
    const facet = makeFacet();
    await facet.write(ws, 'github', {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@foo/github-mcp'],
      env: { TOKEN: 'abc' },
    });

    const config = readConfig();
    expect(Object.keys(config)).toEqual(['mcpServers']);
    expect(config['mcpServers']['github']).toEqual({
      command: 'npx',
      args: ['-y', '@foo/github-mcp'],
      env: { TOKEN: 'abc' },
    });
  });

  it('writes a remote server under `serverUrl`, never `url` — the only spelling `agy` reads', async () => {
    const facet = makeFacet();
    await facet.write(ws, 'remote-service', {
      type: 'http',
      url: 'https://mcp.example.com/mcp',
    });

    const entry = readConfig()['mcpServers']['remote-service'] as Record<
      string,
      unknown
    >;
    expect(entry).toEqual({ serverUrl: 'https://mcp.example.com/mcp' });
    expect(entry['url']).toBeUndefined();
  });

  it('reads a `serverUrl` entry back to the config it was written from, so a reconcile is a no-op', async () => {
    const desired: McpServerConfig = {
      type: 'http',
      url: 'https://mcp.example.com/mcp',
    };
    const facet = makeFacet();
    await facet.write(ws, 'remote-service', desired);

    const roundTripped = facet.readAll(ws).get('remote-service');
    expect(roundTripped).toEqual(desired);
    // The planner compares these hashes; unequal means a rewrite every pass.
    expect(hashMcpConfig(roundTripped as McpServerConfig)).toBe(
      hashMcpConfig(desired),
    );
  });

  it('reads a hand-written `serverUrl` entry as a remote server rather than an endpoint-less one', () => {
    seedConfig({
      mcpServers: { theirs: { serverUrl: 'https://theirs.example.com/sse' } },
    });

    const config = jsonToConfig({
      serverUrl: 'https://theirs.example.com/sse',
    });
    expect(config).toEqual({
      type: 'sse',
      url: 'https://theirs.example.com/sse',
    });
    expect(makeFacet().readAll(ws).get('theirs')).toEqual(config);
  });

  // --------------------------------------------------------- key partitioning

  it("the adapter's cleanup removes only `ptah`, leaving a manifest-owned user server installed", async () => {
    const facet = makeFacet();
    await facet.write(ws, 'github', stdio('github-server'));
    await facet.write(ws, PTAH_SPAWN_MCP_KEY, spawnEntry(51234));

    expect(Object.keys(readConfig()['mcpServers']).sort()).toEqual([
      'github',
      PTAH_SPAWN_MCP_KEY,
    ]);

    await facet.remove(ws, PTAH_SPAWN_MCP_KEY);

    const servers = readConfig()['mcpServers'];
    expect(servers[PTAH_SPAWN_MCP_KEY]).toBeUndefined();
    expect(servers['github']).toEqual({ command: 'github-server' });
  });

  it("an uninstall removes only the manifest-owned key, never the adapter's `ptah` entry", async () => {
    const facet = makeFacet();
    await facet.write(ws, PTAH_SPAWN_MCP_KEY, spawnEntry(51234));
    await facet.write(ws, 'github', stdio('github-server'));

    await facet.remove(ws, 'github');

    const servers = readConfig()['mcpServers'];
    expect(servers['github']).toBeUndefined();
    expect(servers[PTAH_SPAWN_MCP_KEY]).toEqual({
      serverUrl: 'http://localhost:51234',
    });
  });

  it('a key the user hand-wrote survives every write and every removal', async () => {
    seedConfig({
      mcpServers: {
        mine: { command: 'my-own-server', args: ['--flag'] },
        'remote-mine': { serverUrl: 'https://mine.example.com/sse' },
      },
      // A top-level key Ptah knows nothing about must also survive.
      someOtherSetting: true,
    });

    const facet = makeFacet();
    await facet.write(ws, PTAH_SPAWN_MCP_KEY, spawnEntry(51234));
    await facet.write(ws, 'github', stdio('github-server'));
    await facet.remove(ws, 'github');
    await facet.remove(ws, PTAH_SPAWN_MCP_KEY);

    const config = readConfig();
    expect(config['mcpServers']['mine']).toEqual({
      command: 'my-own-server',
      args: ['--flag'],
    });
    expect(config['mcpServers']['remote-mine']).toEqual({
      serverUrl: 'https://mine.example.com/sse',
    });
    expect(config['someOtherSetting'] as unknown).toBe(true);
  });

  it('leaves the `mcpServers` map in place when its last Ptah key goes, because the map is no longer ours to delete', async () => {
    const facet = makeFacet();
    await facet.write(ws, PTAH_SPAWN_MCP_KEY, spawnEntry(51234));
    await facet.remove(ws, PTAH_SPAWN_MCP_KEY);

    expect(readConfig()['mcpServers']).toEqual({});
  });

  // ------------------------------------------------------------- concurrency

  it('a reconcile write and a spawn write issued concurrently both land — neither read-modify-write is lost', async () => {
    // Two facet INSTANCES, because the two writers are two call sites: the
    // reconciler's target and the CLI adapter. Sharing one object would test
    // nothing about the lock.
    const reconcilerFacet = makeFacet();
    const adapterFacet = makeFacet();

    await Promise.all([
      reconcilerFacet.write(ws, 'github', stdio('github-server')),
      adapterFacet.write(ws, PTAH_SPAWN_MCP_KEY, spawnEntry(51234)),
    ]);

    const servers = readConfig()['mcpServers'];
    expect(servers['github']).toEqual({ command: 'github-server' });
    expect(servers[PTAH_SPAWN_MCP_KEY]).toEqual({
      serverUrl: 'http://localhost:51234',
    });
  });

  it('a spawn cleanup racing an install removes only `ptah` and keeps the freshly installed server', async () => {
    const adapterFacet = makeFacet();
    await adapterFacet.write(ws, PTAH_SPAWN_MCP_KEY, spawnEntry(51234));

    const reconcilerFacet = makeFacet();
    await Promise.all([
      reconcilerFacet.write(ws, 'github', stdio('github-server')),
      adapterFacet.remove(ws, PTAH_SPAWN_MCP_KEY),
    ]);

    const servers = readConfig()['mcpServers'];
    expect(servers['github']).toEqual({ command: 'github-server' });
    expect(servers[PTAH_SPAWN_MCP_KEY]).toBeUndefined();
  });

  it('leaves no lock file behind once the writes are done', async () => {
    const facet = makeFacet();
    await facet.write(ws, 'github', stdio('github-server'));
    await facet.remove(ws, 'github');

    const leftovers = readdirSync(join(tempHome, '.gemini', 'config')).filter(
      (name) => name.includes('lock') || name.endsWith('.tmp'),
    );
    expect(leftovers).toEqual([]);
  });
});
