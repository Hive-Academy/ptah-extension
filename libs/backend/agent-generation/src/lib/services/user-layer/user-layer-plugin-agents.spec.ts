import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

let fakeHome: string;

jest.mock('os', () => ({
  ...jest.requireActual<typeof import('os')>('os'),
  homedir: () => fakeHome,
}));

import {
  UserLayerPluginAgents,
  sharedPluginBasenames,
  sourceIdentityChanged,
  sourceOwnership,
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

  it('sourceOwnership requires the plugin id and, when both know one, the sourceRef', () => {
    const other = { sourceRef: 'external:other/repo/toolkit', label: 'Other' };
    expect(sourceOwnership(sidecar(), 'toolkit', acme, false)).toBe('owned');
    expect(sourceOwnership(sidecar(), 'other', acme, false)).toBe('foreign');
    expect(sourceOwnership(sidecar({ pluginId: null }), null, undefined, false)).toBe(
      'owned',
    );
    expect(
      sourceOwnership(sidecar({ sourceRef: acme.sourceRef }), 'toolkit', other, true),
    ).toBe('foreign');
    expect(
      sourceOwnership(sidecar({ sourceRef: acme.sourceRef }), 'toolkit', acme, true),
    ).toBe('owned');
    expect(
      sourceOwnership(sidecar({ sourceRef: acme.sourceRef }), 'toolkit', undefined, false),
    ).toBe('owned');
  });

  it('a legacy sidecar is never owned on a basename another plugin root shares (B2)', () => {
    const other = { sourceRef: 'external:other/repo/toolkit', label: 'Other' };
    // No sourceRef on the sidecar: the basename is the only evidence.
    expect(sourceOwnership(sidecar(), 'toolkit', acme, true)).toBe('ambiguous');
    expect(sourceOwnership(sidecar(), 'toolkit', other, true)).toBe('ambiguous');
    // No descriptor on the source: same.
    expect(
      sourceOwnership(sidecar({ sourceRef: acme.sourceRef }), 'toolkit', undefined, true),
    ).toBe('ambiguous');
    // Another plugin id is foreign whatever the basenames.
    expect(sourceOwnership(sidecar(), 'other', acme, true)).toBe('foreign');
  });

  it('sharedPluginBasenames names only basenames that appear more than once', () => {
    expect(
      [...sharedPluginBasenames([
        join('a', 'external', 'acme', 'repo', 'toolkit'),
        join('a', 'external', 'other', 'repo', 'toolkit'),
        join('a', 'ptah-core'),
      ])],
    ).toEqual(['toolkit']);
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

  async function exists(p: string): Promise<boolean> {
    try {
      await stat(p);
      return true;
    } catch {
      return false;
    }
  }

  async function seedSource(body: string): Promise<string> {
    const plugin = join(workRoot, 'plugins', 'toolkit');
    await mkdir(join(plugin, 'agents'), { recursive: true });
    await writeFile(join(plugin, 'agents', 'reviewer.md'), body, 'utf8');
    return plugin;
  }

  /**
   * Publish with the sidecar write failing after the body landed: a directory
   * occupies the sidecar path, so its atomic rename cannot replace it.
   */
  async function interruptedPublication(plugin: string): Promise<void> {
    const blocker = join(agentsRoot, 'reviewer.ptah-origin.json');
    await mkdir(blocker, { recursive: true });
    const first = counters();
    await agents.mirror(pass([plugin]), first);
    expect(first.errors).toBe(1);
    expect(await readFile(join(agentsRoot, 'reviewer.md'), 'utf8')).toBe(
      '# reviewer',
    );
    expect(await exists(join(agentsRoot, 'reviewer.ptah-origin-pending.json'))).toBe(
      true,
    );
    await rm(blocker, { recursive: true, force: true });
  }

  it('a publication interrupted between body and sidecar is finished by a later pass (B1)', async () => {
    const plugin = await seedSource('# reviewer');
    await interruptedPublication(plugin);

    // A new instance stands in for a restart: nothing is carried in memory.
    const restarted = new UserLayerPluginAgents(
      logger as never,
      new UserLayerFsOps(logger as never),
    );
    const retry = counters();
    await restarted.mirror(pass([plugin]), retry);

    expect(retry).toEqual({ ...counters(), agentsMirrored: 1 });
    const written = JSON.parse(
      await readFile(join(agentsRoot, 'reviewer.ptah-origin.json'), 'utf8'),
    ) as OriginSidecar;
    expect(written).toMatchObject({
      kind: 'agent',
      slug: 'reviewer',
      pluginId: 'toolkit',
      diverged: false,
    });
    expect(written.currentContentHash).toBe(written.sourceHash);
    expect(await exists(join(agentsRoot, 'reviewer.ptah-origin-pending.json'))).toBe(
      false,
    );

    // The clone is now this plugin's: the reconcile reaches it.
    const reconcileClone = jest.fn(async () => undefined);
    await restarted.reconcile(pass([plugin]), { errors: 0 }, reconcileClone);
    expect(reconcileClone).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'reviewer', basenameShared: false }),
    );
  });

  it('an interrupted publication the user edited since stays user-authored (B1)', async () => {
    const plugin = await seedSource('# reviewer');
    await interruptedPublication(plugin);
    await writeFile(join(agentsRoot, 'reviewer.md'), '# my own words', 'utf8');

    const retry = counters();
    await agents.mirror(pass([plugin]), retry);

    expect(retry.agentsMirrored).toBe(0);
    expect(retry.conflicts).toBe(1);
    expect(await readFile(join(agentsRoot, 'reviewer.md'), 'utf8')).toBe(
      '# my own words',
    );
    expect(await exists(join(agentsRoot, 'reviewer.ptah-origin.json'))).toBe(false);
    // The intent is dropped, so a later revert to the plugin's text is still
    // never adopted.
    expect(await exists(join(agentsRoot, 'reviewer.ptah-origin-pending.json'))).toBe(
      false,
    );
  });

  it('another source never resumes a publication that was not its own (B1)', async () => {
    const plugin = await seedSource('# reviewer');
    await interruptedPublication(plugin);
    const impostor = join(workRoot, 'elsewhere', 'toolkit');
    await mkdir(join(impostor, 'agents'), { recursive: true });
    await writeFile(join(impostor, 'agents', 'reviewer.md'), '# reviewer', 'utf8');

    const retry = counters();
    await agents.mirror(pass([impostor]), retry);

    expect(retry.agentsMirrored).toBe(0);
    expect(await exists(join(agentsRoot, 'reviewer.ptah-origin.json'))).toBe(false);
    expect(await exists(join(agentsRoot, 'reviewer.ptah-origin-pending.json'))).toBe(
      true,
    );
  });
});
