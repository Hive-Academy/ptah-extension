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
  normalizePluginConfig,
  parsePluginConfig,
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

describe('parsePluginConfig (strict persisted shape)', () => {
  it('accepts a legacy config whose optional lists are absent, and normalizes them', () => {
    expect(parsePluginConfig({ enabledPluginIds: ['a'] })).toEqual({
      enabledPluginIds: ['a'],
      disabledSkillIds: [],
      disabledPluginIds: [],
      disabledAgentIds: [],
      lastUpdated: undefined,
    });
  });

  it('keeps a stored enabledSkillIds and a string lastUpdated', () => {
    expect(
      parsePluginConfig({
        enabledPluginIds: [],
        enabledSkillIds: ['s'],
        lastUpdated: 't1',
      }),
    ).toMatchObject({ enabledSkillIds: ['s'], lastUpdated: 't1' });
  });

  it('discards a lastUpdated that is not a string instead of trusting it', () => {
    const parsed = parsePluginConfig({ enabledPluginIds: [], lastUpdated: 42 });
    expect(parsed).not.toBeNull();
    expect(parsed?.lastUpdated).toBeUndefined();
  });

  it.each([
    ['a string', 'garbage'],
    ['an array', []],
    ['null', null],
    ['a missing enabledPluginIds', { disabledSkillIds: [] }],
    ['a list that holds a number', { enabledPluginIds: [1] }],
    [
      'a list that is a string',
      { enabledPluginIds: [], disabledSkillIds: 'x' },
    ],
    [
      'an optional list that holds a number',
      { enabledPluginIds: [], enabledSkillIds: [1] },
    ],
  ])('rejects %s', (_label, value) => {
    expect(parsePluginConfig(value)).toBeNull();
  });
});

describe('normalizePluginConfig (lenient display read)', () => {
  it('reads an unusable optional list as absent and keeps the rest', () => {
    expect(
      normalizePluginConfig({
        enabledPluginIds: ['a'],
        disabledSkillIds: 'x',
        enabledSkillIds: [1],
        lastUpdated: 7,
      }),
    ).toEqual({
      enabledPluginIds: ['a'],
      disabledSkillIds: [],
      disabledPluginIds: [],
      disabledAgentIds: [],
      lastUpdated: undefined,
    });
  });

  it('reads anything without an enabledPluginIds string list as the empty default', () => {
    for (const value of [undefined, 'x', { enabledPluginIds: [1] }]) {
      expect(normalizePluginConfig(value)).toEqual({
        enabledPluginIds: [],
        disabledSkillIds: [],
        disabledPluginIds: [],
        disabledAgentIds: [],
        lastUpdated: undefined,
      });
    }
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

  it('a home record is read through its schema: a bad id list is malformed, a bad timestamp is dropped', () => {
    const { home, repo, homeStorage } = makeFixture({});
    const key = `${PLUGIN_CONFIG_HOME_KEY_PREFIX}${canonicalRootKey(repo)}`;
    const record = {
      version: 1,
      harnessRoot: repo,
      origin: 'saved',
      sourceFolders: [],
      dismissed: {},
    };

    homeStorage.raw.set(key, {
      ...record,
      config: { enabledPluginIds: ['p'], lastUpdated: 42 },
    });
    expect(home.viewFor(repo).get(PLUGIN_CONFIG_KEY)).toEqual(
      cfg({ enabledPluginIds: ['p'], lastUpdated: undefined }),
    );

    homeStorage.raw.set(key, {
      ...record,
      config: { enabledPluginIds: ['p'], disabledAgentIds: [3] },
    });
    // A malformed home answers with a value that has no enabledPluginIds, so
    // the strict reader reports an error rather than an empty policy.
    expect(
      parsePluginConfig(home.viewFor(repo).get(PLUGIN_CONFIG_KEY)),
    ).toBeNull();

    homeStorage.raw.set(key, { ...record, origin: 'guessed', config: cfg() });
    expect(
      parsePluginConfig(home.viewFor(repo).get(PLUGIN_CONFIG_KEY)),
    ).toBeNull();
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
