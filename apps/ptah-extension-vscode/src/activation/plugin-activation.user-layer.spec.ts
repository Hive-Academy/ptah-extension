/**
 * TASK_2026_701 P1 review (B3): the user-layer mirror and reconcile count a
 * file they cannot copy instead of throwing. A pass that resolves with such a
 * count must not be reported to harness-sync as `refreshed`.
 */
import type { Logger } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';

const MIRROR_TOKEN = Symbol.for('test.UserLayerMirror');
const PLUGIN_LOADER_TOKEN = Symbol.for('test.PluginLoader');
const CONTENT_DOWNLOAD_TOKEN = Symbol.for('test.ContentDownload');
const WORKSPACE_PROVIDER_TOKEN = Symbol.for('test.WorkspaceProvider');
const STATE_STORAGE_TOKEN = Symbol.for('test.StateStorage');

const registry = new Map<symbol, unknown>();

jest.mock('../di/container', () => ({
  DIContainer: {
    resolve: (token: symbol) => {
      if (!registry.has(token)) throw new Error(`unregistered ${String(token)}`);
      return registry.get(token);
    },
    getContainer: () => ({ isRegistered: () => false }),
  },
}));
jest.mock('@ptah-extension/agent-sdk', () => ({
  SDK_TOKENS: { SDK_PLUGIN_LOADER: Symbol.for('test.PluginLoader') },
}));
jest.mock('@ptah-extension/platform-core', () => ({
  PLATFORM_TOKENS: {
    CONTENT_DOWNLOAD: Symbol.for('test.ContentDownload'),
    WORKSPACE_PROVIDER: Symbol.for('test.WorkspaceProvider'),
    STATE_STORAGE: Symbol.for('test.StateStorage'),
    WORKSPACE_STATE_STORAGE: Symbol.for('test.WorkspaceStateStorage'),
  },
}));
jest.mock('@ptah-extension/harness-sync', () => ({
  HARNESS_SYNC_TOKENS: { AGENT_SYNC_GATE: Symbol.for('test.AgentSyncGate') },
  resolveHarnessWorkspaceRoot: (root: string) => root,
  resolveAgentMirrorSource: () => ({}),
}));
jest.mock('@ptah-extension/agent-generation', () => ({
  AGENT_GENERATION_TOKENS: {
    USER_LAYER_MIRROR_SERVICE: Symbol.for('test.UserLayerMirror'),
  },
  // The library's rule: per-file errors plus managed-skill retirement errors.
  userLayerPassFailures: (result: {
    errors: number;
    retiredSkills: { errors: number };
  }) => result.errors + result.retiredSkills.errors,
}));
jest.mock('@ptah-extension/skill-synthesis', () => ({
  resolveSkillsRoot: () => '/skills',
}));
jest.mock('@ptah-extension/plugin-marketplace', () => ({
  initializePluginMarketplace: jest.fn(),
}));

import { createUserLayerRefresher } from './plugin-activation';

const retired = (errors = 0) => ({ removed: [], preserved: [], errors });

function wire(over: {
  mirrorErrors?: number;
  retiredErrors?: number;
  reconcileErrors?: number;
}): { update: jest.Mock } {
  const update = jest.fn().mockResolvedValue(undefined);
  registry.clear();
  registry.set(PLUGIN_LOADER_TOKEN, {
    getWorkspacePluginConfig: () => ({
      enabledPluginIds: [],
      disabledSkillIds: [],
    }),
    resolvePluginPaths: () => [],
    discoverHarnessPluginPaths: () => [],
    discoverSkillsShPluginPaths: () => [],
    getPluginSourceDescriptors: () => ({}),
  });
  registry.set(CONTENT_DOWNLOAD_TOKEN, { getPluginsPath: () => '/plugins' });
  registry.set(WORKSPACE_PROVIDER_TOKEN, {});
  registry.set(STATE_STORAGE_TOKEN, { get: () => undefined, update });
  registry.set(MIRROR_TOKEN, {
    mirrorAll: jest.fn().mockResolvedValue({
      retiredSkills: retired(over.retiredErrors),
      skillsMirrored: 0,
      agentsMirrored: 0,
      commandsMirrored: 0,
      skipped: 0,
      conflicts: 0,
      errors: over.mirrorErrors ?? 0,
    }),
    reconcileAll: jest.fn().mockResolvedValue({
      retiredSkills: retired(),
      noop: 0,
      fastForwarded: 0,
      diverged: 0,
      missingSidecar: 0,
      errors: over.reconcileErrors ?? 0,
      divergedSlugs: [],
      reaped: 0,
      orphaned: 0,
      reapedClones: [],
      orphanedClones: [],
    }),
    getUserLayerRoots: () => ({
      skills: '/u/skills',
      agents: '/u/agents',
      commands: '/u/commands',
    }),
  });
  return { update };
}

describe('VS Code user-layer refresher — counted per-file failures', () => {
  const logger: Logger = createMockLogger() as never;

  it('reports refreshed when neither half counted a failure', async () => {
    const { update } = wire({});
    await expect(
      createUserLayerRefresher(logger).refresh('/ws'),
    ).resolves.toBe('refreshed');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Parameters<typeof wire>[0], boolean]>([
    ['the mirror counted a failed file', { mirrorErrors: 1 }, false],
    ['a managed-skill retirement failed', { retiredErrors: 1 }, false],
    ['the reconcile counted a failed file', { reconcileErrors: 2 }, true],
  ])('reports failed when %s', async (_label, over, backfillStamped) => {
    const { update } = wire(over);
    await expect(
      createUserLayerRefresher(logger).refresh('/ws'),
    ).resolves.toBe('failed');
    // A mirror with failed items does not stamp the first backfill complete.
    expect(update).toHaveBeenCalledTimes(backfillStamped ? 1 : 0);
  });
});
