import {
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { launchPtah } from './electron-launcher';
import { RpcBridge } from './rpc-bridge';
import { UiDriver } from './ui-driver';

/**
 * Playwright test fixtures for the Ptah Electron app.
 *
 * Each test gets a fresh ElectronApplication, the main BrowserWindow as
 * a Playwright `Page`, an RpcBridge helper for IPC interaction, and a
 * `mainProcessOutput` helper that accumulates all stdout+stderr lines emitted
 * by the Electron main process during the test (used to assert absence of
 * critical error strings on startup).
 */

/** Accumulates main-process stdout and stderr lines during a test. */
export interface MainProcessOutput {
  /** All lines written to stdout by the Electron main process. */
  readonly lines: string[];
  /** Returns true if any captured line contains the given substring. */
  hasLine(substring: string): boolean;
}

export interface PtahFixtures {
  electronApp: ElectronApplication;
  mainWindow: Page;
  rpcBridge: RpcBridge;
  ui: UiDriver;
  /** Captured stdout+stderr lines from the Electron main process. */
  mainProcessOutput: MainProcessOutput;
}

export const test = base.extend<PtahFixtures>({
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use) => {
    const app = await launchPtah();
    try {
      await use(app);
    } finally {
      await app.close().catch(() => {});
    }
  },

  mainProcessOutput: async ({ electronApp }, use) => {
    const lines: string[] = [];
    const onStdout = (chunk: Buffer) => {
      lines.push(...chunk.toString('utf8').split('\n').filter(Boolean));
    };
    const onStderr = (chunk: Buffer) => {
      lines.push(...chunk.toString('utf8').split('\n').filter(Boolean));
    };

    electronApp.process().stdout?.on('data', onStdout);
    electronApp.process().stderr?.on('data', onStderr);

    const output: MainProcessOutput = {
      lines,
      hasLine(substring: string): boolean {
        return lines.some((l) => l.includes(substring));
      },
    };

    try {
      await use(output);
    } finally {
      electronApp.process().stdout?.off('data', onStdout);
      electronApp.process().stderr?.off('data', onStderr);
    }
  },

  mainWindow: async ({ electronApp }, use) => {
    const win = await electronApp.firstWindow();
    await use(win);
  },

  rpcBridge: async ({ electronApp }, use) => {
    await use(new RpcBridge(electronApp));
  },

  ui: async ({ electronApp, mainWindow }, use) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    const driver = new UiDriver(electronApp, mainWindow);
    await driver.installFakeRpcListener();
    await driver.mockRpc({
      'workspace:getInfo': {
        folders: ['C:\\ptah-e2e-ws'],
        activeFolder: 'C:\\ptah-e2e-ws',
      },
      'workspace:switch': { success: true },
      'auth:getAuthStatus': {
        authMethod: 'apiKey',
        hasApiKey: true,
        availableProviders: [],
        anthropicProviderId: null,
      },
      'config:get': {},
      'cron:list': { jobs: [] },
      'gateway:listBindings': { bindings: [] },
      'skillSynthesis:listCandidates': { candidates: [] },
      'memory:list': { memories: [], total: 0 },
    });
    await driver.prepare();
    await use(driver);
  },
});

export const expect = base.expect;
