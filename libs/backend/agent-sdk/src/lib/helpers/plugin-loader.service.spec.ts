/**
 * PluginLoaderService — plugin discovery, visibility, and path resolution.
 *
 * Focus: the two activation models and the split between the two resolvers.
 *
 * - Bundled plugins are OPT-IN: active only while listed in `enabledPluginIds`.
 * - Harness plugins (`ptah-harness-*`) are OPT-OUT: the user authored them by
 *   clicking Apply, so they are active on discovery and stay active until their
 *   id is listed in `disabledPluginIds`.
 *
 * - `getAvailablePlugins()` merges both so the marketplace can render and toggle
 *   harness plugins at all.
 * - `resolvePluginPaths(ids)` resolves explicitly-named plugins. It seeds the
 *   user-layer mirror (`mirrorUserLayer`) and the SDK session `plugins` option.
 *   It accepts a harness id only when the directory actually exists.
 * - `resolveCurrentPluginPaths()` is the path the harness reconciler overlays:
 *   enabled bundled plugins ∪ discovered harness dirs, minus anything
 *   explicitly disabled. Without the harness half, every harness-authored skill
 *   drops out of the desired state and the reconciler reaps its workspace copy
 *   the moment the user toggles a plugin in the marketplace. Without the
 *   disable half, the toggle does nothing.
 *
 * Uses a real temp directory rather than a mocked `fs` — the service reads the
 * filesystem synchronously and the directory layout is the thing under test.
 */

import 'reflect-metadata';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { Logger } from '@ptah-extension/vscode-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import type { PluginConfigState } from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { ExternalPluginStateStore } from '@ptah-extension/plugin-marketplace';

import { SdkError } from '../errors';
import {
  PLUGIN_CONFIG_HOME_KEY_PREFIX,
  canonicalRootKey,
} from './plugin-config-home';
import { PluginLoaderService } from './plugin-loader.service';

/**
 * A consent record for an external plugin, shaped as the store persists it.
 *
 * Written straight into the store so the specs can express the distinction
 * that matters: files on disk versus an approval on record.
 */
function externalRecord(pluginId: string, plugin: string) {
  return {
    pluginId,
    source: 'dotnet/skills',
    plugin,
    displayName: plugin,
    version: '1.0.0',
    installedAt: '2026-08-17T00:00:00.000Z',
    consentToken: 'a'.repeat(64),
    files: [],
    skippedBinaryFiles: [],
    mcpServers: [],
  };
}

function createStateStorage(initial?: PluginConfigState): IStateStorage {
  const store = new Map<string, unknown>();
  if (initial) store.set('ptah.plugins.config', initial);

  return {
    get: <T>(key: string, defaultValue?: T): T | undefined =>
      (store.get(key) as T | undefined) ?? defaultValue,
    update: async (key: string, value: unknown): Promise<void> => {
      store.set(key, value);
    },
    keys: (): readonly string[] => [...store.keys()],
  };
}

interface Harness {
  service: PluginLoaderService;
  logger: MockLogger;
  pluginsBasePath: string;
  externalStore: ExternalPluginStateStore;
  /** Temp workspace root, present only when the spec asked for one. */
  workspaceRoot?: string;
}

/** The one slice of `IWorkspaceProvider` the loader reads. */
function createWorkspaceProvider(workspaceRoot: string | undefined): {
  getWorkspaceRoot(): string | undefined;
} {
  return { getWorkspaceRoot: () => workspaceRoot };
}

function makeHarness(options: {
  bundledDirs?: string[];
  harnessDirs?: string[];
  /** Files (not directories) created directly under the plugins base path. */
  strayFiles?: string[];
  /**
   * `{ 'ptah-harness-alpha': [{ dir, name, description }] }` — writes real
   * `skills/{dir}/SKILL.md` files so skill counts and descriptions come from
   * disk rather than from a stub.
   */
  skills?: Record<
    string,
    Array<{ dir: string; name?: string; description?: string }>
  >;
  enabledPluginIds?: string[];
  disabledSkillIds?: string[];
  disabledPluginIds?: string[];
  /** Omit the persisted disabledPluginIds key entirely (pre-toggle configs). */
  omitDisabledPluginIds?: boolean;
  /** Skip creating the plugins base directory entirely (ENOENT path). */
  omitBasePath?: boolean;
  /**
   * Harness dirs to create under `{ws}/.ptah/plugins`. Supplying this (or
   * `openWorkspace`) creates a temp workspace root and wires a workspace
   * provider that reports it.
   */
  workspaceHarnessDirs?: string[];
  /** Same shape as `skills`, but rooted in the workspace plugin dir. */
  workspaceSkills?: Record<
    string,
    Array<{ dir: string; name?: string; description?: string }>
  >;
  /** Open a workspace with no plugin dir in it. */
  openWorkspace?: boolean;
}): Harness {
  const pluginsBasePath = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ptah-plugin-loader-'),
  );

  const wantsWorkspace =
    options.openWorkspace === true ||
    options.workspaceHarnessDirs !== undefined ||
    options.workspaceSkills !== undefined;
  const workspaceRoot = wantsWorkspace
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-plugin-loader-ws-'))
    : undefined;

  if (workspaceRoot !== undefined) {
    const workspacePlugins = path.join(workspaceRoot, '.ptah', 'plugins');
    for (const dir of options.workspaceHarnessDirs ?? []) {
      fs.mkdirSync(path.join(workspacePlugins, dir), { recursive: true });
    }
    for (const [pluginId, entries] of Object.entries(
      options.workspaceSkills ?? {},
    )) {
      for (const entry of entries) {
        const skillDir = path.join(
          workspacePlugins,
          pluginId,
          'skills',
          entry.dir,
        );
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(
          path.join(skillDir, 'SKILL.md'),
          [
            '---',
            `name: "${entry.name ?? entry.dir}"`,
            `description: "${entry.description ?? `desc for ${entry.dir}`}"`,
            '---',
            '',
            'body',
            '',
          ].join('\n'),
          'utf-8',
        );
      }
    }
  }

  if (options.omitBasePath) {
    fs.rmSync(pluginsBasePath, { recursive: true, force: true });
  } else {
    for (const dir of [
      ...(options.bundledDirs ?? []),
      ...(options.harnessDirs ?? []),
    ]) {
      fs.mkdirSync(path.join(pluginsBasePath, dir), { recursive: true });
    }
    for (const file of options.strayFiles ?? []) {
      fs.writeFileSync(path.join(pluginsBasePath, file), 'x', 'utf-8');
    }
    for (const [pluginId, entries] of Object.entries(options.skills ?? {})) {
      for (const entry of entries) {
        const skillDir = path.join(
          pluginsBasePath,
          pluginId,
          'skills',
          entry.dir,
        );
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(
          path.join(skillDir, 'SKILL.md'),
          [
            '---',
            `name: "${entry.name ?? entry.dir}"`,
            `description: "${entry.description ?? `desc for ${entry.dir}`}"`,
            '---',
            '',
            'body',
            '',
          ].join('\n'),
          'utf-8',
        );
      }
    }
  }

  const persisted: PluginConfigState = {
    enabledPluginIds: options.enabledPluginIds ?? [],
    disabledSkillIds: options.disabledSkillIds ?? [],
    disabledPluginIds: options.disabledPluginIds ?? [],
    lastUpdated: undefined,
  };
  if (options.omitDisabledPluginIds) {
    delete persisted.disabledPluginIds;
  }

  const logger = createMockLogger();
  const externalStore = new ExternalPluginStateStore();
  externalStore.initialize(pluginsBasePath);
  const service = new PluginLoaderService(
    logger as unknown as Logger,
    externalStore,
    createWorkspaceProvider(workspaceRoot) as never,
  );
  service.initialize(pluginsBasePath, createStateStorage(persisted));

  return {
    service,
    logger,
    pluginsBasePath,
    externalStore,
    ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
  };
}

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function track(h: Harness): Harness {
  created.push(h.pluginsBasePath);
  if (h.workspaceRoot !== undefined) created.push(h.workspaceRoot);
  return h;
}

/** `{ws}/.ptah/plugins/{id}` for the harness's temp workspace. */
function wsPlugin(h: Harness, id: string): string {
  return path.join(h.workspaceRoot as string, '.ptah', 'plugins', id);
}

describe('PluginLoaderService.discoverHarnessPluginPaths', () => {
  it('returns every ptah-harness-* directory under the plugins base path', () => {
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core'],
        harnessDirs: ['ptah-harness-alpha', 'ptah-harness-beta'],
      }),
    );

    expect(h.service.discoverHarnessPluginPaths().sort()).toEqual(
      [
        path.join(h.pluginsBasePath, 'ptah-harness-alpha'),
        path.join(h.pluginsBasePath, 'ptah-harness-beta'),
      ].sort(),
    );
  });

  it('ignores non-harness directories and non-directory entries', () => {
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core', 'ptah-angular'],
        harnessDirs: ['ptah-harness-alpha'],
        strayFiles: ['ptah-harness-not-a-dir.md', 'README.md'],
      }),
    );

    expect(h.service.discoverHarnessPluginPaths()).toEqual([
      path.join(h.pluginsBasePath, 'ptah-harness-alpha'),
    ]);
  });

  it('returns an empty array (without warning) when the plugins dir is absent', () => {
    const h = track(makeHarness({ omitBasePath: true }));

    expect(h.service.discoverHarnessPluginPaths()).toEqual([]);
    expect(h.logger.warn).not.toHaveBeenCalled();
  });

  it('returns an empty array when the service is not initialized', () => {
    const logger = createMockLogger();
    const service = new PluginLoaderService(
      logger as unknown as Logger,
      new ExternalPluginStateStore(),
    );

    expect(service.discoverHarnessPluginPaths()).toEqual([]);
  });

  it('EXCLUDES workspace-scoped harness dirs — this method feeds the user-layer mirror', () => {
    // The load-bearing asymmetry. The mirror CLONES what this returns into
    // `~/.ptah/user/skills` create-if-absent, and the user layer is the
    // desired state's BASE — so a mirrored workspace skill would outlive its
    // workspace and propagate into every other project forever, which is the
    // exact opposite of the scope the caller asked for.
    const h = track(
      makeHarness({
        harnessDirs: ['ptah-harness-alpha'],
        workspaceHarnessDirs: ['ptah-harness-local'],
      }),
    );

    expect(h.service.discoverHarnessPluginPaths()).toEqual([
      path.join(h.pluginsBasePath, 'ptah-harness-alpha'),
    ]);
  });
});

describe('PluginLoaderService — workspace-scoped harness plugins', () => {
  it('discovers ptah-harness-* under {ws}/.ptah/plugins', () => {
    const h = track(
      makeHarness({
        workspaceHarnessDirs: ['ptah-harness-local', 'ptah-harness-other'],
      }),
    );

    expect(h.service.discoverWorkspaceHarnessPluginPaths().sort()).toEqual(
      [
        wsPlugin(h, 'ptah-harness-local'),
        wsPlugin(h, 'ptah-harness-other'),
      ].sort(),
    );
  });

  it('reports no workspace scope when no folder is open', () => {
    const h = track(makeHarness({ harnessDirs: ['ptah-harness-alpha'] }));

    expect(h.service.getWorkspacePluginsBasePath()).toBeNull();
    expect(h.service.discoverWorkspaceHarnessPluginPaths()).toEqual([]);
  });

  it('does not warn when the workspace has no .ptah/plugins directory', () => {
    const h = track(makeHarness({ openWorkspace: true }));

    expect(h.service.discoverWorkspaceHarnessPluginPaths()).toEqual([]);
    expect(h.logger.warn).not.toHaveBeenCalled();
  });

  it('includes them in the reconciler overlay alongside the user-global ones', () => {
    const h = track(
      makeHarness({
        harnessDirs: ['ptah-harness-alpha'],
        workspaceHarnessDirs: ['ptah-harness-local'],
      }),
    );

    expect(h.service.resolveCurrentPluginPaths().sort()).toEqual(
      [
        path.join(h.pluginsBasePath, 'ptah-harness-alpha'),
        wsPlugin(h, 'ptah-harness-local'),
      ].sort(),
    );
  });

  it('honours disabledPluginIds for a workspace-scoped plugin', () => {
    const h = track(
      makeHarness({
        workspaceHarnessDirs: ['ptah-harness-local'],
        disabledPluginIds: ['ptah-harness-local'],
      }),
    );

    expect(h.service.resolveCurrentPluginPaths()).toEqual([]);
  });

  it('lets the workspace copy win a slug clash, and says so', () => {
    const h = track(
      makeHarness({
        harnessDirs: ['ptah-harness-dup'],
        workspaceHarnessDirs: ['ptah-harness-dup'],
      }),
    );

    expect(h.service.resolveCurrentPluginPaths()).toEqual([
      wsPlugin(h, 'ptah-harness-dup'),
    ]);
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('shadows a user-global one'),
      expect.objectContaining({ pluginId: 'ptah-harness-dup' }),
    );
  });

  it('lists them in getAvailablePlugins, tagged workspace, so they are toggleable', () => {
    // This list is also the allowlist `plugins:save-config` filters
    // `disabledPluginIds` against — absent from it, the id cannot be turned off.
    const h = track(
      makeHarness({
        harnessDirs: ['ptah-harness-alpha'],
        skills: { 'ptah-harness-alpha': [{ dir: 'alpha' }] },
        workspaceHarnessDirs: ['ptah-harness-local'],
        workspaceSkills: {
          'ptah-harness-local': [
            { dir: 'local', description: 'this repo only' },
          ],
        },
      }),
    );

    const plugins = h.service.getAvailablePlugins();
    const local = plugins.find((p) => p.id === 'ptah-harness-local');
    const alpha = plugins.find((p) => p.id === 'ptah-harness-alpha');

    expect(local).toBeDefined();
    expect(local?.description).toBe('this repo only');
    expect(local?.skillCount).toBe(1);
    expect(local?.keywords).toContain('workspace');
    expect(alpha?.keywords).toContain('global');
  });

  it('resolves a workspace harness id to its workspace path, not the global root', () => {
    const h = track(
      makeHarness({
        workspaceHarnessDirs: ['ptah-harness-local'],
        enabledPluginIds: ['ptah-harness-local'],
      }),
    );

    expect(h.service.resolvePluginPaths(['ptah-harness-local'])).toEqual([
      wsPlugin(h, 'ptah-harness-local'),
    ]);
  });
});

describe('PluginLoaderService.discoverSkillsForPlugins — deterministic descriptors', () => {
  it('keeps the directory slug for both toggling and native invocation', () => {
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core'],
        skills: {
          'ptah-core': [
            {
              dir: 'run-tests',
              name: 'Frontmatter Display Name',
              description: 'Runs the test suite',
            },
          ],
        },
      }),
    );

    expect(
      h.service.discoverSkillsForPlugins([
        path.join(h.pluginsBasePath, 'ptah-core'),
      ]),
    ).toEqual([
      expect.objectContaining({
        skillId: 'run-tests',
        invocationName: 'run-tests',
        descriptorId: 'ptah-core:run-tests',
        displayName: 'Frontmatter Display Name',
        sourceId: 'ptah-core',
        source: 'bundled',
        invocability: 'invocable',
      }),
    ]);
  });

  it('qualifies external skills with their canonical source coordinate', async () => {
    const h = track(makeHarness({ bundledDirs: ['ptah-core'] }));
    const pluginPath = path.join(
      h.pluginsBasePath,
      'external',
      'dotnet',
      'skills',
      'dotnet-test',
    );
    fs.mkdirSync(path.join(pluginPath, 'skills', 'run-tests'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(pluginPath, 'skills', 'run-tests', 'SKILL.md'),
      '---\nname: "Run Tests"\ndescription: "Runs tests"\n---\n',
      'utf-8',
    );
    await h.externalStore.recordInstall(
      externalRecord('external:dotnet/skills/dotnet-test', 'dotnet-test'),
    );

    expect(h.service.discoverSkillsForPlugins([pluginPath])).toEqual([
      expect.objectContaining({
        skillId: 'run-tests',
        invocationName: 'run-tests',
        descriptorId: 'external:dotnet/skills/dotnet-test:run-tests',
        pluginId: 'external:dotnet/skills/dotnet-test',
        sourceId: 'external:dotnet/skills/dotnet-test',
        source: 'external',
      }),
    ]);
  });

  it('marks disabled local skills as not invocable without changing their toggle key', () => {
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core'],
        disabledSkillIds: ['run-tests'],
        skills: { 'ptah-core': [{ dir: 'run-tests' }] },
      }),
    );

    const [skill] = h.service.discoverSkillsForPlugins([
      path.join(h.pluginsBasePath, 'ptah-core'),
    ]);
    expect(skill).toMatchObject({
      skillId: 'run-tests',
      invocationName: 'run-tests',
      invocability: 'not-invocable',
    });
  });
});

describe('PluginLoaderService.resolvePluginPaths (explicitly-named plugins)', () => {
  it('resolves enabled bundled plugin IDs and never appends harness dirs on its own', () => {
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core', 'ptah-angular'],
        harnessDirs: ['ptah-harness-alpha'],
        enabledPluginIds: ['ptah-core', 'ptah-angular'],
      }),
    );

    expect(h.service.resolvePluginPaths(['ptah-core', 'ptah-angular'])).toEqual(
      [
        path.join(h.pluginsBasePath, 'ptah-core'),
        path.join(h.pluginsBasePath, 'ptah-angular'),
      ],
    );
  });

  it('resolves a harness ID that names a real directory', () => {
    // plugins:list-skills passes every ID from getAvailablePlugins(), harness
    // IDs included — dropping them here would hide harness skills from the
    // per-skill toggle.
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core'],
        harnessDirs: ['ptah-harness-alpha'],
      }),
    );

    expect(
      h.service.resolvePluginPaths(['ptah-core', 'ptah-harness-alpha']),
    ).toEqual([
      path.join(h.pluginsBasePath, 'ptah-core'),
      path.join(h.pluginsBasePath, 'ptah-harness-alpha'),
    ]);
  });

  it('still filters unknown IDs and missing directories', () => {
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core'],
        harnessDirs: ['ptah-harness-alpha'],
      }),
    );

    expect(
      h.service.resolvePluginPaths([
        'ptah-core',
        'ptah-react', // known ID, directory not downloaded
        '../escape', // unknown ID
      ]),
    ).toEqual([path.join(h.pluginsBasePath, 'ptah-core')]);

    expect(h.logger.warn).toHaveBeenCalledWith(
      '[PluginLoaderService] Unknown plugin ID filtered out',
      { pluginId: '../escape' },
    );
  });

  it('rejects a harness-prefixed ID with no directory behind it', () => {
    // The prefix alone must not be a passport: only IDs that discovery actually
    // returned (direct children of the base path) are addressable, which is
    // what blocks traversal through the harness branch.
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core'],
        harnessDirs: ['ptah-harness-alpha'],
      }),
    );

    expect(
      h.service.resolvePluginPaths([
        'ptah-harness-ghost',
        `ptah-harness-..${path.sep}..${path.sep}etc`,
      ]),
    ).toEqual([]);
    expect(h.logger.warn).toHaveBeenCalledWith(
      '[PluginLoaderService] Unknown plugin ID filtered out',
      { pluginId: 'ptah-harness-ghost' },
    );
  });

  it('returns an empty array with no enabled plugins even when harness dirs exist', () => {
    const h = track(makeHarness({ harnessDirs: ['ptah-harness-alpha'] }));

    expect(h.service.resolvePluginPaths([])).toEqual([]);
  });
});

describe('PluginLoaderService.getAvailablePlugins (marketplace visibility)', () => {
  it('lists every bundled plugin marked as bundled', () => {
    const h = track(makeHarness({ bundledDirs: ['ptah-core'] }));

    const plugins = h.service.getAvailablePlugins();

    expect(plugins.length).toBeGreaterThan(0);
    expect(plugins.every((p) => p.source === 'bundled')).toBe(true);
    expect(plugins.map((p) => p.id)).toContain('ptah-core');
  });

  it('counts a bundled plugin skills from disk rather than the catalogue constant', () => {
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core'],
        skills: {
          'ptah-core': [{ dir: 'orchestration' }, { dir: 'humanize-library' }],
        },
      }),
    );

    const core = h.service
      .getAvailablePlugins()
      .find((p) => p.id === 'ptah-core');

    expect(core?.skillCount).toBe(2);
  });

  it('falls back to the catalogue count when the plugin has not been downloaded yet', () => {
    const h = track(makeHarness({ bundledDirs: [] }));

    const core = h.service
      .getAvailablePlugins()
      .find((p) => p.id === 'ptah-core');

    expect(core?.skillCount).toBeGreaterThan(0);
  });

  it('appends a discovered harness plugin with a slug-derived name and real skill count', () => {
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core'],
        harnessDirs: ['ptah-harness-release-notes'],
        skills: {
          'ptah-harness-release-notes': [
            {
              dir: 'release-notes',
              name: 'Release Notes',
              description: 'Draft release notes from the changelog',
            },
            { dir: 'changelog-lint' },
          ],
        },
      }),
    );

    const harnessPlugin = h.service
      .getAvailablePlugins()
      .find((p) => p.id === 'ptah-harness-release-notes');

    expect(harnessPlugin).toBeDefined();
    expect(harnessPlugin).toMatchObject({
      id: 'ptah-harness-release-notes',
      name: 'Release Notes',
      category: 'harness-tools',
      skillCount: 2,
      commandCount: 0,
      isDefault: false,
      source: 'harness',
    });
    expect(harnessPlugin?.description).toBe(
      'Draft release notes from the changelog',
    );
    expect(harnessPlugin?.keywords).toEqual(
      expect.arrayContaining(['release', 'notes', 'harness', 'custom']),
    );
  });

  it('describes a harness plugin with no skills on disk without throwing', () => {
    const h = track(makeHarness({ harnessDirs: ['ptah-harness-empty'] }));

    const harnessPlugin = h.service
      .getAvailablePlugins()
      .find((p) => p.id === 'ptah-harness-empty');

    expect(harnessPlugin).toMatchObject({
      name: 'Empty',
      skillCount: 0,
      source: 'harness',
    });
    expect(harnessPlugin?.description).toContain('harness wizard');
  });

  it('skips a half-written skill folder that has no SKILL.md', () => {
    const h = track(
      makeHarness({
        harnessDirs: ['ptah-harness-alpha'],
        skills: { 'ptah-harness-alpha': [{ dir: 'good' }] },
      }),
    );
    fs.mkdirSync(
      path.join(h.pluginsBasePath, 'ptah-harness-alpha', 'skills', 'partial'),
      { recursive: true },
    );

    const harnessPlugin = h.service
      .getAvailablePlugins()
      .find((p) => p.id === 'ptah-harness-alpha');

    expect(harnessPlugin?.skillCount).toBe(1);
  });

  it('still lists a harness plugin the user explicitly disabled (visible but off)', () => {
    // Visibility is independent of activation — a disabled plugin must stay in
    // the list or the user could never turn it back on.
    const h = track(
      makeHarness({
        harnessDirs: ['ptah-harness-alpha'],
        disabledPluginIds: ['ptah-harness-alpha'],
      }),
    );

    expect(h.service.getAvailablePlugins().map((p) => p.id)).toContain(
      'ptah-harness-alpha',
    );
  });
});

describe('PluginLoaderService.resolveCurrentPluginPaths (junction source of truth)', () => {
  it('appends harness plugin dirs after the enabled bundled plugins', () => {
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core'],
        harnessDirs: ['ptah-harness-alpha'],
        enabledPluginIds: ['ptah-core'],
      }),
    );

    expect(h.service.resolveCurrentPluginPaths()).toEqual([
      path.join(h.pluginsBasePath, 'ptah-core'),
      path.join(h.pluginsBasePath, 'ptah-harness-alpha'),
    ]);
  });

  it('surfaces harness dirs even when the user has disabled every bundled plugin', () => {
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core'],
        harnessDirs: ['ptah-harness-alpha'],
        enabledPluginIds: [],
      }),
    );

    // This is the regression: a marketplace toggle that empties enabledPluginIds
    // must still surface the harness dirs, or every harness-authored skill
    // leaves the desired state and its workspace copy is reaped.
    expect(h.service.resolveCurrentPluginPaths()).toEqual([
      path.join(h.pluginsBasePath, 'ptah-harness-alpha'),
    ]);
  });

  it('matches resolvePluginPaths exactly when no harness dirs exist', () => {
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core', 'ptah-angular'],
        enabledPluginIds: ['ptah-core', 'ptah-angular'],
      }),
    );

    expect(h.service.resolveCurrentPluginPaths()).toEqual(
      h.service.resolvePluginPaths(['ptah-core', 'ptah-angular']),
    );
  });

  it('picks up a harness plugin created after initialization', () => {
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core'],
        enabledPluginIds: ['ptah-core'],
      }),
    );

    expect(h.service.resolveCurrentPluginPaths()).toEqual([
      path.join(h.pluginsBasePath, 'ptah-core'),
    ]);

    fs.mkdirSync(path.join(h.pluginsBasePath, 'ptah-harness-late'), {
      recursive: true,
    });

    expect(h.service.resolveCurrentPluginPaths()).toEqual([
      path.join(h.pluginsBasePath, 'ptah-core'),
      path.join(h.pluginsBasePath, 'ptah-harness-late'),
    ]);
  });

  it('includes an untouched harness plugin without it ever being in enabledPluginIds', () => {
    // Opt-out semantics: authoring the skill IS the enable action. Nothing adds
    // the id to enabledPluginIds, so absence there must not mean "off".
    const h = track(
      makeHarness({
        harnessDirs: ['ptah-harness-alpha', 'ptah-harness-beta'],
        enabledPluginIds: [],
        disabledPluginIds: [],
      }),
    );

    expect(h.service.resolveCurrentPluginPaths().sort()).toEqual(
      [
        path.join(h.pluginsBasePath, 'ptah-harness-alpha'),
        path.join(h.pluginsBasePath, 'ptah-harness-beta'),
      ].sort(),
    );
  });

  it('EXCLUDES a harness plugin the user explicitly disabled', () => {
    // The toggle only bites here: the harness reconciler removes managed copies
    // whose skill is absent from these paths, so an excluded plugin is what
    // actually removes its skills from .claude/skills/.
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core'],
        harnessDirs: ['ptah-harness-alpha', 'ptah-harness-beta'],
        enabledPluginIds: ['ptah-core'],
        disabledPluginIds: ['ptah-harness-alpha'],
      }),
    );

    expect(h.service.resolveCurrentPluginPaths()).toEqual([
      path.join(h.pluginsBasePath, 'ptah-core'),
      path.join(h.pluginsBasePath, 'ptah-harness-beta'),
    ]);
  });

  it('lets an explicit disable win over an explicit enable for the same id', () => {
    const h = track(
      makeHarness({
        harnessDirs: ['ptah-harness-alpha'],
        enabledPluginIds: ['ptah-harness-alpha'],
        disabledPluginIds: ['ptah-harness-alpha'],
      }),
    );

    expect(h.service.resolveCurrentPluginPaths()).toEqual([]);
  });

  it('honours an explicit disable of a bundled plugin too', () => {
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core', 'ptah-angular'],
        enabledPluginIds: ['ptah-core', 'ptah-angular'],
        disabledPluginIds: ['ptah-angular'],
      }),
    );

    expect(h.service.resolveCurrentPluginPaths()).toEqual([
      path.join(h.pluginsBasePath, 'ptah-core'),
    ]);
  });

  it('treats a config persisted without disabledPluginIds as nothing disabled', () => {
    // Back-compat: every config on disk today has only enabledPluginIds and
    // disabledSkillIds. It must load unchanged, with harness plugins still on.
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core'],
        harnessDirs: ['ptah-harness-alpha'],
        enabledPluginIds: ['ptah-core'],
        omitDisabledPluginIds: true,
      }),
    );

    expect(h.service.getWorkspacePluginConfig().disabledPluginIds).toEqual([]);
    expect(h.service.resolveCurrentPluginPaths()).toEqual([
      path.join(h.pluginsBasePath, 'ptah-core'),
      path.join(h.pluginsBasePath, 'ptah-harness-alpha'),
    ]);
  });
});

describe('PluginLoaderService.saveWorkspacePluginConfig (disable persistence)', () => {
  it('persists disabledPluginIds and applies it on the next resolve', async () => {
    const h = track(
      makeHarness({
        harnessDirs: ['ptah-harness-alpha'],
        omitDisabledPluginIds: true,
      }),
    );

    expect(h.service.resolveCurrentPluginPaths()).toEqual([
      path.join(h.pluginsBasePath, 'ptah-harness-alpha'),
    ]);

    await h.service.saveWorkspacePluginConfig({
      enabledPluginIds: [],
      disabledSkillIds: [],
      disabledPluginIds: ['ptah-harness-alpha'],
    });

    expect(h.service.getWorkspacePluginConfig().disabledPluginIds).toEqual([
      'ptah-harness-alpha',
    ]);
    expect(h.service.resolveCurrentPluginPaths()).toEqual([]);
  });

  it('preserves an existing disable when a legacy caller omits disabledPluginIds', async () => {
    // harness:start-new-project and the CLI still save { enabledPluginIds,
    // disabledSkillIds } only — that must not silently re-enable the plugin.
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core'],
        harnessDirs: ['ptah-harness-alpha'],
        disabledPluginIds: ['ptah-harness-alpha'],
      }),
    );

    await h.service.saveWorkspacePluginConfig({
      enabledPluginIds: ['ptah-core'],
      disabledSkillIds: [],
    });

    expect(h.service.getWorkspacePluginConfig().disabledPluginIds).toEqual([
      'ptah-harness-alpha',
    ]);
    expect(h.service.resolveCurrentPluginPaths()).toEqual([
      path.join(h.pluginsBasePath, 'ptah-core'),
    ]);
  });

  it('reads a config persisted without disabledAgentIds as nothing disabled, and preserves the list when a caller omits it', async () => {
    // Same back-compat idiom as disabledPluginIds, for the same reason: every
    // config on disk predates per-agent toggling, and a caller that says
    // nothing about agents must not silently re-enable one the user turned off.
    const h = track(makeHarness({ bundledDirs: ['ptah-core'] }));

    expect(h.service.getWorkspacePluginConfig().disabledAgentIds).toEqual([]);

    await h.service.saveWorkspacePluginConfig({
      enabledPluginIds: ['ptah-core'],
      disabledSkillIds: [],
      disabledAgentIds: ['senior-tester'],
    });
    await h.service.saveWorkspacePluginConfig({
      enabledPluginIds: ['ptah-core'],
      disabledSkillIds: [],
    });

    expect(h.service.getWorkspacePluginConfig().disabledAgentIds).toEqual([
      'senior-tester',
    ]);
  });

  it('clears the denylist when an explicit empty array is passed', async () => {
    const h = track(
      makeHarness({
        harnessDirs: ['ptah-harness-alpha'],
        disabledPluginIds: ['ptah-harness-alpha'],
      }),
    );

    await h.service.saveWorkspacePluginConfig({
      enabledPluginIds: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    });

    expect(h.service.resolveCurrentPluginPaths()).toEqual([
      path.join(h.pluginsBasePath, 'ptah-harness-alpha'),
    ]);
  });
});

/**
 * THE ALLOWLIST BOUNDARY (TASK_2026_270).
 *
 * External plugins are the only kind whose bytes came from a third party, so
 * they are the only kind for which "is this on disk" is the wrong question.
 * The right question is "did the user approve this", and the only thing that
 * can answer it is the consent record.
 *
 * Every test below exists to make one specific regression loud: someone
 * widening the check to `id.startsWith('external:')`, or to a directory scan,
 * because either would make the marketplace feature look like it still works.
 */
describe('PluginLoaderService — external plugin allowlist', () => {
  const PLUGIN_ID = 'external:dotnet/skills/dotnet-test';

  /** Put a real plugin tree on disk WITHOUT recording any consent for it. */
  function seedExternalTree(pluginsBasePath: string, plugin: string): string {
    const dir = path.join(
      pluginsBasePath,
      'external',
      'dotnet',
      'skills',
      plugin,
    );
    const skillDir = path.join(dir, 'skills', 'run-tests');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: "run-tests"\ndescription: "runs tests"\n---\n\nbody\n',
      'utf-8',
    );
    return dir;
  }

  it('REJECTS an id whose directory exists but which was never installed', async () => {
    const h = track(makeHarness({ bundledDirs: ['ptah-core'] }));
    seedExternalTree(h.pluginsBasePath, 'dotnet-test');

    expect(h.service.resolvePluginPaths([PLUGIN_ID])).toEqual([]);
    expect(h.logger.warn).toHaveBeenCalledWith(
      '[PluginLoaderService] Unknown plugin ID filtered out',
      { pluginId: PLUGIN_ID },
    );
  });

  it('resolves the same id once a consent record exists', async () => {
    const h = track(makeHarness({ bundledDirs: ['ptah-core'] }));
    const dir = seedExternalTree(h.pluginsBasePath, 'dotnet-test');
    await h.externalStore.recordInstall(
      externalRecord(PLUGIN_ID, 'dotnet-test'),
    );

    expect(h.service.resolvePluginPaths([PLUGIN_ID])).toEqual([dir]);
  });

  it('stops resolving it again the moment the record is removed', async () => {
    const h = track(makeHarness({ bundledDirs: ['ptah-core'] }));
    seedExternalTree(h.pluginsBasePath, 'dotnet-test');
    await h.externalStore.recordInstall(
      externalRecord(PLUGIN_ID, 'dotnet-test'),
    );
    expect(h.service.resolvePluginPaths([PLUGIN_ID])).toHaveLength(1);

    await h.externalStore.removeInstall(PLUGIN_ID);

    // The directory is untouched — only the approval went away.
    expect(h.service.resolvePluginPaths([PLUGIN_ID])).toEqual([]);
  });

  it('rejects a recorded id whose segments are traversal', async () => {
    const h = track(makeHarness({ bundledDirs: ['ptah-core'] }));
    const hostile = 'external:dotnet/skills/..';
    await h.externalStore.recordInstall(externalRecord(hostile, '..'));

    expect(h.service.resolvePluginPaths([hostile])).toEqual([]);
  });

  it.each([
    ['bare prefix', 'external:'],
    ['too few segments', 'external:dotnet/skills'],
    ['too many segments', 'external:dotnet/skills/a/b'],
    ['parent traversal in owner', 'external:../../etc/x'],
    ['backslash separators', 'external:dotnet\\skills\\x'],
  ])('rejects a malformed external id (%s)', (_label, id) => {
    const h = track(makeHarness({ bundledDirs: ['ptah-core'] }));

    expect(h.service.resolvePluginPaths([id])).toEqual([]);
  });

  it('still rejects unknown bundled ids exactly as before', () => {
    const h = track(makeHarness({ bundledDirs: ['ptah-core'] }));

    expect(
      h.service.resolvePluginPaths(['not-a-plugin', '../../etc/passwd']),
    ).toEqual([]);
  });

  it('does not disturb bundled resolution when an external id is present', async () => {
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core'],
        enabledPluginIds: ['ptah-core'],
      }),
    );

    expect(h.service.resolvePluginPaths(['ptah-core', PLUGIN_ID])).toEqual([
      path.join(h.pluginsBasePath, 'ptah-core'),
    ]);
  });

  describe('getAvailablePlugins', () => {
    it('does NOT advertise an external directory with no consent record', () => {
      const h = track(makeHarness({ bundledDirs: ['ptah-core'] }));
      seedExternalTree(h.pluginsBasePath, 'dotnet-test');

      expect(
        h.service.getAvailablePlugins().some((p) => p.source === 'external'),
      ).toBe(false);
    });

    it('advertises a recorded external plugin with its real skill count', async () => {
      const h = track(makeHarness({ bundledDirs: ['ptah-core'] }));
      seedExternalTree(h.pluginsBasePath, 'dotnet-test');
      await h.externalStore.recordInstall(
        externalRecord(PLUGIN_ID, 'dotnet-test'),
      );

      const entry = h.service
        .getAvailablePlugins()
        .find((p) => p.id === PLUGIN_ID);

      expect(entry).toMatchObject({
        source: 'external',
        category: 'external-tools',
        skillCount: 1,
        // Third-party plugins never carry Ptah's "Recommended" badge.
        isDefault: false,
      });
    });

    it('still lists a recorded plugin whose directory has vanished', async () => {
      // Otherwise a half-deleted install becomes unreachable: invisible in the
      // UI, still recorded, and impossible for the user to clean up.
      const h = track(makeHarness({ bundledDirs: ['ptah-core'] }));
      await h.externalStore.recordInstall(
        externalRecord(PLUGIN_ID, 'dotnet-test'),
      );

      const entry = h.service
        .getAvailablePlugins()
        .find((p) => p.id === PLUGIN_ID);

      expect(entry).toBeDefined();
      expect(entry?.skillCount).toBe(0);
    });
  });
});

/**
 * TASK_2026_315 C4 — a permanently broken skill root is reported ONCE.
 *
 * `tmp/logs/log.log` lines 793, 844 and 1012 carry the identical
 *
 *     [PluginLoaderService] Skipping skill without a readable SKILL.md
 *     {"path":"…\\ptah-skillssh-oso95-scroll-world\\skills\\scroll-world\\SKILL.md", …}
 *
 * once per `plugins:list-available`. The condition is permanent — that
 * directory tree has no SKILL.md and never will regain one on its own — so
 * every repeat is a line that tells a reader nothing the first one did not.
 *
 * What must NOT change: the skill is still skipped, the surrounding plugin
 * still lists, and the scan itself still runs on every call so a root that is
 * repaired is picked up with no cache to invalidate.
 */
describe('PluginLoaderService.discoverSkillsForPlugins — broken-root log volume', () => {
  /** A skill directory with no `SKILL.md`, the shape the log complains about. */
  function breakSkill(base: string, pluginId: string, slug: string): string {
    const dir = path.join(base, pluginId, 'skills', slug);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // WARN since TASK_2026_354: the same failure is now surfaced to the user as
  // `PluginInfo.status`, so the log line is the diagnostic half of a state they
  // can act on rather than a debug crumb. The dedupe below is what keeps that
  // honest instead of nagging.
  function skipLines(h: Harness): unknown[][] {
    return h.logger.warn.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === 'string' &&
        call[0].includes('Skipping skill without a readable SKILL.md'),
    );
  }

  it('logs the same unreadable SKILL.md once across repeated list calls', () => {
    const h = track(makeHarness({ harnessDirs: ['ptah-harness-alpha'] }));
    breakSkill(h.pluginsBasePath, 'ptah-harness-alpha', 'broken');
    const pluginPath = path.join(h.pluginsBasePath, 'ptah-harness-alpha');

    h.service.discoverSkillsForPlugins([pluginPath]);
    h.service.discoverSkillsForPlugins([pluginPath]);
    h.service.discoverSkillsForPlugins([pluginPath]);

    expect(skipLines(h)).toHaveLength(1);
  });

  it('still skips the broken skill and still lists a healthy sibling', () => {
    const h = track(
      makeHarness({
        harnessDirs: ['ptah-harness-alpha'],
        skills: { 'ptah-harness-alpha': [{ dir: 'good' }] },
      }),
    );
    breakSkill(h.pluginsBasePath, 'ptah-harness-alpha', 'broken');
    const pluginPath = path.join(h.pluginsBasePath, 'ptah-harness-alpha');

    const skills = h.service.discoverSkillsForPlugins([pluginPath]);

    expect(skills.map((s) => s.skillId)).toEqual(['good']);
  });

  it('picks a repaired root back up, and reports it again if it breaks anew', () => {
    const h = track(makeHarness({ harnessDirs: ['ptah-harness-alpha'] }));
    const skillDir = breakSkill(
      h.pluginsBasePath,
      'ptah-harness-alpha',
      'broken',
    );
    const pluginPath = path.join(h.pluginsBasePath, 'ptah-harness-alpha');
    const skillMd = path.join(skillDir, 'SKILL.md');

    h.service.discoverSkillsForPlugins([pluginPath]);
    expect(skipLines(h)).toHaveLength(1);

    // Repaired: the scan is not cached, so it is picked up immediately.
    fs.writeFileSync(
      skillMd,
      '---\nname: "broken"\ndescription: "now readable"\n---\nbody\n',
      'utf-8',
    );
    const repaired = h.service.discoverSkillsForPlugins([pluginPath]);
    expect(repaired.map((s) => s.skillId)).toEqual(['broken']);
    expect(skipLines(h)).toHaveLength(1);

    // Broken again is a NEW fault, not the memoised one.
    fs.rmSync(skillMd, { force: true });
    h.service.discoverSkillsForPlugins([pluginPath]);
    expect(skipLines(h)).toHaveLength(2);
  });

  it('reports the skip at WARN, not DEBUG', () => {
    const h = track(makeHarness({ harnessDirs: ['ptah-harness-alpha'] }));
    breakSkill(h.pluginsBasePath, 'ptah-harness-alpha', 'broken');

    h.service.discoverSkillsForPlugins([
      path.join(h.pluginsBasePath, 'ptah-harness-alpha'),
    ]);

    expect(skipLines(h)).toHaveLength(1);
    expect(h.logger.debug).not.toHaveBeenCalledWith(
      expect.stringContaining('Skipping skill without a readable SKILL.md'),
      expect.anything(),
    );
  });
});

/**
 * TASK_2026_354 — a broken plugin is a STATE, not just a log line.
 *
 * `ptah-skillssh-oso95-scroll-world` has a `skills/scroll-world/` directory
 * with no `SKILL.md`. Before this, the only trace was one debug line and the
 * plugin rendered in the browser modal as an ordinary entry with
 * `skillCount: 0` — indistinguishable from a plugin that legitimately ships no
 * skills, and with nothing telling the user they could fix it by reinstalling.
 *
 * The plugin must still LIST. Hiding it would leave the user unable to
 * uninstall the thing that is failing.
 */
describe('PluginLoaderService.getAvailablePlugins — broken-plugin status', () => {
  function breakSkill(base: string, pluginId: string, slug: string): void {
    fs.mkdirSync(path.join(base, pluginId, 'skills', slug), {
      recursive: true,
    });
  }

  it('marks a harness plugin with an unreadable SKILL.md as broken, with the path', () => {
    const h = track(makeHarness({ harnessDirs: ['ptah-harness-alpha'] }));
    breakSkill(h.pluginsBasePath, 'ptah-harness-alpha', 'broken');

    const entry = h.service
      .getAvailablePlugins()
      .find((p) => p.id === 'ptah-harness-alpha');

    expect(entry).toBeDefined();
    expect(entry?.status).toBe('broken');
    expect(entry?.issues).toHaveLength(1);
    expect(entry?.issues?.[0].path).toBe(
      path.join(
        h.pluginsBasePath,
        'ptah-harness-alpha',
        'skills',
        'broken',
        'SKILL.md',
      ),
    );
    expect(entry?.issues?.[0].code).toBe('ENOENT');
    expect(entry?.issues?.[0].message).toEqual(expect.any(String));
  });

  it('marks a healthy plugin ok and sends no issues array', () => {
    const h = track(
      makeHarness({
        harnessDirs: ['ptah-harness-alpha'],
        skills: { 'ptah-harness-alpha': [{ dir: 'good' }] },
      }),
    );

    const entry = h.service
      .getAvailablePlugins()
      .find((p) => p.id === 'ptah-harness-alpha');

    expect(entry?.status).toBe('ok');
    // Omitted, not empty: the field means "here is what is wrong".
    expect(entry?.issues).toBeUndefined();
  });

  it('still lists the broken plugin, and its healthy siblings stay ok', () => {
    const h = track(
      makeHarness({
        harnessDirs: ['ptah-harness-alpha', 'ptah-harness-beta'],
        skills: { 'ptah-harness-beta': [{ dir: 'fine' }] },
      }),
    );
    breakSkill(h.pluginsBasePath, 'ptah-harness-alpha', 'broken');

    const plugins = h.service.getAvailablePlugins();
    const alpha = plugins.find((p) => p.id === 'ptah-harness-alpha');
    const beta = plugins.find((p) => p.id === 'ptah-harness-beta');

    // Uninstalling it is the user's remedy, so it must remain visible.
    expect(alpha).toBeDefined();
    expect(alpha?.status).toBe('broken');
    expect(beta?.status).toBe('ok');
  });

  it('reports every unreadable skill in a plugin, not just the first', () => {
    const h = track(makeHarness({ harnessDirs: ['ptah-harness-alpha'] }));
    breakSkill(h.pluginsBasePath, 'ptah-harness-alpha', 'broken-one');
    breakSkill(h.pluginsBasePath, 'ptah-harness-alpha', 'broken-two');

    const entry = h.service
      .getAvailablePlugins()
      .find((p) => p.id === 'ptah-harness-alpha');

    expect(
      entry?.issues?.map((issue) => path.basename(path.dirname(issue.path))),
    ).toEqual(expect.arrayContaining(['broken-one', 'broken-two']));
  });

  it('keeps reporting the status on repeat calls, even though the log dedupes', () => {
    const h = track(makeHarness({ harnessDirs: ['ptah-harness-alpha'] }));
    breakSkill(h.pluginsBasePath, 'ptah-harness-alpha', 'broken');

    h.service.getAvailablePlugins();
    // The log memo must not leak into the payload: a panel opened a second time
    // has to render the same broken badge as the first.
    const second = h.service
      .getAvailablePlugins()
      .find((p) => p.id === 'ptah-harness-alpha');

    expect(second?.status).toBe('broken');
    expect(second?.issues).toHaveLength(1);
  });

  it('clears the status once the skill becomes readable', () => {
    const h = track(makeHarness({ harnessDirs: ['ptah-harness-alpha'] }));
    breakSkill(h.pluginsBasePath, 'ptah-harness-alpha', 'broken');
    const skillMd = path.join(
      h.pluginsBasePath,
      'ptah-harness-alpha',
      'skills',
      'broken',
      'SKILL.md',
    );

    expect(
      h.service.getAvailablePlugins().find((p) => p.id === 'ptah-harness-alpha')
        ?.status,
    ).toBe('broken');

    fs.writeFileSync(
      skillMd,
      '---\nname: "broken"\ndescription: "now readable"\n---\nbody\n',
      'utf-8',
    );

    const repaired = h.service
      .getAvailablePlugins()
      .find((p) => p.id === 'ptah-harness-alpha');
    expect(repaired?.status).toBe('ok');
    expect(repaired?.skillCount).toBe(1);
  });
});

/**
 * Reading a workspace OTHER than the active one (TASK_2026_346).
 *
 * With two folders open, the harness reconciler builds a desired state per
 * ROOT while the injected `IStateStorage` is a proxy that answers for whichever
 * folder is ACTIVE. Reading the ambient scope while reconciling the other root
 * is what wrote one folder's overlay into the other's target directories and
 * reaped it again on the way back.
 */
describe('PluginLoaderService — reads scoped to a workspace root', () => {
  /**
   * A `WorkspaceAwareStateStorage`-shaped proxy, satisfied STRUCTURALLY.
   *
   * Hand-built rather than imported: the real class lives in `vscode-core` and
   * the point of `isWorkspaceScopedStateStorage` is that neither side imports
   * the other. If this object stops being accepted, the structural contract has
   * drifted and that is exactly what should fail.
   */
  function createWorkspaceAwareStorage(
    perRoot: Record<string, PluginConfigState>,
    activeRoot: string,
  ) {
    const stores = new Map<string, IStateStorage>();
    for (const [root, config] of Object.entries(perRoot)) {
      stores.set(path.resolve(root), createStateStorage(config));
    }
    const active = (): IStateStorage =>
      stores.get(path.resolve(activeRoot)) as IStateStorage;

    return {
      get: <T>(key: string, defaultValue?: T): T | undefined =>
        active().get<T>(key, defaultValue),
      update: (key: string, value: unknown): Promise<void> =>
        active().update(key, value),
      keys: (): readonly string[] => active().keys(),
      getStorageForWorkspace: (workspacePath: string) =>
        stores.get(workspacePath),
      getAllWorkspacePaths: () => [...stores.keys()],
    };
  }

  function config(overrides: Partial<PluginConfigState>): PluginConfigState {
    return {
      enabledPluginIds: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
      lastUpdated: undefined,
      ...overrides,
    };
  }

  interface ScopedHarness {
    service: PluginLoaderService;
    logger: MockLogger;
    rootA: string;
    rootB: string;
  }

  function makeScopedHarness(): ScopedHarness {
    const pluginsBasePath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ptah-scoped-plugins-'),
    );
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-scoped-wsA-'));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-scoped-wsB-'));
    created.push(pluginsBasePath, rootA, rootB);

    // One workspace-scoped harness plugin per folder, so `{ws}/.ptah/plugins`
    // is a real difference between them and not just a config difference.
    for (const [root, id] of [
      [rootA, 'ptah-harness-only-a'],
      [rootB, 'ptah-harness-only-b'],
    ] as const) {
      fs.mkdirSync(path.join(root, '.ptah', 'plugins', id), {
        recursive: true,
      });
    }

    const logger = createMockLogger();
    const externalStore = new ExternalPluginStateStore();
    externalStore.initialize(pluginsBasePath);
    const service = new PluginLoaderService(
      logger as unknown as Logger,
      externalStore,
      // The provider reports A: A is the ACTIVE folder throughout.
      createWorkspaceProvider(rootA) as never,
    );
    service.initialize(
      pluginsBasePath,
      createWorkspaceAwareStorage(
        {
          [rootA]: config({ disabledSkillIds: ['a-only-skill'] }),
          [rootB]: config({ disabledSkillIds: ['b-only-skill'] }),
        },
        rootA,
      ) as unknown as IStateStorage,
    );

    return { service, logger, rootA, rootB };
  }

  it("[346/4] returns B's persisted config while A is active, and A's when asked for A", () => {
    const h = makeScopedHarness();

    expect(
      h.service.getWorkspacePluginConfig(h.rootB).disabledSkillIds,
    ).toEqual(['b-only-skill']);
    expect(h.service.getDisabledSkillIds(h.rootB)).toEqual(['b-only-skill']);
    expect(
      h.service.getWorkspacePluginConfig(h.rootA).disabledSkillIds,
    ).toEqual(['a-only-skill']);
  });

  it("[560] a root that names B through a symlink still reads B's config, never the empty default", () => {
    const h = makeScopedHarness();
    const linkParent = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ptah-scoped-link-'),
    );
    created.push(linkParent);
    const link = path.join(linkParent, 'ws-b-link');
    // `junction` needs no elevation on win32 and is ignored elsewhere.
    fs.symlinkSync(h.rootB, link, 'junction');

    // The capability resolver asks with one spelling of the root and the host
    // registered another; a miss would read as "nothing switched off".
    expect(h.service.getWorkspacePluginConfig(link).disabledSkillIds).toEqual([
      'b-only-skill',
    ]);
  });

  it('[346/4] a no-argument call still answers for the ACTIVE workspace, exactly as before', () => {
    const h = makeScopedHarness();

    // The whole point of the argument being optional: every user-facing caller
    // means "the folder the user is looking at" and must be unaffected.
    expect(h.service.getWorkspacePluginConfig().disabledSkillIds).toEqual([
      'a-only-skill',
    ]);
    expect(h.service.getDisabledSkillIds()).toEqual(['a-only-skill']);
  });

  it('[346/4] an unregistered root reads as the default empty config, never as the active one', () => {
    const h = makeScopedHarness();
    const stranger = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ptah-scoped-none-'),
    );
    created.push(stranger);

    const answer = h.service.getWorkspacePluginConfig(stranger);

    expect(answer).toEqual({
      enabledPluginIds: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
      disabledAgentIds: [],
      lastUpdated: undefined,
    });
    // The failure this pins: answering with A's config under B's name is worse
    // than answering with nothing, because the caller cannot tell.
    expect(answer.disabledSkillIds).not.toContain('a-only-skill');
  });

  it("[346/4] resolveCurrentPluginPaths(rootB) scans B's {ws}/.ptah/plugins, not the active folder's", () => {
    const h = makeScopedHarness();

    expect(h.service.resolveCurrentPluginPaths(h.rootB)).toEqual([
      path.join(h.rootB, '.ptah', 'plugins', 'ptah-harness-only-b'),
    ]);
    expect(h.service.resolveCurrentPluginPaths(h.rootA)).toEqual([
      path.join(h.rootA, '.ptah', 'plugins', 'ptah-harness-only-a'),
    ]);
    // And with no argument, the active folder — unchanged behaviour.
    expect(h.service.resolveCurrentPluginPaths()).toEqual([
      path.join(h.rootA, '.ptah', 'plugins', 'ptah-harness-only-a'),
    ]);
  });

  it('[346/4] a single-scope storage answers for every root, so a one-workspace host is untouched', () => {
    const h = track(
      makeHarness({
        openWorkspace: true,
        workspaceHarnessDirs: ['ptah-harness-solo'],
        disabledSkillIds: ['only-one-config'],
      }),
    );
    const root = h.workspaceRoot as string;

    // `createStateStorage` is a plain `IStateStorage`: no
    // `getStorageForWorkspace`, so the probe says "one scope" and the injected
    // storage IS the answer. The CLI and the VS Code extension are this case.
    expect(h.service.getDisabledSkillIds(root)).toEqual(['only-one-config']);
    expect(h.service.getDisabledSkillIds()).toEqual(['only-one-config']);
    expect(h.service.resolveCurrentPluginPaths(root)).toEqual([
      wsPlugin(h, 'ptah-harness-solo'),
    ]);
  });
});

describe('PluginLoaderService — harness-root configuration home (D14)', () => {
  const CONFIG_KEY = 'ptah.plugins.config';

  type MapStorage = IStateStorage & { raw: Map<string, unknown> };

  function mapStorage(initial?: unknown): MapStorage {
    const raw = new Map<string, unknown>();
    if (initial !== undefined) raw.set(CONFIG_KEY, initial);
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

  /** Global storage whose writes can be failed or held open. */
  function createHomeStorage() {
    const raw = new Map<string, unknown>();
    const writes: Array<{ key: string; value: unknown }> = [];
    let failures = 0;
    let gate: Promise<void> | null = null;
    const storage: IStateStorage = {
      get: <T>(key: string, defaultValue?: T): T | undefined =>
        raw.has(key) ? (raw.get(key) as T) : defaultValue,
      update: async (key: string, value: unknown): Promise<void> => {
        writes.push({ key, value });
        if (gate !== null) await gate;
        if (failures > 0) {
          failures -= 1;
          throw new Error('disk full');
        }
        raw.set(key, value);
      },
      keys: (): readonly string[] => [...raw.keys()],
    };
    return {
      storage,
      raw,
      writes,
      failNextWrites(count: number): void {
        failures = count;
      },
      /** Hold every write until the returned release is called. */
      hold(): () => void {
        let release: () => void = () => undefined;
        gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        return () => {
          gate = null;
          release();
        };
      },
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

  /** Every microtask and the write chains behind them have run. */
  const flush = (): Promise<void> =>
    new Promise<void>((resolve) => setImmediate(resolve));

  interface HomeEnv {
    service: PluginLoaderService;
    logger: MockLogger;
    repo: string;
    a: string;
    b: string;
    nested: string;
    folders: Map<string, MapStorage>;
    home: ReturnType<typeof createHomeStorage>;
    open(folder: string, config?: unknown): void;
    close(folder: string): void;
    setActive(folder: string): void;
    /** The home record of `root` (the repository by default). */
    record(root?: string): unknown;
    /** The stored folder config of `folder`. */
    folderConfig(folder: string): unknown;
  }

  function makeHomeEnv(options: { withHome?: boolean } = {}): HomeEnv {
    const pluginsBasePath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ptah-home-plugins-'),
    );
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-home-repo-'));
    created.push(pluginsBasePath, repo);
    const a = path.join(repo, 'a');
    const b = path.join(repo, 'b');
    const nested = path.join(repo, 'nested');
    for (const dir of [a, b, nested]) fs.mkdirSync(dir, { recursive: true });

    const folders = new Map<string, MapStorage>();
    let active = a;
    const activeStorage = (): MapStorage => {
      const storage = folders.get(path.resolve(active));
      if (storage === undefined) throw new Error('no active folder storage');
      return storage;
    };
    const scoped = {
      get: <T>(key: string, defaultValue?: T): T | undefined =>
        folders.get(path.resolve(active))?.get<T>(key, defaultValue),
      update: (key: string, value: unknown): Promise<void> =>
        activeStorage().update(key, value),
      keys: (): readonly string[] =>
        folders.get(path.resolve(active))?.keys() ?? [],
      getStorageForWorkspace: (workspacePath: string) =>
        folders.get(workspacePath),
      getAllWorkspacePaths: () => [...folders.keys()],
    };

    // `nested` is its own repository; everything else belongs to `repo`.
    const nestedKey = canonicalRootKey(nested);
    const harnessRootOf = (folder: string): string => {
      const key = canonicalRootKey(folder);
      return key === nestedKey || key.startsWith(nestedKey + path.sep)
        ? nested
        : repo;
    };

    const home = createHomeStorage();
    const logger = createMockLogger();
    const externalStore = new ExternalPluginStateStore();
    externalStore.initialize(pluginsBasePath);
    const service = new PluginLoaderService(
      logger as unknown as Logger,
      externalStore,
      { getWorkspaceRoot: () => active } as never,
    );
    service.initialize(
      pluginsBasePath,
      scoped as unknown as IStateStorage,
      options.withHome === false
        ? {}
        : { harnessRootOf, homeStorage: home.storage },
    );

    return {
      service,
      logger,
      repo,
      a,
      b,
      nested,
      folders,
      home,
      open(folder, config) {
        folders.set(path.resolve(folder), mapStorage(config));
      },
      close(folder) {
        folders.delete(path.resolve(folder));
      },
      setActive(folder) {
        active = folder;
      },
      record(root = repo) {
        return home.raw.get(
          `${PLUGIN_CONFIG_HOME_KEY_PREFIX}${canonicalRootKey(root)}`,
        );
      },
      folderConfig(folder) {
        return folders.get(path.resolve(folder))?.raw.get(CONFIG_KEY);
      },
    };
  }

  function seedRecord(env: HomeEnv, config: unknown): void {
    env.home.raw.set(
      `${PLUGIN_CONFIG_HOME_KEY_PREFIX}${canonicalRootKey(env.repo)}`,
      {
        version: 1,
        harnessRoot: path.resolve(env.repo),
        config,
        origin: 'saved',
        sourceFolders: [],
        dismissed: {},
      },
    );
  }

  const withoutStamp = (config: unknown): PluginConfigState => ({
    ...(config as PluginConfigState),
    lastUpdated: undefined,
  });

  it('home inactive: a single-scope storage with both options reads and saves exactly as without them', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-home-single-'));
    const pluginsBasePath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ptah-home-single-plugins-'),
    );
    created.push(root, pluginsBasePath);
    const stored = cfg({ disabledSkillIds: ['x'], lastUpdated: 't1' });
    const make = (withOptions: boolean) => {
      const storage = mapStorage(stored);
      const home = createHomeStorage();
      const externalStore = new ExternalPluginStateStore();
      externalStore.initialize(pluginsBasePath);
      const service = new PluginLoaderService(
        createMockLogger() as unknown as Logger,
        externalStore,
        createWorkspaceProvider(root) as never,
      );
      service.initialize(
        pluginsBasePath,
        storage,
        withOptions
          ? { harnessRootOf: () => root, homeStorage: home.storage }
          : {},
      );
      return { service, storage, home };
    };
    const plain = make(false);
    const withOptions = make(true);

    for (const target of [undefined, root, path.join(root, 'elsewhere')]) {
      expect(withOptions.service.getWorkspacePluginConfig(target)).toEqual(
        plain.service.getWorkspacePluginConfig(target),
      );
      expect(
        (await withOptions.service.getEffectivePluginConfig(target)).config,
      ).toEqual((await plain.service.getEffectivePluginConfig(target)).config);
    }

    const payload = { enabledPluginIds: ['ptah-core'], disabledSkillIds: [] };
    await plain.service.saveWorkspacePluginConfig(payload);
    await withOptions.service.saveWorkspacePluginConfig(payload);
    expect(withoutStamp(withOptions.storage.get(CONFIG_KEY))).toEqual(
      withoutStamp(plain.storage.get(CONFIG_KEY)),
    );
    expect(withOptions.home.writes).toEqual([]);
    expect(withOptions.service.getConfigHomeStatus()).toBeNull();
    await expect(
      withOptions.service.adoptFolderConfig(root, root),
    ).rejects.toBeInstanceOf(SdkError);
  });

  it('home inactive: workspace-scoped storage without options keeps per-folder reads', () => {
    const env = makeHomeEnv({ withHome: false });
    env.open(env.a, cfg({ disabledSkillIds: ['a-skill'] }));
    env.open(env.b, cfg({ disabledSkillIds: ['b-skill'] }));

    expect(
      env.service.getWorkspacePluginConfig(env.b).disabledSkillIds,
    ).toEqual(['b-skill']);
    expect(env.service.hasWorkspaceState(env.repo)).toBe(false);
    expect(env.service.getConfigHomeStatus(env.a)).toBeNull();
    expect(env.home.writes).toEqual([]);
  });

  it('sole legacy config in a sub-folder, empty home: the read returns it and the record is imported once (idempotent)', async () => {
    const env = makeHomeEnv();
    const legacy = cfg({
      disabledSkillIds: ['s1'],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    });
    env.open(env.a, legacy);

    expect(env.service.getWorkspacePluginConfig(env.a)).toEqual(legacy);
    await flush();
    expect(env.home.writes).toHaveLength(1);
    expect(env.record()).toMatchObject({
      version: 1,
      origin: 'imported',
      sourceFolders: [path.resolve(env.a)],
      config: { disabledSkillIds: ['s1'] },
    });
    expect(env.service.getConfigHomeStatus(env.a)).toMatchObject({
      harnessRoot: path.resolve(env.repo),
      state: 'imported',
    });

    env.service.getWorkspacePluginConfig(env.a);
    env.service.getWorkspacePluginConfig(env.b);
    env.service.getWorkspacePluginConfig();
    await flush();
    expect(env.home.writes).toHaveLength(1);
    // The folder record is read only.
    expect(env.folderConfig(env.a)).toEqual(legacy);

    // The import notice is dismissible.
    await env.service.dismissFolderConfig(env.repo, env.a);
    expect(env.service.getConfigHomeStatus(env.a)).toBeNull();
  });

  it('an intentionally saved empty config is present: it is imported as empty, not treated as absent', async () => {
    const env = makeHomeEnv();
    const empty = cfg({ lastUpdated: '2026-02-01T00:00:00.000Z' });
    env.open(env.a, empty);

    expect(env.service.getWorkspacePluginConfig(env.b)).toEqual(empty);
    await flush();
    expect(env.record()).toMatchObject({ origin: 'imported', config: empty });

    // Beside a non-empty sibling it is a real, different choice.
    const other = makeHomeEnv();
    other.open(other.a, empty);
    other.open(
      other.b,
      cfg({
        disabledSkillIds: ['s2'],
        lastUpdated: '2026-01-01T00:00:00.000Z',
      }),
    );
    expect(other.service.getConfigHomeStatus(other.b)).toMatchObject({
      state: 'conflict',
      governingFolder: path.resolve(other.a),
    });
    expect(
      other.service.getWorkspacePluginConfig(other.b).disabledSkillIds,
    ).toEqual([]);
  });

  it('home present and empty, sibling holds a non-empty config: the home governs, state differs, sibling bytes unchanged', async () => {
    const env = makeHomeEnv();
    seedRecord(env, cfg());
    const sibling = cfg({ disabledPluginIds: ['p'], lastUpdated: 't' });
    env.open(env.a, sibling);

    expect(env.service.getWorkspacePluginConfig(env.a)).toEqual(cfg());
    expect(env.service.getConfigHomeStatus(env.a)).toEqual({
      harnessRoot: path.resolve(env.repo),
      state: 'differs',
      candidates: [
        {
          folder: path.resolve(env.a),
          lastUpdated: 't',
          enabledCount: 0,
          disabledCount: 1,
          differsFromHome: true,
        },
      ],
    });
    await flush();
    expect(env.home.writes).toEqual([]);
    expect(env.folderConfig(env.a)).toEqual(sibling);
  });

  describe('repo/a and repo/b open at once with conflicting lists', () => {
    const configA = cfg({
      enabledPluginIds: ['ptah-core'],
      disabledSkillIds: ['x'],
      lastUpdated: '2026-03-01T00:00:00.000Z',
    });
    const configB = cfg({
      enabledPluginIds: ['ptah-angular'],
      disabledPluginIds: ['ptah-harness-z'],
      lastUpdated: '2026-04-01T00:00:00.000Z',
    });

    function conflictEnv(): HomeEnv {
      const env = makeHomeEnv();
      env.open(env.a, configA);
      env.open(env.b, configB);
      return env;
    }

    it('reports a conflict, reads the later lastUpdated everywhere and writes nothing', async () => {
      const env = conflictEnv();

      for (const target of [env.a, env.b, env.repo, undefined]) {
        expect(env.service.getWorkspacePluginConfig(target)).toEqual(configB);
      }
      expect(env.service.getConfigHomeStatus(env.a)).toMatchObject({
        state: 'conflict',
        governingFolder: path.resolve(env.b),
        candidates: [
          { folder: path.resolve(env.a), differsFromHome: true },
          { folder: path.resolve(env.b), differsFromHome: false },
        ],
      });
      await flush();
      expect(env.home.writes).toEqual([]);
      expect(env.folderConfig(env.a)).toEqual(configA);
      expect(env.folderConfig(env.b)).toEqual(configB);
    });

    it('a tie on lastUpdated goes to the lowest folder key', () => {
      const env = makeHomeEnv();
      env.open(env.a, { ...configA, lastUpdated: 'same' });
      env.open(env.b, { ...configB, lastUpdated: 'same' });

      expect(env.service.getConfigHomeStatus(env.b)?.governingFolder).toBe(
        path.resolve(env.a),
      );
      expect(
        env.service.getWorkspacePluginConfig(env.b).enabledPluginIds,
      ).toEqual(['ptah-core']);
    });

    it('adopt(repo/b) makes the home equal b exactly (no union) and a then shows as differs', async () => {
      const env = conflictEnv();

      await env.service.adoptFolderConfig(env.repo, env.b);

      expect(env.record()).toMatchObject({
        origin: 'adopted',
        sourceFolders: [path.resolve(env.b)],
        config: configB,
      });
      expect(env.service.getWorkspacePluginConfig(env.a)).toEqual(configB);
      expect(env.service.getConfigHomeStatus(env.a)).toMatchObject({
        state: 'differs',
        candidates: [
          { folder: path.resolve(env.a), differsFromHome: true },
          { folder: path.resolve(env.b), differsFromHome: false },
        ],
      });
    });

    it('dismiss(repo/a) hides its notice until the lastUpdated of a changes', async () => {
      const env = conflictEnv();
      await env.service.adoptFolderConfig(env.repo, env.b);

      await env.service.dismissFolderConfig(env.repo, env.a);
      expect(env.service.getConfigHomeStatus(env.a)).toBeNull();

      env.open(env.a, { ...configA, lastUpdated: '2026-05-01T00:00:00.000Z' });
      expect(env.service.getConfigHomeStatus(env.a)?.state).toBe('differs');
    });

    it('dismiss is refused while the folders conflict; a conflict is resolved by adopting', async () => {
      const env = conflictEnv();
      await expect(
        env.service.dismissFolderConfig(env.repo, env.a),
      ).rejects.toBeInstanceOf(SdkError);
      expect(env.home.writes).toEqual([]);
    });

    it('adopt rejects a folder that holds no config under the root', async () => {
      const env = conflictEnv();
      env.open(env.nested, configA);
      await expect(
        env.service.adoptFolderConfig(env.repo, env.nested),
      ).rejects.toBeInstanceOf(SdkError);
      await expect(
        env.service.adoptFolderConfig(env.repo, path.join(env.repo, 'c')),
      ).rejects.toBeInstanceOf(SdkError);
      expect(env.home.writes).toEqual([]);
    });

    it('a save during the conflict creates the record from the payload; the other folders show as differs', async () => {
      const env = conflictEnv();

      await env.service.saveWorkspacePluginConfig(
        { enabledPluginIds: ['ptah-react'], disabledSkillIds: [] },
        env.a,
      );

      expect(env.record()).toMatchObject({
        origin: 'saved',
        config: { enabledPluginIds: ['ptah-react'], disabledSkillIds: [] },
      });
      expect(env.service.getConfigHomeStatus(env.b)).toMatchObject({
        state: 'differs',
        candidates: [
          { folder: path.resolve(env.a), differsFromHome: true },
          { folder: path.resolve(env.b), differsFromHome: true },
        ],
      });
      expect(env.folderConfig(env.a)).toEqual(configA);
      expect(env.folderConfig(env.b)).toEqual(configB);
    });
  });

  it('transitions keep the home: active folder change, an earlier sibling, closing the imported folder, opening the root', async () => {
    const env = makeHomeEnv();
    const governing = cfg({ disabledSkillIds: ['kept'], lastUpdated: 't-b' });
    env.open(env.b, governing);
    env.setActive(env.b);
    expect(env.service.getWorkspacePluginConfig()).toEqual(governing);
    await flush();
    expect(env.record()).toMatchObject({ origin: 'imported' });

    // A lexically earlier sibling with its own saved settings opens.
    env.open(env.a, cfg({ disabledSkillIds: ['other'], lastUpdated: 't-a' }));
    expect(
      env.service.getWorkspacePluginConfig(env.a).disabledSkillIds,
    ).toEqual(['kept']);
    // The active folder changes.
    env.setActive(env.a);
    expect(env.service.getWorkspacePluginConfig().disabledSkillIds).toEqual([
      'kept',
    ]);
    // The imported folder closes.
    env.close(env.b);
    expect(
      env.service.getWorkspacePluginConfig(env.a).disabledSkillIds,
    ).toEqual(['kept']);
    // The repository root itself opens.
    env.open(env.repo);
    env.setActive(env.repo);
    expect(env.service.getWorkspacePluginConfig().disabledSkillIds).toEqual([
      'kept',
    ]);

    await flush();
    expect(env.home.writes).toHaveLength(1);
  });

  it('an import write that fails leaves reads on the folder config and is retried on the next read', async () => {
    const env = makeHomeEnv();
    const legacy = cfg({ disabledSkillIds: ['s1'], lastUpdated: 't' });
    env.open(env.a, legacy);
    env.home.failNextWrites(1);

    expect(env.service.getWorkspacePluginConfig(env.a)).toEqual(legacy);
    await flush();
    expect(env.record()).toBeUndefined();
    expect(env.service.getConfigHomeStatus(env.a)).toBeNull();
    expect(env.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('import failed'),
      expect.objectContaining({ harnessRoot: path.resolve(env.repo) }),
    );

    expect(env.service.getWorkspacePluginConfig(env.a)).toEqual(legacy);
    await flush();
    expect(env.home.writes).toHaveLength(2);
    expect(env.record()).toMatchObject({ origin: 'imported' });
  });

  it('a save write that fails throws SdkError and leaves the record unchanged', async () => {
    const env = makeHomeEnv();
    env.open(env.a);
    seedRecord(env, cfg({ disabledSkillIds: ['before'] }));
    const before = env.record();
    env.home.failNextWrites(1);

    await expect(
      env.service.saveWorkspacePluginConfig(
        { enabledPluginIds: ['ptah-core'], disabledSkillIds: [] },
        env.a,
      ),
    ).rejects.toBeInstanceOf(SdkError);
    expect(env.record()).toBe(before);
  });

  it('a concurrent save during a pending import is serialized after it and wins without losing a list', async () => {
    const env = makeHomeEnv();
    env.open(
      env.a,
      cfg({
        disabledSkillIds: ['s1'],
        disabledAgentIds: ['agent-1'],
        lastUpdated: 't',
      }),
    );
    const release = env.home.hold();

    env.service.getWorkspacePluginConfig(env.a);
    const save = env.service.saveWorkspacePluginConfig(
      { enabledPluginIds: ['ptah-core'], disabledSkillIds: ['s1', 's2'] },
      env.a,
    );
    await flush();
    expect(env.home.writes).toHaveLength(1);

    release();
    await save;
    await flush();
    expect(
      env.home.writes.map(
        (write) => (write.value as { origin: string }).origin,
      ),
    ).toEqual(['imported', 'saved']);
    expect(env.record()).toMatchObject({
      origin: 'saved',
      config: {
        enabledPluginIds: ['ptah-core'],
        disabledSkillIds: ['s1', 's2'],
        disabledAgentIds: ['agent-1'],
      },
    });
  });

  it('a nested repository (another harness root) is never a candidate', async () => {
    const env = makeHomeEnv();
    env.open(env.a, cfg({ disabledSkillIds: ['outer'], lastUpdated: 't' }));
    env.open(
      env.nested,
      cfg({ disabledSkillIds: ['inner'], lastUpdated: 't' }),
    );

    expect(
      env.service.getWorkspacePluginConfig(env.a).disabledSkillIds,
    ).toEqual(['outer']);
    expect(
      env.service.getWorkspacePluginConfig(env.nested).disabledSkillIds,
    ).toEqual(['inner']);
    await flush();
    expect(env.record()).toMatchObject({
      sourceFolders: [path.resolve(env.a)],
    });
    expect(env.record(env.nested)).toMatchObject({
      sourceFolders: [path.resolve(env.nested)],
    });
    expect(
      env.service
        .getConfigHomeStatus(env.a)
        ?.candidates.map((candidate) => candidate.folder),
    ).toEqual([path.resolve(env.a)]);
  });

  it('hasWorkspaceState is true for a sub-folder and for the harness root when the home is active', () => {
    const env = makeHomeEnv();
    env.open(env.a);

    expect(env.service.hasWorkspaceState(env.a)).toBe(true);
    expect(env.service.hasWorkspaceState(env.repo)).toBe(true);
    expect(env.service.hasWorkspaceState(env.b)).toBe(true);
  });

  it('a malformed home record makes the strict read an error and the lenient read the empty default', async () => {
    const env = makeHomeEnv();
    env.open(env.a, cfg({ disabledSkillIds: ['s1'], lastUpdated: 't' }));
    seedRecord(env, 'garbage');

    expect(env.service.getWorkspacePluginConfig(env.a)).toEqual(
      cfg({ lastUpdated: undefined }),
    );
    await expect(
      env.service.getEffectivePluginConfig(env.a),
    ).rejects.toBeInstanceOf(SdkError);
    expect(env.service.getConfigHomeStatus(env.a)).toBeNull();
    await flush();
    expect(env.home.writes).toEqual([]);
  });
});

describe('PluginLoaderService — plugin source descriptors and contents', () => {
  it('describes all four families, keeping two externals with one basename apart', async () => {
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core'],
        harnessDirs: [
          'ptah-harness-release-notes',
          'ptah-skillssh-acme-tailwind-v4',
        ],
        workspaceHarnessDirs: ['ptah-harness-local'],
      }),
    );
    for (const [pluginId, source, displayName] of [
      ['external:acme/toolkit/toolkit', 'acme/toolkit', 'Acme Toolkit'],
      ['external:beta/plugins/toolkit', 'beta/plugins', 'Beta Toolkit'],
    ]) {
      await h.externalStore.recordInstall({
        ...externalRecord(pluginId, 'toolkit'),
        source,
        displayName,
      });
    }

    const descriptors = h.service.getPluginSourceDescriptors();
    const names = new Map(
      h.service.getAvailablePlugins().map((plugin) => [plugin.id, plugin.name]),
    );
    const base = h.pluginsBasePath;

    expect(descriptors[path.join(base, 'ptah-core')]).toEqual({
      sourceRef: 'ptah:ptah-core',
      label: names.get('ptah-core'),
    });
    expect(descriptors[path.join(base, 'ptah-harness-release-notes')]).toEqual({
      sourceRef: 'harness:ptah-harness-release-notes',
      label: 'Release Notes',
    });
    expect(descriptors[wsPlugin(h, 'ptah-harness-local')]).toEqual({
      sourceRef: 'harness:ptah-harness-local',
      label: 'Local',
    });
    expect(
      descriptors[path.join(base, 'ptah-skillssh-acme-tailwind-v4')],
    ).toEqual({
      sourceRef: 'skills-sh:ptah-skillssh-acme-tailwind-v4',
      label: names.get('ptah-skillssh-acme-tailwind-v4'),
    });
    expect(
      descriptors[path.join(base, 'external', 'acme', 'toolkit', 'toolkit')],
    ).toEqual({
      sourceRef: 'external:acme/toolkit/toolkit',
      label: 'Acme Toolkit',
    });
    expect(
      descriptors[path.join(base, 'external', 'beta', 'plugins', 'toolkit')],
    ).toEqual({
      sourceRef: 'external:beta/plugins/toolkit',
      label: 'Beta Toolkit',
    });
  });

  it('carries agent, skill and command names and counts listed from disk', () => {
    const h = track(
      makeHarness({
        bundledDirs: ['ptah-core'],
        skills: {
          'ptah-harness-kit': [{ dir: 'b-skill' }, { dir: 'a-skill' }],
        },
      }),
    );
    const kit = path.join(h.pluginsBasePath, 'ptah-harness-kit');
    fs.mkdirSync(path.join(kit, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(kit, 'commands'), { recursive: true });
    fs.writeFileSync(path.join(kit, 'agents', 'reviewer.md'), 'r', 'utf-8');
    fs.writeFileSync(path.join(kit, 'agents', 'architect.md'), 'a', 'utf-8');
    fs.writeFileSync(path.join(kit, 'agents', 'notes.txt'), 'n', 'utf-8');
    fs.writeFileSync(path.join(kit, 'commands', 'ship.md'), 's', 'utf-8');

    const plugins = h.service.getAvailablePlugins();

    expect(
      plugins.find((plugin) => plugin.id === 'ptah-harness-kit'),
    ).toMatchObject({
      skillCount: 2,
      skillNames: ['a-skill', 'b-skill'],
      agentCount: 2,
      agentNames: ['architect', 'reviewer'],
      commandCount: 1,
      commandNames: ['ship'],
    });
    // A bundled plugin that has not downloaded claims no contents.
    expect(
      plugins.find((plugin) => plugin.id === 'ptah-core'),
    ).not.toHaveProperty('agentNames');
  });
});
