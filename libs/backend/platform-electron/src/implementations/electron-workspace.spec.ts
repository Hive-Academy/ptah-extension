/**
 * `electron-workspace.spec.ts` — runs `runWorkspaceContract` against
 * `ElectronWorkspaceProvider` and covers Electron-specific routing
 * (app-local JSON config file, file-based settings handoff to
 * `PtahFileSettingsManager`, workspace folder lifecycle).
 *
 * Each setup builds a provider rooted in a disposable tmpdir so
 * `config.json` writes never escape the test sandbox.
 */

import 'reflect-metadata';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  runWorkspaceContract,
  type WorkspaceProviderSetup,
} from '@ptah-extension/platform-core/testing';
import {
  FILE_BASED_SETTINGS_DEFAULTS,
  isFileBasedSettingKey,
} from '@ptah-extension/platform-core';
import { ElectronWorkspaceProvider } from './electron-workspace-provider';

const tmpDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-electron-ws-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (!dir) continue;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {
      /* swallow */
    });
  }
});

runWorkspaceContract('ElectronWorkspaceProvider', async () => {
  const storage = await makeTempDir();
  const provider = new ElectronWorkspaceProvider(storage);
  const setup: WorkspaceProviderSetup = {
    provider,
    seed(config) {
      if (config.folders) {
        provider.setWorkspaceFolders(config.folders);
      }
      // In-memory config seeding routes through setConfiguration so events
      // fire consistently with the production write path.
      if (config.config) {
        for (const [fullKey, value] of Object.entries(config.config)) {
          const dot = fullKey.indexOf('.');
          const section = dot >= 0 ? fullKey.slice(0, dot) : 'ptah';
          const key = dot >= 0 ? fullKey.slice(dot + 1) : fullKey;
          // Fire-and-forget — the contract immediately reads, so the in-memory
          // update is what matters; disk persistence trails behind.
          void provider.setConfiguration(section, key, value);
        }
      }
    },
  };
  return setup;
});

describe('ElectronWorkspaceProvider — Electron-specific behaviour', () => {
  let storage: string;
  let provider: ElectronWorkspaceProvider;

  beforeEach(async () => {
    storage = await makeTempDir();
    provider = new ElectronWorkspaceProvider(storage);
  });

  it('setConfiguration persists to config.json in the storage dir', async () => {
    await provider.setConfiguration('ptah', 'telemetry', false);
    const raw = await fs.readFile(path.join(storage, 'config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    expect(parsed['ptah']?.['telemetry']).toBe(false);
  });

  it('initialFolders seeds both folders and active folder', () => {
    const p = new ElectronWorkspaceProvider(storage, ['/alpha', '/beta']);
    expect(p.getWorkspaceFolders()).toEqual(['/alpha', '/beta']);
    expect(p.getActiveFolder()).toBe('/alpha');
    expect(p.getWorkspaceRoot()).toBe('/alpha');
  });

  it('addFolder deduplicates by resolved path and makes the first active', () => {
    const a = path.resolve('/workspace/project');
    provider.addFolder(a);
    provider.addFolder(a);
    expect(provider.getWorkspaceFolders()).toEqual([a]);
    expect(provider.getActiveFolder()).toBe(a);
  });

  it('removeFolder updates active when the removed entry was active', () => {
    const a = path.resolve('/ws/a');
    const b = path.resolve('/ws/b');
    provider.addFolder(a);
    provider.addFolder(b);
    provider.setActiveFolder(a);
    provider.removeFolder(a);
    expect(provider.getActiveFolder()).toBe(b);
  });

  it('setActiveFolder is a no-op when the folder is not in the list', () => {
    const a = path.resolve('/ws/a');
    const missing = path.resolve('/ws/nope');
    provider.addFolder(a);
    provider.setActiveFolder(missing);
    expect(provider.getActiveFolder()).toBe(a);
  });

  it('onDidChangeWorkspaceFolders fires when folders mutate', () => {
    let count = 0;
    const sub = provider.onDidChangeWorkspaceFolders(() => {
      count += 1;
    });
    provider.addFolder(path.resolve('/ws/x'));
    provider.setWorkspaceFolders([path.resolve('/ws/y')]);
    sub.dispose();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('getConfiguration returns default when section is unset', () => {
    expect(provider.getConfiguration<number>('nope', 'missing', 99)).toBe(99);
  });

  it('loadConfigSync recovers from a missing config file without throwing', () => {
    // Fresh dir — no config.json exists. Constructor must not throw.
    expect(() => new ElectronWorkspaceProvider(storage)).not.toThrow();
  });

  it('loadConfigSync reads an existing config.json on construction', async () => {
    await fs.writeFile(
      path.join(storage, 'config.json'),
      JSON.stringify({ ptah: { seeded: 42 } }),
      'utf-8',
    );
    const p = new ElectronWorkspaceProvider(storage);
    expect(p.getConfiguration<number>('ptah', 'seeded')).toBe(42);
  });

  it('removeFolder is a no-op when the folder is not in the list', () => {
    const a = path.resolve('/ws/a');
    provider.addFolder(a);
    let fired = 0;
    const sub = provider.onDidChangeWorkspaceFolders(() => {
      fired += 1;
    });
    provider.removeFolder(path.resolve('/ws/never'));
    sub.dispose();
    expect(fired).toBe(0);
    expect(provider.getWorkspaceFolders()).toEqual([a]);
  });

  it('setActiveFolder switches the active folder and fires the change event', () => {
    const a = path.resolve('/ws/a');
    const b = path.resolve('/ws/b');
    provider.addFolder(a);
    provider.addFolder(b);
    let fired = 0;
    const sub = provider.onDidChangeWorkspaceFolders(() => {
      fired += 1;
    });
    provider.setActiveFolder(b);
    sub.dispose();
    expect(provider.getActiveFolder()).toBe(b);
    expect(fired).toBeGreaterThanOrEqual(1);
  });

  it('setPendingOrigin records the supplied token verbatim', () => {
    provider.setPendingOrigin('origin-123');
    expect(provider.pendingOrigin).toBe('origin-123');
    provider.setPendingOrigin(null);
    expect(provider.pendingOrigin).toBeNull();
  });

  it('setConfiguration for a file-based key fires affectsConfiguration for the full key', async () => {
    // FILE_BASED_SETTINGS_KEYS includes provider settings — pick the first
    // file-based key dynamically so the test does not couple to a specific
    // trademarked name.
    const fileBasedKey = Object.keys(FILE_BASED_SETTINGS_DEFAULTS).find((k) =>
      isFileBasedSettingKey(k),
    );
    if (!fileBasedKey) {
      // No file-based keys configured — nothing to assert.
      return;
    }
    const events: boolean[] = [];
    const sub = provider.onDidChangeConfiguration((e) => {
      events.push(e.affectsConfiguration(`ptah.${fileBasedKey}`));
    });
    await provider.setConfiguration('ptah', fileBasedKey, 'some-value');
    sub.dispose();
    expect(events).toContain(true);
  });
});
