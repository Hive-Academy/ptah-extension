import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { launchPtah } from './electron-launcher';
import { UiDriver } from './ui-driver';
import { RpcBridge } from './rpc-bridge';
import { createThreeHunkRepo, type ScratchRepo } from './git-scratch-repo';

/**
 * Real-RPC fixtures — the app talks to its own backend, nothing is mocked.
 *
 * The default `fixtures.ts` `ui` fixture calls `installFakeRpcListener()`,
 * which runs `ipcMain.removeAllListeners('rpc')` and answers every RPC from a
 * static map. That is the right tool for renderer-shaped assertions and the
 * wrong one for `TASK_2026_218`, whose whole question is whether a click in
 * the running UI reaches the real handler. A spec built on the mocked driver
 * would re-prove what Batch 8B already proved under jsdom.
 *
 * So this file deliberately does NOT install the fake listener and does NOT
 * seed `get-startup-config`: the real handler registered in
 * `apps/ptah-electron/src/activation/post-window.ts` answers with the real
 * `ElectronWorkspaceProvider` root, which resolves from the positional argv
 * this fixture passes at launch.
 *
 * Kept in its own file rather than added to `fixtures.ts` so the ~20 existing
 * specs on the mocked driver are untouched.
 */

/**
 * Booting a real workspace is what makes home-directory isolation mandatory
 * here rather than merely tidy. `wire-runtime.ts:345` awaits `bootHeavyServices`
 * whenever a startup workspace exists, which opens the SQLite database that
 * `persistence-sqlite/src/lib/db-path.ts` resolves to
 * `os.homedir()/.ptah/state/ptah.sqlite`. Without an isolated home, an e2e run
 * would contend with — and write migrations into — the developer's live Ptah
 * database. `--user-data-dir` does not cover this: it moves Electron's userData,
 * not `os.homedir()`.
 *
 * Node resolves `os.homedir()` from `USERPROFILE` on Windows and `HOME`
 * elsewhere, so both are set. This also isolates `~/.ptah/settings.json` and
 * the downloaded-content cache.
 */
const HOME_ENV_KEYS = ['USERPROFILE', 'HOME'] as const;

/**
 * A first boot into an empty home runs every migration from zero, so the
 * default 30s launch window is too tight — and `bootHeavyServices` is awaited
 * before the window is created, so the cost lands on `firstWindow()`.
 */
const REAL_BOOT_TIMEOUT_MS = 120_000;

export interface RealRpcFixtures {
  /** A throwaway git repo with one committed file and three unstaged hunks. */
  repo: ScratchRepo;
  /** Isolated `os.homedir()` for the launched app — never the developer's. */
  ptahHome: string;
  electronApp: ElectronApplication;
  mainWindow: Page;
  /** UiDriver with no RPC mocking installed. */
  ui: UiDriver;
  /** Talks to the REAL handler here — nothing intercepts the `rpc` channel. */
  rpcBridge: RpcBridge;
}

export const test = base.extend<RealRpcFixtures>({
  // eslint-disable-next-line no-empty-pattern
  repo: async ({}, use) => {
    const repo = createThreeHunkRepo();
    try {
      await use(repo);
    } finally {
      repo.cleanup();
    }
  },

  // eslint-disable-next-line no-empty-pattern
  ptahHome: async ({}, use) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-e2e-home-'));
    try {
      await use(home);
    } finally {
      try {
        fs.rmSync(home, { recursive: true, force: true });
      } catch {
        // SQLite and the recursive workspace watcher can hold handles past
        // process exit on Windows; a leaked tmp home is not a spec failure.
      }
    }
  },

  electronApp: async ({ repo, ptahHome }, use) => {
    const env: Record<string, string> = {};
    for (const key of HOME_ENV_KEYS) env[key] = ptahHome;
    // The first non-flag argv becomes the workspace root — see
    // apps/ptah-electron/src/activation/bootstrap.ts.
    const app = await launchPtah({
      args: [repo.root],
      env,
      timeout: REAL_BOOT_TIMEOUT_MS,
    });
    try {
      await use(app);
    } finally {
      await app.close().catch(() => {});
    }
  },

  mainWindow: async ({ electronApp }, use) => {
    const win = await electronApp.firstWindow({
      timeout: REAL_BOOT_TIMEOUT_MS,
    });
    await use(win);
  },

  rpcBridge: async ({ electronApp, mainWindow }, use) => {
    // Depends on mainWindow because sendRpc dispatches through the live
    // BrowserWindow's webContents.
    await mainWindow.waitForLoadState('domcontentloaded');
    await use(new RpcBridge(electronApp));
  },

  ui: async ({ electronApp, mainWindow }, use) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    const driver = new UiDriver(electronApp, mainWindow);
    await driver.page
      .locator('ptah-electron-shell')
      .waitFor({ state: 'visible' });
    await use(driver);
  },
});

export const expect = base.expect;
