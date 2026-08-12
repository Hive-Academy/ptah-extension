/**
 * GATE 1 (TASK_2026_181, Batch 8) — `tasks.savedViews` must reach
 * `~/.ptah/settings.json` on the VS Code path.
 *
 * ## Why this spec exists at all
 *
 * `VscodeSettingsAdapter.writeGlobal` has two destinations and picks between
 * them with `isFileBasedSettingKey`. If `'tasks.savedViews'` is missing from
 * `FILE_BASED_SETTINGS_KEYS`, the write goes to
 * `vscode.workspace.getConfiguration('ptah').update(...)` instead — and VS Code
 * has no `package.json contributes.configuration` schema for that key, so it
 * discards the value. No throw, no warning, no log. The user saves a view, the
 * UI reports success, and the view is simply gone on the next launch.
 *
 * A unit test asserting `FILE_BASED_SETTINGS_KEYS.has('tasks.savedViews')` would
 * pass without proving any of that. This spec therefore drives the REAL objects
 * — the real `PtahFileSettingsManager` over a real temp directory, the real
 * `VscodeSettingsAdapter`, the real `TasksSettings` repository — and asserts the
 * bytes on disk.
 *
 * The `vscode` double is rigged to THROW on `update`. That is the load-bearing
 * half: it turns the silent failure into a loud one, so this spec fails if the
 * routing entry is ever removed rather than quietly testing nothing.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  PtahFileSettingsManager,
  FILE_BASED_SETTINGS_DEFAULTS,
} from '@ptah-extension/platform-core';
import type { IMasterKeyProvider } from '@ptah-extension/platform-core';
import { SecretsFileStore, TasksSettings } from '@ptah-extension/settings-core';

import {
  VscodeSettingsAdapter,
  type VscodeApiSlice,
} from './vscode-settings-adapter';
import type { VscodeWorkspaceProvider } from '../implementations/vscode-workspace-provider';

/**
 * A `vscode` module that fails loudly if anything routes to it.
 *
 * In production this call silently succeeds and drops the value; here it
 * throws, so a lost routing entry surfaces as a failing test rather than as a
 * green suite and a bug report six weeks later.
 */
function createHostileVscodeModule(): VscodeApiSlice {
  return {
    workspace: {
      getConfiguration: () => ({
        get: <T>(key: string): T | undefined => {
          throw new Error(
            `Routed '${key}' to vscode.workspace.getConfiguration — it has no ` +
              `schema for this key and the value would be silently lost. ` +
              `Add the key to FILE_BASED_SETTINGS_KEYS.`,
          );
        },
        update: (key: string): Thenable<void> => {
          throw new Error(
            `Routed a WRITE of '${key}' to vscode.workspace.getConfiguration — ` +
              `the value would be silently discarded. Add the key to ` +
              `FILE_BASED_SETTINGS_KEYS.`,
          );
        },
      }),
      onDidChangeConfiguration: () => ({ dispose: () => undefined }),
    },
    ConfigurationTarget: { Global: 1 },
  };
}

describe('Gate 1 — tasks.* settings route to ~/.ptah/settings.json', () => {
  let ptahDir: string;
  let fileSettings: PtahFileSettingsManager;
  let adapter: VscodeSettingsAdapter;
  let tasks: TasksSettings;

  beforeEach(() => {
    ptahDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-gate1-'));
    fileSettings = new PtahFileSettingsManager(
      FILE_BASED_SETTINGS_DEFAULTS,
      ptahDir,
    );
    adapter = new VscodeSettingsAdapter(
      { fileSettings } as unknown as VscodeWorkspaceProvider,
      createHostileVscodeModule(),
      {
        getMasterKey: async () => Buffer.alloc(32),
      } as unknown as IMasterKeyProvider,
      new SecretsFileStore(ptahDir),
    );
    tasks = new TasksSettings(adapter);
  });

  afterEach(() => {
    fs.rmSync(ptahDir, { recursive: true, force: true });
  });

  /** The settings file as it actually sits on disk, nested exactly as written. */
  function readSettingsFile(): Record<string, unknown> {
    const raw = fs.readFileSync(path.join(ptahDir, 'settings.json'), 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  }

  it('writes tasks.savedViews into settings.json on disk', async () => {
    const view = {
      id: 'view-1',
      name: 'In progress',
      filter: { statuses: ['in_progress'] },
      sort: { field: 'updated', direction: 'desc' },
      order: 0,
    };

    await tasks.savedViews.set([view]);

    const onDisk = readSettingsFile();
    // The manager unflattens dot keys, so `tasks.savedViews` lands nested.
    expect(onDisk['tasks']).toEqual({ savedViews: [view] });
  });

  it('writes tasks.activeViewId into settings.json on disk', async () => {
    await tasks.activeViewId.set('view-1');

    expect(readSettingsFile()['tasks']).toEqual({ activeViewId: 'view-1' });
  });

  it('reads back what it wrote, through a fresh manager over the same directory', async () => {
    const view = {
      id: 'survivor',
      name: 'Blocked',
      filter: { statuses: ['blocked'] },
      sort: { field: 'title', direction: 'asc' },
      order: 3,
    };
    await tasks.savedViews.set([view]);
    await tasks.activeViewId.set('survivor');

    // A second process opening the same ~/.ptah — this is the round trip that
    // makes a saved view survive a restart.
    const reopened = new TasksSettings(
      new VscodeSettingsAdapter(
        {
          fileSettings: new PtahFileSettingsManager(
            FILE_BASED_SETTINGS_DEFAULTS,
            ptahDir,
          ),
        } as unknown as VscodeWorkspaceProvider,
        createHostileVscodeModule(),
        {
          getMasterKey: async () => Buffer.alloc(32),
        } as unknown as IMasterKeyProvider,
        new SecretsFileStore(ptahDir),
      ),
    );

    expect(reopened.savedViews.get()).toEqual([view]);
    expect(reopened.activeViewId.get()).toBe('survivor');
  });

  it('returns the registered defaults when nothing was ever written', () => {
    expect(tasks.savedViews.get()).toEqual([]);
    expect(tasks.activeViewId.get()).toBe('');
  });

  it('proves the double is armed: an unrouted key does hit the vscode store', () => {
    // Guards the guard. Without this, deleting the routing entries could be
    // masked by a double that never actually throws.
    expect(() => adapter.readGlobal('definitely.not.a.ptah.setting')).toThrow(
      /vscode\.workspace\.getConfiguration/,
    );
  });
});
