/**
 * Specs for ChromeLauncherBrowserCapabilities.
 *
 * Covers:
 *   - session lifecycle: lazy create via ensureSession(), cleanup on close()
 *   - CDP wiring: Page/Network/Runtime/Emulation enable + setDeviceMetricsOverride
 *   - launcher failure (chrome not found) → wrapped error surfaced by navigate()
 *   - CDP connect failure after chrome launch → launcher is killed and error surfaced
 *   - navigate: success path returns final URL/title from Runtime.evaluate
 *   - screenshot: format + quality + captureBeyondViewport plumbing
 *   - evaluate: exceptionDetails mapped to error field
 *   - click/type/getContent: element-not-found paths
 *   - network: buffer fed by requestWillBeSent / responseReceived listeners
 *   - status: connected=false when no session, details when connected
 *   - startRecording / stopRecording: screencast start/stop and reject-when-already-recording
 *
 * External deps mocked:
 *   - 'chrome-launcher'          → launch(), returns { port, kill }
 *   - 'chrome-remote-interface'  → default export factory, returns CDP client stub
 *   - 'jpeg-js' / 'gifenc'       → mocked transitively (screen-recorder.service import)
 *   - 'fs' / 'fs.promises'       → screen-recorder transitive dep
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ChromeLauncherBrowserCapabilities } from './chrome-launcher-browser-capabilities';

// ---------------------------------------------------------------------------
// Mocks — chrome-launcher + chrome-remote-interface
// ---------------------------------------------------------------------------

jest.mock('chrome-launcher', () => ({
  launch: jest.fn(),
}));

jest.mock('chrome-remote-interface', () => ({
  __esModule: true,
  default: jest.fn(),
}));

// Transitive deps pulled in by screen-recorder.service import.
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

const chromeLauncherMock = require('chrome-launcher') as {
  launch: jest.Mock;
};

const cdpMock = require('chrome-remote-interface') as {
  default: jest.Mock;
};

// ---------------------------------------------------------------------------
// CDP stub builder
// ---------------------------------------------------------------------------

interface CdpStubs {
  client: Record<string, unknown>;
  Page: {
    enable: jest.Mock;
    navigate: jest.Mock;
    loadEventFired: jest.Mock;
    getFrameTree: jest.Mock;
    captureScreenshot: jest.Mock;
    startScreencast: jest.Mock;
    stopScreencast: jest.Mock;
    screencastFrame: jest.Mock;
    screencastFrameAck: jest.Mock;
  };
  Network: {
    enable: jest.Mock;
    requestWillBeSent: jest.Mock;
    responseReceived: jest.Mock;
    /** Captured listeners so tests can fire events. */
    requestListener?: (params: unknown) => void;
    responseListener?: (params: unknown) => void;
  };
  Runtime: {
    enable: jest.Mock;
    evaluate: jest.Mock;
    runIfWaitingForDebugger: jest.Mock;
  };
  Emulation: { setDeviceMetricsOverride: jest.Mock };
  Input: { insertText: jest.Mock };
  Fetch: {
    enable: jest.Mock;
    requestPaused: jest.Mock;
    continueRequest: jest.Mock;
    fulfillRequest: jest.Mock;
    failRequest: jest.Mock;
    listener?: (
      params: {
        requestId: string;
        request?: { url?: string };
      },
      sessionId?: string,
    ) => Promise<void> | void;
  };
  Target: {
    setAutoAttach: jest.Mock;
    attachedToTarget: jest.Mock;
    closeTarget: jest.Mock;
    runIfWaitingForDebugger: jest.Mock;
    listener?: (params: {
      sessionId?: string;
      waitingForDebugger?: boolean;
      targetInfo?: { targetId?: string; type?: string; openerId?: string };
    }) => Promise<void> | void;
  };
  close: jest.Mock;
}

function buildCdpStubs(): CdpStubs {
  const networkState: CdpStubs['Network'] = {
    enable: jest.fn().mockResolvedValue(undefined),
    requestWillBeSent: jest.fn((listener: (p: unknown) => void) => {
      networkState.requestListener = listener;
    }),
    responseReceived: jest.fn((listener: (p: unknown) => void) => {
      networkState.responseListener = listener;
    }),
  };

  const Page = {
    enable: jest.fn().mockResolvedValue(undefined),
    navigate: jest.fn().mockResolvedValue(undefined),
    loadEventFired: jest.fn().mockResolvedValue(undefined),
    getFrameTree: jest.fn().mockResolvedValue({
      frameTree: { frame: { url: 'https://example.com/' } },
    }),
    captureScreenshot: jest.fn().mockResolvedValue({ data: 'BASE64PNG' }),
    startScreencast: jest.fn().mockResolvedValue(undefined),
    stopScreencast: jest.fn().mockResolvedValue(undefined),
    screencastFrame: jest.fn(),
    screencastFrameAck: jest.fn().mockResolvedValue(undefined),
  };

  const Runtime = {
    enable: jest.fn().mockResolvedValue(undefined),
    runIfWaitingForDebugger: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn().mockResolvedValue({
      result: {
        value: JSON.stringify({
          url: 'https://example.com/',
          title: 'Example',
        }),
        type: 'string',
      },
    }),
  };

  const Emulation = {
    setDeviceMetricsOverride: jest.fn().mockResolvedValue(undefined),
  };

  const Input = { insertText: jest.fn().mockResolvedValue(undefined) };

  const Fetch: CdpStubs['Fetch'] = {
    enable: jest.fn().mockResolvedValue(undefined),
    requestPaused: jest.fn(
      (
        listener: (
          params: {
            requestId: string;
            request?: { url?: string };
          },
          sessionId?: string,
        ) => Promise<void> | void,
      ) => {
        Fetch.listener = listener;
      },
    ),
    continueRequest: jest.fn().mockResolvedValue(undefined),
    fulfillRequest: jest.fn().mockResolvedValue(undefined),
    failRequest: jest.fn().mockResolvedValue(undefined),
  };

  const Target: CdpStubs['Target'] = {
    setAutoAttach: jest.fn().mockResolvedValue(undefined),
    attachedToTarget: jest.fn(
      (
        listener: (params: {
          sessionId?: string;
          waitingForDebugger?: boolean;
          targetInfo?: { targetId?: string; type?: string; openerId?: string };
        }) => Promise<void> | void,
      ) => {
        Target.listener = listener;
      },
    ),
    closeTarget: jest.fn().mockResolvedValue(undefined),
    runIfWaitingForDebugger: jest.fn().mockResolvedValue(undefined),
  };

  const close = jest.fn().mockResolvedValue(undefined);

  const client: Record<string, unknown> = {
    Page,
    Network: networkState,
    Runtime,
    Emulation,
    Input,
    Fetch,
    Target,
    close,
  };

  return {
    client,
    Page,
    Network: networkState,
    Runtime,
    Emulation,
    Input,
    Fetch,
    Target,
    close,
  };
}

function primeLaunch(): { kill: jest.Mock } {
  const kill = jest.fn().mockResolvedValue(undefined);
  chromeLauncherMock.launch.mockResolvedValue({ port: 9222, kill });
  return { kill };
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('ChromeLauncherBrowserCapabilities', () => {
  let caps: ChromeLauncherBrowserCapabilities;
  let cdp: CdpStubs;
  let kill: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    cdp = buildCdpStubs();
    ({ kill } = primeLaunch());
    cdpMock.default.mockResolvedValue(cdp.client);
    caps = new ChromeLauncherBrowserCapabilities(() => '');
  });

  afterEach(async () => {
    await caps.dispose();
  });

  describe('lifecycle — createSession / cleanup', () => {
    it('is not connected until ensureSession() runs', () => {
      expect(caps.isConnected()).toBe(false);
    });

    it('launches Chrome, connects CDP, and enables domains on first navigate()', async () => {
      const result = await caps.navigate('https://example.com/');

      expect(chromeLauncherMock.launch).toHaveBeenCalledTimes(1);
      expect(cdpMock.default).toHaveBeenCalledWith({ port: 9222 });
      expect(cdp.Page.enable).toHaveBeenCalled();
      expect(cdp.Network.enable).toHaveBeenCalled();
      expect(cdp.Runtime.enable).toHaveBeenCalled();
      expect(cdp.Emulation.setDeviceMetricsOverride).toHaveBeenCalledWith(
        expect.objectContaining({ width: 1920, height: 1080 }),
      );
      expect(result.success).toBe(true);
      expect(result.url).toBe('https://example.com/');
      expect(result.title).toBe('Example');
      expect(caps.isConnected()).toBe(true);
    });

    it('re-uses the existing session on subsequent calls (single launch)', async () => {
      await caps.navigate('https://example.com/');
      await caps.navigate('https://example.com/page2');
      expect(chromeLauncherMock.launch).toHaveBeenCalledTimes(1);
    });

    it('close() tears down the CDP client and kills the Chrome process', async () => {
      await caps.navigate('https://example.com/');
      await caps.close();

      expect(cdp.close).toHaveBeenCalled();
      expect(kill).toHaveBeenCalled();
      expect(caps.isConnected()).toBe(false);
    });

    it('launches with default viewport/visibility when no configureSession() was called', async () => {
      await caps.navigate('https://example.com/');

      const launchArgs = chromeLauncherMock.launch.mock.calls[0][0] as {
        chromeFlags: string[];
      };
      expect(launchArgs.chromeFlags).not.toContain('--headless');
      expect(launchArgs.chromeFlags).toContain('--window-size=1920,1080');
      expect(cdp.Emulation.setDeviceMetricsOverride).toHaveBeenCalledWith(
        expect.objectContaining({ width: 1920, height: 1080 }),
      );
    });

    it('honours configureSession() options on the first session (headless + viewport)', async () => {
      caps.configureSession({
        headless: true,
        viewport: { width: 1280, height: 720 },
      });

      await caps.navigate('https://example.com/');

      const launchArgs = chromeLauncherMock.launch.mock.calls[0][0] as {
        chromeFlags: string[];
      };
      expect(launchArgs.chromeFlags).toContain('--headless');
      expect(launchArgs.chromeFlags).toContain('--window-size=1280,720');
      expect(cdp.Emulation.setDeviceMetricsOverride).toHaveBeenCalledWith(
        expect.objectContaining({ width: 1280, height: 720 }),
      );

      const status = await caps.status();
      expect(status.headless).toBe(true);
      expect(status.viewport).toEqual({ width: 1280, height: 720 });
    });

    it('resets to defaults on a subsequent session after close() (cleanup clears _pendingOptions)', async () => {
      caps.configureSession({
        headless: true,
        viewport: { width: 800, height: 600 },
      });
      await caps.navigate('https://example.com/');
      await caps.close();

      // No new configureSession() before second session — should fall back to defaults.
      await caps.navigate('https://example.com/page2');

      const secondLaunchArgs = chromeLauncherMock.launch.mock.calls[1][0] as {
        chromeFlags: string[];
      };
      expect(secondLaunchArgs.chromeFlags).not.toContain('--headless');
      expect(secondLaunchArgs.chromeFlags).toContain('--window-size=1920,1080');
    });
  });

  describe('error paths', () => {
    it('wraps chrome-launcher failures in a "Chrome/Chromium not found" error', async () => {
      chromeLauncherMock.launch.mockRejectedValueOnce(new Error('ENOENT'));
      const result = await caps.navigate('https://example.com/');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Chrome.*not found/i);
    });

    it('kills Chrome and surfaces an error when CDP connect fails', async () => {
      cdpMock.default.mockRejectedValueOnce(new Error('port in use'));
      const result = await caps.navigate('https://example.com/');
      expect(kill).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Failed to connect to Chrome.*port in use/);
    });
  });

  describe('screenshot()', () => {
    it('requests PNG by default with no quality and fullPage=false', async () => {
      await caps.navigate('https://example.com/');
      const result = await caps.screenshot();

      expect(cdp.Page.captureScreenshot).toHaveBeenCalledWith({
        format: 'png',
        quality: undefined,
        captureBeyondViewport: false,
      });
      expect(result.data).toBe('BASE64PNG');
      expect(result.format).toBe('png');
    });

    it('passes jpeg + quality + fullPage through to Page.captureScreenshot', async () => {
      await caps.navigate('https://example.com/');
      await caps.screenshot({ format: 'jpeg', quality: 42, fullPage: true });

      expect(cdp.Page.captureScreenshot).toHaveBeenLastCalledWith({
        format: 'jpeg',
        quality: 42,
        captureBeyondViewport: true,
      });
    });
  });

  describe('evaluate()', () => {
    it('maps CDP exceptionDetails to the result.error field', async () => {
      await caps.navigate('https://example.com/');
      cdp.Runtime.evaluate.mockResolvedValueOnce({
        result: { value: null, type: 'undefined' },
        exceptionDetails: {
          text: 'boom',
          exception: { description: 'ReferenceError: x is not defined' },
        },
      });

      const result = await caps.evaluate('x');
      expect(result.type).toBe('error');
      expect(result.error).toMatch(/ReferenceError/);
    });

    it('returns value/type on a successful evaluation', async () => {
      await caps.navigate('https://example.com/');
      cdp.Runtime.evaluate.mockResolvedValueOnce({
        result: { value: 42, type: 'number' },
      });

      const result = await caps.evaluate('21 + 21');
      expect(result).toEqual({ value: 42, type: 'number' });
    });
  });

  describe('click() / type() / getContent() — element-not-found', () => {
    beforeEach(async () => {
      await caps.navigate('https://example.com/');
    });

    it('click() returns success=false when the selector does not match', async () => {
      cdp.Runtime.evaluate.mockResolvedValueOnce({
        result: { value: { found: false }, type: 'object' },
      });
      const result = await caps.click('#missing');
      expect(result).toEqual({
        success: false,
        error: 'Element not found: #missing',
      });
    });

    it('type() returns success=false when the selector does not match and never calls Input.insertText', async () => {
      cdp.Runtime.evaluate.mockResolvedValueOnce({
        result: { value: { found: false }, type: 'object' },
      });
      const result = await caps.type('#missing', 'hello');
      expect(result.success).toBe(false);
      expect(cdp.Input.insertText).not.toHaveBeenCalled();
    });

    it('type() calls Input.insertText after successful focus', async () => {
      cdp.Runtime.evaluate.mockResolvedValueOnce({
        result: { value: { found: true }, type: 'object' },
      });
      const result = await caps.type('#input', 'ptah');
      expect(result.success).toBe(true);
      expect(cdp.Input.insertText).toHaveBeenCalledWith({ text: 'ptah' });
    });

    it('getContent() returns html/text when the element exists', async () => {
      cdp.Runtime.evaluate.mockResolvedValueOnce({
        result: {
          value: { html: '<p>x</p>', text: 'x' },
          type: 'object',
        },
      });
      const result = await caps.getContent('p');
      expect(result.html).toBe('<p>x</p>');
      expect(result.text).toBe('x');
    });
  });

  describe('network capture', () => {
    it('returns an error when no session is active', async () => {
      const result = await caps.getNetworkRequests();
      expect(result.requests).toEqual([]);
      expect(result.error).toMatch(/No active browser session/);
    });

    it('records requests as Network.requestWillBeSent → responseReceived listeners fire', async () => {
      await caps.navigate('https://example.com/');
      expect(cdp.Network.requestListener).toBeDefined();
      expect(cdp.Network.responseListener).toBeDefined();

      cdp.Network.requestListener?.({
        requestId: '1',
        request: { url: 'https://example.com/a.js', method: 'GET' },
        type: 'Script',
      });
      cdp.Network.responseListener?.({
        requestId: '1',
        response: { status: 200, headers: { 'content-length': '42' } },
      });

      const { requests } = await caps.getNetworkRequests();
      expect(requests).toEqual([
        {
          url: 'https://example.com/a.js',
          method: 'GET',
          status: 200,
          type: 'Script',
          size: 42,
        },
      ]);
    });
  });

  describe('status()', () => {
    it('returns { connected: false } when no session is active', async () => {
      const result = await caps.status();
      expect(result).toEqual({ connected: false });
    });

    it('returns connected=true with url/title/viewport when a session exists', async () => {
      await caps.navigate('https://example.com/');
      const result = await caps.status();
      expect(result.connected).toBe(true);
      expect(result.url).toBe('https://example.com/');
      expect(result.title).toBe('Example');
      expect(result.viewport).toEqual({ width: 1920, height: 1080 });
      expect(result.headless).toBe(false);
    });
  });

  describe('recording', () => {
    it('startRecording() starts the CDP screencast and registers a frame listener', async () => {
      const result = await caps.startRecording({
        maxFrames: 10,
        frameDelay: 200,
      });
      expect(result.success).toBe(true);
      expect(cdp.Page.startScreencast).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'jpeg' }),
      );
      expect(cdp.Page.screencastFrame).toHaveBeenCalledTimes(1);
    });

    it('startRecording() refuses when a recording is already in progress', async () => {
      await caps.startRecording();
      const second = await caps.startRecording();
      expect(second.success).toBe(false);
      expect(second.error).toMatch(/already in progress/i);
    });

    it('stopRecording() returns an error when nothing is being recorded', async () => {
      await caps.navigate('https://example.com/');
      const result = await caps.stopRecording();
      expect(result.error).toMatch(/no recording in progress/i);
    });

    it('stopRecording() stops the CDP screencast before assembling the GIF', async () => {
      await caps.startRecording();
      await caps.stopRecording();
      expect(cdp.Page.stopScreencast).toHaveBeenCalled();
    });

    it('stopRecording() still stops the CDP screencast when the page escaped', async () => {
      await caps.startRecording();
      cdp.Page.getFrameTree.mockResolvedValueOnce({
        frameTree: { frame: { url: 'data:text/html,escaped' } },
      });
      const result = await caps.stopRecording();
      expect(result.error).toMatch(/outside the workspace/);
      expect(result.filePath).toBe('');
      expect(cdp.Page.stopScreencast).toHaveBeenCalled();
    });
  });

  describe('workspace file guard', () => {
    let root: string;
    let outside: string;
    let insideUrl: string;
    let outsideUrl: string;

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-browser-root-'));
      outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-browser-out-'));
      const insideFile = path.join(root, 'page.html');
      const outsideFile = path.join(outside, 'secret.html');
      fs.writeFileSync(insideFile, '<p>inside</p>');
      fs.writeFileSync(outsideFile, 'SECRET');
      insideUrl = pathToFileURL(insideFile).href;
      outsideUrl = pathToFileURL(outsideFile).href;
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    });

    it('omits --allow-file-access-from-files and --disable-web-security', async () => {
      await caps.navigate('https://example.com/');
      const launchArgs = chromeLauncherMock.launch.mock.calls[0][0] as {
        chromeFlags: string[];
      };
      expect(launchArgs.chromeFlags).not.toContain(
        '--allow-file-access-from-files',
      );
      expect(launchArgs.chromeFlags).not.toContain('--disable-web-security');
    });

    it('installs file: interception before the first navigation', async () => {
      caps.configureSession({ workspaceRoots: [root] });
      await caps.navigate('https://example.com/');
      expect(cdp.Fetch.enable).toHaveBeenCalledWith({
        patterns: [{ urlPattern: 'file:*', requestStage: 'Request' }],
      });
      const enableOrder = cdp.Fetch.enable.mock.invocationCallOrder[0];
      const navigateOrder = cdp.Page.navigate.mock.invocationCallOrder[0];
      expect(enableOrder).toBeLessThan(navigateOrder);
    });

    it('fulfills canonical bytes for an inside file and fails an outside file', async () => {
      caps.configureSession({ workspaceRoots: [root] });
      await caps.navigate('https://example.com/');
      expect(cdp.Fetch.listener).toBeDefined();

      await cdp.Fetch.listener?.({
        requestId: 'in',
        request: { url: insideUrl },
      });
      await cdp.Fetch.listener?.({
        requestId: 'out',
        request: { url: outsideUrl },
      });

      const insideFile = path.join(root, 'page.html');
      expect(cdp.Fetch.fulfillRequest).toHaveBeenCalledWith({
        requestId: 'in',
        responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'text/html; charset=utf-8' },
        ],
        body: fs.readFileSync(insideFile).toString('base64'),
      });
      expect(cdp.Fetch.continueRequest).not.toHaveBeenCalled();
      expect(cdp.Fetch.failRequest).toHaveBeenCalledWith({
        requestId: 'out',
        errorReason: 'BlockedByClient',
      });
    });

    it('closes a page target opened by the tool tab', async () => {
      await caps.navigate('https://example.com/');
      expect(cdp.Target.setAutoAttach).toHaveBeenCalledWith({
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
      });
      await cdp.Target.listener?.({
        sessionId: 'popup',
        waitingForDebugger: true,
        targetInfo: {
          targetId: 'popup-target',
          type: 'page',
          openerId: 'tab-1',
        },
      });
      expect(cdp.Target.closeTarget).toHaveBeenCalledWith({
        targetId: 'popup-target',
      });
      expect(cdp.Target.runIfWaitingForDebugger).not.toHaveBeenCalled();
      expect(cdp.Runtime.runIfWaitingForDebugger).not.toHaveBeenCalled();
    });

    it('resumes an attached worker or iframe with Runtime.runIfWaitingForDebugger', async () => {
      await caps.navigate('https://example.com/');
      await cdp.Target.listener?.({
        sessionId: 'worker-1',
        waitingForDebugger: true,
        targetInfo: { targetId: 'worker-target', type: 'worker' },
      });
      await cdp.Target.listener?.({
        sessionId: 'frame-1',
        waitingForDebugger: true,
        targetInfo: { targetId: 'frame-target', type: 'iframe' },
      });
      const fetchOrder = cdp.Fetch.enable.mock.invocationCallOrder;
      const resumeOrder =
        cdp.Runtime.runIfWaitingForDebugger.mock.invocationCallOrder;
      expect(cdp.Fetch.enable).toHaveBeenCalledWith(
        { patterns: [{ urlPattern: 'file:*', requestStage: 'Request' }] },
        'worker-1',
      );
      expect(cdp.Runtime.runIfWaitingForDebugger).toHaveBeenCalledWith(
        {},
        'worker-1',
      );
      expect(cdp.Runtime.runIfWaitingForDebugger).toHaveBeenCalledWith(
        {},
        'frame-1',
      );
      expect(fetchOrder[fetchOrder.length - 2]).toBeLessThan(resumeOrder[0]);
      expect(fetchOrder[fetchOrder.length - 1]).toBeLessThan(resumeOrder[1]);
      expect(cdp.Target.closeTarget).not.toHaveBeenCalled();
    });

    it('omits url, title, and network entries when the page scheme is refused', async () => {
      await caps.navigate('https://example.com/');
      cdp.Network.requestListener?.({
        requestId: '1',
        request: { url: 'https://example.com/a.js', method: 'GET' },
        type: 'Script',
      });
      cdp.Network.responseListener?.({
        requestId: '1',
        response: { status: 200, headers: { 'content-length': '4' } },
      });
      cdp.Page.getFrameTree.mockResolvedValue({
        frameTree: { frame: { url: 'data:text/html,hi' } },
      });
      const pageStatus = await caps.status();
      expect(pageStatus.connected).toBe(true);
      expect(pageStatus.url).toBeUndefined();
      expect(pageStatus.title).toBeUndefined();
      expect(pageStatus.viewport).toEqual({ width: 1920, height: 1080 });
      const { requests, error } = await caps.getNetworkRequests();
      expect(requests).toEqual([]);
      expect(error).toBeUndefined();
    });

    it('withholds a data: or javascript: follow-on and blanks the page', async () => {
      caps.configureSession({ workspaceRoots: [root] });
      await caps.navigate('https://example.com/');
      cdp.Page.navigate.mockClear();
      cdp.Page.getFrameTree.mockResolvedValue({
        frameTree: { frame: { url: 'data:text/html,hi' } },
      });
      const dataShot = await caps.screenshot();
      expect(dataShot.data).toBe('');
      expect(dataShot.error).toMatch(/outside the workspace/);
      expect(cdp.Page.captureScreenshot).not.toHaveBeenCalled();
      expect(cdp.Page.navigate).toHaveBeenCalledWith({ url: 'about:blank' });

      cdp.Page.getFrameTree.mockResolvedValue({
        frameTree: { frame: { url: 'javascript:alert(1)' } },
      });
      const scriptShot = await caps.screenshot();
      expect(scriptShot.data).toBe('');
      expect(cdp.Page.captureScreenshot).not.toHaveBeenCalled();
    });

    it('answers a paused file request on the child session that sent it', async () => {
      caps.configureSession({ workspaceRoots: [root] });
      await caps.navigate('https://example.com/');
      await cdp.Fetch.listener?.(
        { requestId: 'child-in', request: { url: insideUrl } },
        'child-session-1',
      );
      expect(cdp.Fetch.fulfillRequest).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'child-in' }),
        'child-session-1',
      );
      await cdp.Fetch.listener?.(
        { requestId: 'child-out', request: { url: outsideUrl } },
        'child-session-1',
      );
      expect(cdp.Fetch.failRequest).toHaveBeenCalledWith(
        { requestId: 'child-out', errorReason: 'BlockedByClient' },
        'child-session-1',
      );
    });

    it('keeps roots configured while the browser session is starting', async () => {
      caps.configureSession({ workspaceRoots: [root] });
      chromeLauncherMock.launch.mockImplementationOnce(async () => {
        caps.configureSession({ workspaceRoots: [outside] });
        return { port: 9222, kill };
      });
      await caps.navigate('https://example.com/');
      expect(chromeLauncherMock.launch).toHaveBeenCalledTimes(1);
      await cdp.Fetch.listener?.({
        requestId: 'moved',
        request: { url: outsideUrl },
      });
      const outsideFile = path.join(outside, 'secret.html');
      expect(cdp.Fetch.fulfillRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'moved',
          body: fs.readFileSync(outsideFile).toString('base64'),
        }),
      );
      await cdp.Fetch.listener?.({
        requestId: 'old',
        request: { url: insideUrl },
      });
      expect(cdp.Fetch.failRequest).toHaveBeenCalledWith({
        requestId: 'old',
        errorReason: 'BlockedByClient',
      });
    });

    it('does not open the page when the file guard cannot be installed', async () => {
      cdp.Fetch.enable.mockRejectedValueOnce(new Error('no fetch'));
      const result = await caps.navigate('https://example.com/');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/file-access guard/i);
      expect(cdp.Page.navigate).not.toHaveBeenCalled();
      expect(kill).toHaveBeenCalled();
    });

    it('withholds screenshot and evaluate when the current page is an outside file', async () => {
      caps.configureSession({ workspaceRoots: [root] });
      await caps.navigate('https://example.com/');
      cdp.Page.getFrameTree.mockResolvedValue({
        frameTree: { frame: { url: outsideUrl } },
      });

      const shot = await caps.screenshot();
      expect(shot.data).toBe('');
      expect(shot.error).toMatch(/outside the workspace/);
      expect(shot.error).not.toContain('SECRET');
      expect(shot.error).not.toContain(outsideUrl);
      expect(cdp.Page.captureScreenshot).not.toHaveBeenCalled();

      const evaluated = await caps.evaluate('document.body.innerText');
      expect(evaluated.type).toBe('error');
      expect(evaluated.error).toMatch(/outside the workspace/);
      expect(evaluated.error).not.toContain('SECRET');
    });

    it('starts a new session when workspace roots change and keeps it when they do not', async () => {
      await caps.navigate('https://example.com/');
      caps.configureSession({ workspaceRoots: [root] });
      await caps.navigate('https://example.com/');
      caps.configureSession({ workspaceRoots: [root] });
      await caps.navigate('https://example.com/again');
      expect(chromeLauncherMock.launch).toHaveBeenCalledTimes(2);
    });
  });
});
