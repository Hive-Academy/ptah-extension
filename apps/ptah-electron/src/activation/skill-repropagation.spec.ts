import 'reflect-metadata';

const CLI_PLUGIN_SYNC_SERVICE_TOKEN = Symbol.for('CliPluginSyncService');
const LOGGER_TOKEN = Symbol.for('Logger');
const STATE_STORAGE_TOKEN = Symbol.for('IStateStorage');
const CONTENT_DOWNLOAD_TOKEN = Symbol.for('ContentDownloadService');
const USER_LAYER_MIRROR_TOKEN = Symbol.for('PtahUserLayerMirrorService');

jest.mock('@ptah-extension/vscode-core', () => ({
  TOKENS: {
    CLI_PLUGIN_SYNC_SERVICE: Symbol.for('CliPluginSyncService'),
    LOGGER: Symbol.for('Logger'),
  },
}));

jest.mock('@ptah-extension/platform-core', () => ({
  PLATFORM_TOKENS: {
    STATE_STORAGE: Symbol.for('IStateStorage'),
    CONTENT_DOWNLOAD: Symbol.for('ContentDownloadService'),
  },
}));

jest.mock('@ptah-extension/agent-generation', () => ({
  AGENT_GENERATION_TOKENS: {
    USER_LAYER_MIRROR_SERVICE: Symbol.for('PtahUserLayerMirrorService'),
  },
}));

jest.mock('@ptah-extension/skill-synthesis', () => ({}));

const activateSkillJunctions = jest.fn();
const syncCliAgentsOnActivation = jest.fn();

jest.mock('./plugin-activation', () => ({
  activateSkillJunctions: (...args: unknown[]) =>
    activateSkillJunctions(...args),
}));

jest.mock('./cli-agent-sync', () => ({
  syncCliAgentsOnActivation: (...args: unknown[]) =>
    syncCliAgentsOnActivation(...args),
}));

import { ElectronSkillRepropagation } from './skill-repropagation';

const WORKSPACE_ROOT = '/tmp/ws';
const USER_ROOTS = {
  skills: '/home/.ptah/user/skills',
  commands: '/home/.ptah/user/commands',
  agents: '/home/.ptah/user/agents',
};

interface Stubs {
  syncForce: jest.Mock;
  initialize: jest.Mock;
  getUserLayerRoots: jest.Mock;
  getPluginsPath: jest.Mock;
  warn: jest.Mock;
}

function makeContainer(stubs: Stubs): {
  resolve: <T>(token: symbol) => T;
} {
  const map = new Map<symbol, unknown>([
    [
      CLI_PLUGIN_SYNC_SERVICE_TOKEN,
      { initialize: stubs.initialize, syncForce: stubs.syncForce },
    ],
    [LOGGER_TOKEN, { debug: jest.fn(), warn: stubs.warn }],
    [STATE_STORAGE_TOKEN, { get: jest.fn(), update: jest.fn() }],
    [CONTENT_DOWNLOAD_TOKEN, { getPluginsPath: stubs.getPluginsPath }],
    [USER_LAYER_MIRROR_TOKEN, { getUserLayerRoots: stubs.getUserLayerRoots }],
  ]);
  return {
    resolve: <T>(token: symbol): T => {
      if (!map.has(token)) {
        throw new Error(`unregistered token: ${String(token)}`);
      }
      return map.get(token) as T;
    },
  };
}

function makeStubs(overrides: Partial<Stubs> = {}): Stubs {
  return {
    syncForce: jest.fn().mockResolvedValue([]),
    initialize: jest.fn(),
    getUserLayerRoots: jest.fn().mockReturnValue(USER_ROOTS),
    getPluginsPath: jest.fn().mockReturnValue('/home/.ptah/plugins'),
    warn: jest.fn(),
    ...overrides,
  };
}

describe('ElectronSkillRepropagation', () => {
  beforeEach(() => {
    activateSkillJunctions.mockReset();
    syncCliAgentsOnActivation.mockReset();
  });

  it("kind 'skill' force-syncs rivals with the user-layer roots", async () => {
    const stubs = makeStubs();
    const container = makeContainer(stubs);
    const repropagation = new ElectronSkillRepropagation(container as never);

    await repropagation.repropagate('skill', 'caveman', WORKSPACE_ROOT);

    expect(stubs.initialize).toHaveBeenCalledTimes(1);
    expect(stubs.syncForce).toHaveBeenCalledWith(
      { skillsRoot: USER_ROOTS.skills, commandsRoot: USER_ROOTS.commands },
      WORKSPACE_ROOT,
    );
    expect(activateSkillJunctions).not.toHaveBeenCalled();
    expect(syncCliAgentsOnActivation).not.toHaveBeenCalled();
  });

  it("kind 'command' force-syncs rivals AND re-copies Claude commands", async () => {
    const stubs = makeStubs();
    const container = makeContainer(stubs);
    const repropagation = new ElectronSkillRepropagation(container as never);

    await repropagation.repropagate('command', 'deep-research', WORKSPACE_ROOT);

    expect(stubs.syncForce).toHaveBeenCalledWith(
      { skillsRoot: USER_ROOTS.skills, commandsRoot: USER_ROOTS.commands },
      WORKSPACE_ROOT,
    );
    expect(activateSkillJunctions).toHaveBeenCalledWith(
      container,
      '/home/.ptah/plugins',
      { skills: USER_ROOTS.skills, commands: USER_ROOTS.commands },
    );
  });

  it("kind 'agent' invokes the agent distribution path", async () => {
    const stubs = makeStubs();
    const container = makeContainer(stubs);
    const repropagation = new ElectronSkillRepropagation(container as never);

    await repropagation.repropagate('agent', 'planner', WORKSPACE_ROOT);

    expect(syncCliAgentsOnActivation).toHaveBeenCalledWith(
      container,
      WORKSPACE_ROOT,
    );
    expect(stubs.syncForce).not.toHaveBeenCalled();
  });

  it('swallows a thrown sync (non-fatal) and logs a warning', async () => {
    const stubs = makeStubs({
      syncForce: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const container = makeContainer(stubs);
    const repropagation = new ElectronSkillRepropagation(container as never);

    await expect(
      repropagation.repropagate('skill', 'caveman', WORKSPACE_ROOT),
    ).resolves.toBeUndefined();
    expect(stubs.warn).toHaveBeenCalledTimes(1);
  });
});
