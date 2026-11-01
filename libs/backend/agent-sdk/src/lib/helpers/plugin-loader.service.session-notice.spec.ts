import 'reflect-metadata';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { IStateStorage } from '@ptah-extension/platform-core';
import type { PluginConfigState } from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { ExternalPluginStateStore } from '@ptah-extension/plugin-marketplace';

import {
  PLUGIN_CONFIG_HOME_KEY_PREFIX,
  PLUGIN_CONFIG_KEY,
  canonicalRootKey,
} from './plugin-config-home';
import { PluginLoaderService } from './plugin-loader.service';

const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function config(overrides: Partial<PluginConfigState> = {}): PluginConfigState {
  return { enabledPluginIds: [], disabledSkillIds: [], ...overrides };
}

function setup(withHome = true) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-session-notice-'));
  created.push(base);
  const project = path.join(base, 'project');
  const child = path.join(base, 'child');
  const grandchild = path.join(base, 'grandchild');
  for (const root of [project, child, grandchild]) fs.mkdirSync(root);

  const records = new Map<string, unknown>();
  const homeWrites = jest.fn(async (key: string, value: unknown) => {
    records.set(key, value);
  });
  const homeStorage: IStateStorage = {
    get: <T>(key: string, defaultValue?: T): T | undefined =>
      records.has(key) ? (records.get(key) as T) : defaultValue,
    update: homeWrites,
    keys: () => [...records.keys()],
  };
  const folderStorage: IStateStorage = {
    get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
    update: async () => undefined,
    keys: () => [],
  };
  const legacyConfigs = new Map<string, PluginConfigState>();
  const scopedStorage = {
    ...folderStorage,
    getStorageForWorkspace: (root: string): IStateStorage => ({
      ...folderStorage,
      get: <T>(key: string, defaultValue?: T): T | undefined =>
        key === PLUGIN_CONFIG_KEY && legacyConfigs.has(root)
          ? (legacyConfigs.get(root) as T)
          : defaultValue,
    }),
    getAllWorkspacePaths: () => [...legacyConfigs.keys()],
  };
  const logger = createMockLogger();
  const externalStore = new ExternalPluginStateStore();
  externalStore.initialize(base);
  const service = new PluginLoaderService(
    logger as unknown as Logger,
    externalStore,
    { getWorkspaceRoot: () => project } as never,
  );
  service.initialize(
    base,
    scopedStorage,
    withHome
      ? { harnessRootOf: (folder) => path.resolve(folder), homeStorage }
      : undefined,
  );

  const recordKey = (root: string): string =>
    `${PLUGIN_CONFIG_HOME_KEY_PREFIX}${canonicalRootKey(root)}`;
  const setConfig = (root: string, value: PluginConfigState): void => {
    records.set(recordKey(root), {
      version: 1,
      harnessRoot: root,
      config: value,
      origin: 'saved',
      sourceFolders: [],
      dismissed: {},
    });
  };
  const setLegacyConfig = (root: string, value: PluginConfigState): void => {
    legacyConfigs.set(root, value);
  };

  return {
    service,
    project,
    child,
    grandchild,
    base,
    records,
    recordKey,
    setConfig,
    setLegacyConfig,
    homeWrites,
    logger,
  };
}

describe('PluginLoaderService.getSessionPluginNotice', () => {
  it('returns null without a configuration home', () => {
    const h = setup(false);
    expect(h.service.getSessionPluginNotice(h.child, [h.project], h.project)).toBeNull();
  });

  it('returns null when the session uses the project root', () => {
    const h = setup();
    expect(h.service.getSessionPluginNotice(h.project, [], h.project)).toBeNull();
  });

  it('reports inheritance with no nearer choices', () => {
    const h = setup();
    expect(h.service.getSessionPluginNotice(h.child, [h.project], h.project)).toEqual({
      sessionRoot: h.child,
      inheritsProjectSettings: true,
      overrides: [],
      incomplete: false,
    });
    expect(h.homeWrites).not.toHaveBeenCalled();
  });

  it('reads an importable legacy layer without writing its home record', async () => {
    const h = setup();
    h.setLegacyConfig(h.child, config({ enabledPluginIds: ['legacy-plugin'] }));

    expect(h.service.getSessionPluginNotice(h.child, [h.project], h.project)).toEqual({
      sessionRoot: h.child,
      inheritsProjectSettings: true,
      overrides: [
        { kind: 'plugin', id: 'legacy-plugin', value: 'on', root: h.child },
      ],
      incomplete: false,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.homeWrites).not.toHaveBeenCalled();
    expect(h.records.has(h.recordKey(h.child))).toBe(false);
  });

  it('lists recorded plugin and skill choices even when the project agrees', () => {
    const h = setup();
    h.setConfig(h.child, config({ enabledPluginIds: ['pluginA'], disabledSkillIds: ['skillX'] }));
    h.setConfig(h.project, config({ enabledPluginIds: ['pluginA'], disabledSkillIds: ['skillX'] }));
    expect(h.service.getSessionPluginNotice(h.child, [h.project], h.project)).toEqual({
      sessionRoot: h.child,
      inheritsProjectSettings: true,
      overrides: [
        { kind: 'plugin', id: 'pluginA', value: 'on', root: h.child },
        { kind: 'skill', id: 'skillX', value: 'off', root: h.child },
      ],
      incomplete: false,
    });
  });

  it('uses the nearest choice and includes ids only recorded at the child', () => {
    const h = setup();
    h.setConfig(h.grandchild, config({ disabledSkillIds: ['skillY'] }));
    h.setConfig(h.child, config({ enabledSkillIds: ['skillY', 'skillZ'] }));
    expect(h.service.getSessionPluginNotice(
      h.grandchild,
      [h.child, h.child, h.project],
      h.project,
    )?.overrides).toEqual([
      { kind: 'skill', id: 'skillY', value: 'off', root: h.grandchild },
      { kind: 'skill', id: 'skillZ', value: 'on', root: h.child },
    ]);
  });

  it('withholds overrides when the project is not in the lineage', () => {
    const h = setup();
    h.setConfig(h.child, config({ enabledPluginIds: ['pluginA'] }));
    expect(h.service.getSessionPluginNotice(h.child, [], h.project)).toEqual({
      sessionRoot: h.child,
      inheritsProjectSettings: false,
      overrides: [],
      incomplete: false,
    });
  });

  it('marks an unreadable nearer layer incomplete and still lists readable layers', () => {
    const h = setup();
    h.records.set(h.recordKey(h.grandchild), { malformed: true });
    h.setConfig(h.child, config({ enabledPluginIds: ['pluginA'] }));
    expect(h.service.getSessionPluginNotice(h.grandchild, [h.child, h.project], h.project)).toEqual({
      sessionRoot: h.grandchild,
      inheritsProjectSettings: true,
      overrides: [{ kind: 'plugin', id: 'pluginA', value: 'on', root: h.child }],
      incomplete: true,
    });
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('unreadable'),
      expect.objectContaining({ root: h.grandchild }),
    );
    expect(h.homeWrites).not.toHaveBeenCalled();
  });

  it('excludes agent ids', () => {
    const h = setup();
    h.setConfig(h.child, config({ disabledAgentIds: ['backend-developer'] }));
    expect(h.service.getSessionPluginNotice(h.child, [h.project], h.project)?.overrides).toEqual([]);
  });

  it('recognizes a symlinked alias of the project root in the lineage', () => {
    const h = setup();
    const alias = path.join(h.base, 'project-alias');
    fs.symlinkSync(h.project, alias, 'dir');
    h.setConfig(h.child, config({ enabledPluginIds: ['pluginA'] }));
    expect(h.service.getSessionPluginNotice(h.child, [alias], h.project)).toEqual({
      sessionRoot: h.child,
      inheritsProjectSettings: true,
      overrides: [{ kind: 'plugin', id: 'pluginA', value: 'on', root: h.child }],
      incomplete: false,
    });
  });
});
