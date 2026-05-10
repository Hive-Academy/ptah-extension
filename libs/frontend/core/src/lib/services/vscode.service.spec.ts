/**
 * VSCodeService unit specs.
 *
 * Strategy: Set `window.vscode` and `window.ptahConfig` before TestBed
 * (mirrors the claude-rpc.service.spec.ts pattern). The service calls
 * `initializeFromGlobals()` in its constructor, so the globals must be
 * in place before injection.
 */

import { TestBed } from '@angular/core/testing';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import {
  VSCodeService,
  WebviewConfig,
  initializeVSCodeService,
  provideVSCodeService,
} from './vscode.service';

interface PtahTestWindow {
  vscode?: {
    postMessage: jest.Mock<void, [unknown]>;
    getState: jest.Mock<unknown, []>;
    setState: jest.Mock<void, [unknown]>;
  };
  ptahConfig?: Partial<WebviewConfig>;
}

function getPtahWindow(): PtahTestWindow {
  return window as unknown as PtahTestWindow;
}

function installVsCodeApi(config?: Partial<WebviewConfig>): {
  postMessage: jest.Mock<void, [unknown]>;
  getState: jest.Mock<unknown, []>;
  setState: jest.Mock<void, [unknown]>;
} {
  const postMessage = jest.fn<void, [unknown]>();
  const getState = jest.fn<unknown, []>().mockReturnValue({});
  const setState = jest.fn<void, [unknown]>();

  getPtahWindow().vscode = { postMessage, getState, setState };
  getPtahWindow().ptahConfig = {
    isVSCode: true,
    theme: 'dark',
    workspaceRoot: '/my/workspace',
    workspaceName: 'workspace',
    extensionUri: 'vscode-resource://ext',
    baseUri: '',
    iconUri: 'icon.svg',
    userIconUri: 'user.png',
    isElectron: false,
    ...config,
  };

  return { postMessage, getState, setState };
}

function uninstallVsCodeApi(): void {
  delete getPtahWindow().vscode;
  delete getPtahWindow().ptahConfig;
}

describe('VSCodeService', () => {
  let service: VSCodeService;

  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
    uninstallVsCodeApi();
  });

  // ── initializeFromGlobals ──────────────────────────────────────────────────

  describe('initializeFromGlobals', () => {
    it('sets isConnected=false in dev mode (no window.vscode)', () => {
      // Do NOT install VS Code API — simulate dev mode
      uninstallVsCodeApi();
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      expect(service.isConnected()).toBe(false);
    });

    it('sets isConnected=true and config when vscode and ptahConfig are present', () => {
      installVsCodeApi({ isElectron: false });
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      expect(service.isConnected()).toBe(true);
      expect(service.config().isVSCode).toBe(true);
      expect(service.config().extensionUri).toBe('vscode-resource://ext');
    });

    it('sets isConnected=true even when ptahConfig is absent (logs warning)', () => {
      const consoleSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const ptahWin = getPtahWindow();
      ptahWin.vscode = {
        postMessage: jest.fn(),
        getState: jest.fn(() => ({})),
        setState: jest.fn(),
      };
      // No ptahConfig
      delete ptahWin.ptahConfig;

      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      expect(service.isConnected()).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('no ptahConfig'),
      );
      consoleSpy.mockRestore();
    });
  });

  // ── getAssetUri ──────────────────────────────────────────────────────────

  describe('getAssetUri()', () => {
    it('returns relative ./path when isElectron=true', () => {
      installVsCodeApi({ isElectron: true });
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      expect(service.getAssetUri('assets/logo.png')).toBe('./assets/logo.png');
    });

    it('returns extensionUri/path when connected with extensionUri and not Electron', () => {
      installVsCodeApi({
        isElectron: false,
        extensionUri: 'vscode-resource://ext',
      });
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      expect(service.getAssetUri('assets/logo.png')).toBe(
        'vscode-resource://ext/assets/logo.png',
      );
    });

    it('returns /path when not connected (no vscode api)', () => {
      uninstallVsCodeApi();
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      expect(service.getAssetUri('assets/logo.png')).toBe('/assets/logo.png');
    });
  });

  // ── updateWorkspaceRoot ───────────────────────────────────────────────────

  describe('updateWorkspaceRoot()', () => {
    it('updates workspaceRoot and derives workspaceName from last path segment', () => {
      installVsCodeApi();
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      service.updateWorkspaceRoot('/users/dev/my-project');
      expect(service.config().workspaceRoot).toBe('/users/dev/my-project');
      expect(service.config().workspaceName).toBe('my-project');
    });

    it('derives workspaceName from Windows-style path', () => {
      installVsCodeApi();
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      service.updateWorkspaceRoot('C:\\Users\\dev\\my-project');
      expect(service.config().workspaceName).toBe('my-project');
    });

    it('workspaceName is empty string when path is empty (??  does not guard falsy)', () => {
      installVsCodeApi();
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      service.updateWorkspaceRoot('');
      // ''.split(/[/\\]/).pop() === '' (not null/undefined), so ?? 'Workspace' is NOT
      // triggered. The implementation uses ?? (nullish coalescing), not ||, so an empty
      // string passes through unchanged. workspaceName is ''.
      const name = service.config().workspaceName;
      expect(name).toBe('');
    });
  });

  // ── isElectron getter ─────────────────────────────────────────────────────

  describe('isElectron getter', () => {
    it('returns true when config has isElectron=true', () => {
      installVsCodeApi({ isElectron: true });
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      expect(service.isElectron).toBe(true);
    });

    it('returns false when config has isElectron=false', () => {
      installVsCodeApi({ isElectron: false });
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      expect(service.isElectron).toBe(false);
    });

    it('returns false when isElectron is not set in config', () => {
      const ptahWin = getPtahWindow();
      ptahWin.vscode = {
        postMessage: jest.fn(),
        getState: jest.fn(() => ({})),
        setState: jest.fn(),
      };
      ptahWin.ptahConfig = {
        isVSCode: true,
        theme: 'dark',
        workspaceRoot: '',
        workspaceName: '',
        extensionUri: '',
        baseUri: '',
        iconUri: '',
        userIconUri: '',
        // No isElectron field
      };
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      expect(service.isElectron).toBe(false);
    });
  });

  // ── getPtahIconUri / getPtahUserIconUri ───────────────────────────────────

  describe('getPtahIconUri()', () => {
    it('returns iconUri from config when set', () => {
      installVsCodeApi({ iconUri: 'custom-icon.svg' });
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      expect(service.getPtahIconUri()).toBe('custom-icon.svg');
    });

    it('falls back to getAssetUri when iconUri is empty', () => {
      installVsCodeApi({
        iconUri: '',
        isElectron: false,
        extensionUri: 'vscode-resource://ext',
      });
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      const uri = service.getPtahIconUri();
      expect(uri).toContain('assets/ptah-icon.svg');
    });
  });

  describe('getPtahUserIconUri()', () => {
    it('returns userIconUri from config when set', () => {
      installVsCodeApi({ userIconUri: 'user-avatar.png' });
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      expect(service.getPtahUserIconUri()).toBe('user-avatar.png');
    });

    it('falls back to getAssetUri when userIconUri is empty', () => {
      installVsCodeApi({
        userIconUri: '',
        isElectron: false,
        extensionUri: 'vscode-resource://ext',
      });
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      const uri = service.getPtahUserIconUri();
      expect(uri).toContain('assets/user-icon.png');
    });
  });

  // ── postMessage ───────────────────────────────────────────────────────────

  describe('postMessage()', () => {
    it('calls vscode.postMessage when vscode api is present', () => {
      const { postMessage } = installVsCodeApi();
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      const msg = { type: 'RPC_CALL', payload: { method: 'test', params: {} } };
      service.postMessage(msg);

      expect(postMessage).toHaveBeenCalledWith(msg);
    });

    it('logs warning and does not throw when no vscode api', () => {
      const consoleSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      uninstallVsCodeApi();
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      expect(() => service.postMessage({ type: 'test' })).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('not available'),
      );
      consoleSpy.mockRestore();
    });
  });

  // ── getState ──────────────────────────────────────────────────────────────

  describe('getState()', () => {
    it('returns undefined when no vscode api', () => {
      uninstallVsCodeApi();
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      expect(service.getState('my-key')).toBeUndefined();
    });

    it('returns undefined when vscode.getState returns null/undefined', () => {
      installVsCodeApi();
      getPtahWindow().vscode!.getState = jest.fn().mockReturnValue(null);
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      expect(service.getState('my-key')).toBeUndefined();
    });

    it('returns the typed value from state object by key', () => {
      installVsCodeApi();
      getPtahWindow().vscode!.getState = jest.fn().mockReturnValue({
        'my-key': { data: 42 },
      });
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      expect(service.getState<{ data: number }>('my-key')).toEqual({
        data: 42,
      });
    });

    it('returns undefined for a key not in the state object', () => {
      installVsCodeApi();
      getPtahWindow().vscode!.getState = jest
        .fn()
        .mockReturnValue({ 'other-key': 'x' });
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      expect(service.getState('my-key')).toBeUndefined();
    });
  });

  // ── setState ──────────────────────────────────────────────────────────────

  describe('setState()', () => {
    it('logs warning and does not throw when no vscode api', () => {
      const consoleSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      uninstallVsCodeApi();
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      expect(() => service.setState('key', { value: 1 })).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('not available'),
      );
      consoleSpy.mockRestore();
    });

    it('merges new key-value into existing state object', () => {
      const { setState, getState } = installVsCodeApi();
      getState.mockReturnValue({ 'existing-key': 'existing-value' });
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      service.setState('new-key', { data: 123 });

      expect(setState).toHaveBeenCalledWith({
        'existing-key': 'existing-value',
        'new-key': { data: 123 },
      });
    });

    it('creates new state object when current state is empty/null', () => {
      const { setState, getState } = installVsCodeApi();
      getState.mockReturnValue(null);
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      service.setState('key', 'value');

      expect(setState).toHaveBeenCalledWith({ key: 'value' });
    });
  });

  // ── handleMessage (MessageHandler implementation) ─────────────────────────

  describe('handleMessage()', () => {
    it('updates workspaceRoot when WORKSPACE_CHANGED payload has path', () => {
      installVsCodeApi();
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      service.handleMessage({
        type: MESSAGE_TYPES.WORKSPACE_CHANGED,
        payload: { workspaceInfo: { path: '/new/workspace' } },
      });

      expect(service.config().workspaceRoot).toBe('/new/workspace');
      expect(service.config().workspaceName).toBe('workspace');
    });

    it('is a no-op when payload is undefined', () => {
      installVsCodeApi({ workspaceRoot: '/original' });
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      expect(() => {
        service.handleMessage({ type: MESSAGE_TYPES.WORKSPACE_CHANGED });
      }).not.toThrow();

      expect(service.config().workspaceRoot).toBe('/original');
    });

    it('is a no-op when workspaceInfo is null', () => {
      installVsCodeApi({ workspaceRoot: '/original' });
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      expect(() => {
        service.handleMessage({
          type: MESSAGE_TYPES.WORKSPACE_CHANGED,
          payload: { workspaceInfo: null },
        });
      }).not.toThrow();

      expect(service.config().workspaceRoot).toBe('/original');
    });

    it('declares WORKSPACE_CHANGED in handledMessageTypes', () => {
      installVsCodeApi();
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      expect(service.handledMessageTypes).toContain(
        MESSAGE_TYPES.WORKSPACE_CHANGED,
      );
    });
  });

  // ── Factory functions ─────────────────────────────────────────────────────

  describe('initializeVSCodeService()', () => {
    it('returns a no-op function', () => {
      installVsCodeApi();
      TestBed.configureTestingModule({ providers: [VSCodeService] });
      service = TestBed.inject(VSCodeService);

      const fn = initializeVSCodeService(service);
      expect(typeof fn).toBe('function');
      expect(() => fn()).not.toThrow();
    });
  });

  describe('provideVSCodeService()', () => {
    it('returns an array with VSCodeService and an APP_INITIALIZER provider', () => {
      const providers = provideVSCodeService();
      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBe(2);
    });
  });
});
