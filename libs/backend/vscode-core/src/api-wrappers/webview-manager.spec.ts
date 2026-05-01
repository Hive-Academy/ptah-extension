/**
 * WebviewManager unit tests.
 *
 * Exercises the real WebviewManager surface: panel creation + initial data,
 * revealing an existing panel, WebviewView registration, message sending and
 * broadcasting, message routing (system vs. routable), metric tracking, and
 * disposal.
 *
 * TASK_2025_291 Wave B: replaces a ghost spec that mocked a nonexistent
 * EventBus dependency.
 */

import 'reflect-metadata';
import type * as vscode from 'vscode';

import { MESSAGE_TYPES, type WebviewMessage } from '@ptah-extension/shared';

import type { Logger } from '../logging/logger';
import { WebviewManager, type WebviewPanelConfig } from './webview-manager';

// -------------------------------------------------------------------------
// Module-level vscode mock
// -------------------------------------------------------------------------
jest.mock('vscode', () => ({
  window: {
    createWebviewPanel: jest.fn(),
  },
  ViewColumn: {
    One: 1,
    Two: 2,
    Three: 3,
  },
  Uri: {
    file: (path: string) => ({
      scheme: 'file',
      fsPath: path,
      path,
      authority: '',
      query: '',
      fragment: '',
      toString: () => `file://${path}`,
    }),
    joinPath: jest.fn((base: { fsPath: string }, ...parts: string[]) => ({
      scheme: 'file',
      fsPath: `${base.fsPath}/${parts.join('/')}`,
      path: `${base.fsPath}/${parts.join('/')}`,
      authority: '',
      query: '',
      fragment: '',
      toString: () => `file://${base.fsPath}/${parts.join('/')}`,
    })),
  },
}));

const vscodeModule = jest.requireMock<{
  window: { createWebviewPanel: jest.Mock };
  ViewColumn: { One: number; Two: number; Three: number };
}>('vscode');

// -------------------------------------------------------------------------
// Panel / View mock factories
// -------------------------------------------------------------------------
interface PanelHooks {
  receiveMessage: (message: WebviewMessage) => void;
  changeViewState: (visible: boolean) => void;
  dispose: () => void;
}

interface MockPanel {
  webview: {
    postMessage: jest.Mock;
    onDidReceiveMessage: jest.Mock;
    html: string;
    options: Record<string, unknown>;
  };
  onDidChangeViewState: jest.Mock;
  onDidDispose: jest.Mock;
  reveal: jest.Mock;
  dispose: jest.Mock;
  visible: boolean;
  hooks: PanelHooks;
}

function createMockPanel(): MockPanel {
  const hooks: Partial<PanelHooks> = {};

  const onDidReceiveMessage = jest.fn(
    (callback: (message: WebviewMessage) => void) => {
      hooks.receiveMessage = callback;
      return { dispose: jest.fn() };
    },
  );

  const onDidChangeViewState = jest.fn(
    (callback: (e: { webviewPanel: { visible: boolean } }) => void) => {
      hooks.changeViewState = (visible: boolean) =>
        callback({ webviewPanel: { visible } });
      return { dispose: jest.fn() };
    },
  );

  const onDidDispose = jest.fn((callback: () => void) => {
    hooks.dispose = callback;
    return { dispose: jest.fn() };
  });

  return {
    webview: {
      postMessage: jest.fn().mockResolvedValue(true),
      onDidReceiveMessage,
      html: '',
      options: {},
    },
    onDidChangeViewState,
    onDidDispose,
    reveal: jest.fn(),
    dispose: jest.fn(),
    visible: true,
    hooks: hooks as PanelHooks,
  };
}

interface MockView {
  webview: {
    postMessage: jest.Mock;
    onDidReceiveMessage: jest.Mock;
  };
  onDidChangeVisibility: jest.Mock;
  onDidDispose: jest.Mock;
  visible: boolean;
  hooks: { visibility?: () => void; dispose?: () => void };
}

function createMockView(): MockView {
  const hooks: MockView['hooks'] = {};
  return {
    webview: {
      postMessage: jest.fn().mockResolvedValue(true),
      onDidReceiveMessage: jest.fn(),
    },
    onDidChangeVisibility: jest.fn((cb: () => void) => {
      hooks.visibility = cb;
      return { dispose: jest.fn() };
    }),
    onDidDispose: jest.fn((cb: () => void) => {
      hooks.dispose = cb;
      return { dispose: jest.fn() };
    }),
    visible: true,
    hooks,
  };
}

function createMockLogger(): jest.Mocked<
  Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>
> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function createMockContext(): Pick<
  vscode.ExtensionContext,
  'subscriptions' | 'extensionUri'
> {
  return {
    subscriptions: [],
    extensionUri: {
      scheme: 'file',
      fsPath: '/test/extension',
      path: '/test/extension',
      authority: '',
      query: '',
      fragment: '',
      toString: () => 'file:///test/extension',
    } as unknown as vscode.Uri,
  } as Pick<vscode.ExtensionContext, 'subscriptions' | 'extensionUri'>;
}

// -------------------------------------------------------------------------
describe('WebviewManager', () => {
  let context: Pick<vscode.ExtensionContext, 'subscriptions' | 'extensionUri'>;
  let logger: ReturnType<typeof createMockLogger>;
  let createPanelMock: jest.Mock;
  let panels: MockPanel[];
  let manager: WebviewManager;

  beforeEach(() => {
    jest.clearAllMocks();
    panels = [];
    createPanelMock = vscodeModule.window.createWebviewPanel;
    createPanelMock.mockImplementation(() => {
      const panel = createMockPanel();
      panels.push(panel);
      return panel;
    });
    context = createMockContext();
    logger = createMockLogger();
    manager = new WebviewManager(
      context as vscode.ExtensionContext,
      logger as unknown as Logger,
    );
  });

  afterEach(() => {
    manager.dispose();
  });

  // ---------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------
  describe('construction', () => {
    it('starts with no active webviews', () => {
      expect(manager.getActiveWebviews()).toEqual([]);
      expect(manager.getWebviewMetrics()).toEqual({});
    });
  });

  // ---------------------------------------------------------------------
  // createWebviewPanel
  // ---------------------------------------------------------------------
  describe('createWebviewPanel', () => {
    const baseConfig: WebviewPanelConfig = {
      viewType: 'ptah.panel',
      title: 'Ptah Panel',
    };

    it('creates a new panel, tracks it, and wires lifecycle hooks', () => {
      const panel = manager.createWebviewPanel(baseConfig);

      expect(createPanelMock).toHaveBeenCalledTimes(1);
      expect(panel).toBe(panels[0]);
      expect(manager.getWebviewPanel('ptah.panel')).toBe(panels[0]);
      expect(manager.hasWebview('ptah.panel')).toBe(true);
      expect(manager.getActiveWebviews()).toContain('ptah.panel');

      // Lifecycle hooks registered exactly once.
      expect(panels[0].webview.onDidReceiveMessage).toHaveBeenCalledTimes(1);
      expect(panels[0].onDidChangeViewState).toHaveBeenCalledTimes(1);
      expect(panels[0].onDidDispose).toHaveBeenCalledTimes(1);
    });

    it('applies default webview options when none are provided', () => {
      manager.createWebviewPanel(baseConfig);

      const args = createPanelMock.mock.calls[0];
      // [viewType, title, viewColumn, options]
      expect(args[0]).toBe('ptah.panel');
      expect(args[1]).toBe('Ptah Panel');
      expect(args[2]).toBe(vscodeModule.ViewColumn.One);
      expect(args[3]).toEqual(
        expect.objectContaining({
          enableScripts: true,
          retainContextWhenHidden: true,
          enableForms: true,
          enableCommandUris: false,
        }),
      );
    });

    it('sends initial data to the webview when provided', () => {
      manager.createWebviewPanel(baseConfig, { version: '1.0.0' });

      expect(panels[0].webview.postMessage).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.INITIAL_DATA,
        payload: { version: '1.0.0' },
      });
    });

    it('reveals the existing panel when the same viewType is requested again', () => {
      const first = manager.createWebviewPanel(baseConfig);
      const second = manager.createWebviewPanel({
        ...baseConfig,
        showOptions: {
          viewColumn: vscodeModule.ViewColumn
            .Two as unknown as vscode.ViewColumn,
          preserveFocus: true,
        },
      });

      expect(second).toBe(first);
      expect(createPanelMock).toHaveBeenCalledTimes(1);
      expect(panels[0].reveal).toHaveBeenCalledWith(
        vscodeModule.ViewColumn.Two,
        true,
      );
    });
  });

  // ---------------------------------------------------------------------
  // Message routing
  // ---------------------------------------------------------------------
  describe('incoming message routing', () => {
    beforeEach(() => {
      manager.createWebviewPanel({
        viewType: 'ptah.routing',
        title: 'Routing',
      });
    });

    it('updates metrics when any message arrives', () => {
      const panel = panels[0];
      panel.hooks.receiveMessage({
        type: MESSAGE_TYPES.WEBVIEW_READY,
      } as WebviewMessage);

      const metrics = manager.getWebviewMetrics('ptah.routing');
      if (metrics === null || Array.isArray(metrics)) {
        throw new Error('expected per-webview metrics object');
      }
      expect(metrics.messageCount).toBe(1);
      expect(metrics.lastActivity).toBeGreaterThan(0);
    });

    it('handles system messages without logging an error', () => {
      const panel = panels[0];
      panel.hooks.receiveMessage({
        type: MESSAGE_TYPES.WEBVIEW_READY,
      } as WebviewMessage);

      expect(logger.error).not.toHaveBeenCalled();
    });

    it('defers routable messages to the external handler and logs at debug level', () => {
      const panel = panels[0];
      panel.hooks.receiveMessage({
        type: 'chat:sendMessage',
        payload: { text: 'hi' },
      } as unknown as WebviewMessage);

      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('chat:sendMessage'),
      );
    });
  });

  // ---------------------------------------------------------------------
  // View state / disposal tracking
  // ---------------------------------------------------------------------
  describe('lifecycle callbacks', () => {
    it('updates isVisible when the panel view state changes', () => {
      manager.createWebviewPanel({
        viewType: 'ptah.visible',
        title: 'Visible',
      });
      const panel = panels[0];

      panel.hooks.changeViewState(false);

      const metrics = manager.getWebviewMetrics('ptah.visible');
      if (metrics === null || Array.isArray(metrics)) {
        throw new Error('expected per-webview metrics object');
      }
      expect(metrics.isVisible).toBe(false);
    });

    it('drops tracking when the panel disposes itself', () => {
      manager.createWebviewPanel({
        viewType: 'ptah.panel.dispose',
        title: 'Self-dispose',
      });
      const panel = panels[0];

      panel.hooks.dispose();

      expect(manager.hasWebview('ptah.panel.dispose')).toBe(false);
      expect(manager.getWebviewMetrics('ptah.panel.dispose')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // sendMessage
  // ---------------------------------------------------------------------
  describe('sendMessage', () => {
    it('posts the message on the matching panel and resolves true', async () => {
      manager.createWebviewPanel({
        viewType: 'ptah.send',
        title: 'Send',
      });

      const result = await manager.sendMessage(
        'ptah.send',
        MESSAGE_TYPES.CHAT_MESSAGE_CHUNK,
        { chunk: 'ok' },
      );

      expect(result).toBe(true);
      expect(panels[0].webview.postMessage).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.CHAT_MESSAGE_CHUNK,
        payload: { chunk: 'ok' },
      });
    });

    it('returns false and debug-logs when the target webview is unknown', async () => {
      const result = await manager.sendMessage(
        'ptah.unknown',
        MESSAGE_TYPES.CHAT_MESSAGE_CHUNK,
        {},
      );

      expect(result).toBe(false);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('not found'),
        expect.objectContaining({
          activePanels: expect.any(Array),
          activeViews: expect.any(Array),
        }),
      );
    });

    it('returns false and logs an error when postMessage rejects', async () => {
      manager.createWebviewPanel({
        viewType: 'ptah.send.err',
        title: 'Err',
      });
      panels[0].webview.postMessage.mockRejectedValueOnce(
        new Error('postMessage blew up'),
      );

      const result = await manager.sendMessage(
        'ptah.send.err',
        MESSAGE_TYPES.CHAT_MESSAGE_CHUNK,
        {},
      );

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------
  // registerWebviewView
  // ---------------------------------------------------------------------
  describe('registerWebviewView', () => {
    it('tracks the view and initialises metrics from its current visibility', () => {
      const view = createMockView();
      view.visible = false;

      manager.registerWebviewView(
        'ptah.view',
        view as unknown as vscode.WebviewView,
      );

      expect(manager.getActiveWebviews()).toContain('ptah.view');

      const metrics = manager.getWebviewMetrics('ptah.view');
      if (metrics === null || Array.isArray(metrics)) {
        throw new Error('expected per-webview metrics object');
      }
      expect(metrics.isVisible).toBe(false);
    });

    it('cleans up when the view disposes itself', () => {
      const view = createMockView();
      manager.registerWebviewView(
        'ptah.view.dispose',
        view as unknown as vscode.WebviewView,
      );

      expect(view.hooks.dispose).toBeDefined();
      view.hooks.dispose?.();

      expect(manager.getActiveWebviews()).not.toContain('ptah.view.dispose');
      expect(manager.getWebviewMetrics('ptah.view.dispose')).toBeNull();
    });

    it('sendMessage() delivers to a registered view when no panel matches', async () => {
      const view = createMockView();
      manager.registerWebviewView(
        'ptah.view.send',
        view as unknown as vscode.WebviewView,
      );

      const result = await manager.sendMessage(
        'ptah.view.send',
        MESSAGE_TYPES.CHAT_MESSAGE_CHUNK,
        { x: 1 },
      );

      expect(result).toBe(true);
      expect(view.webview.postMessage).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.CHAT_MESSAGE_CHUNK,
        payload: { x: 1 },
      });
    });
  });

  // ---------------------------------------------------------------------
  // broadcastMessage
  // ---------------------------------------------------------------------
  describe('broadcastMessage', () => {
    it('sends the message to every registered panel and view', async () => {
      manager.createWebviewPanel({
        viewType: 'ptah.broadcast.panel',
        title: 'Panel',
      });
      const view = createMockView();
      manager.registerWebviewView(
        'ptah.broadcast.view',
        view as unknown as vscode.WebviewView,
      );

      await manager.broadcastMessage(MESSAGE_TYPES.CHAT_MESSAGE_CHUNK, {
        chunk: 'hello',
      });

      expect(panels[0].webview.postMessage).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.CHAT_MESSAGE_CHUNK,
        payload: { chunk: 'hello' },
      });
      expect(view.webview.postMessage).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.CHAT_MESSAGE_CHUNK,
        payload: { chunk: 'hello' },
      });
    });

    it('swallows per-view errors via warn rather than rejecting the broadcast', async () => {
      const view = createMockView();
      view.webview.postMessage.mockRejectedValueOnce(new Error('view failed'));
      manager.registerWebviewView(
        'ptah.broadcast.err',
        view as unknown as vscode.WebviewView,
      );

      await expect(
        manager.broadcastMessage(MESSAGE_TYPES.CHAT_MESSAGE_CHUNK, {}),
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------
  // getWebview / getWebviewPanel
  // ---------------------------------------------------------------------
  describe('accessors', () => {
    it('getWebview() returns the panel webview when a panel is registered', () => {
      manager.createWebviewPanel({
        viewType: 'ptah.acc.panel',
        title: 'Panel',
      });

      expect(manager.getWebview('ptah.acc.panel')).toBe(panels[0].webview);
    });

    it('getWebview() returns the view webview when only a view is registered', () => {
      const view = createMockView();
      manager.registerWebviewView(
        'ptah.acc.view',
        view as unknown as vscode.WebviewView,
      );

      expect(manager.getWebview('ptah.acc.view')).toBe(view.webview);
    });

    it('getWebview() returns undefined for unknown viewType', () => {
      expect(manager.getWebview('ptah.unknown')).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------
  // disposeWebview / dispose
  // ---------------------------------------------------------------------
  describe('disposal', () => {
    it('disposeWebview() disposes the underlying panel', () => {
      manager.createWebviewPanel({
        viewType: 'ptah.disp.one',
        title: 'One',
      });

      expect(manager.disposeWebview('ptah.disp.one')).toBe(true);
      expect(panels[0].dispose).toHaveBeenCalledTimes(1);
    });

    it('disposeWebview() returns false for an unknown viewType', () => {
      expect(manager.disposeWebview('ptah.unknown')).toBe(false);
    });

    it('dispose() disposes every panel and clears metrics', () => {
      manager.createWebviewPanel({ viewType: 'ptah.all.1', title: '1' });
      manager.createWebviewPanel({ viewType: 'ptah.all.2', title: '2' });

      manager.dispose();

      expect(panels[0].dispose).toHaveBeenCalledTimes(1);
      expect(panels[1].dispose).toHaveBeenCalledTimes(1);
      expect(manager.getWebviewMetrics()).toEqual({});
    });
  });
});
