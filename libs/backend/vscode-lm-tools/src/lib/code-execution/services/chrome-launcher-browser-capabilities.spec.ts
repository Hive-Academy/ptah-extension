/**
 * Specs for ChromeLauncherBrowserCapabilities (TASK_2026_100 P1.B7).
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const chromeLauncherMock = require('chrome-launcher') as {
  launch: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
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
  Runtime: { enable: jest.Mock; evaluate: jest.Mock };
  Emulation: { setDeviceMetricsOverride: jest.Mock };
  Input: { insertText: jest.Mock };
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
    captureScreenshot: jest.fn().mockResolvedValue({ data: 'BASE64PNG' }),
    startScreencast: jest.fn().mockResolvedValue(undefined),
    stopScreencast: jest.fn().mockResolvedValue(undefined),
    screencastFrame: jest.fn(),
    screencastFrameAck: jest.fn().mockResolvedValue(undefined),
  };

  const Runtime = {
    enable: jest.fn().mockResolvedValue(undefined),
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

  const close = jest.fn().mockResolvedValue(undefined);

  const client: Record<string, unknown> = {
    Page,
    Network: networkState,
    Runtime,
    Emulation,
    Input,
    close,
  };

  return {
    client,
    Page,
    Network: networkState,
    Runtime,
    Emulation,
    Input,
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
      // NOTE: there is a latent bug in createSession() — it calls cleanup()
      // as the first step, which clears _pendingOptions before they can be
      // consumed, so configureSession() settings are effectively dropped on
      // the very first session creation. This test asserts the observed
      // default-path behaviour; see spec B7 bug report.
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
  });
});
