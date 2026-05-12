/**
 * `cli-workspace-provider.spec.ts` — runs `runWorkspaceContract` against
 * `CliWorkspaceProvider`, plus CLI-specific checks for:
 *   - CWD fallback when no workspace path is provided.
 *   - Explicit workspace-path argument resolution.
 *   - Atomic JSON persistence of non file-based config.
 *   - File-based settings routing to `PtahFileSettingsManager`.
 *
 * The contract assumes an empty-folder state on construction; the CLI impl
 * defaults to `[process.cwd()]`, so the harness clears folders via the
 * `seed` hook before each contract assertion reads them.
 */

import 'reflect-metadata';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  runWorkspaceContract,
  runWorkspaceLifecycleContract,
  type WorkspaceProviderSetup,
  type WorkspaceLifecycleProviderSetup,
} from '@ptah-extension/platform-core/testing';
import { CliWorkspaceProvider } from './cli-workspace-provider';

const tmpDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-cli-ws-'));
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

// Known divergence exposed by the contract:
// TODO(W4.B3): impl divergence — `CliWorkspaceProvider.setWorkspaceFolders`
//   calls `path.resolve()` on every folder, so POSIX-style fixtures like
//   `/a` and `/root` come back as `D:\a` / `D:\root` on Windows. The Electron
//   impl stores the seeded strings verbatim (only resolves on `addFolder`).
//   The two contract tests that fail here ("returns seeded folders in order"
//   and "getWorkspaceRoot returns the first folder") are real-world parity
//   bugs: CLI callers cannot round-trip an absolute POSIX path through the
//   provider without OS-dependent mangling. Fix: align the resolve policy
//   across both impls — either drop the resolve in CLI or add it in Electron.
runWorkspaceContract('CliWorkspaceProvider', async () => {
  const storage = await makeTempDir();
  // Pass a workspace path so we don't lean on `process.cwd()` (jest's cwd
  // varies between runners). Immediately clear it via setWorkspaceFolders([])
  // because the contract's first assertion expects an empty initial folder
  // list — the CLI impl defaults to a single-folder workspace by design.
  const provider = new CliWorkspaceProvider(storage, storage);
  provider.setWorkspaceFolders([]);

  const setup: WorkspaceProviderSetup = {
    provider,
    seed(config) {
      if (config.folders) {
        provider.setWorkspaceFolders(config.folders);
      }
      if (config.config) {
        for (const [fullKey, value] of Object.entries(config.config)) {
          const dot = fullKey.indexOf('.');
          const section = dot >= 0 ? fullKey.slice(0, dot) : 'ptah';
          const key = dot >= 0 ? fullKey.slice(dot + 1) : fullKey;
          void provider.setConfiguration(section, key, value);
        }
      }
    },
  };
  return setup;
});

describe('CliWorkspaceProvider — CLI-specific behaviour', () => {
  let storage: string;

  beforeEach(async () => {
    storage = await makeTempDir();
  });

  it('defaults workspace folder to process.cwd() when no path is supplied', () => {
    const provider = new CliWorkspaceProvider(storage);
    const folders = provider.getWorkspaceFolders();
    expect(folders).toHaveLength(1);
    // On Windows the drive letter casing may differ, so compare via path.resolve.
    expect(path.resolve(folders[0])).toBe(path.resolve(process.cwd()));
  });

  it('resolves an explicit workspace path to an absolute folder entry', () => {
    const provider = new CliWorkspaceProvider(storage, storage);
    expect(provider.getWorkspaceFolders()).toEqual([path.resolve(storage)]);
    expect(provider.getWorkspaceRoot()).toBe(path.resolve(storage));
  });

  it('setConfiguration persists to config.json in the storage dir (non file-based keys)', async () => {
    const provider = new CliWorkspaceProvider(storage, storage);
    // `customSetting` is NOT in FILE_BASED_SETTINGS_KEYS, so it should land
    // in the per-app config.json file, not in ~/.ptah/settings.json.
    await provider.setConfiguration('ptah', 'customSetting', 42);
    const raw = await fs.readFile(path.join(storage, 'config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    expect(parsed['ptah']?.['customSetting']).toBe(42);
  });

  it('onDidChangeConfiguration fires once per setConfiguration call', async () => {
    const provider = new CliWorkspaceProvider(storage, storage);
    let count = 0;
    const sub = provider.onDidChangeConfiguration(() => {
      count += 1;
    });
    await provider.setConfiguration('ptah', 'customA', 1);
    await provider.setConfiguration('ptah', 'customB', 2);
    sub.dispose();
    expect(count).toBe(2);
  });

  it('setWorkspaceFolders fires onDidChangeWorkspaceFolders', () => {
    const provider = new CliWorkspaceProvider(storage, storage);
    let count = 0;
    const sub = provider.onDidChangeWorkspaceFolders(() => {
      count += 1;
    });
    provider.setWorkspaceFolders(['/fake/a', '/fake/b']);
    sub.dispose();
    expect(count).toBe(1);
  });

  it('loadConfigSync recovers from a missing config.json without throwing', () => {
    // Fresh dir — no config.json exists. Constructor must not throw.
    expect(() => new CliWorkspaceProvider(storage, storage)).not.toThrow();
  });

  it('getConfiguration returns default when the section is unset', () => {
    const provider = new CliWorkspaceProvider(storage, storage);
    expect(provider.getConfiguration<number>('nope', 'missing', 99)).toBe(99);
  });

  it('persisted config survives a provider restart (non file-based key)', async () => {
    const first = new CliWorkspaceProvider(storage, storage);
    await first.setConfiguration('ptah', 'persistedCustom', 'keep-me');
    const second = new CliWorkspaceProvider(storage, storage);
    expect(second.getConfiguration<string>('ptah', 'persistedCustom')).toBe(
      'keep-me',
    );
  });

  it('setWorkspaceFolders resolves relative paths to absolute', () => {
    const provider = new CliWorkspaceProvider(storage, storage);
    provider.setWorkspaceFolders(['relative/path']);
    const folders = provider.getWorkspaceFolders();
    expect(path.isAbsolute(folders[0])).toBe(true);
  });

  // -------------------------------------------------------------------------
  // addFolder
  // -------------------------------------------------------------------------

  it('addFolder appends a new folder and fires onDidChangeWorkspaceFolders', () => {
    const provider = new CliWorkspaceProvider(storage, storage);
    const initial = provider.getWorkspaceFolders().length;
    let fired = 0;
    const sub = provider.onDidChangeWorkspaceFolders(() => {
      fired += 1;
    });
    provider.addFolder(storage);
    // The resolved storage path is already present — deduplication keeps count the same.
    const afterDup = provider.getWorkspaceFolders().length;
    expect(afterDup).toBe(initial); // no-op: already present
    expect(fired).toBe(0); // no event fired for duplicate

    const newDir = path.join(storage, 'newSub');
    provider.addFolder(newDir);
    expect(provider.getWorkspaceFolders().length).toBe(initial + 1);
    expect(fired).toBe(1);
    sub.dispose();
  });

  it('addFolder deduplicates by resolved path and does not fire event', () => {
    const provider = new CliWorkspaceProvider(storage, storage);
    provider.setWorkspaceFolders([]);
    provider.addFolder('/some/abs/folder');
    let count = 0;
    const sub = provider.onDidChangeWorkspaceFolders(() => {
      count += 1;
    });
    provider.addFolder('/some/abs/folder'); // duplicate — should no-op
    expect(count).toBe(0);
    sub.dispose();
  });

  // -------------------------------------------------------------------------
  // removeFolder
  // -------------------------------------------------------------------------

  it('removeFolder removes an existing folder and fires onDidChangeWorkspaceFolders', () => {
    const provider = new CliWorkspaceProvider(storage, storage);
    provider.setWorkspaceFolders(['/fake/a', '/fake/b']);
    let fired = 0;
    const sub = provider.onDidChangeWorkspaceFolders(() => {
      fired += 1;
    });
    provider.removeFolder('/fake/a');
    expect(provider.getWorkspaceFolders()).not.toContain('/fake/a');
    expect(fired).toBe(1);
    sub.dispose();
  });

  it('removeFolder is a no-op and does not fire event for unknown path', () => {
    const provider = new CliWorkspaceProvider(storage, storage);
    provider.setWorkspaceFolders(['/fake/a']);
    let fired = 0;
    const sub = provider.onDidChangeWorkspaceFolders(() => {
      fired += 1;
    });
    provider.removeFolder('/fake/nonexistent');
    expect(fired).toBe(0);
    sub.dispose();
  });

  it('removeFolder updates activeFolder when the active folder is removed', () => {
    const provider = new CliWorkspaceProvider(storage, storage);
    provider.setWorkspaceFolders(['/fake/a', '/fake/b']);
    provider.setActiveFolder('/fake/a');
    // Confirm active is set to resolved /fake/a
    expect(provider.getActiveFolder()).toBe(path.resolve('/fake/a'));
    provider.removeFolder('/fake/a');
    // activeFolder should fall back to the first remaining folder
    const remaining = provider.getActiveFolder();
    const remainingFolders = provider.getWorkspaceFolders();
    // Either it's now the first remaining folder, or undefined if empty
    if (remainingFolders.length > 0) {
      expect(remaining).toBe(remainingFolders[0]);
    } else {
      expect(remaining).toBeUndefined();
    }
  });

  // -------------------------------------------------------------------------
  // setActiveFolder / getActiveFolder
  // -------------------------------------------------------------------------

  it('setActiveFolder updates the active folder and fires onDidChangeWorkspaceFolders', () => {
    const provider = new CliWorkspaceProvider(storage, storage);
    provider.setWorkspaceFolders(['/fake/a', '/fake/b']);
    let fired = 0;
    const sub = provider.onDidChangeWorkspaceFolders(() => {
      fired += 1;
    });
    provider.setActiveFolder('/fake/b');
    expect(provider.getActiveFolder()).toBe(path.resolve('/fake/b'));
    expect(fired).toBe(1);
    sub.dispose();
  });

  it('setActiveFolder is a no-op for a path not in the folders list', () => {
    const provider = new CliWorkspaceProvider(storage, storage);
    provider.setWorkspaceFolders(['/fake/a']);
    provider.setActiveFolder('/fake/a');
    let fired = 0;
    const sub = provider.onDidChangeWorkspaceFolders(() => {
      fired += 1;
    });
    provider.setActiveFolder('/fake/notpresent');
    expect(fired).toBe(0);
    sub.dispose();
  });

  it('getActiveFolder returns undefined when no folders are present', () => {
    const provider = new CliWorkspaceProvider(storage, storage);
    provider.setWorkspaceFolders([]);
    // After clearing all folders the active folder should be undefined
    expect(provider.getActiveFolder()).toBeUndefined();
  });

  it('setConfiguration routes file-based ptah keys through fileSettings', async () => {
    const provider = new CliWorkspaceProvider(storage, storage);
    // 'authMethod' is a known FILE_BASED_SETTINGS key (routed to PtahFileSettingsManager)
    // We verify the value is readable back via getConfiguration.
    await provider.setConfiguration('ptah', 'authMethod', 'device-flow');
    const val = provider.getConfiguration<string>('ptah', 'authMethod');
    expect(val).toBe('device-flow');
  });
});

// ---------------------------------------------------------------------------
// IWorkspaceLifecycleProvider conformance — CliWorkspaceProvider
// CliWorkspaceProvider implements both IWorkspaceProvider and
// IWorkspaceLifecycleProvider on the same instance.
// ---------------------------------------------------------------------------

runWorkspaceLifecycleContract('CliWorkspaceProvider', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-cli-lifecycle-'));
  tmpDirs.push(dir);
  const provider = new CliWorkspaceProvider(dir, dir);
  // Clear the initial CWD folder so contract invariants start from empty.
  provider.setWorkspaceFolders([]);

  const setup: WorkspaceLifecycleProviderSetup = {
    provider,
    seed(folders: string[]): void {
      provider.setWorkspaceFolders(folders);
    },
    getFolders(): string[] {
      return provider.getWorkspaceFolders();
    },
    subscribeToFolderChanges(fn: () => void) {
      return provider.onDidChangeWorkspaceFolders(fn);
    },
  };
  return setup;
});
