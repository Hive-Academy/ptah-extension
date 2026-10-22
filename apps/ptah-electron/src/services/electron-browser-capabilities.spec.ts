import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ElectronBrowserCapabilities } from './electron-browser-capabilities';

jest.mock('jpeg-js', () => ({ decode: jest.fn() }));
jest.mock('gifenc', () => ({
  GIFEncoder: jest.fn(() => ({
    writeFrame: jest.fn(),
    finish: jest.fn(),
    bytes: jest.fn(() => new Uint8Array([0])),
  })),
  quantize: jest.fn(() => [[0, 0, 0]]),
  applyPalette: jest.fn(() => new Uint8Array([0])),
}));

interface SpecState {
  sendCommand: jest.Mock;
  getURL: jest.Mock;
  loadURL: jest.Mock;
  attach: jest.Mock;
  detach: jest.Mock;
  removeListener: jest.Mock;
  windowCount: number;
  lastOptions: Record<string, unknown> | undefined;
  handlers: Record<string, (...args: unknown[]) => unknown>;
  failFetch: boolean;
}

type SpecGlobal = typeof globalThis & {
  'ptah.electronBrowserCapabilities.spec'?: SpecState;
};

function specState(): SpecState {
  const value = (globalThis as SpecGlobal)[
    'ptah.electronBrowserCapabilities.spec'
  ];
  if (!value) {
    throw new Error('electron mock was not installed');
  }
  return value;
}

jest.mock('electron', () => {
  const state: SpecState = {
    sendCommand: jest.fn(async (method: string) => {
      if (method === 'Fetch.enable' && state.failFetch) {
        throw new Error('no fetch');
      }
      if (method === 'Page.captureScreenshot') {
        return { data: 'IMG' };
      }
      if (method === 'Runtime.evaluate') {
        return { result: { type: 'string', value: 'ok' } };
      }
      return {};
    }),
    getURL: jest.fn(() => 'https://example.com/'),
    loadURL: jest.fn().mockResolvedValue(undefined),
    attach: jest.fn(),
    detach: jest.fn(),
    removeListener: jest.fn((event: string) => {
      delete state.handlers[event];
    }),
    windowCount: 0,
    lastOptions: undefined,
    handlers: {},
    failFetch: false,
  };
  (globalThis as SpecGlobal)['ptah.electronBrowserCapabilities.spec'] = state;

  class BrowserWindow {
    destroyed = false;
    webContents: {
      debugger: {
        attach: jest.Mock;
        detach: jest.Mock;
        sendCommand: jest.Mock;
        on: jest.Mock;
      };
      getURL: jest.Mock;
      getTitle: () => string;
      once: (event: string, cb: () => void) => void;
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener: jest.Mock;
      setWindowOpenHandler: (handler: (...args: unknown[]) => unknown) => void;
    };

    constructor(options: Record<string, unknown>) {
      state.windowCount += 1;
      state.lastOptions = options;
      this.webContents = {
        debugger: {
          attach: state.attach,
          detach: state.detach,
          sendCommand: state.sendCommand,
          on: jest.fn(
            (event: string, handler: (...args: unknown[]) => void) => {
              state.handlers[event] = handler;
            },
          ),
        },
        getURL: state.getURL,
        getTitle: () => 'Example',
        once: (event: string, cb: () => void) => {
          if (event === 'did-finish-load') {
            queueMicrotask(cb);
          }
        },
        on: (event: string, handler: (...args: unknown[]) => void) => {
          state.handlers[event] = handler;
        },
        removeListener: state.removeListener,
        setWindowOpenHandler: (
          handler: (...args: unknown[]) => unknown,
        ) => {
          state.handlers['window-open'] = handler;
        },
      };
    }

    loadURL = state.loadURL;

    isDestroyed(): boolean {
      return this.destroyed;
    }

    destroy(): void {
      this.destroyed = true;
    }

    on(event: string, handler: (...args: unknown[]) => void): void {
      state.handlers[event] = handler;
    }
  }

  return { BrowserWindow };
});

describe('ElectronBrowserCapabilities file guard', () => {
  let root: string;
  let outside: string;
  let insideUrl: string;
  let outsideUrl: string;
  let caps: ElectronBrowserCapabilities;

  beforeEach(() => {
    const state = specState();
    state.sendCommand.mockClear();
    state.getURL.mockReset();
    state.getURL.mockReturnValue('https://example.com/');
    state.loadURL.mockClear();
    state.attach.mockClear();
    state.detach.mockClear();
    state.removeListener.mockClear();
    state.windowCount = 0;
    state.handlers = {};
    state.failFetch = false;
    state.lastOptions = undefined;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-electron-root-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-electron-out-'));
    const insideFile = path.join(root, 'page.html');
    const outsideFile = path.join(outside, 'secret.html');
    fs.writeFileSync(insideFile, '<p>inside</p>');
    fs.writeFileSync(outsideFile, 'SECRET');
    insideUrl = pathToFileURL(insideFile).href;
    outsideUrl = pathToFileURL(outsideFile).href;
    caps = new ElectronBrowserCapabilities(() => '');
  });

  afterEach(async () => {
    await caps.dispose();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('keeps webSecurity on and does not launch with unsafe file flags', async () => {
    await caps.navigate('https://example.com/');
    const options = specState().lastOptions;
    const prefs = options?.['webPreferences'];
    expect(prefs).toEqual(
      expect.objectContaining({
        webSecurity: true,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      }),
    );
    const serialized = JSON.stringify(options);
    expect(serialized).not.toContain('allow-file-access-from-files');
    expect(serialized).not.toContain('disable-web-security');
  });

  it('enables Fetch for file: URLs before load and releases listeners on close', async () => {
    caps.configureSession({ workspaceRoots: [root] });
    await caps.navigate('https://example.com/');
    expect(specState().sendCommand).toHaveBeenCalledWith('Fetch.enable', {
      patterns: [{ urlPattern: 'file:*', requestStage: 'Request' }],
    });
    const enableIndex = specState().sendCommand.mock.calls.findIndex(
      (call) => call[0] === 'Fetch.enable',
    );
    const enableOrder =
      specState().sendCommand.mock.invocationCallOrder[enableIndex];
    expect(enableOrder).toBeLessThan(
      specState().loadURL.mock.invocationCallOrder[0],
    );
    expect(specState().handlers['will-navigate']).toEqual(expect.any(Function));
    expect(specState().handlers['will-redirect']).toEqual(expect.any(Function));

    await caps.close();
    expect(specState().removeListener).toHaveBeenCalledWith(
      'will-navigate',
      expect.any(Function),
    );
    expect(specState().removeListener).toHaveBeenCalledWith(
      'will-redirect',
      expect.any(Function),
    );
    expect(specState().detach).toHaveBeenCalled();
  });

  it('blocks a lexically unsafe file navigation and an outside-root file request', async () => {
    caps.configureSession({ workspaceRoots: [root] });
    await caps.navigate('https://example.com/');
    const prevent = jest.fn();
    specState().handlers['will-navigate']?.(
      { preventDefault: prevent },
      'file://server/share/secret.html',
    );
    expect(prevent).toHaveBeenCalled();

    const allow = jest.fn();
    specState().handlers['will-redirect']?.(
      { preventDefault: allow },
      insideUrl,
    );
    expect(allow).not.toHaveBeenCalled();

    const message = specState().handlers['message'];
    expect(message).toEqual(expect.any(Function));
    await message?.({}, 'Fetch.requestPaused', {
      requestId: 'out',
      request: { url: outsideUrl },
    });
    await message?.({}, 'Fetch.requestPaused', {
      requestId: 'in',
      request: { url: insideUrl },
    });

    expect(specState().sendCommand).toHaveBeenCalledWith('Fetch.failRequest', {
      requestId: 'out',
      errorReason: 'BlockedByClient',
    });
    const insideFile = path.join(root, 'page.html');
    expect(specState().sendCommand).toHaveBeenCalledWith(
      'Fetch.fulfillRequest',
      {
        requestId: 'in',
        responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'text/html; charset=utf-8' },
        ],
        body: fs.readFileSync(insideFile).toString('base64'),
      },
    );
    expect(specState().sendCommand).not.toHaveBeenCalledWith(
      'Fetch.continueRequest',
      expect.anything(),
    );
  });

  it('denies window.open and webview attach', async () => {
    caps.configureSession({ workspaceRoots: [root] });
    await caps.navigate('https://example.com/');
    const openHandler = specState().handlers['window-open'];
    expect(openHandler).toEqual(expect.any(Function));
    expect(openHandler?.({ url: outsideUrl })).toEqual({ action: 'deny' });
    const prevent = jest.fn();
    specState().handlers['will-attach-webview']?.(
      { preventDefault: prevent },
      {},
    );
    expect(prevent).toHaveBeenCalled();
  });

  it('withholds a data: or javascript: follow-on and blanks the page', async () => {
    caps.configureSession({ workspaceRoots: [root] });
    await caps.navigate('https://example.com/');
    specState().loadURL.mockClear();
    specState().getURL.mockReturnValue('data:text/html,hi');
    const dataShot = await caps.screenshot();
    expect(dataShot.data).toBe('');
    expect(dataShot.error).toMatch(/outside the workspace/);
    expect(specState().loadURL).toHaveBeenCalledWith('about:blank');

    specState().getURL.mockReturnValue('javascript:alert(1)');
    const scriptShot = await caps.screenshot();
    expect(scriptShot.data).toBe('');
    expect(specState().sendCommand).not.toHaveBeenCalledWith(
      'Page.captureScreenshot',
      expect.anything(),
    );
  });

  it('keeps roots configured while the window is being created', async () => {
    const state = specState();
    caps.configureSession({ workspaceRoots: [root] });
    state.attach.mockImplementationOnce(() => {
      caps.configureSession({ workspaceRoots: [outside] });
    });
    await caps.navigate('https://example.com/');
    expect(state.windowCount).toBe(1);
    const message = state.handlers['message'];
    await message?.({}, 'Fetch.requestPaused', {
      requestId: 'moved',
      request: { url: outsideUrl },
    });
    expect(state.sendCommand).toHaveBeenCalledWith(
      'Fetch.fulfillRequest',
      expect.objectContaining({
        requestId: 'moved',
        body: fs.readFileSync(path.join(outside, 'secret.html')).toString(
          'base64',
        ),
      }),
    );
    await message?.({}, 'Fetch.requestPaused', {
      requestId: 'old',
      request: { url: insideUrl },
    });
    expect(state.sendCommand).toHaveBeenCalledWith('Fetch.failRequest', {
      requestId: 'old',
      errorReason: 'BlockedByClient',
    });
  });

  it('omits url, title, and network entries when the page scheme is refused', async () => {
    await caps.navigate('https://example.com/');
    const message = specState().handlers['message'];
    await message?.({}, 'Network.requestWillBeSent', {
      requestId: '1',
      type: 'Script',
      request: { url: 'https://example.com/a.js', method: 'GET' },
    });
    await message?.({}, 'Network.responseReceived', {
      requestId: '1',
      response: { status: 200, headers: { 'content-length': '4' } },
    });
    specState().getURL.mockReturnValue('data:text/html,secret');
    const pageStatus = await caps.status();
    expect(pageStatus.connected).toBe(true);
    expect(pageStatus.url).toBeUndefined();
    expect(pageStatus.title).toBeUndefined();
    expect(pageStatus.viewport).toEqual({ width: 1920, height: 1080 });
    expect(JSON.stringify(pageStatus)).not.toContain('secret');
    const { requests, error } = await caps.getNetworkRequests();
    expect(requests).toEqual([]);
    expect(error).toBeUndefined();
  });

  it('withholds screenshot bytes when the current URL is outside the workspace', async () => {
    caps.configureSession({ workspaceRoots: [root] });
    await caps.navigate('https://example.com/');
    specState().sendCommand.mockClear();
    specState().getURL.mockReturnValue(outsideUrl);

    const shot = await caps.screenshot();
    expect(shot.data).toBe('');
    expect(shot.error).toMatch(/outside the workspace/);
    expect(shot.error).not.toContain('SECRET');
    expect(shot.error).not.toContain(outsideUrl);
    expect(specState().sendCommand).not.toHaveBeenCalledWith(
      'Page.captureScreenshot',
      expect.anything(),
    );
  });

  it('fails closed when the file guard cannot be installed and does not load the URL', async () => {
    specState().failFetch = true;
    const result = await caps.navigate('https://example.com/');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/file-access guard/);
    expect(specState().loadURL).not.toHaveBeenCalled();
  });

  describe('recording', () => {
    it('stopRecording() stops the screencast when the page escaped', async () => {
      await caps.navigate('https://example.com/');
      const start = await caps.startRecording();
      expect(start.success).toBe(true);
      specState().getURL.mockReturnValue('data:text/html,escaped');
      const result = await caps.stopRecording();
      expect(result.error).toMatch(/outside the workspace/);
      expect(result.filePath).toBe('');
      expect(specState().sendCommand).toHaveBeenCalledWith(
        'Page.stopScreencast',
        {},
      );
    });
  });
});
