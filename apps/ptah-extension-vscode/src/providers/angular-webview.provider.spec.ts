import * as vscode from 'vscode';
import type {
  Logger,
  WebviewManager,
  WebviewMessageHandlerService,
} from '@ptah-extension/vscode-core';
import { WebviewEventQueue } from '../services/webview-event-queue';
import { WebviewHtmlGenerator } from '../services/webview-html-generator';
import { AngularWebviewProvider } from './angular-webview.provider';
import type { VscodeHostAttentionNotifications } from '@ptah-extension/platform-vscode';

// The shared vscode mock has no ExtensionMode (read by the provider's
// development watcher) or ViewColumn (read by createPanel).
jest.mock('vscode', () => ({
  ...jest.requireActual('vscode'),
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 },
}));

const savedId = 'ptah.panel.12345678-1234-1234-1234-123456789abc';

function panel(): {
  value: vscode.WebviewPanel;
  dispose: () => void;
  disposePanel: jest.Mock;
  postMessage: jest.Mock;
} {
  const onDispose: Array<() => void> = [];
  const postMessage = jest.fn().mockResolvedValue(true);
  const disposePanel = jest.fn(() =>
    onDispose.forEach((callback) => callback()),
  );
  const value = {
    webview: { options: {}, html: '', postMessage },
    dispose: disposePanel,
    onDidDispose: jest.fn((callback: () => void) => {
      onDispose.push(callback);
      return { dispose: jest.fn() };
    }),
    onDidChangeViewState: jest.fn(() => ({ dispose: jest.fn() })),
  } as unknown as vscode.WebviewPanel;
  return { value, dispose: disposePanel, disposePanel, postMessage };
}

function state(route: string, panelId = savedId, v = 1): unknown {
  return {
    unrelated: { retained: true },
    ptahRoute: { v, route, seed: null, panelId },
  };
}

describe('AngularWebviewProvider panel adoption', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
  const context = {
    extensionUri: vscode.Uri.file('/extension'),
    extensionMode: 1,
  } as unknown as vscode.ExtensionContext;
  let provider: AngularWebviewProvider;
  let manager: { registerWebviewView: jest.Mock };
  let listener: jest.Mock;
  let generate: jest.SpyInstance;
  let created: ReturnType<typeof panel>;
  let creationOptions: vscode.WebviewPanelOptions & vscode.WebviewOptions = {
    enableScripts: false,
    retainContextWhenHidden: false,
    localResourceRoots: [],
  };
  let liveManagerIds: Set<string>;

  it('bridges panel view-state changes into the manager visibility event', async () => {
    const visibilityListeners: Array<() => void> = [];
    const viewStateListeners: Array<() => void> = [];
    Object.assign(created.value, {
      visible: true,
      onDidChangeViewState: jest.fn((listener: () => void) => {
        viewStateListeners.push(listener);
        return { dispose: jest.fn() };
      }),
    });
    manager.registerWebviewView.mockImplementation((_id: string, view: vscode.WebviewView) => {
      view.onDidChangeVisibility(() => visibilityListeners.push(jest.fn()));
    });
    await provider.createPanel();
    expect(viewStateListeners).toHaveLength(1);
    viewStateListeners[0]();
    expect(visibilityListeners).toHaveLength(1);
  });

  beforeEach(() => {
    created = panel();
    Object.assign(vscode.window, {
      createWebviewPanel: jest.fn(
        (
          _viewType: string,
          _title: string,
          _column: vscode.ViewColumn,
          options: vscode.WebviewPanelOptions & vscode.WebviewOptions,
        ) => {
          creationOptions = options;
          return created.value;
        },
      ),
    });
    liveManagerIds = new Set<string>();
    manager = {
      registerWebviewView: jest.fn((id: string, value: vscode.WebviewPanel) => {
        liveManagerIds.add(id);
        value.onDidDispose(() => liveManagerIds.delete(id));
      }),
    };
    listener = jest.fn(
      (_options: unknown, disposables: vscode.Disposable[]) => {
        disposables.push({ dispose: jest.fn() });
      },
    );
    generate = jest
      .spyOn(WebviewHtmlGenerator.prototype, 'generateAngularWebviewContent')
      .mockReturnValue('<ptah-root></ptah-root>');
    jest
      .spyOn(WebviewHtmlGenerator.prototype, 'buildWorkspaceInfo')
      .mockReturnValue(null);
    provider = new AngularWebviewProvider(
      context,
      logger,
      manager as unknown as WebviewManager,
      new WebviewEventQueue(logger),
      {
        setupMessageListener: listener,
      } as unknown as WebviewMessageHandlerService,
      Object.assign(Object.create(null) as VscodeHostAttentionNotifications, {
        setRouteDispatcher: jest.fn(() => ({ dispose: jest.fn() })),
      }),
    );
  });

  afterEach(() => {
    provider.dispose();
    jest.restoreAllMocks();
  });

  it.each(['/chat/tab-1', '/thoth/skills'])(
    'adopts a saved %s panel without altering state or setting initialView',
    async (route) => {
      const restored = panel();
      const saved = state(route);
      await provider.deserializeWebviewPanel(restored.value, saved);

      expect(saved).toEqual(state(route));
      expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
      expect(manager.registerWebviewView).toHaveBeenCalledWith(
        savedId,
        expect.objectContaining({ webview: restored.value.webview }),
      );
      expect(generate).toHaveBeenCalledWith(
        restored.value.webview,
        expect.objectContaining({ panelId: savedId }),
      );
      expect(generate.mock.calls[0][1]).not.toHaveProperty('initialView');
      expect(restored.value.webview.html).toBe('<ptah-root></ptah-root>');
      expect(restored.value.webview.options).toEqual(
        expect.objectContaining({
          enableScripts: true,
          localResourceRoots: expect.arrayContaining([context.extensionUri]),
        }),
      );
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          webviewId: savedId,
          webview: restored.value.webview,
        }),
        expect.any(Array),
      );
      expect(provider.panelCount).toBe(1);
      restored.dispose();
      expect(provider.panelCount).toBe(0);
      expect(listener.mock.calls[0][1][0].dispose).toHaveBeenCalled();
    },
  );

  it('uses the same panel options and message wiring for fresh and restored panels', async () => {
    const flush = jest.spyOn(WebviewEventQueue.prototype, 'flush');
    await provider.createPanel({ initialView: 'analytics' });
    const restored = panel();
    await provider.deserializeWebviewPanel(
      restored.value,
      state('/chat/tab-1'),
    );
    expect(creationOptions).toEqual(
      expect.objectContaining({
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: expect.arrayContaining([context.extensionUri]),
      }),
    );
    // Mock Uris carry a fresh toString closure each, so compare by path.
    const shape = (options: vscode.WebviewOptions) => ({
      enableScripts: options.enableScripts,
      roots: options.localResourceRoots?.map((root) => root.fsPath),
    });
    expect(shape(created.value.webview.options)).toEqual(
      shape(creationOptions),
    );
    expect(shape(restored.value.webview.options)).toEqual(
      shape(creationOptions),
    );
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      'ptah-angular-spa',
      expect.any(String),
      vscode.ViewColumn.One,
      expect.objectContaining({ retainContextWhenHidden: true }),
    );
    expect(listener).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0][1]).toHaveProperty(
      'initialView',
      'analytics',
    );
    expect(generate.mock.calls[1][1]).not.toHaveProperty('initialView');
    const ready = listener.mock.calls[1][0].onReady as () => void;
    ready();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(restored.postMessage).not.toHaveBeenCalled();
  });

  it('keeps distinct valid IDs for multiple restored panels', async () => {
    const anotherId = 'ptah.panel.abcdefab-1234-1234-1234-abcdefabcdef';
    await provider.deserializeWebviewPanel(panel().value, state('/chat/one'));
    await provider.deserializeWebviewPanel(
      panel().value,
      state('/thoth/skills', anotherId),
    );
    expect(
      manager.registerWebviewView.mock.calls.map((call) => call[0]),
    ).toEqual([savedId, anotherId]);
  });

  it('allocates distinct IDs for collisions and invalid saved state', async () => {
    const cases: unknown[] = [
      state('/chat/a'),
      state('/chat/a'),
      state('/chat/a', 'ptah.panel.short'),
      state('/chat/a', savedId, 2),
      state('https://example.com/'),
      undefined,
    ];
    const panels = cases.map(() => panel());
    for (let i = 0; i < cases.length; i++) {
      await provider.deserializeWebviewPanel(panels[i].value, cases[i]);
    }
    const ids = manager.registerWebviewView.mock.calls.map(
      (call) => call[0] as string,
    );
    expect(ids[0]).toBe(savedId);
    expect(ids[1]).not.toBe(savedId);
    expect(new Set(ids).size).toBe(cases.length);
    for (const id of ids.slice(1)) {
      expect(id).toMatch(/^ptah\.panel\.[0-9a-f-]{36}$/);
    }
    expect(provider.panelCount).toBe(cases.length);
  });

  it('logs and disposes a restored panel when HTML generation throws', async () => {
    const restored = panel();
    const failure = new Error('HTML failed');
    const queueDispose = jest.spyOn(WebviewEventQueue.prototype, 'dispose');
    generate.mockImplementation(() => {
      throw failure;
    });

    await provider.deserializeWebviewPanel(restored.value, state('/chat/a'));

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to restore editor panel',
      failure,
    );
    expect(restored.disposePanel).toHaveBeenCalled();
    expect(provider.panelCount).toBe(0);
    expect(queueDispose).toHaveBeenCalledTimes(1);
    expect(liveManagerIds.size).toBe(0);
    expect(manager.registerWebviewView).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('rolls back manager and queue registration when listener setup throws', async () => {
    const restored = panel();
    const failure = new Error('listener failed');
    const queueDispose = jest.spyOn(WebviewEventQueue.prototype, 'dispose');
    listener.mockImplementationOnce(() => {
      throw failure;
    });

    await provider.deserializeWebviewPanel(restored.value, state('/chat/a'));

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to restore editor panel',
      failure,
    );
    expect(restored.disposePanel).toHaveBeenCalledTimes(1);
    expect(provider.panelCount).toBe(0);
    expect(liveManagerIds.size).toBe(0);
    expect(queueDispose).toHaveBeenCalledTimes(1);
  });
});
