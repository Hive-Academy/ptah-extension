/**
 * PluginLoaderService — the capability policy layers (TASK_2026_560, C3).
 *
 * - The global skill/plugin layer sits beneath the workspace
 *   `PluginConfigState`; with no global item a pre-task config reads back
 *   unchanged (AC-3.2).
 * - `getEffectivePluginConfig` answers from ONE snapshot and throws the
 *   structural policy-unknown error when a layer cannot be read; the sync
 *   readers answer restrictively in that case (N3).
 * - `saveWorkspacePluginConfig(config, root)` writes into the storage it chose
 *   before reading, whatever the active folder does meanwhile (#8).
 *
 * Real temp directories, as in `plugin-loader.service.spec.ts`: the overlay
 * is a directory scan.
 */

import 'reflect-metadata';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { Logger } from '@ptah-extension/vscode-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import {
  canonicalFilename,
  harnessPolicyFingerprint,
  isCapabilityPolicyUnknownError,
  type CapabilityExplicitItem,
  type CapabilityGlobalLayerSnapshot,
  type ICapabilityGlobalLayer,
  type PluginConfigState,
} from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { ExternalPluginStateStore } from '@ptah-extension/plugin-marketplace';

import { SdkError } from '../errors';
import {
  CapabilityPolicyUnknownError,
  PluginLoaderService,
} from './plugin-loader.service';

const CONFIG_KEY = 'ptah.plugins.config';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/** A plain one-scope storage over a Map; `stored` is the raw persisted value. */
function createStateStorage(stored?: unknown): IStateStorage & {
  raw: Map<string, unknown>;
} {
  const raw = new Map<string, unknown>();
  if (stored !== undefined) raw.set(CONFIG_KEY, stored);
  return {
    raw,
    get: <T>(key: string, defaultValue?: T): T | undefined =>
      (raw.get(key) as T | undefined) ?? defaultValue,
    update: async (key: string, value: unknown): Promise<void> => {
      raw.set(key, value);
    },
    keys: (): readonly string[] => [...raw.keys()],
  };
}

function item(
  kind: CapabilityExplicitItem['kind'],
  id: string,
  value: CapabilityExplicitItem['value'],
): CapabilityExplicitItem {
  return { v: 1, kind, id, value, source: 'user', at: '2026-09-25T00:00:00Z' };
}

/** A global layer returning a fixed snapshot, counting its reads. */
function createGlobalLayer(
  snapshot: CapabilityGlobalLayerSnapshot,
): ICapabilityGlobalLayer & { reads: number } {
  const layer = {
    reads: 0,
    readGlobalLayer: async (): Promise<CapabilityGlobalLayerSnapshot> => {
      layer.reads += 1;
      return snapshot;
    },
  };
  return layer;
}

/** An ok snapshot whose fingerprint entries mirror its items. */
function okSnapshot(
  items: CapabilityExplicitItem[],
): CapabilityGlobalLayerSnapshot {
  return {
    status: 'ok',
    items,
    fingerprintEntries: items.map((entry) => ({
      name: canonicalFilename(entry.kind, entry.id),
      content: JSON.stringify(entry),
    })),
  };
}

interface Setup {
  service: PluginLoaderService;
  pluginsBasePath: string;
}

function makeLoader(options: {
  storage: IStateStorage;
  globalLayer?: ICapabilityGlobalLayer;
  /** Direct children of the plugins base path. */
  pluginDirs?: string[];
  /** `{ pluginDir: [skillDir] }` under the plugins base path. */
  skills?: Record<string, string[]>;
  workspaceRoot?: string;
}): Setup {
  const pluginsBasePath = tempDir('ptah-cap-plugins-');
  for (const dir of options.pluginDirs ?? []) {
    fs.mkdirSync(path.join(pluginsBasePath, dir), { recursive: true });
  }
  for (const [plugin, skillDirs] of Object.entries(options.skills ?? {})) {
    for (const skill of skillDirs) {
      const skillDir = path.join(pluginsBasePath, plugin, 'skills', skill);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        `---\nname: ${skill}\ndescription: ${skill}\n---\n`,
        'utf-8',
      );
    }
  }

  const externalStore = new ExternalPluginStateStore();
  externalStore.initialize(pluginsBasePath);
  const service = new PluginLoaderService(
    createMockLogger() as unknown as Logger,
    externalStore,
    { getWorkspaceRoot: () => options.workspaceRoot } as never,
    options.globalLayer,
  );
  service.initialize(pluginsBasePath, options.storage);
  return { service, pluginsBasePath };
}

/** A config as persisted before TASK_2026_560: no `enabledSkillIds`. */
const PRE_TASK_CONFIG: PluginConfigState = {
  enabledPluginIds: ['ptah-core', 'ptah-angular'],
  disabledSkillIds: ['orchestration'],
  disabledPluginIds: ['ptah-harness-beta'],
  disabledAgentIds: ['backend-developer'],
  lastUpdated: '2026-01-01T00:00:00.000Z',
};

describe('PluginLoaderService — capability layers', () => {
  describe('explicit ancestor policy', () => {
    function scopedStores(roots: string[]) {
      const stores = new Map(
        roots.map((root) => [path.resolve(root), createStateStorage()]),
      );
      const active = stores.get(path.resolve(roots[0]));
      if (!active) throw new Error('fixture');
      const storage = {
        get: active.get,
        update: active.update,
        keys: active.keys,
        getStorageForWorkspace: (root: string) =>
          stores.get(path.resolve(root)),
        getAllWorkspacePaths: () => [...stores.keys()],
      } as IStateStorage;
      return { storage, stores };
    }

    it('layers R -> A -> B nearest first, keeps agents local, and saves only B', async () => {
      const root = tempDir('ptah-policy-root-');
      const a = tempDir('ptah-policy-a-');
      const b = tempDir('ptah-policy-b-');
      const { storage, stores } = scopedStores([b, a, root]);
      stores.get(b)?.raw.set(CONFIG_KEY, {
        enabledPluginIds: ['child-on'],
        disabledPluginIds: ['same-layer'],
        enabledSkillIds: ['child-skill', 'same-skill'],
        disabledSkillIds: ['same-skill'],
        disabledAgentIds: ['local-agent'],
      });
      stores.get(a)?.raw.set(CONFIG_KEY, {
        enabledPluginIds: ['near-on', 'same-layer'],
        disabledPluginIds: ['child-on', 'root-on'],
        enabledSkillIds: ['near-skill'],
        disabledSkillIds: ['child-skill', 'root-skill'],
        disabledAgentIds: ['parent-agent'],
      });
      stores.get(root)?.raw.set(CONFIG_KEY, {
        enabledPluginIds: ['root-on', 'distant-on'],
        disabledSkillIds: ['distant-skill'],
        enabledSkillIds: ['root-skill'],
      });
      const { service } = makeLoader({
        storage,
        workspaceRoot: b,
        globalLayer: createGlobalLayer(
          okSnapshot([
            item('plugin', 'global-off', 'off'),
            item('plugin', 'distant-on', 'off'),
          ]),
        ),
      });

      const effective = await service.getEffectivePluginConfig(b, {
        ancestorRoots: [a, root, a, b],
      });
      expect(effective.config.enabledPluginIds).toEqual([
        'child-on',
        'near-on',
        'distant-on',
      ]);
      expect(effective.config.disabledPluginIds).toEqual([
        'same-layer',
        'root-on',
        'global-off',
      ]);
      expect(effective.config.enabledSkillIds).toEqual([
        'child-skill',
        'same-skill',
        'near-skill',
      ]);
      expect(effective.config.disabledSkillIds).toEqual([
        'same-skill',
        'root-skill',
        'distant-skill',
      ]);
      expect(effective.config.disabledAgentIds).toEqual(['local-agent']);
      expect(service.getWorkspacePluginConfig(b).enabledPluginIds).toEqual([
        'child-on',
      ]);

      await service.saveWorkspacePluginConfig(
        {
          enabledPluginIds: ['changed'],
          disabledSkillIds: [],
        },
        b,
      );
      expect(stores.get(a)?.raw.get(CONFIG_KEY)).toMatchObject({
        enabledPluginIds: ['near-on', 'same-layer'],
      });
      expect(stores.get(root)?.raw.get(CONFIG_KEY)).toMatchObject({
        enabledPluginIds: ['root-on', 'distant-on'],
      });
    });

    it('reads shadowed layers strictly and distinguishes absent config from missing roots', async () => {
      const a = tempDir('ptah-policy-a-');
      const b = tempDir('ptah-policy-b-');
      const missing = path.join(a, 'missing');
      const { storage, stores } = scopedStores([b, a]);
      stores
        .get(b)
        ?.raw.set(CONFIG_KEY, {
          enabledPluginIds: ['x'],
          disabledSkillIds: [],
        });
      const { service } = makeLoader({ storage, workspaceRoot: b });
      await expect(
        service.getEffectivePluginConfig(b, { ancestorRoots: [a] }),
      ).resolves.toMatchObject({
        config: { enabledPluginIds: ['x'] },
      });
      stores
        .get(a)
        ?.raw.set(CONFIG_KEY, {
          enabledPluginIds: [],
          disabledSkillIds: 'bad',
        });
      await expect(
        service.getEffectivePluginConfig(b, { ancestorRoots: [a] }),
      ).rejects.toBeInstanceOf(CapabilityPolicyUnknownError);
      stores
        .get(a)
        ?.raw.set(CONFIG_KEY, { enabledPluginIds: [], disabledSkillIds: [] });
      await expect(
        service.getEffectivePluginConfig(b, { ancestorRoots: [missing] }),
      ).rejects.toBeInstanceOf(CapabilityPolicyUnknownError);
      const parent = stores.get(a);
      if (!parent) throw new Error('fixture');
      parent.get = () => {
        throw Object.assign(new Error('unreadable'), { code: 'EACCES' });
      };
      await expect(
        service.getEffectivePluginConfig(b, { ancestorRoots: [a] }),
      ).rejects.toBeInstanceOf(CapabilityPolicyUnknownError);
    });

    it('refuses an existing ancestor whose workspace storage is unavailable', async () => {
      const ancestor = tempDir('ptah-policy-ancestor-');
      const child = tempDir('ptah-policy-child-');
      const { storage } = scopedStores([child]);
      const { service } = makeLoader({ storage, workspaceRoot: child });

      await expect(
        service.getEffectivePluginConfig(child, { ancestorRoots: [ancestor] }),
      ).rejects.toMatchObject({
        reasons: expect.arrayContaining([
          expect.objectContaining({
            path: `${ancestor} (${CONFIG_KEY})`,
            error: 'missing workspace storage',
          }),
        ]),
      });
    });

    it('deduplicates canonical and same-root aliases for policy and fingerprint', async () => {
      const b = tempDir('ptah-policy-b-');
      const a = tempDir('ptah-policy-a-');
      const alias = path.join(b, 'alias');
      fs.symlinkSync(a, alias, 'dir');
      const { storage, stores } = scopedStores([b, a]);
      stores
        .get(a)
        ?.raw.set(CONFIG_KEY, {
          enabledPluginIds: ['from-a'],
          disabledSkillIds: [],
        });
      const { service } = makeLoader({ storage, workspaceRoot: b });
      const plain = await service.getEffectivePluginConfig(b, {
        ancestorRoots: [a],
      });
      const repeated = await service.getEffectivePluginConfig(b, {
        ancestorRoots: [alias, a, b],
      });
      expect(repeated.config).toEqual(plain.config);
      expect(repeated.fingerprint).toBe(plain.fingerprint);
    });
  });
  describe('pre-task configs (AC-3.2)', () => {
    it('reads a pre-task config back unchanged, with or without a global layer', async () => {
      const stored = structuredClone(PRE_TASK_CONFIG);
      for (const globalLayer of [
        undefined,
        createGlobalLayer(okSnapshot([])),
      ]) {
        const storage = createStateStorage(stored);
        const { service } = makeLoader({
          storage,
          globalLayer,
          pluginDirs: ['ptah-core', 'ptah-harness-alpha', 'ptah-harness-beta'],
        });

        const effective = await service.getEffectivePluginConfig();

        expect(effective.config).toEqual(PRE_TASK_CONFIG);
        expect(effective.config).not.toHaveProperty('enabledSkillIds');
        expect(service.getWorkspacePluginConfig()).toEqual(PRE_TASK_CONFIG);
        // The stored value itself is never rewritten by a read.
        expect(storage.raw.get(CONFIG_KEY)).toEqual(PRE_TASK_CONFIG);
        expect(effective.overlayPluginPaths.sort()).toEqual(
          service.resolveCurrentPluginPaths().sort(),
        );
      }
    });

    it('reads a config saved before disabledPluginIds existed exactly as before', async () => {
      const storage = createStateStorage({
        enabledPluginIds: ['ptah-core'],
        disabledSkillIds: [],
      });
      const { service, pluginsBasePath } = makeLoader({
        storage,
        pluginDirs: ['ptah-core', 'ptah-harness-alpha'],
      });

      const effective = await service.getEffectivePluginConfig();

      expect(effective.config).toEqual({
        enabledPluginIds: ['ptah-core'],
        disabledSkillIds: [],
        disabledPluginIds: [],
        disabledAgentIds: [],
        lastUpdated: undefined,
      });
      expect(effective.overlayPluginPaths.sort()).toEqual(
        [
          path.join(pluginsBasePath, 'ptah-core'),
          path.join(pluginsBasePath, 'ptah-harness-alpha'),
        ].sort(),
      );
    });
  });

  describe('global layer beneath the workspace', () => {
    it('global OFF / workspace ON: the workspace wins', async () => {
      const storage = createStateStorage({
        enabledPluginIds: ['ptah-harness-alpha'],
        disabledSkillIds: [],
        enabledSkillIds: ['review-code'],
      });
      const { service, pluginsBasePath } = makeLoader({
        storage,
        pluginDirs: ['ptah-harness-alpha'],
        globalLayer: createGlobalLayer(
          okSnapshot([
            item('plugin', 'ptah-harness-alpha', 'off'),
            item('skill', 'review-code', 'off'),
          ]),
        ),
      });

      const { config, overlayPluginPaths } =
        await service.getEffectivePluginConfig();

      expect(config.disabledPluginIds).not.toContain('ptah-harness-alpha');
      expect(config.disabledSkillIds).not.toContain('review-code');
      expect(overlayPluginPaths).toEqual([
        path.join(pluginsBasePath, 'ptah-harness-alpha'),
      ]);
    });

    it('global OFF with nothing in the workspace: the plugin and skill are off', async () => {
      const storage = createStateStorage({
        enabledPluginIds: [],
        disabledSkillIds: [],
      });
      const { service } = makeLoader({
        storage,
        pluginDirs: ['ptah-harness-alpha'],
        globalLayer: createGlobalLayer(
          okSnapshot([
            item('plugin', 'ptah-harness-alpha', 'off'),
            item('skill', 'review-code', 'off'),
          ]),
        ),
      });

      const { config, overlayPluginPaths } =
        await service.getEffectivePluginConfig();

      expect(config.disabledPluginIds).toEqual(['ptah-harness-alpha']);
      expect(config.disabledSkillIds).toEqual(['review-code']);
      expect(overlayPluginPaths).toEqual([]);
    });

    it('global ON turns on a bundled plugin the workspace never mentioned; inherit adds nothing', async () => {
      const storage = createStateStorage({
        enabledPluginIds: [],
        disabledSkillIds: [],
      });
      const { service, pluginsBasePath } = makeLoader({
        storage,
        pluginDirs: ['ptah-angular', 'ptah-react'],
        globalLayer: createGlobalLayer(
          okSnapshot([
            item('plugin', 'ptah-angular', 'on'),
            item('plugin', 'ptah-react', 'inherit'),
          ]),
        ),
      });

      const { config, overlayPluginPaths } =
        await service.getEffectivePluginConfig();

      expect(config.enabledPluginIds).toEqual(['ptah-angular']);
      expect(config.disabledPluginIds).toEqual([]);
      expect(overlayPluginPaths).toEqual([
        path.join(pluginsBasePath, 'ptah-angular'),
      ]);
    });

    it('fingerprints the global items and the STORED workspace config from one read', async () => {
      const stored: PluginConfigState = {
        enabledPluginIds: ['ptah-core'],
        disabledSkillIds: ['x'],
      };
      const snapshot = okSnapshot([item('skill', 'y', 'off')]);
      const globalLayer = createGlobalLayer(snapshot);
      const { service } = makeLoader({
        storage: createStateStorage(stored),
        globalLayer,
      });

      const { fingerprint } = await service.getEffectivePluginConfig();

      expect(globalLayer.reads).toBe(1);
      expect(fingerprint).toBe(
        harnessPolicyFingerprint({
          entries: snapshot.status === 'ok' ? snapshot.fingerprintEntries : [],
          pluginConfig: stored,
        }),
      );
    });
  });

  describe('unknown policy (N3)', () => {
    it('throws the structural policy-unknown error when the global layer is unreadable', async () => {
      const { service } = makeLoader({
        storage: createStateStorage(PRE_TASK_CONFIG),
        globalLayer: createGlobalLayer({
          status: 'error',
          reasons: [
            { path: '/home/u/.ptah/capabilities/global', error: 'EACCES' },
          ],
        }),
      });

      const failure = await service.getEffectivePluginConfig().then(
        () => null,
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(CapabilityPolicyUnknownError);
      expect(failure).toBeInstanceOf(SdkError);
      expect(isCapabilityPolicyUnknownError(failure)).toBe(true);
      expect((failure as CapabilityPolicyUnknownError).reasons).toEqual([
        { path: '/home/u/.ptah/capabilities/global', error: 'EACCES' },
      ]);
    });

    it('throws when the workspace storage read fails', async () => {
      const storage = createStateStorage();
      storage.get = () => {
        throw Object.assign(new Error('locked'), { code: 'EBUSY' });
      };
      const { service } = makeLoader({ storage });

      const failure = await service.getEffectivePluginConfig('/ws').then(
        () => null,
        (error: unknown) => error,
      );

      expect(isCapabilityPolicyUnknownError(failure)).toBe(true);
      expect((failure as CapabilityPolicyUnknownError).reasons).toEqual([
        { path: `/ws (${CONFIG_KEY})`, error: 'EBUSY' },
      ]);
    });

    it('throws when a stored denylist is not a list, instead of reading it as empty', async () => {
      const { service } = makeLoader({
        storage: createStateStorage({
          enabledPluginIds: [],
          disabledSkillIds: [],
          disabledPluginIds: 'ptah-harness-alpha',
        }),
        pluginDirs: ['ptah-harness-alpha'],
      });

      await expect(service.getEffectivePluginConfig()).rejects.toBeInstanceOf(
        CapabilityPolicyUnknownError,
      );
    });

    it('resolveCurrentPluginPaths is [] and getDisabledSkillIds is every known skill', () => {
      const storage = createStateStorage();
      storage.get = () => {
        throw new Error('corrupt');
      };
      const { service } = makeLoader({
        storage,
        pluginDirs: ['ptah-harness-alpha'],
        skills: {
          'ptah-core': ['orchestration', 'review-code'],
          'ptah-harness-alpha': ['alpha'],
          'ptah-skillssh-o-r': ['scroll'],
        },
      });

      expect(service.resolveCurrentPluginPaths()).toEqual([]);
      expect(service.getDisabledSkillIds()).toEqual([
        'alpha',
        'orchestration',
        'review-code',
        'scroll',
      ]);
    });
  });

  describe('saveWorkspacePluginConfig', () => {
    function createScopedStorage(roots: string[], active: { root: string }) {
      const stores = new Map(
        roots.map((root) => [
          path.resolve(root),
          createStateStorage({ enabledPluginIds: [], disabledSkillIds: [] }),
        ]),
      );
      const current = () =>
        stores.get(path.resolve(active.root)) as ReturnType<
          typeof createStateStorage
        >;
      return {
        stores,
        storage: {
          get: <T>(key: string, defaultValue?: T): T | undefined =>
            current().get<T>(key, defaultValue),
          update: (key: string, value: unknown) => current().update(key, value),
          keys: () => current().keys(),
          getStorageForWorkspace: (workspacePath: string) =>
            stores.get(workspacePath),
          getAllWorkspacePaths: () => [...stores.keys()],
        } as unknown as IStateStorage,
      };
    }

    it('a save for A during an A->B switch lands in A, never in B', async () => {
      const rootA = tempDir('ptah-cap-wsA-');
      const rootB = tempDir('ptah-cap-wsB-');
      const active = { root: rootA };
      const { stores, storage } = createScopedStorage([rootA, rootB], active);
      const storeA = stores.get(path.resolve(rootA));
      const storeB = stores.get(path.resolve(rootB));
      if (!storeA || !storeB) throw new Error('fixture');

      // The switch lands between the save's read and its write.
      const readA = storeA.get.bind(storeA);
      storeA.get = <T>(key: string, defaultValue?: T) => {
        active.root = rootB;
        return readA<T>(key, defaultValue);
      };

      const { service } = makeLoader({ storage, workspaceRoot: rootA });
      await service.saveWorkspacePluginConfig(
        { enabledPluginIds: ['ptah-core'], disabledSkillIds: ['a-skill'] },
        rootA,
      );

      expect(storeA.raw.get(CONFIG_KEY)).toMatchObject({
        enabledPluginIds: ['ptah-core'],
        disabledSkillIds: ['a-skill'],
      });
      expect(storeB.raw.get(CONFIG_KEY)).toEqual({
        enabledPluginIds: [],
        disabledSkillIds: [],
      });
    });

    it('rejects a root the host has no storage for rather than writing the active one', async () => {
      const rootA = tempDir('ptah-cap-wsA-');
      const { stores, storage } = createScopedStorage([rootA], {
        root: rootA,
      });
      const { service } = makeLoader({ storage });

      await expect(
        service.saveWorkspacePluginConfig(
          { enabledPluginIds: ['ptah-core'], disabledSkillIds: [] },
          tempDir('ptah-cap-stranger-'),
        ),
      ).rejects.toBeInstanceOf(SdkError);
      expect(stores.get(path.resolve(rootA))?.raw.get(CONFIG_KEY)).toEqual({
        enabledPluginIds: [],
        disabledSkillIds: [],
      });
    });

    it('preserves enabledSkillIds when a legacy caller omits it, and never invents it', async () => {
      const storage = createStateStorage({
        enabledPluginIds: [],
        disabledSkillIds: [],
        enabledSkillIds: ['review-code'],
      });
      const { service } = makeLoader({ storage });

      await service.saveWorkspacePluginConfig({
        enabledPluginIds: ['ptah-core'],
        disabledSkillIds: ['x'],
      });
      expect(storage.raw.get(CONFIG_KEY)).toMatchObject({
        enabledSkillIds: ['review-code'],
      });

      const fresh = createStateStorage({
        enabledPluginIds: [],
        disabledSkillIds: [],
      });
      const legacy = makeLoader({ storage: fresh });
      await legacy.service.saveWorkspacePluginConfig({
        enabledPluginIds: [],
        disabledSkillIds: [],
      });
      expect(fresh.raw.get(CONFIG_KEY)).not.toHaveProperty('enabledSkillIds');
    });
  });
});
