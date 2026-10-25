import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

let fakeHome: string;

jest.mock('os', () => ({
  ...jest.requireActual<typeof import('os')>('os'),
  homedir: () => fakeHome,
}));

import {
  UserLayerPluginAgents,
  ownsSourcedClone,
  sourceIdentityChanged,
  withSourceIdentity,
} from './user-layer-plugin-agents';
import type {
  PluginAgentMirrorCounters,
  PluginAgentPass,
} from './user-layer-plugin-agents';
import { UserLayerFsOps } from './user-layer-fs-ops';
import type { OriginSidecar } from './origin-sidecar.types';

/** TASK_2026_701 B10 — the plugin-agent collaborator's own rules. */

function sidecar(over: Partial<OriginSidecar> = {}): OriginSidecar {
  return {
    kind: 'agent',
    slug: 'reviewer',
    pluginId: 'toolkit',
    version: null,
    sourceHash: 'sha256:x',
    clonedAt: 1,
    diverged: false,
    lastEnhancedAt: null,
    historyDir: '.history',
    ...over,
  };
}

const acme = { sourceRef: 'external:acme/repo/toolkit', label: 'Acme Toolkit' };

describe('source identity helpers', () => {
  it('withSourceIdentity sets both fields from a descriptor', () => {
    expect(withSourceIdentity(sidecar(), acme)).toMatchObject({
      sourceRef: acme.sourceRef,
      sourceLabel: acme.label,
    });
  });

  it('withSourceIdentity carries existing fields forward without a descriptor', () => {
    const stored = sidecar({ sourceRef: 'ptah:x', sourceLabel: 'X' });
    expect(withSourceIdentity(stored, undefined)).toBe(stored);
  });

  it('sourceIdentityChanged is false without a descriptor or when equal', () => {
    expect(sourceIdentityChanged(sidecar(), undefined)).toBe(false);
    expect(
      sourceIdentityChanged(
        sidecar({ sourceRef: acme.sourceRef, sourceLabel: acme.label }),
        acme,
      ),
    ).toBe(false);
    expect(
      sourceIdentityChanged(
        sidecar({ sourceRef: acme.sourceRef, sourceLabel: 'Renamed' }),
        acme,
      ),
    ).toBe(true);
  });

  it('ownsSourcedClone requires the plugin id and, when both know one, the sourceRef', () => {
    expect(ownsSourcedClone(sidecar(), 'toolkit', acme)).toBe(true);
    expect(ownsSourcedClone(sidecar(), 'other', acme)).toBe(false);
    expect(ownsSourcedClone(sidecar({ pluginId: null }), null, undefined)).toBe(
      true,
    );
    expect(
      ownsSourcedClone(sidecar({ sourceRef: acme.sourceRef }), 'toolkit', {
        sourceRef: 'external:other/repo/toolkit',
        label: 'Other',
      }),
    ).toBe(false);
    expect(
      ownsSourcedClone(sidecar({ sourceRef: acme.sourceRef }), 'toolkit', undefined),
    ).toBe(true);
  });
});

describe('UserLayerPluginAgents', () => {
  let workRoot: string;
  let agentsRoot: string;
  let logger: { info: jest.Mock; warn: jest.Mock; debug: jest.Mock; error: jest.Mock };
  let agents: UserLayerPluginAgents;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'ptah-plugin-agents-unit-'));
    fakeHome = join(workRoot, 'home');
    agentsRoot = join(fakeHome, '.ptah', 'user', 'agents', 'ws');
    logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
    agents = new UserLayerPluginAgents(
      logger as never,
      new UserLayerFsOps(logger as never),
    );
  });

  afterEach(async () => {
    try {
      await rm(workRoot, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Best effort; cleanup never decides a test.
    }
  });

  function pass(pluginPaths: string[]): PluginAgentPass {
    return {
      pluginPaths,
      agentsRoot,
      descriptors: undefined,
      withSlugLock: (_slug, fn) => fn(),
    };
  }

  function counters(): PluginAgentMirrorCounters {
    return { agentsMirrored: 0, skipped: 0, conflicts: 0, errors: 0 };
  }

  it('a plugin with no agents directory is normal, not an error', async () => {
    const plugin = join(workRoot, 'plugins', 'no-agents');
    await mkdir(plugin, { recursive: true });
    const result = counters();

    await agents.mirror(pass([plugin]), result);

    expect(result).toEqual(counters());
  });

  it('an unreadable agents path is counted, never thrown, and the pass continues', async () => {
    const broken = join(workRoot, 'plugins', 'broken');
    await mkdir(broken, { recursive: true });
    // `agents` is a file, so listing it fails with ENOTDIR.
    await writeFile(join(broken, 'agents'), 'not a directory', 'utf8');
    const healthy = join(workRoot, 'plugins', 'healthy');
    await mkdir(join(healthy, 'agents'), { recursive: true });
    await writeFile(join(healthy, 'agents', 'writer.md'), '# writer', 'utf8');
    const result = counters();

    await agents.mirror(pass([broken, healthy]), result);

    expect(result.errors).toBe(1);
    expect(result.agentsMirrored).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[UserLayerMirror] failed to read plugin agents',
      expect.objectContaining({ agentsDir: join(broken, 'agents') }),
    );
  });

  it('reconcile hands only sidecar-carrying or absent clones to the reconciler', async () => {
    const plugin = join(workRoot, 'plugins', 'p');
    await mkdir(join(plugin, 'agents'), { recursive: true });
    await writeFile(join(plugin, 'agents', 'mine.md'), '# plugin', 'utf8');
    await writeFile(join(plugin, 'agents', 'fresh.md'), '# plugin', 'utf8');
    await mkdir(agentsRoot, { recursive: true });
    await writeFile(join(agentsRoot, 'mine.md'), '# user-authored', 'utf8');
    const reconcileClone = jest.fn(async () => undefined);
    const result = { errors: 0 };

    await agents.reconcile(pass([plugin]), result, reconcileClone);

    expect(reconcileClone).toHaveBeenCalledTimes(1);
    expect(reconcileClone).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'fresh', pluginId: 'p' }),
    );
    expect(result.errors).toBe(0);
  });
});
