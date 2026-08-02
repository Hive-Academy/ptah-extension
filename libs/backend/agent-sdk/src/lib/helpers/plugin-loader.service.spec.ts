/**
 * PluginLoaderService — plugin path resolution.
 *
 * Focus: the split between the two resolvers.
 *
 * - `resolvePluginPaths(ids)` stays bundled-only. It seeds the user-layer mirror
 *   (`mirrorUserLayer`) and the SDK session `plugins` option, where harness dirs
 *   would change ownership semantics.
 * - `resolveCurrentPluginPaths()` is the junction-feeding path and additionally
 *   discovers `{pluginsBasePath}/ptah-harness-*`. Without those entries,
 *   SkillJunctionService.removeStaleJunctions deletes every harness-authored
 *   skill junction whenever the user toggles a plugin in the marketplace.
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

import { PluginLoaderService } from './plugin-loader.service';

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
}

function makeHarness(options: {
  bundledDirs?: string[];
  harnessDirs?: string[];
  /** Files (not directories) created directly under the plugins base path. */
  strayFiles?: string[];
  enabledPluginIds?: string[];
  disabledSkillIds?: string[];
  /** Skip creating the plugins base directory entirely (ENOENT path). */
  omitBasePath?: boolean;
}): Harness {
  const pluginsBasePath = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ptah-plugin-loader-'),
  );

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
  }

  const logger = createMockLogger();
  const service = new PluginLoaderService(logger as unknown as Logger);
  service.initialize(
    pluginsBasePath,
    createStateStorage({
      enabledPluginIds: options.enabledPluginIds ?? [],
      disabledSkillIds: options.disabledSkillIds ?? [],
      lastUpdated: undefined,
    }),
  );

  return { service, logger, pluginsBasePath };
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
  return h;
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
    const service = new PluginLoaderService(logger as unknown as Logger);

    expect(service.discoverHarnessPluginPaths()).toEqual([]);
  });
});

describe('PluginLoaderService.resolvePluginPaths (bundled-only — unchanged)', () => {
  it('resolves enabled bundled plugin IDs and never appends harness dirs', () => {
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
        'ptah-harness-alpha', // harness dirs are not addressable by ID
      ]),
    ).toEqual([path.join(h.pluginsBasePath, 'ptah-core')]);
  });

  it('returns an empty array with no enabled plugins even when harness dirs exist', () => {
    const h = track(makeHarness({ harnessDirs: ['ptah-harness-alpha'] }));

    expect(h.service.resolvePluginPaths([])).toEqual([]);
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
    // must still hand the harness dirs to SkillJunctionService, or every
    // harness-authored junction is pruned as stale.
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
});
