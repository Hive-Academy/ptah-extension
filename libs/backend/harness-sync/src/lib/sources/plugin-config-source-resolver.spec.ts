/**
 * `PluginConfigSourceResolver` over the layered capability policy
 * (TASK_2026_560, P9 G1).
 *
 * The pinned rules:
 *   - a reader with `getEffectivePluginConfig` is asked ONCE, and every policy
 *     field of the state comes from that one answer — no workspace-only sync
 *     call is mixed in;
 *   - the policy-unknown error (recognised by name, since agent-sdk may not be
 *     imported here) freezes the state, and any other failure keeps today's
 *     unfiltered `empty` state;
 *   - a reader without the method keeps the synchronous path.
 *
 * And the D-1/D-2 source boundary (TASK_2026_853):
 *   - MCP intents are the global records plus the reconciled workspace's own,
 *     so an install in workspace A never reaches B's state or manifest;
 *   - retired skills.sh roots and retired MCP keys ride on EVERY resolution,
 *     the read-failure and frozen states included.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { dirname, join } from 'path';
import {
  CAPABILITY_POLICY_UNKNOWN_ERROR_NAME,
  SKILLS_SH_RETIRED_FILE,
  type AgentModelLayers,
  type McpServerConfig,
} from '@ptah-extension/shared';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import type { HarnessSourceLayout } from './harness-source.port';
import { McpIntentStore } from './mcp-intent-store';
import {
  PluginConfigSourceResolver,
  createPluginConfigSourceResolver,
  type HarnessEffectivePluginConfig,
  type HarnessPluginConfigReader,
} from './plugin-config-source-resolver';

jest.mock('os', () => ({
  ...jest.requireActual<typeof import('os')>('os'),
  homedir: jest.fn(),
}));

/** Structurally what agent-sdk's `CapabilityPolicyUnknownError` looks like. */
function policyUnknownError(): Error {
  const error = new Error("Ptah couldn't read the capability policy");
  error.name = CAPABILITY_POLICY_UNKNOWN_ERROR_NAME;
  return error;
}

describe('PluginConfigSourceResolver — layered policy', () => {
  let home: string;
  let layout: HarnessSourceLayout;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'harness-source-resolver-'));
    jest.mocked(homedir).mockReturnValue(home);
    layout = {
      skillsRoot: join(home, 'skills'),
      commandsRoot: join(home, 'commands'),
      agentsRoot: join(home, 'agents'),
    };
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function resolverFor(
    reader: HarnessPluginConfigReader | null,
  ): PluginConfigSourceResolver {
    return new PluginConfigSourceResolver(
      () => reader,
      layout,
      new McpIntentStore(join(home, '.ptah', 'mcp-installed.json')),
    );
  }

  /** Sync members that fail the test if the effective path mixes them in. */
  function syncMembersThatMustNotRun(): HarnessPluginConfigReader {
    return {
      resolveCurrentPluginPaths: jest.fn(() => ['/sync/overlay']),
      getDisabledSkillIds: jest.fn(() => ['sync-skill']),
      getWorkspacePluginConfig: jest.fn(() => ({
        disabledPluginIds: ['sync-plugin'],
      })),
    };
  }

  const effective: HarnessEffectivePluginConfig = {
    config: {
      disabledSkillIds: ['global-off-skill'],
      disabledPluginIds: ['ptah-harness-release'],
      disabledAgentIds: ['reviewer'],
    },
    fingerprint: 'fp-1',
    overlayPluginPaths: ['/plugins/ptah-angular'],
  };

  it('takes every policy field from ONE effective read and calls no sync member', async () => {
    const sync = syncMembersThatMustNotRun();
    const getEffectivePluginConfig = jest.fn().mockResolvedValue(effective);
    const reader: HarnessPluginConfigReader = {
      ...sync,
      getEffectivePluginConfig,
    };

    const state = await resolverFor(reader).resolve('/ws/a');

    expect(getEffectivePluginConfig).toHaveBeenCalledTimes(1);
    expect(getEffectivePluginConfig).toHaveBeenCalledWith('/ws/a');
    expect(sync.resolveCurrentPluginPaths).not.toHaveBeenCalled();
    expect(sync.getDisabledSkillIds).not.toHaveBeenCalled();
    expect(sync.getWorkspacePluginConfig).not.toHaveBeenCalled();
    expect(state).toEqual(
      expect.objectContaining({
        overlayPluginPaths: ['/plugins/ptah-angular'],
        overlayPluginPathsKnown: true,
        disabledSkillIds: ['global-off-skill'],
        disabledPluginIds: ['ptah-harness-release'],
        disabledAgentIds: ['reviewer'],
        policyFingerprint: 'fp-1',
      }),
    );
    expect(state.policyUnknown).toBeUndefined();
  });

  it('maps the policy-unknown error to a frozen state that claims no overlay', async () => {
    const reader: HarnessPluginConfigReader = {
      ...syncMembersThatMustNotRun(),
      getEffectivePluginConfig: () => Promise.reject(policyUnknownError()),
    };

    const state = await resolverFor(reader).resolve('/ws/a');

    expect(state.policyUnknown).toBe(true);
    expect(state.overlayPluginPathsKnown).toBeUndefined();
    expect(state.policyFingerprint).toBeUndefined();
    expect(state.disabledSkillIds).toEqual([]);
  });

  it('keeps the unfiltered empty state for any other read failure, never frozen', async () => {
    const reader: HarnessPluginConfigReader = {
      ...syncMembersThatMustNotRun(),
      getEffectivePluginConfig: () => Promise.reject(new Error('disk on fire')),
    };

    const state = await resolverFor(reader).resolve('/ws/a');

    expect(state.policyUnknown).toBeUndefined();
    expect(state.overlayPluginPathsKnown).toBeUndefined();
    expect(state.overlayPluginPaths).toEqual([]);
  });

  it('catches a reader that throws synchronously instead of rejecting', async () => {
    const reader: HarnessPluginConfigReader = {
      ...syncMembersThatMustNotRun(),
      getEffectivePluginConfig: () => {
        throw policyUnknownError();
      },
    };

    await expect(resolverFor(reader).resolve()).resolves.toEqual(
      expect.objectContaining({ policyUnknown: true }),
    );
  });

  it('a reader without the method keeps the synchronous workspace path', () => {
    const reader = syncMembersThatMustNotRun();

    const state = resolverFor(reader).resolve('/ws/a');

    // Synchronous: not a Promise, so every existing caller sees today's shape.
    expect(state).not.toBeInstanceOf(Promise);
    expect(state).toEqual(
      expect.objectContaining({
        overlayPluginPaths: ['/sync/overlay'],
        overlayPluginPathsKnown: true,
        disabledSkillIds: ['sync-skill'],
        disabledPluginIds: ['sync-plugin'],
      }),
    );
  });

  it.each(['sync', 'effective', 'unavailable'] as const)(
    'reads fresh model layers for the exact reconcile root on the %s path',
    async (mode) => {
      const reader =
        mode === 'unavailable'
          ? null
          : {
              ...syncMembersThatMustNotRun(),
              ...(mode === 'effective'
                ? { getEffectivePluginConfig: async () => effective }
                : {}),
            };
      let layers: AgentModelLayers = {
        workspace: { reviewer: { codex: 'first' } },
      };
      const layersForPath = jest.fn(() => layers);
      const getter = jest.fn(() => ({ layersForPath }));
      const resolver = createPluginConfigSourceResolver(
        () => reader,
        undefined,
        undefined,
        getter,
      );
      expect(getter).not.toHaveBeenCalled();
      expect((await resolver.resolve('/ws/a')).agentModels).toBe(layers);
      layers = { machine: { '*': { codex: 'second' } } };
      expect((await resolver.resolve('/ws/b')).agentModels).toBe(layers);
      expect(layersForPath.mock.calls).toEqual([['/ws/a'], ['/ws/b']]);
      expect(getter).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['absent', 'null', 'getter throws', 'layers throws'] as const)(
    '%s model getter leaves the entire source state unchanged',
    async (mode) => {
      const reader = syncMembersThatMustNotRun();
      const getter =
        mode === 'absent'
          ? undefined
          : () => {
              if (mode === 'null') return null;
              if (mode === 'getter throws') throw new Error('not initialized');
              return {
                layersForPath: () => {
                  throw new Error('unreadable');
                },
              };
            };
      const baseline = await createPluginConfigSourceResolver(
        () => reader,
      ).resolve('/ws/a');
      const actual = await createPluginConfigSourceResolver(
        () => reader,
        undefined,
        undefined,
        getter,
      ).resolve('/ws/a');
      expect(actual.agentModels).toBeUndefined();
      expect(actual).not.toHaveProperty('agentModels');
      expect(JSON.stringify(actual)).toBe(JSON.stringify(baseline));
    },
  );

  it.each([undefined, ''])(
    'does not read model settings without a workspace root (%s)',
    async (root) => {
      const getter = jest.fn(() => ({ layersForPath: jest.fn(() => ({})) }));
      const state = await new PluginConfigSourceResolver(
        () => null,
        undefined,
        undefined,
        getter,
      ).resolve(root);
      expect(getter).not.toHaveBeenCalled();
      expect(state.agentModels).toBeUndefined();
    },
  );
});

describe('PluginConfigSourceResolver — workspace scope and retirement', () => {
  const stdio: McpServerConfig = { type: 'stdio', command: 'node' };
  let home: string;
  let storePath: string;
  let pluginsRoot: string;
  let wsA: string;
  let wsB: string;
  let store: McpIntentStore;

  /** A `.git` marker stops the canonical-root walk inside the temp home. */
  const workspace = (name: string): string => {
    const root = join(home, name);
    mkdirSync(join(root, '.git'), { recursive: true });
    return root;
  };

  const writeFile = (path: string, content: string): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf-8');
  };

  const syncReader = (): HarnessPluginConfigReader => ({
    resolveCurrentPluginPaths: () => [],
    getDisabledSkillIds: () => [],
    getWorkspacePluginConfig: () => ({}),
  });

  /** Default plugins root on purpose: `homedir()` is mocked to the temp home. */
  const resolverFor = (
    reader: () => HarnessPluginConfigReader | null,
  ): PluginConfigSourceResolver =>
    new PluginConfigSourceResolver(
      reader,
      {
        skillsRoot: join(home, 'skills'),
        commandsRoot: join(home, 'commands'),
        agentsRoot: join(home, 'agents'),
      },
      store,
    );

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'harness-source-scope-'));
    jest.mocked(homedir).mockReturnValue(home);
    storePath = join(home, '.ptah', 'mcp-installed.json');
    pluginsRoot = join(home, '.ptah', 'plugins');
    wsA = workspace('ws-a');
    wsB = workspace('ws-b');
    store = new McpIntentStore(storePath);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('an install in workspace A is absent from B’s state and built manifest', async () => {
    store.record({
      serverKey: 'only-a',
      registryName: 'io.test/only-a',
      config: stdio,
      targets: ['claude'],
      scope: 'workspace',
      workspaceRoot: wsA,
    });
    const resolver = resolverFor(syncReader);
    const builder = new HarnessManifestBuilder();

    const stateA = await resolver.resolve(wsA);
    const stateB = await resolver.resolve(wsB);

    expect(stateA.mcpIntents?.map((i) => i.serverKey)).toEqual(['only-a']);
    expect(stateB.mcpIntents).toEqual([]);
    expect((await builder.build(stateA)).mcp.map((s) => s.serverKey)).toEqual([
      'only-a',
    ]);
    expect((await builder.build(stateB)).mcp).toEqual([]);
  });

  it('merges global targets with the workspace’s own, and never widens an unscoped pass', async () => {
    store.record({
      serverKey: 'github',
      registryName: 'io.test/github',
      config: stdio,
      targets: ['claude'],
      scope: 'global',
    });
    store.record({
      serverKey: 'github',
      registryName: 'io.test/github',
      config: stdio,
      targets: ['codex'],
      scope: 'workspace',
      workspaceRoot: wsA,
    });
    const resolver = resolverFor(syncReader);

    const targetsFor = async (root?: string) =>
      (await resolver.resolve(root)).mcpIntents?.map((i) => [
        i.serverKey,
        [...i.targets].sort(),
      ]);

    expect(await targetsFor(wsA)).toEqual([['github', ['claude', 'codex']]]);
    expect(await targetsFor(wsB)).toEqual([['github', ['claude']]]);
    expect(await targetsFor(undefined)).toEqual([['github', ['claude']]]);
  });

  it('reads the canonical workspace, so a sub-directory sees its root’s records', async () => {
    store.record({
      serverKey: 'only-a',
      registryName: 'io.test/only-a',
      config: stdio,
      targets: ['claude'],
      scope: 'workspace',
      workspaceRoot: wsA,
    });
    const nested = join(wsA, 'packages', 'app');
    mkdirSync(nested, { recursive: true });

    const state = await resolverFor(syncReader).resolve(nested);

    expect(state.mcpIntents?.map((i) => i.serverKey)).toEqual(['only-a']);
  });

  describe('retired sources', () => {
    const policyUnknown = (): Error => {
      const error = new Error('unreadable policy');
      error.name = CAPABILITY_POLICY_UNKNOWN_ERROR_NAME;
      return error;
    };

    const effectiveReader =
      (answer: () => Promise<HarnessEffectivePluginConfig>) =>
      (): HarnessPluginConfigReader => ({
        ...syncReader(),
        getEffectivePluginConfig: answer,
      });

    const paths: ReadonlyArray<
      [string, () => HarnessPluginConfigReader | null]
    > = [
      ['sync success', syncReader],
      ['reader unavailable', () => null],
      [
        'reader factory throws',
        () => {
          throw new Error('not initialized');
        },
      ],
      [
        'sync read failure',
        () => ({
          ...syncReader(),
          getWorkspacePluginConfig: () => {
            throw new Error('unreadable');
          },
        }),
      ],
      [
        'effective success',
        effectiveReader(async () => ({
          config: { disabledSkillIds: [] },
          fingerprint: 'fp',
          overlayPluginPaths: [],
        })),
      ],
      [
        'effective policy unknown',
        effectiveReader(() => Promise.reject(policyUnknown())),
      ],
      [
        'effective read failure',
        effectiveReader(() => Promise.reject(new Error('disk on fire'))),
      ],
    ];

    beforeEach(() => {
      writeFile(
        join(pluginsRoot, SKILLS_SH_RETIRED_FILE),
        JSON.stringify({
          version: 1,
          roots: {
            'ptah-skillssh-zeta-skills': { retiredAt: '2026-10-01T00:00:00Z' },
            'ptah-skillssh-acme-skills': { retiredAt: '2026-10-01T00:00:00Z' },
            // Not a plain directory name: could only point outside the root.
            '..': { retiredAt: '2026-10-01T00:00:00Z' },
            // Empty would join to the plugins root itself.
            '': { retiredAt: '2026-10-01T00:00:00Z' },
            'nested/escape': { retiredAt: '2026-10-01T00:00:00Z' },
          },
        }),
      );
      writeFile(
        storePath,
        JSON.stringify({
          version: 1,
          servers: {
            legacy: {
              registryName: 'io.test/legacy',
              targets: ['claude'],
              installedAt: '2026-01-01T00:00:00Z',
              config: stdio,
            },
          },
        }),
      );
    });

    it.each(paths)('are carried on the %s path', async (_name, reader) => {
      const state = await resolverFor(reader).resolve(wsA);

      expect(state.retired).toEqual({
        skillSourceRoots: [
          join(pluginsRoot, 'ptah-skillssh-acme-skills'),
          join(pluginsRoot, 'ptah-skillssh-zeta-skills'),
        ],
        mcpServerKeys: ['legacy'],
      });
      // A retired v1 server is never desired anywhere.
      expect(state.mcpIntents).toEqual([]);
    });

    it.each([
      ['absent', null],
      ['not JSON', '{oops'],
      ['wrong version', JSON.stringify({ version: 2, roots: {} })],
    ])('a registry that is %s retires no skill root', async (_name, raw) => {
      rmSync(join(pluginsRoot, SKILLS_SH_RETIRED_FILE), { force: true });
      if (raw !== null)
        writeFile(join(pluginsRoot, SKILLS_SH_RETIRED_FILE), raw);

      const state = await resolverFor(syncReader).resolve(wsA);

      expect(state.retired).toEqual({
        skillSourceRoots: [],
        mcpServerKeys: ['legacy'],
      });
    });

    it('re-reads both registries on every pass', async () => {
      const resolver = resolverFor(syncReader);
      expect((await resolver.resolve(wsA)).retired?.mcpServerKeys).toEqual([
        'legacy',
      ]);

      rmSync(storePath);
      rmSync(join(pluginsRoot, SKILLS_SH_RETIRED_FILE));

      expect((await resolver.resolve(wsA)).retired).toEqual({
        skillSourceRoots: [],
        mcpServerKeys: [],
      });
    });
  });
});
