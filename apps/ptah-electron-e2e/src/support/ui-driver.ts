import type { ElectronApplication, Locator, Page } from '@playwright/test';

export type ElectronView =
  | 'chat'
  | 'canvas'
  | 'dashboard'
  | 'editor'
  | 'settings'
  | 'setup-wizard'
  | 'thoth';

export type ThothTab = 'memory' | 'skills' | 'cron' | 'gateway';

export type RpcResolver = unknown | string;

export type RpcMockMap = Record<string, RpcResolver>;

interface RendererMessage {
  type: string;
  payload?: unknown;
}

export interface StartupConfigSeed {
  initialView: string;
  isLicensed: boolean;
  workspaceRoot: string;
  workspaceName: string;
}

const NAMESPACE_EMPTY_DEFAULTS: Record<string, unknown> = {
  jobs: [],
  bindings: [],
  candidates: [],
  entries: [],
  guilds: [],
};

const DEFAULT_STARTUP_CONFIG: StartupConfigSeed = {
  initialView: 'chat',
  isLicensed: true,
  workspaceRoot: 'C:\\ptah-e2e-ws',
  workspaceName: 'ptah-e2e-ws',
};

export class UiDriver {
  public constructor(
    private readonly app: ElectronApplication,
    public readonly page: Page,
  ) {}

  public async installFakeRpcListener(): Promise<void> {
    await this.app.evaluate(({ ipcMain, BrowserWindow }, namespaceDefaults) => {
      const g = globalThis as unknown as {
        __uiMockStatics?: Record<string, unknown>;
        __uiMockFns?: Record<string, string>;
        __uiNamespaceDefaults?: Record<string, unknown>;
        __uiObservedCalls?: { method: string; params: unknown }[];
      };
      g.__uiMockStatics = g.__uiMockStatics ?? {};
      g.__uiMockFns = g.__uiMockFns ?? {};
      g.__uiNamespaceDefaults = namespaceDefaults;
      g.__uiObservedCalls = [];

      ipcMain.removeAllListeners('rpc');
      ipcMain.on('rpc', (event: Electron.IpcMainEvent, message: unknown) => {
        if (!message || typeof message !== 'object') return;
        const msg = message as Record<string, unknown>;
        const rpcData = (msg['payload'] || msg) as Record<string, unknown>;
        const method = rpcData['method'] as string | undefined;
        const params = rpcData['params'] as unknown;
        const correlationId =
          (rpcData['correlationId'] as string) ||
          (rpcData['requestId'] as string) ||
          '';
        if (!method) return;
        (g.__uiObservedCalls ?? []).push({ method, params });

        let data: unknown = {};
        const fns = g.__uiMockFns ?? {};
        const statics = g.__uiMockStatics ?? {};
        if (Object.prototype.hasOwnProperty.call(fns, method)) {
          const resolver = new Function(
            'params',
            `return (${fns[method]})(params);`,
          ) as (p: unknown) => unknown;
          data = resolver(params);
        } else if (Object.prototype.hasOwnProperty.call(statics, method)) {
          data = statics[method];
        } else {
          const defaults = g.__uiNamespaceDefaults ?? {};
          const merged: Record<string, unknown> = {};
          for (const key of Object.keys(defaults)) {
            merged[key] = defaults[key];
          }
          data = merged;
        }

        const win = BrowserWindow.fromWebContents(event.sender);
        const target = win ?? BrowserWindow.getAllWindows()[0];
        target?.webContents.send('to-renderer', {
          type: 'rpc:response',
          correlationId,
          success: true,
          data,
        });
      });
    }, NAMESPACE_EMPTY_DEFAULTS);
  }

  public async seedStartupConfig(
    config: StartupConfigSeed = DEFAULT_STARTUP_CONFIG,
  ): Promise<void> {
    await this.app.evaluate(({ ipcMain }, cfg) => {
      ipcMain.removeAllListeners('get-startup-config');
      ipcMain.on('get-startup-config', (event: Electron.IpcMainEvent) => {
        event.returnValue = {
          initialView: cfg.initialView,
          isLicensed: cfg.isLicensed,
          workspaceRoot: cfg.workspaceRoot,
          workspaceName: cfg.workspaceName,
        };
      });
    }, config);
  }

  public async prepare(
    config: StartupConfigSeed = DEFAULT_STARTUP_CONFIG,
  ): Promise<void> {
    await this.seedStartupConfig(config);
    await this.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.reload();
    });
    await this.page.waitForLoadState('domcontentloaded');
    await this.page
      .locator('ptah-electron-shell')
      .waitFor({ state: 'visible' });
  }

  public async mockRpc(map: RpcMockMap): Promise<void> {
    const statics: Record<string, unknown> = {};
    const fns: Record<string, string> = {};
    for (const method of Object.keys(map)) {
      const value = map[method];
      if (typeof value === 'string') {
        fns[method] = value;
      } else {
        statics[method] = value;
      }
    }
    await this.app.evaluate(
      (_electron, payload) => {
        const g = globalThis as unknown as {
          __uiMockStatics?: Record<string, unknown>;
          __uiMockFns?: Record<string, string>;
        };
        g.__uiMockStatics = g.__uiMockStatics ?? {};
        g.__uiMockFns = g.__uiMockFns ?? {};
        for (const key of Object.keys(payload.statics)) {
          g.__uiMockStatics[key] = payload.statics[key];
          delete g.__uiMockFns[key];
        }
        for (const key of Object.keys(payload.fns)) {
          g.__uiMockFns[key] = payload.fns[key];
          delete g.__uiMockStatics[key];
        }
      },
      { statics, fns },
    );
  }

  public async getObservedCalls(
    method: string,
  ): Promise<{ method: string; params: unknown }[]> {
    return this.app.evaluate((_electron, target) => {
      const g = globalThis as unknown as {
        __uiObservedCalls?: { method: string; params: unknown }[];
      };
      return (g.__uiObservedCalls ?? []).filter((c) => c.method === target);
    }, method);
  }

  public async waitForObservedCall(
    method: string,
    timeoutMs = 10_000,
  ): Promise<{ method: string; params: unknown }> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const calls = await this.getObservedCalls(method);
      if (calls.length > 0) {
        return calls[calls.length - 1];
      }
      if (Date.now() > deadline) {
        throw new Error(
          `[UiDriver] waitForObservedCall timed out after ${timeoutMs}ms (method="${method}")`,
        );
      }
      await this.page.waitForTimeout(50);
    }
  }

  public async forceVisible(): Promise<void> {
    await this.page.evaluate(() => {
      const doc = document as unknown as {
        __ptahVisibilityForced?: boolean;
      };
      if (doc.__ptahVisibilityForced) {
        document.dispatchEvent(new Event('visibilitychange'));
        return;
      }
      doc.__ptahVisibilityForced = true;
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }

  public async pushEvent(message: RendererMessage): Promise<void> {
    await this.app.evaluate(({ BrowserWindow }, msg) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send('to-renderer', msg);
    }, message);
  }

  public async pushBatch(events: RendererMessage[]): Promise<void> {
    await this.pushEvent({ type: 'batch', payload: { events } });
  }

  public async goto(view: ElectronView): Promise<void> {
    await this.syncWorkspace();
    if (view === 'chat' || view === 'canvas') {
      await this.pushEvent({ type: 'switchView', payload: { view: 'chat' } });
      const tabName = view === 'canvas' ? 'Canvas' : 'Chat';
      const tab = this.page
        .getByRole('tab', { name: tabName })
        .or(this.page.locator(`[title="${tabName}"]`))
        .first();
      await tab.waitFor({ state: 'visible' });
      await tab.click({ force: true });
      return;
    }
    if (view === 'editor') {
      const editorPanel = this.page.locator('ptah-editor-panel');
      if (!(await editorPanel.count())) {
        const editorTab = this.page
          .getByRole('button', { name: 'Toggle Editor panel' })
          .or(this.page.locator('[aria-label="Toggle Editor panel"]'))
          .first();
        await editorTab.waitFor({ state: 'visible' });
        await editorTab.click();
      }
      await editorPanel.first().waitFor({ state: 'visible' });
      // Force a deterministic file-tree reload from the registered mock — the
      // lazily-mounted panel's one-shot fetch can race the mock under xvfb.
      await this.pushEvent({ type: 'file:tree-changed', payload: {} });
      return;
    }
    const viewName = view === 'dashboard' ? 'analytics' : view;
    await this.pushEvent({ type: 'switchView', payload: { view: viewName } });
  }

  public async openTab(tab: ThothTab): Promise<void> {
    await this.syncWorkspace();
    await this.pushEvent({ type: 'switchView', payload: { view: 'thoth' } });
    const tabButton = this.page.locator('#thoth-tab-' + tab);
    await tabButton.waitFor({ state: 'visible' });
    await tabButton.click();
    await this.page
      .locator('#thoth-panel-' + tab)
      .waitFor({ state: 'visible' });
  }

  public panel(view?: ElectronView): Locator {
    if (view === 'thoth' || view === undefined) {
      return this.page.locator('[id^="thoth-panel-"]');
    }
    if (view === 'editor') {
      return this.page.locator('ptah-editor-panel');
    }
    return this.page.locator('body');
  }

  private async syncWorkspace(): Promise<void> {
    await this.pushEvent({ type: 'workspaceChanged', payload: {} });
  }
}
