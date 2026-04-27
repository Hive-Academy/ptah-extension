import {
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { launchPtah } from './electron-launcher';
import { RpcBridge } from './rpc-bridge';

/**
 * Playwright test fixtures for the Ptah Electron app.
 *
 * Each test gets a fresh ElectronApplication, the main BrowserWindow as
 * a Playwright `Page`, and an RpcBridge helper for IPC interaction.
 */
export interface PtahFixtures {
  electronApp: ElectronApplication;
  mainWindow: Page;
  rpcBridge: RpcBridge;
}

export const test = base.extend<PtahFixtures>({
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use) => {
    const app = await launchPtah();
    try {
      await use(app);
    } finally {
      await app.close().catch(() => {
        // Already closed -- ignore.
      });
    }
  },

  mainWindow: async ({ electronApp }, use) => {
    const win = await electronApp.firstWindow();
    await use(win);
  },

  rpcBridge: async ({ electronApp }, use) => {
    await use(new RpcBridge(electronApp));
  },
});

export const expect = base.expect;
