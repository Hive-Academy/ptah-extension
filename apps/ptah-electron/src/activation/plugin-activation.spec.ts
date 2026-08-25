import 'reflect-metadata';
import * as path from 'path';

/**
 * TASK_2026_278 Batch 1b — the activation-seam SOURCES contract.
 *
 * The engine lives in `agent-generation` and is covered there. What this file
 * pins is what the Electron host TELLS it, because every defect in this batch
 * was a host that under-described its own sources:
 *
 * - harness-authored `ptah-harness-*` roots were passed to the junction layer
 *   and never to the mirror, so harness skills had no clone and no divergence
 *   tracking at all (defect 6);
 * - `pluginsBasePath` was never passed, so the reap pass could not tell a
 *   DISABLED plugin from an UNINSTALLED one;
 * - the synth root was hard-coded to `~/.ptah/skills` while promotion honours
 *   `skillSynthesis.skillsRoot`, so a configured root meant promoted skills
 *   were never cloned;
 * - `reconcile()` was called where `reconcileAll()` was meant, so nothing was
 *   ever reaped (defect 8).
 *
 * The two passes MUST agree: `reconcileAll`'s reap half reads "not among the
 * supplied roots" as "upstream deleted", so a reconcile told about fewer roots
 * than the mirror would delete live clones. That agreement is the first test.
 */

const PLUGIN_LOADER_TOKEN = Symbol.for('SdkPluginLoader');
const CONTENT_DOWNLOAD_TOKEN = Symbol.for('ContentDownloadService');
const WORKSPACE_PROVIDER_TOKEN = Symbol.for('IWorkspaceProvider');
const STATE_STORAGE_TOKEN = Symbol.for('IStateStorage');
const USER_LAYER_MIRROR_TOKEN = Symbol.for('PtahUserLayerMirrorService');
const SKILL_REGISTRY_STORE_TOKEN = Symbol.for('SkillRegistryStore');
const SKILL_REGISTRY_CATALOG_TOKEN = Symbol.for('SkillRegistryCatalogService');
const SKILL_CANDIDATE_STORE_TOKEN = Symbol.for('SkillCandidateStore');

const CONFIGURED_SKILLS_ROOT = path.join('/configured', 'skills-root');

jest.mock('@ptah-extension/platform-core', () => ({
  PLATFORM_TOKENS: {
    STATE_STORAGE: Symbol.for('IStateStorage'),
    WORKSPACE_STATE_STORAGE: Symbol.for('IWorkspaceStateStorage'),
    WORKSPACE_PROVIDER: Symbol.for('IWorkspaceProvider'),
    CONTENT_DOWNLOAD: Symbol.for('ContentDownloadService'),
  },
}));

jest.mock('@ptah-extension/agent-sdk', () => ({
  SDK_TOKENS: { SDK_PLUGIN_LOADER: Symbol.for('SdkPluginLoader') },
}));

jest.mock('@ptah-extension/harness-sync', () => ({
  HARNESS_SYNC_TOKENS: {
    RECONCILER: Symbol.for('HarnessReconciler'),
    PROPAGATION: Symbol.for('HarnessSyncPropagation'),
  },
}));

jest.mock('@ptah-extension/agent-generation', () => ({
  AGENT_GENERATION_TOKENS: {
    USER_LAYER_MIRROR_SERVICE: Symbol.for('PtahUserLayerMirrorService'),
  },
}));

jest.mock('@ptah-extension/plugin-marketplace', () => ({
  initializePluginMarketplace: jest.fn(),
}));

jest.mock('@ptah-extension/skill-synthesis', () => ({
  SKILL_SYNTHESIS_TOKENS: {
    SKILL_REGISTRY_STORE: Symbol.for('SkillRegistryStore'),
    SKILL_REGISTRY_CATALOG_SERVICE: Symbol.for('SkillRegistryCatalogService'),
    SKILL_CANDIDATE_STORE: Symbol.for('SkillCandidateStore'),
  },
  resolveSkillsRoot: jest.fn(() => CONFIGURED_SKILLS_ROOT),
}));

import { resolveSkillsRoot } from '@ptah-extension/skill-synthesis';
import {
  mirrorUserLayer,
  propagateHarness,
  reconcileUserLayer,
} from './plugin-activation';

const RECONCILER_TOKEN = Symbol.for('HarnessReconciler');
const PROPAGATION_TOKEN = Symbol.for('HarnessSyncPropagation');

const WORKSPACE_ROOT = path.join('/tmp', 'ws');
const PLUGINS_BASE = path.join('/home', '.ptah', 'plugins');
const BUNDLED_PLUGIN = path.join(PLUGINS_BASE, 'ptah-core');
const HARNESS_PLUGIN = path.join(PLUGINS_BASE, 'ptah-harness-release-notes');

interface Harness {
  container: { resolve: <T>(token: symbol) => T; isRegistered: () => boolean };
  mirrorAll: jest.Mock;
  reconcileAll: jest.Mock;
  reconcile: jest.Mock;
  catalogSync: jest.Mock;
  setDiverged: jest.Mock;
  setPending: jest.Mock;
}

function emptyReconcileResult(over: Record<string, unknown> = {}) {
  return {
    noop: 0,
    fastForwarded: 0,
    diverged: 0,
    missingSidecar: 0,
    errors: 0,
    divergedSlugs: [],
    reaped: 0,
    orphaned: 0,
    reapedClones: [],
    orphanedClones: [],
    ...over,
  };
}

function makeHarness(
  reconcileResult: Record<string, unknown> = emptyReconcileResult(),
): Harness {
  const mirrorAll = jest.fn().mockResolvedValue({
    skillsMirrored: 0,
    agentsMirrored: 0,
    commandsMirrored: 0,
    skipped: 0,
    conflicts: 0,
    errors: 0,
  });
  const reconcileAll = jest.fn().mockResolvedValue(reconcileResult);
  const reconcile = jest.fn().mockResolvedValue(reconcileResult);
  const catalogSync = jest.fn().mockResolvedValue({ upserted: 0, linked: 0 });
  const setDiverged = jest.fn();
  const setPending = jest.fn();

  const map = new Map<symbol, unknown>([
    [
      PLUGIN_LOADER_TOKEN,
      {
        getWorkspacePluginConfig: () => ({
          enabledPluginIds: ['ptah-core'],
          disabledPluginIds: [],
          disabledSkillIds: [],
        }),
        resolvePluginPaths: () => [BUNDLED_PLUGIN],
        discoverHarnessPluginPaths: () => [HARNESS_PLUGIN],
      },
    ],
    [CONTENT_DOWNLOAD_TOKEN, { getPluginsPath: () => PLUGINS_BASE }],
    [WORKSPACE_PROVIDER_TOKEN, { getConfiguration: jest.fn() }],
    [
      STATE_STORAGE_TOKEN,
      { get: jest.fn(() => 1), update: jest.fn().mockResolvedValue(undefined) },
    ],
    [
      USER_LAYER_MIRROR_TOKEN,
      {
        mirrorAll,
        reconcileAll,
        reconcile,
        getUserLayerRoots: () => ({
          skills: '/user/skills',
          agents: '/user/agents',
          commands: '/user/commands',
        }),
      },
    ],
    [SKILL_REGISTRY_STORE_TOKEN, { setDiverged, setPending }],
    [SKILL_REGISTRY_CATALOG_TOKEN, { sync: catalogSync }],
    [SKILL_CANDIDATE_STORE_TOKEN, { listDormantPromotedSlugs: () => [] }],
  ]);

  return {
    container: {
      resolve: <T>(token: symbol): T => {
        const found = map.get(token);
        if (found === undefined)
          throw new Error(`unregistered: ${String(token)}`);
        return found as T;
      },
      isRegistered: () => true,
    },
    mirrorAll,
    reconcileAll,
    reconcile,
    catalogSync,
    setDiverged,
    setPending,
  };
}

const EXPECTED_SOURCES = {
  pluginPaths: [BUNDLED_PLUGIN],
  harnessPluginRoots: [HARNESS_PLUGIN],
  pluginsBasePath: PLUGINS_BASE,
  synthesizedSkillsRoot: CONFIGURED_SKILLS_ROOT,
  agentSourceDir: path.join(WORKSPACE_ROOT, '.claude', 'agents'),
};

describe('electron plugin-activation — user-layer sources (TASK_2026_278)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolveSkillsRoot as jest.Mock).mockReturnValue(CONFIGURED_SKILLS_ROOT);
  });

  it('describes the same sources to mirrorAll and to reconcileAll', async () => {
    const h = makeHarness();

    await mirrorUserLayer(h.container as never, WORKSPACE_ROOT);
    await reconcileUserLayer(h.container as never, WORKSPACE_ROOT, false);

    expect(h.mirrorAll).toHaveBeenCalledWith(EXPECTED_SOURCES);
    expect(h.reconcileAll).toHaveBeenCalledWith(EXPECTED_SOURCES);
    expect(h.mirrorAll.mock.calls[0][0]).toEqual(
      h.reconcileAll.mock.calls[0][0],
    );
  });

  it('takes the synth root from resolveSkillsRoot, never from a hard-coded ~/.ptah/skills', async () => {
    const h = makeHarness();
    (resolveSkillsRoot as jest.Mock).mockReturnValue('/elsewhere/skills');

    await mirrorUserLayer(h.container as never, WORKSPACE_ROOT);

    expect(resolveSkillsRoot).toHaveBeenCalled();
    expect(h.mirrorAll.mock.calls[0][0].synthesizedSkillsRoot).toBe(
      '/elsewhere/skills',
    );
  });

  it('omits agentSourceDir when no workspace is open, and still names every other source', async () => {
    const h = makeHarness();

    await reconcileUserLayer(h.container as never, undefined, false);

    const sources = h.reconcileAll.mock.calls[0][0];
    expect(sources).not.toHaveProperty('agentSourceDir');
    expect(sources.harnessPluginRoots).toEqual([HARNESS_PLUGIN]);
    expect(sources.pluginsBasePath).toBe(PLUGINS_BASE);
  });

  it('sweeps with reconcileAll — reconcile() alone never reaps a deleted upstream', async () => {
    const h = makeHarness();

    await reconcileUserLayer(h.container as never, WORKSPACE_ROOT, false);

    expect(h.reconcileAll).toHaveBeenCalledTimes(1);
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it('re-syncs the catalog when the pass only reaped or orphaned clones', async () => {
    const h = makeHarness(emptyReconcileResult({ reaped: 1, orphaned: 2 }));

    await reconcileUserLayer(h.container as never, WORKSPACE_ROOT, true);

    // A reap DELETES a clone and an orphan re-flags one; both leave the
    // catalog stale exactly as a fast-forward does, and the old condition
    // named neither.
    expect(h.catalogSync).toHaveBeenCalledTimes(1);
  });

  it('leaves the catalog alone when nothing changed at all', async () => {
    const h = makeHarness(emptyReconcileResult({ noop: 3 }));

    await reconcileUserLayer(h.container as never, WORKSPACE_ROOT, true);

    expect(h.catalogSync).not.toHaveBeenCalled();
  });

  it('never throws out of activation when the mirror fails', async () => {
    const h = makeHarness();
    h.reconcileAll.mockRejectedValue(new Error('EPERM'));

    await expect(
      reconcileUserLayer(h.container as never, WORKSPACE_ROOT, true),
    ).resolves.toBeUndefined();
  });
});

/**
 * A workspace-folder change must run the FULL pass, not a bare reconcile
 * (TASK_2026_278 review finding 3).
 *
 * The reconciler's desired state IS `~/.ptah/user`, and one of that layer's
 * sources is `{ws}/.claude/agents` — a directory that belongs to the workspace.
 * Switching folders therefore changes the sources, so a bare `reconcile`
 * propagated the PREVIOUS workspace's agents into the new one and logged a clean
 * pass. `HarnessPropagationService.propagate` is the sequence that fixes it:
 * refresh the user layer, then reconcile.
 */
describe('electron plugin-activation — propagateHarness', () => {
  interface PropagationHarness {
    container: {
      resolve: <T>(token: symbol) => T;
      isRegistered: (token: symbol) => boolean;
    };
    propagate: jest.Mock;
    reconcile: jest.Mock;
  }

  function makePropagationHarness(
    options: { withPropagation: boolean } = { withPropagation: true },
  ): PropagationHarness {
    const propagate = jest.fn().mockResolvedValue({
      workspaceRoot: WORKSPACE_ROOT,
      sources: 'ok',
      targets: [],
    });
    const reconcile = jest.fn().mockResolvedValue({
      workspaceRoot: WORKSPACE_ROOT,
      sources: 'ok',
      targets: [],
    });

    const map = new Map<symbol, unknown>([[RECONCILER_TOKEN, { reconcile }]]);
    if (options.withPropagation) {
      map.set(PROPAGATION_TOKEN, { propagate });
    }

    return {
      container: {
        resolve: <T>(token: symbol): T => {
          const found = map.get(token);
          if (found === undefined) {
            throw new Error(`unregistered: ${String(token)}`);
          }
          return found as T;
        },
        isRegistered: (token: symbol) => map.has(token),
      },
      propagate,
      reconcile,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('refreshes the user layer for the NEW workspace before reconciling it', async () => {
    const h = makePropagationHarness();

    await propagateHarness(
      h.container as never,
      WORKSPACE_ROOT,
      'workspace-folders-changed',
    );

    expect(h.propagate).toHaveBeenCalledWith(
      WORKSPACE_ROOT,
      'workspace-folders-changed',
    );
    // Specifically NOT the bare reconcile: that is the call that mirrored
    // nothing and propagated the previous workspace's `.claude/agents`.
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it('falls back to a bare reconcile when propagation is not registered', async () => {
    const h = makePropagationHarness({ withPropagation: false });

    await propagateHarness(h.container as never, WORKSPACE_ROOT, 'fallback');

    expect(h.reconcile).toHaveBeenCalledWith(
      WORKSPACE_ROOT,
      expect.objectContaining({ mode: 'full', reason: 'fallback' }),
    );
  });

  it('does nothing when no workspace is open', async () => {
    const h = makePropagationHarness();

    await propagateHarness(h.container as never, undefined, 'no-workspace');

    expect(h.propagate).not.toHaveBeenCalled();
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it('never throws out of the workspace-change handler when propagation fails', async () => {
    const h = makePropagationHarness();
    h.propagate.mockRejectedValue(new Error('EBUSY'));

    await expect(
      propagateHarness(h.container as never, WORKSPACE_ROOT, 'boom'),
    ).resolves.toBeUndefined();
  });
});
