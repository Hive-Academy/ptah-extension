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
