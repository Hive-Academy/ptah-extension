/**
 * Antigravity as the sixth user-installed MCP target (TASK_2026_285), end to end
 * through the reconciler rather than through the facet alone.
 *
 * The facet spec (`targets/mcp/antigravity-mcp-facet.spec.ts`) pins the file's
 * schema and the key partition. This one pins the half only the reconciler can
 * answer: that an intent recorded for `antigravity` produces a manifest-owned
 * entry in `~/.gemini/config/mcp_config.json`, that dropping the intent removes
 * exactly that entry, and that the entries the reconciler must never touch —
 * the adapter's ephemeral `ptah` key and the user's hand-written servers —
 * survive a full pass in both directions.
 *
 * `homeDir` is a temp directory throughout. A spec that wrote to the real
 * `~/.gemini` would edit the developer's own `agy` config.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { HarnessTargetId, McpServerConfig } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import type {
  HarnessSourceState,
  IHarnessCliDetector,
} from '../sources/harness-source.port';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import { PTAH_SPAWN_MCP_KEY } from '../targets/mcp/mcp-facet.port';
import { createMcpFacet } from '../targets/mcp/mcp-facet.registry';
import { createAntigravityTarget } from '../targets/rival-targets';
import { HarnessReconcilerService } from './harness-reconciler.service';

const CONFIG_REL = '~/.gemini/config/mcp_config.json';

function fakeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function detectorFor(installed: HarnessTargetId[]): IHarnessCliDetector {
  const set = new Set(installed);
  return { isInstalled: (target) => Promise.resolve(set.has(target)) };
}

describe('HarnessReconcilerService — antigravity MCP (TASK_2026_285)', () => {
  let ws: string;
  let sourcesRoot: string;
  let home: string;
  let configPath: string;

  const githubServer: McpServerConfig = {
    type: 'stdio',
    command: 'github-mcp',
    args: ['--stdio'],
  };

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-agy-mcp-ws-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-agy-mcp-src-'));
    home = mkdtempSync(join(tmpdir(), 'harness-agy-mcp-home-'));
    configPath = join(home, '.gemini', 'config', 'mcp_config.json');

    // One skill, so the user layer is non-empty and `sources` reports `ok`.
    mkdirSync(join(sourcesRoot, 'skills', 'alpha'), { recursive: true });
    writeFileSync(
      join(sourcesRoot, 'skills', 'alpha', 'SKILL.md'),
      '---\nname: alpha\ndescription: the alpha skill\n---\nalpha body\n',
      'utf-8',
    );
  });

  afterEach(() => {
    for (const dir of [ws, sourcesRoot, home]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** Skills only; commands and agents are empty directories for this spec. */
  function sourceLayout(): HarnessSourceState['layout'] {
    return {
      skillsRoot: join(sourcesRoot, 'skills'),
      commandsRoot: join(sourcesRoot, 'commands'),
      agentsRoot: join(sourcesRoot, 'agents'),
    };
  }

  /** A reconciler wired with the antigravity target alone, pointed at `home`. */
  function makeReconciler(
    intents: HarnessSourceState['mcpIntents'],
  ): HarnessReconcilerService {
    const store = new ManagedManifestStore();
    const sourceState: HarnessSourceState = {
      layout: sourceLayout(),
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
      mcpIntents: intents,
    };
    return new HarnessReconcilerService(
      fakeLogger(),
      new HarnessManifestBuilder(),
      store,
      createStaticSourceResolver(sourceState),
      [
        createAntigravityTarget({
          manifestStore: store,
          detector: detectorFor(['antigravity']),
          homeDir: home,
        }),
      ],
    );
  }

  /** The server map, or `{}` when nothing has written the config file at all. */
  function servers(): Record<string, unknown> {
    if (!existsSync(configPath)) return {};
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<
      string,
      Record<string, unknown>
    >;
    return parsed['mcpServers'] ?? {};
  }

  /** What `AntigravityCliAdapter` does before a spawn, via the same facet. */
  function spawnWrite(port: number): Promise<void> {
    return createMcpFacet('antigravity', { homeDir: home }).write(
      '',
      PTAH_SPAWN_MCP_KEY,
      { type: 'sse', url: `http://localhost:${port}` },
    );
  }

  /** What it does after `done`. */
  function spawnCleanup(): Promise<void> {
    return createMcpFacet('antigravity', { homeDir: home }).remove(
      '',
      PTAH_SPAWN_MCP_KEY,
    );
  }

  it('installs an intent recorded for antigravity into ~/.gemini/config/mcp_config.json', async () => {
    const reconciler = makeReconciler([
      {
        serverKey: 'github',
        registryName: 'io.github.example/github',
        config: githubServer,
        targets: ['antigravity'],
      },
    ]);

    const health = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'spec',
    });
    const target = health.targets.find((t) => t.target === 'antigravity');

    expect(target?.facets.mcp).toBe('supported');
    expect(target?.writeFailed).toEqual([]);
    expect(servers()['github']).toEqual({
      command: 'github-mcp',
      args: ['--stdio'],
    });
    expect(health.targets[0].found).toBeGreaterThan(0);
  });

  it('does not install a server whose intent names other targets only', async () => {
    const reconciler = makeReconciler([
      {
        serverKey: 'cursor-only',
        registryName: 'io.github.example/cursor-only',
        config: githubServer,
        targets: ['cursor'],
      },
    ]);

    await reconciler.reconcile(ws, { mode: 'full', reason: 'spec' });
    expect(servers()['cursor-only']).toBeUndefined();
  });

  it('is idempotent — a second pass reports the entry found and rewrites nothing', async () => {
    const intents: HarnessSourceState['mcpIntents'] = [
      {
        serverKey: 'github',
        registryName: 'io.github.example/github',
        config: githubServer,
        targets: ['antigravity'],
      },
    ];
    const reconciler = makeReconciler(intents);

    await reconciler.reconcile(ws, { mode: 'full', reason: 'spec' });
    const first = readFileSync(configPath, 'utf-8');

    const health = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'spec',
    });
    expect(readFileSync(configPath, 'utf-8')).toBe(first);
    expect(
      health.targets.find((t) => t.target === 'antigravity')?.missing,
    ).toEqual([]);
  });

  it('survives a full spawn/teardown cycle: the user server is still installed after cleanup', async () => {
    const reconciler = makeReconciler([
      {
        serverKey: 'github',
        registryName: 'io.github.example/github',
        config: githubServer,
        targets: ['antigravity'],
      },
    ]);
    await reconciler.reconcile(ws, { mode: 'full', reason: 'spec' });

    await spawnWrite(51234);
    expect(servers()[PTAH_SPAWN_MCP_KEY]).toEqual({
      serverUrl: 'http://localhost:51234',
    });

    await spawnCleanup();

    expect(servers()[PTAH_SPAWN_MCP_KEY]).toBeUndefined();
    expect(servers()['github']).toEqual({
      command: 'github-mcp',
      args: ['--stdio'],
    });
  });

  it("a reconcile never writes or reaps the adapter's ephemeral `ptah` key, and never reports it", async () => {
    await spawnWrite(51234);

    const reconciler = makeReconciler([
      {
        serverKey: 'github',
        registryName: 'io.github.example/github',
        config: githubServer,
        targets: ['antigravity'],
      },
    ]);
    const health = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'spec',
    });
    const target = health.targets.find((t) => t.target === 'antigravity');

    expect(servers()[PTAH_SPAWN_MCP_KEY]).toEqual({
      serverUrl: 'http://localhost:51234',
    });
    // Not desired and not owned, so it is not a finding of any kind. A `ptah`
    // key showing up as `foreign` would be a permanently un-clearable row in
    // `ptah harness doctor` for a file Ptah itself wrote on purpose.
    expect(target?.foreign).not.toContain(
      `${CONFIG_REL}#${PTAH_SPAWN_MCP_KEY}`,
    );
    expect(target?.missing).not.toContain(
      `${CONFIG_REL}#${PTAH_SPAWN_MCP_KEY}`,
    );
    expect(target?.removed).not.toContain(
      `${CONFIG_REL}#${PTAH_SPAWN_MCP_KEY}`,
    );
  });

  it('an uninstall removes only the manifest-owned key — `ptah` and hand-written servers stay', async () => {
    const intent = {
      serverKey: 'github',
      registryName: 'io.github.example/github',
      config: githubServer,
      targets: ['antigravity' as const],
    };

    // Same manifest store across both passes, so the second pass INHERITS
    // ownership of `github` and can legitimately remove it.
    const store = new ManagedManifestStore();
    const build = (
      intents: HarnessSourceState['mcpIntents'],
    ): HarnessReconcilerService =>
      new HarnessReconcilerService(
        fakeLogger(),
        new HarnessManifestBuilder(),
        store,
        createStaticSourceResolver({
          layout: sourceLayout(),
          overlayPluginPaths: [],
          disabledSkillIds: [],
          disabledPluginIds: [],
          mcpIntents: intents,
        }),
        [
          createAntigravityTarget({
            manifestStore: store,
            detector: detectorFor(['antigravity']),
            homeDir: home,
          }),
        ],
      );

    await build([intent]).reconcile(ws, { mode: 'full', reason: 'spec' });
    await spawnWrite(51234);
    // A server the user added by hand, after the install.
    const facet = createMcpFacet('antigravity', { homeDir: home });
    await facet.write('', 'their-own', { type: 'stdio', command: 'theirs' });

    // The intent is gone — this is what `McpInstallService.uninstall` produces.
    const health = await build([]).reconcile(ws, {
      mode: 'full',
      reason: 'spec',
    });

    const remaining = servers();
    expect(remaining['github']).toBeUndefined();
    expect(remaining[PTAH_SPAWN_MCP_KEY]).toEqual({
      serverUrl: 'http://localhost:51234',
    });
    expect(remaining['their-own']).toEqual({ command: 'theirs' });
    expect(
      health.targets.find((t) => t.target === 'antigravity')?.removed,
    ).toContain(`${CONFIG_REL}#github`);
  });

  it('refuses to take a key the user already owns, and reports it as both foreign and missing', async () => {
    mkdirSync(join(home, '.gemini', 'config'), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify(
        { mcpServers: { github: { command: 'the-users-own-github' } } },
        null,
        2,
      ),
      'utf-8',
    );

    const reconciler = makeReconciler([
      {
        serverKey: 'github',
        registryName: 'io.github.example/github',
        config: githubServer,
        targets: ['antigravity'],
      },
    ]);
    const health = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'spec',
    });
    const target = health.targets.find((t) => t.target === 'antigravity');

    expect(servers()['github']).toEqual({ command: 'the-users-own-github' });
    expect(target?.foreign).toContain(`${CONFIG_REL}#github`);
    expect(target?.missing).toContain(`${CONFIG_REL}#github`);
  });

  it('a reconcile and a spawn running concurrently both land their entry', async () => {
    const reconciler = makeReconciler([
      {
        serverKey: 'github',
        registryName: 'io.github.example/github',
        config: githubServer,
        targets: ['antigravity'],
      },
    ]);

    await Promise.all([
      reconciler.reconcile(ws, { mode: 'full', reason: 'spec' }),
      spawnWrite(51234),
    ]);

    const both = servers();
    expect(both['github']).toEqual({
      command: 'github-mcp',
      args: ['--stdio'],
    });
    expect(both[PTAH_SPAWN_MCP_KEY]).toEqual({
      serverUrl: 'http://localhost:51234',
    });
  });
});
