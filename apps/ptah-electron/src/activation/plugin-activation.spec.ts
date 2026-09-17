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
const SQLITE_CONNECTION_TOKEN = Symbol.for('PtahSqliteConnection');
const AGENT_SYNC_GATE_TOKEN = Symbol.for('HarnessSyncAgentSyncGate');
const GOVERNOR_TOKEN = Symbol.for('BackgroundWorkGovernor');

const CONFIGURED_SKILLS_ROOT = path.join('/configured', 'skills-root');

jest.mock('@ptah-extension/platform-core', () => ({
  PLATFORM_TOKENS: {
    STATE_STORAGE: Symbol.for('IStateStorage'),
    WORKSPACE_STATE_STORAGE: Symbol.for('IWorkspaceStateStorage'),
    WORKSPACE_PROVIDER: Symbol.for('IWorkspaceProvider'),
    CONTENT_DOWNLOAD: Symbol.for('ContentDownloadService'),
  },
}));

jest.mock('@ptah-extension/vscode-core', () => ({
  TOKENS: { BACKGROUND_WORK_GOVERNOR: Symbol.for('BackgroundWorkGovernor') },
}));

jest.mock('@ptah-extension/agent-sdk', () => ({
  SDK_TOKENS: { SDK_PLUGIN_LOADER: Symbol.for('SdkPluginLoader') },
}));

// `resolveAgentMirrorSource` is stubbed with its own shape rather than left
// undefined: the host now DELEGATES the agent decision to `harness-sync`, so a
// bare token mock would throw inside `buildMirrorSources` and every pass below
// would report zero calls. The real rules it applies — resolve the root the
// reconciler keys on, gate the mirror on consent — are pinned in that lib's own
// spec, which is where they belong (TASK_2026_365).
jest.mock('@ptah-extension/harness-sync', () => ({
  HARNESS_SYNC_TOKENS: {
    RECONCILER: Symbol.for('HarnessReconciler'),
    PROPAGATION: Symbol.for('HarnessSyncPropagation'),
    AGENT_SYNC_GATE: Symbol.for('HarnessSyncAgentSyncGate'),
  },
  resolveHarnessWorkspaceRoot: (root: string) => root,
  resolveAgentMirrorSource: (root: string | undefined) =>
    root === undefined || root === ''
      ? {}
      : {
          agentSourceDir: path.join(root, '.claude', 'agents'),
          workspaceRoot: root,
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
  GOVERNED_USER_LAYER_REASONS,
  USER_LAYER_COALESCE_WINDOW_MS,
  createUserLayerRefresher,
  mirrorUserLayer,
  propagateHarness,
  reconcileUserLayer,
  refreshUserLayer,
} from './plugin-activation';
import { ElectronSkillRepropagation } from './skill-repropagation';

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
  options: { sqliteOpen?: boolean; governor?: unknown } = {},
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
    [SQLITE_CONNECTION_TOKEN, { isOpen: options.sqliteOpen ?? true }],
    [
      AGENT_SYNC_GATE_TOKEN,
      { resolve: () => ({ enabled: true, derived: false }) },
    ],
  ]);
  if (options.governor !== undefined) map.set(GOVERNOR_TOKEN, options.governor);

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
  // Agent clones are keyed by workspace, so the mirror is told which one it is
  // writing for (TASK_2026_365).
  workspaceRoot: WORKSPACE_ROOT,
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

  it('does not sync the catalog itself — that is the pass owner’s job (TASK_2026_345)', async () => {
    // The sync used to live here, gated on `fastForwarded || diverged ||
    // reaped || orphaned`, while `bootHeavyServicesOnce` fired an ungated one
    // right beside it. Two call sites x two passes per switch is where the four
    // syncs of log.log:1206-1223 came from. `runUserLayerPass` now owns it.
    const h = makeHarness(emptyReconcileResult({ reaped: 1, orphaned: 2 }));

    await reconcileUserLayer(h.container as never, WORKSPACE_ROOT, true);

    expect(h.catalogSync).not.toHaveBeenCalled();
  });

  it('still records divergence in the registry store', async () => {
    // The half of the old tail that stays: divergence is per-slug state the
    // reconcile itself discovered, not a whole-catalog refresh.
    const h = makeHarness(
      emptyReconcileResult({
        diverged: 1,
        divergedSlugs: [
          { kind: 'skill', slug: 'a-skill', pendingSourceHash: 'abc' },
        ],
      }),
    );

    await reconcileUserLayer(h.container as never, WORKSPACE_ROOT, true);

    expect(h.setDiverged).toHaveBeenCalledWith('skill', 'a-skill', true);
    expect(h.setPending).toHaveBeenCalledWith('skill', 'a-skill', 'abc');
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
 * TASK_2026_345 — one user-layer pass per workspace switch.
 *
 * The baseline for one switch to `property-hub` (`tmp/logs/log.log:1206-1223`)
 * was two `mirrorAll`, two `reconcile` and FOUR catalog syncs, with the two
 * mirror/reconcile pairs running CONCURRENTLY on the same tree — the log shows
 * one reporting `fastForwarded: 15` and its twin `0` for the same clones in the
 * same second. Four triggers were asking: `activation` (the heavy boot),
 * `workspace-folders-changed` (the folder listener's propagation),
 * `content-download-complete`, and an `addFolder` immediately followed by a
 * `switch`.
 *
 * These tests pin the counts the fix promises: N triggers in the window are one
 * pass, that pass syncs the catalog exactly once, and a trigger that arrives
 * after the pass drained still gets its own.
 */
describe('electron plugin-activation — refreshUserLayer coalescing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (resolveSkillsRoot as jest.Mock).mockReturnValue(CONFIGURED_SKILLS_ROOT);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('runs ONE pass for the four triggers a workspace switch fires', async () => {
    const h = makeHarness();

    const all = Promise.all([
      refreshUserLayer(h.container as never, WORKSPACE_ROOT, 'activation'),
      refreshUserLayer(
        h.container as never,
        WORKSPACE_ROOT,
        'workspace-folders-changed',
      ),
      refreshUserLayer(
        h.container as never,
        WORKSPACE_ROOT,
        'content-download-complete',
      ),
      createUserLayerRefresher(h.container as never).refresh(WORKSPACE_ROOT),
    ]);

    jest.advanceTimersByTime(USER_LAYER_COALESCE_WINDOW_MS);
    await all;

    expect(h.mirrorAll).toHaveBeenCalledTimes(1);
    expect(h.reconcileAll).toHaveBeenCalledTimes(1);
    expect(h.catalogSync).toHaveBeenCalledTimes(1);
  });

  it('names every trigger on the one pass it ran', async () => {
    const h = makeHarness();
    const logged: string[] = [];
    (console.log as jest.Mock).mockImplementation((line: unknown) => {
      if (typeof line === 'string') logged.push(line);
    });

    const all = Promise.all([
      refreshUserLayer(h.container as never, WORKSPACE_ROOT, 'activation'),
      refreshUserLayer(
        h.container as never,
        WORKSPACE_ROOT,
        'workspace-folders-changed',
      ),
    ]);
    jest.advanceTimersByTime(USER_LAYER_COALESCE_WINDOW_MS);
    await all;

    // Losing the reason list is how the duplicate triggers stayed invisible:
    // four passes each blamed one cause and none of them mentioned the others.
    expect(
      logged.filter((line) =>
        line.startsWith('[Ptah Electron] User-layer pass'),
      ),
    ).toEqual([
      '[Ptah Electron] User-layer pass (activation + workspace-folders-changed)',
    ]);
  });

  it('runs the pass in the one correct order: mirror, then reconcile, then catalog', async () => {
    const h = makeHarness();
    const order: string[] = [];
    h.mirrorAll.mockImplementation(async () => {
      order.push('mirrorAll');
      return {
        skillsMirrored: 0,
        agentsMirrored: 0,
        commandsMirrored: 0,
        skipped: 0,
        conflicts: 0,
        errors: 0,
      };
    });
    h.reconcileAll.mockImplementation(async () => {
      order.push('reconcileAll');
      return emptyReconcileResult();
    });
    h.catalogSync.mockImplementation(async () => {
      order.push('catalogSync');
      return { upserted: 0, linked: 0 };
    });

    const pass = refreshUserLayer(
      h.container as never,
      WORKSPACE_ROOT,
      'activation',
    );
    jest.advanceTimersByTime(USER_LAYER_COALESCE_WINDOW_MS);
    await pass;

    // Reconciling an unmirrored layer copies nothing, and syncing before the
    // reconcile records a state the pass is about to change.
    expect(order).toEqual(['mirrorAll', 'reconcileAll', 'catalogSync']);
  });

  it('runs a SECOND pass for a trigger that arrives after the first drained', async () => {
    const h = makeHarness();

    const first = refreshUserLayer(
      h.container as never,
      WORKSPACE_ROOT,
      'activation',
    );
    jest.advanceTimersByTime(USER_LAYER_COALESCE_WINDOW_MS);
    await first;
    expect(h.mirrorAll).toHaveBeenCalledTimes(1);

    // The real `content-download-complete`: it follows the network, so it is
    // seconds away, not milliseconds. It must not be swallowed.
    const second = refreshUserLayer(
      h.container as never,
      WORKSPACE_ROOT,
      'content-download-complete',
    );
    jest.advanceTimersByTime(USER_LAYER_COALESCE_WINDOW_MS);
    await second;

    expect(h.mirrorAll).toHaveBeenCalledTimes(2);
    expect(h.reconcileAll).toHaveBeenCalledTimes(2);
    expect(h.catalogSync).toHaveBeenCalledTimes(2);
  });

  it('joins two spellings of one directory into a single pass', async () => {
    const h = makeHarness();

    const all = Promise.all([
      refreshUserLayer(h.container as never, WORKSPACE_ROOT, 'activation'),
      refreshUserLayer(
        h.container as never,
        `${WORKSPACE_ROOT.replace(/\\/g, '/')}/`,
        'switch',
      ),
    ]);
    jest.advanceTimersByTime(USER_LAYER_COALESCE_WINDOW_MS);
    await all;

    expect(h.mirrorAll).toHaveBeenCalledTimes(1);
  });

  it('keeps two different workspaces apart', async () => {
    const h = makeHarness();
    const other = path.join('/tmp', 'other-ws');

    const all = Promise.all([
      refreshUserLayer(h.container as never, WORKSPACE_ROOT, 'activation'),
      refreshUserLayer(h.container as never, other, 'activation'),
    ]);
    jest.advanceTimersByTime(USER_LAYER_COALESCE_WINDOW_MS);
    await all;

    expect(h.mirrorAll).toHaveBeenCalledTimes(2);
    expect(h.mirrorAll.mock.calls[0][0].agentSourceDir).toBe(
      path.join(WORKSPACE_ROOT, '.claude', 'agents'),
    );
    expect(h.mirrorAll.mock.calls[1][0].agentSourceDir).toBe(
      path.join(other, '.claude', 'agents'),
    );
  });

  it('skips the catalog sync when SQLite is closed', async () => {
    const h = makeHarness(emptyReconcileResult(), { sqliteOpen: false });

    const pass = refreshUserLayer(
      h.container as never,
      WORKSPACE_ROOT,
      'activation',
    );
    jest.advanceTimersByTime(USER_LAYER_COALESCE_WINDOW_MS);
    await pass;

    expect(h.mirrorAll).toHaveBeenCalledTimes(1);
    expect(h.catalogSync).not.toHaveBeenCalled();
  });

  it('never rejects, whatever the pass hits', async () => {
    const h = makeHarness();
    h.mirrorAll.mockRejectedValue(new Error('EPERM'));
    h.reconcileAll.mockRejectedValue(new Error('EPERM'));

    const pass = refreshUserLayer(
      h.container as never,
      WORKSPACE_ROOT,
      'activation',
    );
    jest.advanceTimersByTime(USER_LAYER_COALESCE_WINDOW_MS);

    await expect(pass).resolves.toBeUndefined();
  });
});

/**
 * TASK_2026_437 C14 (c): a background user-layer refresh waits for the
 * background-work governor; `activation` and click-driven propagation never do;
 * refreshes that arrive while one is held join it; shutdown skips it.
 */
describe('electron plugin-activation — refreshUserLayer defers background reasons', () => {
  function makeGovernor() {
    let clear = false;
    let settle: ((outcome: 'clear' | 'timeout') => void) | undefined;
    let fail: ((error: Error) => void) | undefined;
    const signals: AbortSignal[] = [];
    const whenClear = jest.fn(
      (options: { signal?: AbortSignal; lane?: string } = {}) =>
        new Promise<'clear' | 'timeout'>((resolve, reject) => {
          settle = resolve;
          fail = reject;
          if (options.signal) {
            signals.push(options.signal);
            // The real governor rejects a waiter whose signal fires.
            options.signal.addEventListener(
              'abort',
              () => reject(abortError('aborted')),
              { once: true },
            );
          }
        }),
    );
    return {
      isClear: jest.fn(() => clear),
      whenClear,
      signals,
      setClear: (value: boolean) => {
        clear = value;
      },
      release: (outcome: 'clear' | 'timeout' = 'clear') => settle?.(outcome),
      dispose: () => fail?.(abortError('disposed')),
      breakWith: (error: Error) => fail?.(error),
    };
  }

  function abortError(message: string): Error {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
  }

  /** Fire the window timer, then let the promise chain settle. */
  async function settle(): Promise<void> {
    jest.advanceTimersByTime(USER_LAYER_COALESCE_WINDOW_MS);
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }

  let logged: string[];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (resolveSkillsRoot as jest.Mock).mockReturnValue(CONFIGURED_SKILLS_ROOT);
    logged = [];
    jest.spyOn(console, 'log').mockImplementation((line: unknown) => {
      if (typeof line === 'string') logged.push(line);
    });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('governs content-download-complete and background skill re-propagation only', () => {
    expect([...GOVERNED_USER_LAYER_REASONS]).toEqual([
      'content-download-complete',
      'skill-repropagation',
    ]);
  });

  it('never defers the activation pass', async () => {
    const governor = makeGovernor();
    const h = makeHarness(emptyReconcileResult(), { governor });

    const pass = refreshUserLayer(
      h.container as never,
      WORKSPACE_ROOT,
      'activation',
    );
    await settle();
    await pass;

    expect(h.mirrorAll).toHaveBeenCalledTimes(1);
    expect(governor.whenClear).not.toHaveBeenCalled();
  });

  it('never defers a click-driven harness propagation', async () => {
    const governor = makeGovernor();
    const h = makeHarness(emptyReconcileResult(), { governor });

    const pass = createUserLayerRefresher(h.container as never).refresh(
      WORKSPACE_ROOT,
    );
    await settle();
    await pass;

    expect(h.mirrorAll).toHaveBeenCalledTimes(1);
    expect(governor.whenClear).not.toHaveBeenCalled();
  });

  it('holds a content-download-complete pass until the governor clears, then runs it once', async () => {
    const governor = makeGovernor();
    const h = makeHarness(emptyReconcileResult(), { governor });

    const pass = refreshUserLayer(
      h.container as never,
      WORKSPACE_ROOT,
      'content-download-complete',
    );
    await settle();

    expect(h.mirrorAll).not.toHaveBeenCalled();
    expect(governor.whenClear).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      lane: 'user-layer-refresh',
    });
    expect(logged).toContain(
      '[Ptah Electron] User-layer pass (content-download-complete) deferred until background work clears',
    );

    governor.release('clear');
    await settle();
    await pass;

    expect(h.mirrorAll).toHaveBeenCalledTimes(1);
    expect(h.reconcileAll).toHaveBeenCalledTimes(1);
    expect(h.catalogSync).toHaveBeenCalledTimes(1);
  });

  it('runs a held pass at the governor starvation ceiling', async () => {
    const governor = makeGovernor();
    const h = makeHarness(emptyReconcileResult(), { governor });

    const pass = refreshUserLayer(
      h.container as never,
      WORKSPACE_ROOT,
      'content-download-complete',
    );
    await settle();
    governor.release('timeout');
    await settle();
    await pass;

    expect(h.mirrorAll).toHaveBeenCalledTimes(1);
  });

  it('coalesces requests that arrive while a pass is held into that ONE pass', async () => {
    const governor = makeGovernor();
    const h = makeHarness(emptyReconcileResult(), { governor });

    const first = refreshUserLayer(
      h.container as never,
      WORKSPACE_ROOT,
      'content-download-complete',
    );
    await settle();
    expect(governor.whenClear).toHaveBeenCalledTimes(1);

    // Long after the window: they join the held batch, not a second one.
    const second = refreshUserLayer(
      h.container as never,
      WORKSPACE_ROOT,
      'content-download-complete',
    );
    const third = refreshUserLayer(
      h.container as never,
      WORKSPACE_ROOT,
      'content-download-complete',
    );
    await settle();
    expect(h.mirrorAll).not.toHaveBeenCalled();
    expect(governor.whenClear).toHaveBeenCalledTimes(1);

    governor.release('clear');
    await settle();
    await Promise.all([first, second, third]);

    expect(h.mirrorAll).toHaveBeenCalledTimes(1);
    expect(h.catalogSync).toHaveBeenCalledTimes(1);
  });

  it('a non-governed reason joining a held pass releases it at once, as ONE pass naming both', async () => {
    const governor = makeGovernor();
    const h = makeHarness(emptyReconcileResult(), { governor });

    const held = refreshUserLayer(
      h.container as never,
      WORKSPACE_ROOT,
      'content-download-complete',
    );
    await settle();
    expect(h.mirrorAll).not.toHaveBeenCalled();

    const click = createUserLayerRefresher(h.container as never).refresh(
      WORKSPACE_ROOT,
    );
    await settle();
    await Promise.all([held, click]);

    expect(governor.signals[0]?.aborted).toBe(true);
    expect(h.mirrorAll).toHaveBeenCalledTimes(1);
    expect(logged).toContain(
      '[Ptah Electron] User-layer pass (content-download-complete + harness-propagation)',
    );
  });

  it('skips a held pass when the governor is disposed at shutdown', async () => {
    const governor = makeGovernor();
    const h = makeHarness(emptyReconcileResult(), { governor });

    const pass = refreshUserLayer(
      h.container as never,
      WORKSPACE_ROOT,
      'content-download-complete',
    );
    await settle();
    governor.dispose();
    await settle();

    await expect(pass).resolves.toBeUndefined();
    expect(h.mirrorAll).not.toHaveBeenCalled();
    expect(
      logged.some((line) =>
        line.startsWith(
          '[Ptah Electron] User-layer pass (content-download-complete) skipped — host shutting down',
        ),
      ),
    ).toBe(true);
  });

  it('runs a held pass when the governor rejects with anything but an abort (fail open)', async () => {
    const governor = makeGovernor();
    const h = makeHarness(emptyReconcileResult(), { governor });
    const warned: unknown[][] = [];
    (console.warn as jest.Mock).mockImplementation((...args: unknown[]) => {
      warned.push(args);
    });

    const pass = refreshUserLayer(
      h.container as never,
      WORKSPACE_ROOT,
      'content-download-complete',
    );
    await settle();
    governor.breakWith(new Error('governor bug'));
    await settle();
    await pass;

    expect(h.mirrorAll).toHaveBeenCalledTimes(1);
    expect(warned).toContainEqual([
      '[Ptah Electron] User-layer pass (content-download-complete) — background-work wait failed; running anyway:',
      'governor bug',
    ]);
  });

  /**
   * TASK_2026_437 FU-17b, end to end on the Electron side: the port adapter →
   * a propagation that forwards `userLayerRefreshReason` to this host's
   * refresher (the forward itself is pinned in harness-sync's
   * `harness-propagation.service.spec.ts`) → the shared coalescer and its gate.
   */
  function repropagationFor(h: Harness): ElectronSkillRepropagation {
    const refresher = createUserLayerRefresher(h.container as never);
    const propagation = {
      propagate: async (
        cwd: string,
        _reason: string,
        options: { userLayerRefreshReason?: string } = {},
      ) => {
        await refresher.refresh(cwd, options.userLayerRefreshReason);
        return null;
      },
    };
    const container = {
      isRegistered: () => true,
      resolve: <T>(token: symbol): T =>
        token === PROPAGATION_TOKEN
          ? (propagation as T)
          : h.container.resolve<T>(token),
    };
    return new ElectronSkillRepropagation(container as never);
  }

  it('a background skill re-propagation (auto-enhance / auto-promote) returns at once; its refresh is held until the governor clears', async () => {
    const governor = makeGovernor();
    const h = makeHarness(emptyReconcileResult(), { governor });

    // Resolves while the governor is still busy: the caller is not held.
    await repropagationFor(h).repropagate('skill', 'caveman', WORKSPACE_ROOT);
    await settle();

    expect(h.mirrorAll).not.toHaveBeenCalled();
    expect(governor.whenClear).toHaveBeenCalledTimes(1);
    expect(logged).toContain(
      '[Ptah Electron] User-layer pass (skill-repropagation) deferred until background work clears',
    );

    governor.release('clear');
    await settle();

    expect(h.mirrorAll).toHaveBeenCalledTimes(1);
  });

  /**
   * b17b logic review, serious 1 + minor 3: `SkillCuratorService.runEnhancementPass`
   * awaits one re-propagation per candidate (`ENHANCE_MAX_SLUGS_PER_PASS` = 3),
   * in sequence. This drives that exact shape against a busy governor.
   */
  it('a 3-candidate enhancement loop finishes while the governor is busy, and its refreshes merge into ONE held pass', async () => {
    const governor = makeGovernor();
    const h = makeHarness(emptyReconcileResult(), { governor });
    const repropagation = repropagationFor(h);

    const candidates = [
      { kind: 'skill', slug: 'one' },
      { kind: 'agent', slug: 'two' },
      { kind: 'command', slug: 'three' },
    ] as const;
    let loopFinished = false;
    const loop = (async () => {
      for (const candidate of candidates) {
        await repropagation.repropagate(
          candidate.kind,
          candidate.slug,
          WORKSPACE_ROOT,
        );
      }
      loopFinished = true;
    })();
    await settle();
    await loop;

    expect(loopFinished).toBe(true);

    expect(h.mirrorAll).not.toHaveBeenCalled();
    expect(governor.whenClear).toHaveBeenCalledTimes(1);

    governor.release('clear');
    await settle();

    expect(h.mirrorAll).toHaveBeenCalledTimes(1);
  });

  it.each(['skill', 'agent', 'command'] as const)(
    "never holds a clicked '%s' re-propagation (promote, enhanceNow, applyProposal, revert)",
    async (kind) => {
      const governor = makeGovernor();
      const h = makeHarness(emptyReconcileResult(), { governor });

      const pass = repropagationFor(h).repropagate(
        kind,
        'caveman',
        WORKSPACE_ROOT,
        { userInitiated: true },
      );
      await settle();
      await pass;

      expect(h.mirrorAll).toHaveBeenCalledTimes(1);
      expect(governor.whenClear).not.toHaveBeenCalled();
      expect(logged).toContain(
        '[Ptah Electron] User-layer pass (harness-propagation)',
      );
    },
  );

  it('a clicked re-propagation joining a held background one releases it at once, as ONE pass', async () => {
    const governor = makeGovernor();
    const h = makeHarness(emptyReconcileResult(), { governor });
    const repropagation = repropagationFor(h);

    await repropagation.repropagate('skill', 'caveman', WORKSPACE_ROOT);
    await settle();
    expect(h.mirrorAll).not.toHaveBeenCalled();

    const click = repropagation.repropagate(
      'agent',
      'reviewer',
      WORKSPACE_ROOT,
      {
        userInitiated: true,
      },
    );
    await settle();
    // The click resolves only once the released pass has run.
    await click;

    expect(governor.signals[0]?.aborted).toBe(true);
    expect(h.mirrorAll).toHaveBeenCalledTimes(1);
    expect(logged).toContain(
      '[Ptah Electron] User-layer pass (skill-repropagation + harness-propagation)',
    );
  });

  it('a refresh with no label keeps harness-propagation and is never held', async () => {
    const governor = makeGovernor();
    const h = makeHarness(emptyReconcileResult(), { governor });

    const pass = createUserLayerRefresher(h.container as never).refresh(
      WORKSPACE_ROOT,
      undefined,
    );
    await settle();
    await pass;

    expect(governor.whenClear).not.toHaveBeenCalled();
    expect(logged).toContain(
      '[Ptah Electron] User-layer pass (harness-propagation)',
    );
  });

  it('runs at once when the governor is already clear', async () => {
    const governor = makeGovernor();
    governor.setClear(true);
    const h = makeHarness(emptyReconcileResult(), { governor });

    const pass = refreshUserLayer(
      h.container as never,
      WORKSPACE_ROOT,
      'content-download-complete',
    );
    await settle();
    await pass;

    expect(h.mirrorAll).toHaveBeenCalledTimes(1);
    expect(governor.whenClear).not.toHaveBeenCalled();
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
