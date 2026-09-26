/**
 * Specs for buildBrowserNamespace.
 *
 * Covers ptah.browser.* in two modes:
 *   - Capability-backed — delegation to IBrowserCapabilities, URL blocklist
 *     enforcement, viewport/expression-length validation, try/catch envelope
 *     that maps thrown errors into structured result objects.
 *   - Graceful-degradation — no capabilities wired returns fixed error
 *     payloads for every method.
 *   - validateBrowserUrl — exported pure helper covers blocked schemes and
 *     localhost toggling.
 */

import {
  buildBrowserNamespace,
  validateBrowserUrl,
  type BrowserNamespaceDependencies,
  type IBrowserCapabilities,
} from './browser-namespace.builder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCapabilities(): jest.Mocked<IBrowserCapabilities> {
  return {
    configureSession: jest.fn(),
    navigate: jest.fn().mockResolvedValue({
      success: true,
      url: 'https://example.com',
      title: 'Ex',
    }),
    screenshot: jest.fn().mockResolvedValue({ data: 'base64', format: 'png' }),
    evaluate: jest.fn().mockResolvedValue({ value: 42, type: 'number' }),
    click: jest.fn().mockResolvedValue({ success: true }),
    type: jest.fn().mockResolvedValue({ success: true }),
    getContent: jest.fn().mockResolvedValue({ html: '<p/>', text: 'p' }),
    getNetworkRequests: jest.fn().mockResolvedValue({ requests: [] }),
    close: jest.fn().mockResolvedValue(undefined),
    status: jest.fn().mockResolvedValue({ connected: true }),
    isConnected: jest.fn().mockReturnValue(true),
    startRecording: jest.fn().mockResolvedValue({ success: true }),
    stopRecording: jest.fn().mockResolvedValue({
      filePath: '/tmp/a.gif',
      frameCount: 10,
      durationMs: 1000,
      fileSizeBytes: 2048,
      truncated: false,
    }),
  };
}

// ---------------------------------------------------------------------------
// validateBrowserUrl
// ---------------------------------------------------------------------------

describe('validateBrowserUrl', () => {
  it('accepts http/https URLs and returns undefined', () => {
    expect(validateBrowserUrl('https://example.com')).toBeUndefined();
    expect(validateBrowserUrl('http://example.com')).toBeUndefined();
  });

  it('rejects file/data/chrome/javascript schemes', () => {
    expect(validateBrowserUrl('file:///C:/a.html')).toMatch(/not allowed/);
    expect(validateBrowserUrl('data:text/html,hi')).toMatch(/not allowed/);
    expect(validateBrowserUrl('javascript:alert(1)')).toMatch(/not allowed/);
  });

  it('blocks localhost unless allowLocalhost=true', () => {
    expect(validateBrowserUrl('http://localhost:3000')).toMatch(/localhost/);
    expect(validateBrowserUrl('http://localhost:3000', true)).toBeUndefined();
  });

  it('returns "Invalid URL" for malformed input', () => {
    expect(validateBrowserUrl('not a url')).toMatch(/Invalid URL/);
  });
});

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe('buildBrowserNamespace — shape', () => {
  it('exposes the full method surface in capability-backed mode', () => {
    const ns = buildBrowserNamespace({ capabilities: createCapabilities() });
    for (const fn of [
      'navigate',
      'screenshot',
      'evaluate',
      'click',
      'type',
      'getContent',
      'networkRequests',
      'close',
      'status',
      'recordStart',
      'recordStop',
    ] as const) {
      expect(typeof ns[fn]).toBe('function');
    }
  });

  it('exposes the full method surface in graceful-degradation mode', () => {
    const ns = buildBrowserNamespace({});
    expect(typeof ns.navigate).toBe('function');
    expect(typeof ns.recordStop).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Capability-backed behaviour
// ---------------------------------------------------------------------------

describe('buildBrowserNamespace — capability-backed', () => {
  let capabilities: jest.Mocked<IBrowserCapabilities>;
  let deps: BrowserNamespaceDependencies;

  beforeEach(() => {
    capabilities = createCapabilities();
    deps = { capabilities, getAllowLocalhost: () => false };
  });

  it('navigate() forwards url + waitForLoad and returns the capability result', async () => {
    const ns = buildBrowserNamespace(deps);
    const out = await ns.navigate({ url: 'https://example.com' });
    expect(out).toEqual({
      success: true,
      url: 'https://example.com',
      title: 'Ex',
    });
    expect(capabilities.navigate).toHaveBeenCalledWith(
      'https://example.com',
      true,
    );
  });

  it('navigate() rejects blocked URLs without touching capabilities', async () => {
    const ns = buildBrowserNamespace(deps);
    const out = await ns.navigate({ url: 'file:///evil.html' });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/not allowed/);
    expect(capabilities.navigate).not.toHaveBeenCalled();
  });

  it('navigate() validates viewport bounds', async () => {
    const ns = buildBrowserNamespace(deps);
    const out = await ns.navigate({
      url: 'https://example.com',
      viewport: { width: 0, height: 100 },
    });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/Invalid viewport/);
  });

  it('navigate() wraps capability errors into structured result', async () => {
    capabilities.navigate.mockRejectedValue(new Error('kaboom'));
    const ns = buildBrowserNamespace(deps);
    const out = await ns.navigate({ url: 'https://example.com' });
    expect(out).toEqual({
      success: false,
      url: 'https://example.com',
      title: '',
      error: 'kaboom',
    });
  });

  // TASK_2026_559 Batch 17 (User Decision 3): jpeg at quality 60 is the
  // default; an explicit format or quality is honoured.
  describe('screenshot() format and quality', () => {
    it('defaults to jpeg at quality 60 when neither is given', async () => {
      const ns = buildBrowserNamespace(deps);
      await ns.screenshot();
      expect(capabilities.screenshot).toHaveBeenCalledWith({
        format: 'jpeg',
        quality: 60,
      });
    });

    it('defaults to jpeg at quality 60 for an empty params object and keeps fullPage', async () => {
      const ns = buildBrowserNamespace(deps);
      await ns.screenshot({ fullPage: true });
      expect(capabilities.screenshot).toHaveBeenCalledWith({
        format: 'jpeg',
        quality: 60,
        fullPage: true,
      });
    });

    it('honours an explicit webp and applies the default quality', async () => {
      const ns = buildBrowserNamespace(deps);
      await ns.screenshot({ format: 'webp' });
      expect(capabilities.screenshot).toHaveBeenCalledWith({
        format: 'webp',
        quality: 60,
      });
    });

    it('applies an explicit quality given without a format to the jpeg default', async () => {
      const ns = buildBrowserNamespace(deps);
      await ns.screenshot({ quality: 85 });
      expect(capabilities.screenshot).toHaveBeenCalledWith({
        format: 'jpeg',
        quality: 85,
      });
    });

    it('honours an explicit jpeg quality, including the 0 and 100 bounds', async () => {
      const ns = buildBrowserNamespace(deps);
      await ns.screenshot({ format: 'jpeg', quality: 0 });
      await ns.screenshot({ format: 'jpeg', quality: 100 });
      expect(capabilities.screenshot.mock.calls.map((c) => c[0])).toEqual([
        { format: 'jpeg', quality: 0 },
        { format: 'jpeg', quality: 100 },
      ]);
    });

    it.each([[-1], [101], [50.5], [Number.NaN]])(
      'rejects quality %p without invoking the capability',
      async (quality) => {
        const ns = buildBrowserNamespace(deps);
        const out = await ns.screenshot({ quality });
        expect(out).toEqual({
          data: '',
          format: 'jpeg',
          error: 'Invalid quality. Must be an integer between 0 and 100.',
        });
        expect(capabilities.screenshot).not.toHaveBeenCalled();
      },
    );

    it.each([['webp' as const], ['jpeg' as const]])(
      'rejects an out-of-range quality for an explicit %s',
      async (format) => {
        const ns = buildBrowserNamespace(deps);
        const out = await ns.screenshot({ format, quality: 101 });
        expect(out.error).toBe(
          'Invalid quality. Must be an integer between 0 and 100.',
        );
        expect(capabilities.screenshot).not.toHaveBeenCalled();
      },
    );

    // Batch 17 r1 S1: png ignores quality, so no quality value blocks it.
    it.each([[undefined], [-1], [101], [50.5], [Number.NaN], [80]])(
      'captures an explicit png with quality %p and sends no quality',
      async (quality) => {
        const ns = buildBrowserNamespace(deps);
        const out = await ns.screenshot({ format: 'png', quality });
        expect(out.error).toBeUndefined();
        expect(capabilities.screenshot).toHaveBeenCalledTimes(1);
        const sent = capabilities.screenshot.mock.calls[0][0];
        expect(sent?.format).toBe('png');
        expect(sent?.quality).toBeUndefined();
      },
    );

    it('reports the resolved default format when the capability throws', async () => {
      capabilities.screenshot.mockRejectedValueOnce(new Error('no page'));
      const ns = buildBrowserNamespace(deps);
      await expect(ns.screenshot()).resolves.toEqual({
        data: '',
        format: 'jpeg',
        error: 'no page',
      });
    });
  });

  it('evaluate() rejects oversized expressions without invoking capability', async () => {
    const ns = buildBrowserNamespace(deps);
    const huge = 'x'.repeat(65 * 1024);
    const out = await ns.evaluate({ expression: huge });
    expect(out.type).toBe('error');
    expect(out.error).toMatch(/exceeds maximum length/);
    expect(capabilities.evaluate).not.toHaveBeenCalled();
  });

  it('click() rejects empty selector without invoking capability', async () => {
    const ns = buildBrowserNamespace(deps);
    const out = await ns.click({ selector: '   ' });
    expect(out).toEqual({ success: false, error: 'Selector cannot be empty' });
    expect(capabilities.click).not.toHaveBeenCalled();
  });

  it('close() returns {success:true} and surfaces errors', async () => {
    const ns = buildBrowserNamespace(deps);
    await expect(ns.close()).resolves.toEqual({ success: true });
    capabilities.close.mockRejectedValueOnce(new Error('stuck'));
    await expect(ns.close()).resolves.toEqual({
      success: false,
      error: 'stuck',
    });
  });

  it('recordStop() returns zeroed payload with error on failure', async () => {
    capabilities.stopRecording.mockRejectedValueOnce(new Error('nope'));
    const ns = buildBrowserNamespace(deps);
    const out = await ns.recordStop();
    expect(out).toEqual({
      filePath: '',
      frameCount: 0,
      durationMs: 0,
      fileSizeBytes: 0,
      truncated: false,
      error: 'nope',
    });
  });
});

// ---------------------------------------------------------------------------
// Graceful degradation
// ---------------------------------------------------------------------------

// Batch 17 r1: the CLI registers a placeholder under the browser token that
// has none of the IBrowserCapabilities methods (cli-engine container.ts).
describe('buildBrowserNamespace — placeholder host without browser methods', () => {
  const cliPlaceholder = {
    launch: async () => {
      throw new Error('Browser automation not available in CLI');
    },
    close: async () => undefined,
    getStatus: () => ({ launched: false }),
  } as unknown as IBrowserCapabilities;

  it('answers screenshot() with the not-available error instead of a TypeError', async () => {
    const ns = buildBrowserNamespace({ capabilities: cliPlaceholder });
    const out = await ns.screenshot();
    expect(out.data).toBe('');
    expect(out.error).toMatch(
      /^Browser capabilities not available on this platform\./,
    );
  });

  it('answers navigate() and status() the same way', async () => {
    const ns = buildBrowserNamespace({ capabilities: cliPlaceholder });
    const nav = await ns.navigate({ url: 'https://example.com' });
    expect(nav.error).toMatch(/not available on this platform/);
    await expect(ns.status()).resolves.toEqual({ connected: false });
  });
});

describe('buildBrowserNamespace — graceful degradation', () => {
  it('every method returns a fixed error payload indicating unavailability', async () => {
    const ns = buildBrowserNamespace({});

    const nav = await ns.navigate({ url: 'https://example.com' });
    expect(nav.success).toBe(false);
    expect(nav.error).toMatch(/not available/i);

    const ev = await ns.evaluate({ expression: '1+1' });
    expect(ev.type).toBe('error');

    const st = await ns.status();
    expect(st.connected).toBe(false);
  });
});
