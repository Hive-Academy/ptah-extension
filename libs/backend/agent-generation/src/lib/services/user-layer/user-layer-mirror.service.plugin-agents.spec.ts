import 'reflect-metadata';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

let fakeHome: string;

// Every user-layer write lands under `homedir()`; never let a spec touch the
// developer's real `~/.ptah/user`.
jest.mock('os', () => ({
  ...jest.requireActual<typeof import('os')>('os'),
  homedir: () => fakeHome,
}));

import {
  AgentSyncGate,
  HarnessManifestBuilder,
  HarnessStateStore,
  ManagedManifestStore,
  resolveAgentMirrorSource,
  resolveHarnessWorkspaceRoot,
} from '@ptah-extension/harness-sync';
import {
  UserLayerMirrorService,
  userLayerPassFailures,
} from './user-layer-mirror.service';
import type {
  MirrorPluginDescriptors,
  MirrorSources,
} from './user-layer-mirror.service';
import type { OriginSidecar } from './origin-sidecar.types';

/**
 * TASK_2026_701 B10 — plugin agents become Library clones whenever the host
 * names a Library scope root, independent of agent-sync consent; consent still
 * gates propagation (`buildAgents`).
 */

function makeLogger(): {
  info: jest.Mock;
  warn: jest.Mock;
  debug: jest.Mock;
  error: jest.Mock;
} {
  return { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readSidecarFile(path: string): Promise<OriginSidecar> {
  return JSON.parse(await readFile(path, 'utf8')) as OriginSidecar;
}

async function removeTempRoot(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Best effort; cleanup never decides a test.
  }
}

describe('UserLayerMirrorService — plugin agents (B10)', () => {
  let workRoot: string;
  let pluginsBase: string;
  let workspace: string;
  let harnessRoot: string;
  let service: UserLayerMirrorService;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'ptah-plugin-agents-'));
    fakeHome = join(workRoot, 'home');
    pluginsBase = join(fakeHome, '.ptah', 'plugins');
    // Inside the fake home and marked as a repository root, so the harness
    // root walk stops here. A workspace outside the fake home walks up into
    // the developer's real home (it has a `.ptah/`), and every write below
    // would land there.
    workspace = join(fakeHome, 'projects', 'workspace');
    await mkdir(join(workspace, '.git'), { recursive: true });
    harnessRoot = resolveHarnessWorkspaceRoot(workspace);
    expect(harnessRoot).toBe(workspace);
    logger = makeLogger();
    service = new UserLayerMirrorService(logger as never);
  });

  afterEach(async () => {
    await removeTempRoot(workRoot);
  });

  async function seedPluginAgent(
    pluginDir: string,
    slug: string,
    body: string,
  ): Promise<string> {
    const agentsDir = join(pluginDir, 'agents');
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, `${slug}.md`), body, 'utf8');
    return pluginDir;
  }

  async function seedWorkspaceAgent(slug: string, body: string): Promise<void> {
    const dir = join(harnessRoot, '.claude', 'agents');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${slug}.md`), body, 'utf8');
  }

  function agentsRoot(): string {
    return service.getUserLayerRoots(harnessRoot).agents;
  }

  function sidecarPath(slug: string): string {
    return join(agentsRoot(), `${slug}.ptah-origin.json`);
  }

  function sources(over: Partial<MirrorSources> = {}): MirrorSources {
    return { pluginPaths: [], libraryScopeRoot: harnessRoot, ...over };
  }

  it('mirrors a plugin agent with pluginId, sourceRef and sourceLabel', async () => {
    const plugin = await seedPluginAgent(
      join(pluginsBase, 'ptah-core'),
      'reviewer',
      '# reviewer v1',
    );
    const descriptors: MirrorPluginDescriptors = {
      [plugin]: { sourceRef: 'ptah:ptah-core', label: 'Ptah Core' },
    };

    const result = await service.mirrorAll(
      sources({ pluginPaths: [plugin], pluginDescriptors: descriptors }),
    );

    expect(result.agentsMirrored).toBe(1);
    expect(result.errors).toBe(0);
    expect(await readFile(join(agentsRoot(), 'reviewer.md'), 'utf8')).toBe(
      '# reviewer v1',
    );
    expect(await readSidecarFile(sidecarPath('reviewer'))).toMatchObject({
      kind: 'agent',
      slug: 'reviewer',
      pluginId: 'ptah-core',
      sourceRef: 'ptah:ptah-core',
      sourceLabel: 'Ptah Core',
      diverged: false,
    });
  });

  it('does not mirror plugin agents when no library scope root is named', async () => {
    const plugin = await seedPluginAgent(
      join(pluginsBase, 'ptah-core'),
      'reviewer',
      '# v1',
    );

    const result = await service.mirrorAll({ pluginPaths: [plugin] });

    expect(result.agentsMirrored).toBe(0);
    expect(await exists(join(agentsRoot(), 'reviewer.md'))).toBe(false);
  });

  it('refuses a relative library scope root and counts it', async () => {
    const plugin = await seedPluginAgent(
      join(pluginsBase, 'ptah-core'),
      'reviewer',
      '# v1',
    );

    const result = await service.mirrorAll({
      pluginPaths: [plugin],
      libraryScopeRoot: 'relative/root',
    });

    expect(result.agentsMirrored).toBe(0);
    expect(result.errors).toBe(1);
  });

  describe.each([
    {
      name: 'a fresh workspace with no consent flag',
      prepare: (): void => undefined,
    },
    {
      name: 'a workspace with agent sync explicitly disabled',
      prepare: (root: string): void => {
        const store = new HarnessStateStore();
        expect(
          store.save(root, { ...store.load(root), agentSyncEnabled: false }),
        ).toBe(true);
      },
    },
  ])('$name', ({ prepare }) => {
    it('still clones plugin agents, and buildAgents still returns []', async () => {
      prepare(harnessRoot);
      await seedWorkspaceAgent('local-only', '# workspace agent');
      const plugin = await seedPluginAgent(
        join(pluginsBase, 'ptah-core'),
        'reviewer',
        '# reviewer v1',
      );
      const gate = new AgentSyncGate(
        new ManagedManifestStore(),
        new HarnessStateStore(),
      );
      expect(gate.resolve(harnessRoot).enabled).toBe(false);

      // Exactly what a host builds: the agent facet is gated, the Library
      // scope root is not.
      const mirrorSources: MirrorSources = {
        pluginPaths: [plugin],
        libraryScopeRoot: harnessRoot,
        ...resolveAgentMirrorSource(workspace, gate),
      };
      expect(mirrorSources.agentSourceDir).toBeUndefined();

      const result = await service.mirrorAll(mirrorSources);

      expect(result.agentsMirrored).toBe(1);
      expect(await exists(join(agentsRoot(), 'reviewer.md'))).toBe(true);
      // The ungated workspace agent was not mirrored.
      expect(await exists(join(agentsRoot(), 'local-only.md'))).toBe(false);

      const desired = await new HarnessManifestBuilder().build(
        {
          layout: {
            agentsRoot: agentsRoot(),
            skillsRoot: service.getUserLayerRoots().skills,
            commandsRoot: service.getUserLayerRoots().commands,
          },
          overlayPluginPaths: [],
          disabledSkillIds: [],
          disabledPluginIds: [],
        },
        { agentSyncEnabled: gate.resolve(harnessRoot).enabled },
      );
      expect(desired.agents).toEqual([]);
    });
  });

  it('a workspace agent owns its slug; the plugin agent is skipped and recorded', async () => {
    await seedWorkspaceAgent('reviewer', '# workspace reviewer');
    const plugin = await seedPluginAgent(
      join(pluginsBase, 'ptah-core'),
      'reviewer',
      '# plugin reviewer',
    );

    const result = await service.mirrorAll(
      sources({
        pluginPaths: [plugin],
        agentSourceDir: join(harnessRoot, '.claude', 'agents'),
        workspaceRoot: harnessRoot,
      }),
    );

    expect(result.agentsMirrored).toBe(1);
    expect(result.conflicts).toBe(1);
    expect(await readFile(join(agentsRoot(), 'reviewer.md'), 'utf8')).toBe(
      '# workspace reviewer',
    );
    const sidecar = await readSidecarFile(sidecarPath('reviewer'));
    expect(sidecar.pluginId).toBeNull();
    expect(sidecar.conflictsWith).toBe(
      join(plugin, 'agents', 'reviewer.md'),
    );
  });

  it('never claims or overwrites a user-authored agent without a sidecar', async () => {
    await mkdir(agentsRoot(), { recursive: true });
    await writeFile(join(agentsRoot(), 'reviewer.md'), '# mine', 'utf8');
    const plugin = await seedPluginAgent(
      join(pluginsBase, 'ptah-core'),
      'reviewer',
      '# plugin reviewer',
    );

    const mirrored = await service.mirrorAll(sources({ pluginPaths: [plugin] }));
    const reconciled = await service.reconcile(
      sources({ pluginPaths: [plugin] }),
    );

    expect(mirrored.conflicts).toBe(1);
    expect(reconciled.missingSidecar).toBe(0);
    expect(await readFile(join(agentsRoot(), 'reviewer.md'), 'utf8')).toBe(
      '# mine',
    );
    expect(await exists(sidecarPath('reviewer'))).toBe(false);
  });

  it('two plugins with one slug: first write wins, the second is a conflict', async () => {
    const first = await seedPluginAgent(
      join(pluginsBase, 'plugin-a'),
      'reviewer',
      '# from a',
    );
    const second = await seedPluginAgent(
      join(pluginsBase, 'plugin-b'),
      'reviewer',
      '# from b',
    );

    const result = await service.mirrorAll(
      sources({ pluginPaths: [first, second] }),
    );
    expect(result.agentsMirrored).toBe(1);
    expect(result.conflicts).toBe(1);
    expect(await readFile(join(agentsRoot(), 'reviewer.md'), 'utf8')).toBe(
      '# from a',
    );
    expect((await readSidecarFile(sidecarPath('reviewer'))).pluginId).toBe(
      'plugin-a',
    );

    // The loser's different bytes never mark the winner's clone diverged.
    const reconciled = await service.reconcile(
      sources({ pluginPaths: [first, second] }),
    );
    expect(reconciled.diverged).toBe(0);
    expect(reconciled.noop).toBe(1);
  });

  it('two external plugins with one basename keep distinct ownership by sourceRef', async () => {
    const acme = await seedPluginAgent(
      join(pluginsBase, 'external', 'acme', 'repo', 'toolkit'),
      'reviewer',
      '# acme',
    );
    const other = await seedPluginAgent(
      join(pluginsBase, 'external', 'other', 'repo', 'toolkit'),
      'reviewer',
      '# other',
    );
    const pluginDescriptors: MirrorPluginDescriptors = {
      [acme]: { sourceRef: 'external:acme/repo/toolkit', label: 'Acme Toolkit' },
      [other]: {
        sourceRef: 'external:other/repo/toolkit',
        label: 'Other Toolkit',
      },
    };

    await service.mirrorAll(sources({ pluginPaths: [acme], pluginDescriptors }));
    // A later pass that only knows the second plugin must not adopt the clone.
    const result = await service.mirrorAll(
      sources({ pluginPaths: [other], pluginDescriptors }),
    );
    expect(result.agentsMirrored).toBe(0);
    expect(result.conflicts).toBe(1);

    await writeFile(
      join(other, 'agents', 'reviewer.md'),
      '# other v2',
      'utf8',
    );
    const reconciled = await service.reconcile(
      sources({ pluginPaths: [other], pluginDescriptors }),
    );
    expect(reconciled.fastForwarded).toBe(0);
    expect(reconciled.diverged).toBe(0);

    expect(await readFile(join(agentsRoot(), 'reviewer.md'), 'utf8')).toBe(
      '# acme',
    );
    expect(await readSidecarFile(sidecarPath('reviewer'))).toMatchObject({
      pluginId: 'toolkit',
      sourceRef: 'external:acme/repo/toolkit',
      sourceLabel: 'Acme Toolkit',
      conflictsWith: join(other, 'agents', 'reviewer.md'),
    });
  });

  it('an unedited clone fast-forwards and an edited one diverges on update', async () => {
    const plugin = await seedPluginAgent(
      join(pluginsBase, 'ptah-core'),
      'reviewer',
      '# v1',
    );
    await seedPluginAgent(plugin, 'writer', '# writer v1');
    await service.mirrorAll(sources({ pluginPaths: [plugin] }));

    await writeFile(join(agentsRoot(), 'reviewer.md'), '# my edit', 'utf8');
    await writeFile(join(plugin, 'agents', 'reviewer.md'), '# v2', 'utf8');
    await writeFile(join(plugin, 'agents', 'writer.md'), '# writer v2', 'utf8');

    const result = await service.reconcile(sources({ pluginPaths: [plugin] }));

    expect(result.diverged).toBe(1);
    expect(result.fastForwarded).toBe(1);
    expect(result.divergedSlugs).toEqual([
      expect.objectContaining({ kind: 'agent', slug: 'reviewer' }),
    ]);
    expect(await readFile(join(agentsRoot(), 'reviewer.md'), 'utf8')).toBe(
      '# my edit',
    );
    expect(await readFile(join(agentsRoot(), 'writer.md'), 'utf8')).toBe(
      '# writer v2',
    );
    expect((await readSidecarFile(sidecarPath('reviewer'))).diverged).toBe(
      true,
    );

    const state = await service.readCloneEditState(
      'agent',
      'reviewer',
      harnessRoot,
    );
    expect(state).toMatchObject({
      exists: true,
      edited: true,
      pluginId: 'ptah-core',
    });
  });

  it('reconcile records a descriptor on a clone made before sourceRef existed', async () => {
    const plugin = await seedPluginAgent(
      join(pluginsBase, 'ptah-core'),
      'reviewer',
      '# v1',
    );
    await service.mirrorAll(sources({ pluginPaths: [plugin] }));
    expect(
      (await readSidecarFile(sidecarPath('reviewer'))).sourceRef,
    ).toBeUndefined();

    const result = await service.reconcile(
      sources({
        pluginPaths: [plugin],
        pluginDescriptors: {
          [plugin]: { sourceRef: 'ptah:ptah-core', label: 'Ptah Core' },
        },
      }),
    );

    expect(result.noop).toBe(1);
    expect(await readSidecarFile(sidecarPath('reviewer'))).toMatchObject({
      sourceRef: 'ptah:ptah-core',
      sourceLabel: 'Ptah Core',
    });
  });

  it('an edited clone kept as orphan after plugin removal keeps sourceLabel', async () => {
    const plugin = await seedPluginAgent(
      join(pluginsBase, 'ptah-core'),
      'reviewer',
      '# v1',
    );
    const pluginDescriptors: MirrorPluginDescriptors = {
      [plugin]: { sourceRef: 'ptah:ptah-core', label: 'Ptah Core' },
    };
    await service.mirrorAll(sources({ pluginPaths: [plugin], pluginDescriptors }));
    await writeFile(join(agentsRoot(), 'reviewer.md'), '# my edit', 'utf8');

    // Uninstalled: the plugin directory is gone, and no host describes it now.
    await removeTempRoot(plugin);
    const result = await service.reconcileAll(
      sources({ pluginPaths: [], pluginsBasePath: pluginsBase }),
    );

    expect(result.orphaned).toBe(1);
    expect(result.reaped).toBe(0);
    expect(await readSidecarFile(sidecarPath('reviewer'))).toMatchObject({
      orphaned: true,
      pluginId: 'ptah-core',
      sourceRef: 'ptah:ptah-core',
      sourceLabel: 'Ptah Core',
    });
  });

  it('an unedited plugin agent clone is reaped after removal without agent sync', async () => {
    const plugin = await seedPluginAgent(
      join(pluginsBase, 'ptah-core'),
      'reviewer',
      '# v1',
    );
    await service.mirrorAll(sources({ pluginPaths: [plugin] }));
    await removeTempRoot(plugin);

    const result = await service.reconcileAll(
      sources({ pluginPaths: [], pluginsBasePath: pluginsBase }),
    );

    expect(result.reapedClones).toEqual([{ kind: 'agent', slug: 'reviewer' }]);
    expect(await exists(join(agentsRoot(), 'reviewer.md'))).toBe(false);
  });

  it('a workspace that consents later still seeds its own legacy agents', async () => {
    const plugin = await seedPluginAgent(
      join(pluginsBase, 'ptah-core'),
      'reviewer',
      '# plugin reviewer',
    );
    await service.mirrorAll(sources({ pluginPaths: [plugin] }));

    const legacyRoot = service.getUserLayerRoots().agents;
    await mkdir(legacyRoot, { recursive: true });
    await writeFile(join(legacyRoot, 'builder.md'), '# enhanced flat', 'utf8');
    await seedWorkspaceAgent('builder', '# builder source');

    await service.mirrorAll(
      sources({
        pluginPaths: [plugin],
        agentSourceDir: join(harnessRoot, '.claude', 'agents'),
        workspaceRoot: harnessRoot,
      }),
    );

    expect(await readFile(join(agentsRoot(), 'builder.md'), 'utf8')).toBe(
      '# enhanced flat',
    );
    expect(await readFile(join(agentsRoot(), 'reviewer.md'), 'utf8')).toBe(
      '# plugin reviewer',
    );
    // The seed quarantine treats the plugin clone as held, not foreign.
    const listing = await service.listQuarantinedAgents(harnessRoot);
    expect(listing.notOwned).not.toContain('reviewer');
    expect(listing.quarantined).toEqual([]);
  });

  describe('legacy sidecars of two plugins sharing a basename (B2)', () => {
    const ACME_REF = 'external:acme/repo/toolkit';
    const OTHER_REF = 'external:other/repo/toolkit';

    async function seedTwoToolkits(): Promise<{
      acme: string;
      other: string;
      pluginDescriptors: MirrorPluginDescriptors;
    }> {
      const acme = join(pluginsBase, 'external', 'acme', 'repo', 'toolkit');
      const other = join(pluginsBase, 'external', 'other', 'repo', 'toolkit');
      await seedPluginAgent(acme, 'reviewer', '# acme');
      await seedPluginAgent(other, 'reviewer', '# other');
      for (const [dir, body] of [
        [acme, '# acme skill'],
        [other, '# other skill'],
      ] as const) {
        await mkdir(join(dir, 'skills', 'audit'), { recursive: true });
        await writeFile(join(dir, 'skills', 'audit', 'SKILL.md'), body, 'utf8');
      }
      return {
        acme,
        other,
        pluginDescriptors: {
          [acme]: { sourceRef: ACME_REF, label: 'Acme Toolkit' },
          [other]: { sourceRef: OTHER_REF, label: 'Other Toolkit' },
        },
      };
    }

    function skillSidecarPath(): string {
      return join(
        service.getUserLayerRoots(harnessRoot).skills,
        'audit',
        '.ptah-origin.json',
      );
    }

    /** Rewrite a sidecar as one written before `sourceRef` existed. */
    async function makeLegacy(path: string): Promise<void> {
      const legacy = await readSidecarFile(path);
      delete legacy.sourceRef;
      delete legacy.sourceLabel;
      await writeFile(path, JSON.stringify(legacy, null, 2), 'utf8');
    }

    it.each([
      ['acme first', (a: string, o: string) => [a, o]],
      ['other first', (a: string, o: string) => [o, a]],
    ])(
      'neither plugin acquires the clone, whichever the pass meets first (%s)',
      async (_label, order) => {
        const { acme, other, pluginDescriptors } = await seedTwoToolkits();
        // Cloned from acme alone, then aged into a legacy sidecar.
        await service.mirrorAll(
          sources({ pluginPaths: [acme], pluginDescriptors }),
        );
        await makeLegacy(sidecarPath('reviewer'));
        await makeLegacy(skillSidecarPath());
        // Both upstreams move on, so an owner would fast-forward.
        await writeFile(join(acme, 'agents', 'reviewer.md'), '# acme v2', 'utf8');
        await writeFile(join(other, 'agents', 'reviewer.md'), '# other v2', 'utf8');
        await writeFile(
          join(other, 'skills', 'audit', 'SKILL.md'),
          '# other skill v2',
          'utf8',
        );

        const both = sources({ pluginPaths: order(acme, other), pluginDescriptors });
        const mirrored = await service.mirrorAll(both);
        const reconciled = await service.reconcile(both);

        expect(mirrored.agentsMirrored).toBe(0);
        expect(reconciled.fastForwarded).toBe(0);
        expect(reconciled.diverged).toBe(0);
        expect(await readFile(join(agentsRoot(), 'reviewer.md'), 'utf8')).toBe(
          '# acme',
        );
        expect(
          await readFile(
            join(service.getUserLayerRoots(harnessRoot).skills, 'audit', 'SKILL.md'),
            'utf8',
          ),
        ).toBe('# acme skill');
        const agentSidecar = await readSidecarFile(sidecarPath('reviewer'));
        const skillSidecar = await readSidecarFile(skillSidecarPath());
        expect(agentSidecar.sourceRef).toBeUndefined();
        expect(skillSidecar.sourceRef).toBeUndefined();
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringMatching(/more than one plugin with this directory name/),
          expect.objectContaining({ slug: 'reviewer' }),
        );

        // With one candidate left the basename decides again, and the ref is
        // recorded.
        const alone = await service.reconcile(
          sources({ pluginPaths: [acme], pluginDescriptors }),
        );
        expect(alone.fastForwarded).toBe(1);
        expect(await readSidecarFile(sidecarPath('reviewer'))).toMatchObject({
          sourceRef: ACME_REF,
        });
      },
    );
  });
});

describe('userLayerPassFailures (B3)', () => {
  it('adds the per-file errors and the managed-skill retirement errors', () => {
    expect(
      userLayerPassFailures({
        errors: 2,
        retiredSkills: { removed: [], preserved: [], errors: 1 },
      }),
    ).toBe(3);
    expect(
      userLayerPassFailures({
        errors: 0,
        retiredSkills: { removed: [], preserved: [], errors: 0 },
      }),
    ).toBe(0);
  });
});
