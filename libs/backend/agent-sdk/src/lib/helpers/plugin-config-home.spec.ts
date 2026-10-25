/**
 * PluginConfigHome (D14) — the pieces the loader spec does not reach through
 * `PluginLoaderService`: equality, the strict shape check, the view's single
 * key, a throwing `harnessRootOf`, and unreadable folder records.
 *
 * The conflict-rule matrix runs through the real loader in
 * `plugin-loader.service.spec.ts`.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IStateStorage,
  IWorkspaceScopedStateStorage,
} from '@ptah-extension/platform-core';
import type { PluginConfigState } from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { SdkError } from '../errors';
import {
  PLUGIN_CONFIG_HOME_KEY_PREFIX,
  PLUGIN_CONFIG_KEY,
  PluginConfigHome,
  canonicalRootKey,
  isWellFormedPluginConfig,
  pluginConfigsEqual,
} from './plugin-config-home';

function mapStorage(initial?: unknown): IStateStorage & {
  raw: Map<string, unknown>;
} {
  const raw = new Map<string, unknown>();
  if (initial !== undefined) raw.set(PLUGIN_CONFIG_KEY, initial);
  return {
    raw,
    get: <T>(key: string, defaultValue?: T): T | undefined =>
      raw.has(key) ? (raw.get(key) as T) : defaultValue,
    update: async (key: string, value: unknown): Promise<void> => {
      raw.set(key, value);
    },
    keys: (): readonly string[] => [...raw.keys()],
  };
}

function cfg(overrides: Partial<PluginConfigState> = {}): PluginConfigState {
  return {
    enabledPluginIds: [],
    disabledSkillIds: [],
    disabledPluginIds: [],
    disabledAgentIds: [],
    ...overrides,
  };
}

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setImmediate(resolve));

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

interface Fixture {
  home: PluginConfigHome;
  logger: MockLogger;
  repo: string;
  a: string;
  homeStorage: ReturnType<typeof mapStorage>;
}

function makeFixture(
  folderConfigs: Record<string, unknown>,
  harnessRootOf?: (folder: string) => string,
): Fixture {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-config-home-'));
  created.push(repo);
  const folders = new Map<string, IStateStorage>();
  for (const [name, config] of Object.entries(folderConfigs)) {
    const folder = path.join(repo, name);
    fs.mkdirSync(folder, { recursive: true });
    folders.set(path.resolve(folder), mapStorage(config));
  }
  const folderStorage: IWorkspaceScopedStateStorage = {
    ...mapStorage(),
    getStorageForWorkspace: (workspacePath: string) =>
      folders.get(workspacePath),
    getAllWorkspacePaths: () => [...folders.keys()],
  };
  const homeStorage = mapStorage();
  const logger = createMockLogger();
  const home = new PluginConfigHome({
    folderStorage,
    homeStorage,
    harnessRootOf: harnessRootOf ?? (() => repo),
    logger: logger as unknown as Logger,
  });
  return { home, logger, repo, a: path.join(repo, 'a'), homeStorage };
}

describe('pluginConfigsEqual', () => {
  it('ignores list order, duplicates and lastUpdated', () => {
    expect(
      pluginConfigsEqual(
        cfg({ disabledSkillIds: ['b', 'a', 'a'], lastUpdated: 't1' }),
        cfg({ disabledSkillIds: ['a', 'b'], lastUpdated: 't2' }),
      ),
    ).toBe(true);
  });

  it('reads an absent enabledSkillIds as an empty list', () => {
    expect(pluginConfigsEqual(cfg(), cfg({ enabledSkillIds: [] }))).toBe(true);
  });

  it('tells apart configs that differ in any of the five lists', () => {
    const base = cfg();
    for (const field of [
      'enabledPluginIds',
      'disabledSkillIds',
      'disabledPluginIds',
      'disabledAgentIds',
      'enabledSkillIds',
    ] as const) {
      expect(pluginConfigsEqual(base, cfg({ [field]: ['x'] }))).toBe(false);
    }
  });
});

describe('isWellFormedPluginConfig', () => {
  it('accepts a config whose optional lists are absent', () => {
    expect(
      isWellFormedPluginConfig({ enabledPluginIds: [], disabledSkillIds: [] }),
    ).toBe(true);
  });

  it.each([
    ['a string', 'garbage'],
    ['an array', []],
    ['a missing enabledPluginIds', { disabledSkillIds: [] }],
    ['a list that holds a number', { enabledPluginIds: [1] }],
    [
      'a list that is a string',
      { enabledPluginIds: [], disabledSkillIds: 'x' },
    ],
  ])('rejects %s', (_label, value) => {
    expect(isWellFormedPluginConfig(value)).toBe(false);
  });
});

describe('PluginConfigHome', () => {
  it('the view serves only the plugin config key', async () => {
    const { home, repo } = makeFixture({});
    const view = home.viewFor(repo);

    expect(() => view.get('ptah.other')).toThrow(SdkError);
    await expect(view.update('ptah.other', cfg())).rejects.toBeInstanceOf(
      SdkError,
    );
    expect(view.keys()).toEqual([]);
  });

  it('the view refuses to save a malformed config', async () => {
    const { home, repo, homeStorage } = makeFixture({});

    await expect(
      home.viewFor(repo).update(PLUGIN_CONFIG_KEY, { enabledPluginIds: 'x' }),
    ).rejects.toBeInstanceOf(SdkError);
    expect(homeStorage.raw.size).toBe(0);
  });

  it('a harnessRootOf that throws makes the folder its own harness root', () => {
    const { home, a, logger } = makeFixture({ a: cfg() }, () => {
      throw new Error('no git');
    });

    expect(home.harnessRootFor(a)).toBe(path.resolve(a));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('harnessRootOf failed'),
      expect.objectContaining({ folder: a, error: 'no git' }),
    );
  });

  it('a sole unreadable folder record is passed through to the strict reader and never imported', async () => {
    const unreadable = { enabledPluginIds: [], disabledSkillIds: 'x' };
    const { home, repo, homeStorage } = makeFixture({ a: unreadable });

    expect(home.viewFor(repo).get(PLUGIN_CONFIG_KEY)).toEqual(unreadable);
    await flush();
    expect(homeStorage.raw.size).toBe(0);
    expect(home.status(repo)).toBeNull();
  });

  it('adopting an unreadable folder record is refused', async () => {
    const { home, repo, a, homeStorage } = makeFixture({
      a: { enabledPluginIds: 7 },
      b: cfg({ disabledSkillIds: ['s'] }),
    });

    await expect(home.adopt(repo, a)).rejects.toBeInstanceOf(SdkError);
    expect(homeStorage.raw.size).toBe(0);
  });

  it('writes to one record run in call order', async () => {
    const { home, repo, a, homeStorage } = makeFixture({
      a: cfg({ disabledSkillIds: ['s'], lastUpdated: 't' }),
      b: cfg({ disabledPluginIds: ['p'], lastUpdated: 'u' }),
    });

    const adopt = home.adopt(repo, a);
    const dismiss = home.dismiss(repo, path.join(repo, 'b'));
    await Promise.all([adopt, dismiss]);

    expect(
      homeStorage.raw.get(
        `${PLUGIN_CONFIG_HOME_KEY_PREFIX}${canonicalRootKey(repo)}`,
      ),
    ).toMatchObject({
      origin: 'adopted',
      config: { disabledSkillIds: ['s'] },
      dismissed: { [canonicalRootKey(path.join(repo, 'b'))]: 'u' },
    });
    expect(home.status(repo)).toBeNull();
  });
});
