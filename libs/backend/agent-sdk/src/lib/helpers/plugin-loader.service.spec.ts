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

  function skipLines(h: Harness): unknown[][] {
    return h.logger.debug.mock.calls.filter(
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
});
