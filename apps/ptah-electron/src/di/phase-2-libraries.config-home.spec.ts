import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * TASK_2026_701 A27, D14 — the harness-sync plugin-config reader that
 * `phase-2-libraries.ts` registers (the `sourceResolver` lambda) forwards
 * `workspaceRoot` to the loader and does nothing else. Whether that forward lands on the harness-root config
 * home depends on how `initPluginLoader` initialized the loader, so this spec
 * runs the REAL loader through the REAL Electron initializer and reads the way
 * the reader does.
 *
 * Case: a sub-folder of a repository is open, the repository root itself is
 * not registered as a folder, and the reconciler asks for the harness root's
 * config. The answer is the harness-root home config, imported from that
 * sub-folder on first read.
 *
 * Every write stays inside a temp directory: the folder and global storages
 * are in-memory maps, and the plugins base path is a temp dir.
 */

jest.mock('@ptah-extension/plugin-marketplace', () => ({
  ...jest.requireActual('@ptah-extension/plugin-marketplace'),
  // The marketplace initializer resolves its own services from the container;
  // this spec is about the loader's config home only.
  initializePluginMarketplace: jest.fn(),
}));

import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IStateStorage,
  IWorkspaceScopedStateStorage,
} from '@ptah-extension/platform-core';
import { PluginLoaderService, SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { ExternalPluginStateStore } from '@ptah-extension/plugin-marketplace';
import type { PluginConfigState } from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { initPluginLoader } from '../activation/plugin-activation';

const CONFIG_KEY = 'ptah.plugins.config';

interface MapStorage extends IStateStorage {
  raw: Map<string, unknown>;
  writes: Array<{ key: string; value: unknown }>;
}

function mapStorage(initial?: Record<string, unknown>): MapStorage {
  const raw = new Map<string, unknown>(Object.entries(initial ?? {}));
  const writes: Array<{ key: string; value: unknown }> = [];
  return {
    raw,
    writes,
    get: <T>(key: string, defaultValue?: T): T | undefined =>
      raw.has(key) ? (raw.get(key) as T) : defaultValue,
    update: async (key: string, value: unknown): Promise<void> => {
      writes.push({ key, value });
      raw.set(key, value);
    },
    keys: (): readonly string[] => [...raw.keys()],
  };
}

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setImmediate(resolve));

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  jest.restoreAllMocks();
});

describe('phase-2 plugin-config reader — harness-root config home (A27, D14)', () => {
  it('a sub-folder is open and the harness root is not registered: the reader returns the harness-root home config, imported from that sub-folder', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-config-home-'));
    const pluginsBasePath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ptah-config-home-plugins-'),
    );
    created.push(repo, pluginsBasePath);
    // `.git` makes `repo` the harness root of everything below it.
    fs.mkdirSync(path.join(repo, '.git'));
    const subFolder = path.join(repo, 'packages', 'app');
    fs.mkdirSync(subFolder, { recursive: true });

    const legacy: PluginConfigState = {
      enabledPluginIds: ['ptah-core'],
      disabledSkillIds: ['noisy-skill'],
      disabledPluginIds: [],
      disabledAgentIds: [],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    // Only the sub-folder is registered; the repository root has no record.
    const folders = new Map<string, MapStorage>([
      [path.resolve(subFolder), mapStorage({ [CONFIG_KEY]: legacy })],
    ]);
    const folderStorage: IWorkspaceScopedStateStorage = {
      get: <T>(key: string, defaultValue?: T): T | undefined =>
        folders.get(path.resolve(subFolder))?.get<T>(key, defaultValue),
      update: (key: string, value: unknown): Promise<void> =>
        folders.get(path.resolve(subFolder))?.update(key, value) ??
        Promise.resolve(),
      keys: (): readonly string[] =>
        folders.get(path.resolve(subFolder))?.keys() ?? [],
      getStorageForWorkspace: (workspacePath: string) =>
        folders.get(workspacePath),
      getAllWorkspacePaths: () => [...folders.keys()],
    };
    const homeStorage = mapStorage();

    const externalStore = new ExternalPluginStateStore();
    externalStore.initialize(pluginsBasePath);
    const loader = new PluginLoaderService(
      createMockLogger() as unknown as Logger,
      externalStore,
      { getWorkspaceRoot: () => subFolder } as never,
    );
    const registry = new Map<unknown, unknown>([
      [SDK_TOKENS.SDK_PLUGIN_LOADER, loader],
      [PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, folderStorage],
      [PLATFORM_TOKENS.STATE_STORAGE, homeStorage],
    ]);
    const container = {
      resolve: (token: unknown) => registry.get(token),
      isRegistered: (token: unknown) => registry.has(token),
    } as unknown as DependencyContainer;

    initPluginLoader(container, pluginsBasePath);

    // What the phase-2 reader does: forward the root it was asked about.
    const config = loader.getWorkspacePluginConfig(repo);

    expect(config).toEqual(legacy);
    await flush();
    // One import in total, whichever read came first (`initPluginLoader`
    // itself reads the active folder once).
    expect(homeStorage.writes).toHaveLength(1);
    expect(homeStorage.writes[0].value).toMatchObject({
      origin: 'imported',
      harnessRoot: path.resolve(repo),
      sourceFolders: [path.resolve(subFolder)],
      config: { disabledSkillIds: ['noisy-skill'] },
    });
    // The sub-folder spelling reads the same home record; nothing re-imports.
    expect(loader.getWorkspacePluginConfig(subFolder)).toEqual(legacy);
    await flush();
    expect(homeStorage.writes).toHaveLength(1);
    // The folder record is read only.
    expect(folders.get(path.resolve(subFolder))?.writes).toEqual([]);
  });
});
