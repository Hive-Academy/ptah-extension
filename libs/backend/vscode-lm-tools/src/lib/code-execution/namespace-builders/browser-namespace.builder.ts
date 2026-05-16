/**
 * Browser Namespace Builder
 *
 * CDP browser integration for AI agent access.
 * Builds the browser namespace with navigate, screenshot, evaluate, click,
 * type, getContent, networkRequests, close, and status methods.
 *
 * When IBrowserCapabilities is provided, delegates to the platform implementation.
 * When IBrowserCapabilities is absent, returns graceful degradation stubs
 * that return error objects with descriptive messages.
 *
 * Pattern: ide-namespace.builder.ts (IIDECapabilities + graceful degradation)
 */

import type {
  BrowserNamespace,
  BrowserNavigateResult,
  BrowserScreenshotResult,
  BrowserEvaluateResult,
  BrowserClickResult,
  BrowserTypeResult,
  BrowserContentResult,
  BrowserNetworkResult,
  BrowserStatusResult,
  BrowserRecordStartResult,
  BrowserRecordStopResult,
  ViewportDimensions,
} from '../types';

// ========================================
// IBrowserCapabilities Interface
// ========================================

/**
 * Platform-specific browser automation capabilities interface.
 *
 * In Electron, this is implemented by ElectronBrowserCapabilities which uses
 * a dedicated hidden BrowserWindow with webContents.debugger for CDP access.
 *
 * In VS Code, this is implemented by ChromeLauncherBrowserCapabilities which
 * uses chrome-launcher to auto-discover Chrome and chrome-remote-interface
 * for CDP communication over WebSocket.
 *
 * In standalone/fallback mode, this interface is NOT provided, and
 * buildBrowserNamespace() returns graceful degradation stubs instead.
 */
/**
 * Session options that the agent can configure before a browser session is created.
 * These only take effect when creating a NEW session — if a session already exists,
 * they are stored for the next session creation.
 */
export interface BrowserSessionOptions {
  /** Whether to run in headless mode (default: false — visible browser) */
  headless?: boolean;
  /** Viewport dimensions (default: 1920x1080 — desktop) */
  viewport?: ViewportDimensions;
}

export interface IBrowserCapabilities {
  /**
   * Configure session options for the next browser session creation.
   * These options are consumed by ensureSession()/createSession() when
   * a new session is lazily started (e.g., on first navigate call).
   *
   * If a session already exists, the options are stored and will apply
   * when the current session is closed and a new one is created.
   */
  configureSession(options: BrowserSessionOptions): void;

  navigate(
    url: string,
    waitForLoad?: boolean,
  ): Promise<{ success: boolean; url: string; title: string; error?: string }>;

  screenshot(options?: {
    format?: string;
    quality?: number;
    fullPage?: boolean;
  }): Promise<{ data: string; format: string; error?: string }>;

  evaluate(
    expression: string,
    returnByValue?: boolean,
  ): Promise<{ value: unknown; type: string; error?: string }>;

  click(selector: string): Promise<{ success: boolean; error?: string }>;

  type(
    selector: string,
    text: string,
  ): Promise<{ success: boolean; error?: string }>;

  getContent(
    selector?: string,
  ): Promise<{ html: string; text: string; error?: string }>;

  getNetworkRequests(limit?: number): Promise<{
    requests: Array<{
      url: string;
      method: string;
      status: number;
      type: string;
      size?: number;
    }>;
    error?: string;
  }>;

  close(): Promise<void>;

  status(): Promise<{
    connected: boolean;
    url?: string;
    title?: string;
    uptimeMs?: number;
    autoCloseInMs?: number;
    headless?: boolean;
    recording?: boolean;
    viewport?: ViewportDimensions;
  }>;

  isConnected(): boolean;

  // Recording methods

  /** Start recording browser session frames for GIF assembly */
  startRecording(options?: {
    maxFrames?: number;
    frameDelay?: number;
  }): Promise<{ success: boolean; error?: string }>;

  /** Stop recording and assemble captured frames into a GIF file */
  stopRecording(): Promise<{
    filePath: string;
    frameCount: number;
    durationMs: number;
    fileSizeBytes: number;
    truncated: boolean;
    error?: string;
  }>;
}

// ========================================
// URL Validation (Security)
// ========================================

const BLOCKED_SCHEMES = [
  'file:',
  'chrome:',
  'chrome-extension:',
  'about:',
  'data:',
  'javascript:',
];
const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'];
const MAX_EXPRESSION_LENGTH = 64 * 1024; // 64KB

/**
 * Validate a URL against the security blocklist.
 * Only http: and https: schemes are allowed.
 * Localhost is blocked by default (configurable via allowLocalhost).
 *
 * @param url - URL to validate
 * @param allowLocalhost - Whether to allow localhost URLs (default: false)
 * @returns Error message if URL is blocked, undefined if allowed
 */
export function validateBrowserUrl(
  url: string,
  allowLocalhost = false,
): string | undefined {
  try {
    const parsed = new URL(url);

    // Check blocked schemes
    if (BLOCKED_SCHEMES.includes(parsed.protocol)) {
      return `Blocked: ${parsed.protocol} URLs are not allowed for security reasons. Only http: and https: are permitted.`;
    }

    // Only allow http and https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return `Blocked: ${parsed.protocol} URLs are not allowed. Only http: and https: are permitted.`;
    }

    // Check blocked hosts (unless localhost is allowed)
    if (!allowLocalhost && BLOCKED_HOSTS.includes(parsed.hostname)) {
      return `Blocked: ${parsed.hostname} URLs are blocked by default. Enable ptah.browser.allowLocalhost in settings to allow local dev server access.`;
    }

    return undefined; // URL is allowed
  } catch {
    return `Blocked: Invalid URL "${url}". Only valid http: and https: URLs are allowed.`;
  }
}

// ========================================
// Graceful Degradation Message
// ========================================

const BROWSER_NOT_AVAILABLE_MSG =
  'Browser capabilities not available on this platform. Browser automation requires either the Electron app (built-in) or Chrome installed on your system (VS Code extension).';

// ========================================
// BrowserNamespaceDependencies
// ========================================

/**
 * Dependencies required to build the browser namespace.
 *
 * @property capabilities - Optional IBrowserCapabilities from DI.
 *   Provided in Electron (ElectronBrowserCapabilities) and VS Code (ChromeLauncherBrowserCapabilities).
 *   Undefined when no browser capabilities are available (graceful degradation).
 * @property getAllowLocalhost - Function returning the ptah.browser.allowLocalhost setting value.
 */
export interface BrowserNamespaceDependencies {
  capabilities?: IBrowserCapabilities;
  getAllowLocalhost?: () => boolean;
  // Note: recordingDir is configured via the capabilities constructor, not here.
  // Note: headless and viewport are agent-controlled via navigate params, not settings.
}

// ========================================
// buildBrowserNamespace
// ========================================

/**
 * Build the browser namespace with CDP-backed browser automation methods.
 *
 * When capabilities are provided, delegates all operations to the platform
 * implementation (Electron webContents.debugger or chrome-launcher + chrome-remote-interface).
 *
 * When capabilities are undefined, returns graceful degradation stubs that
 * return error objects with descriptive messages.
 *
 * @param deps - Dependencies (capabilities + config accessors)
 * @returns BrowserNamespace with all 9 methods
 */
export function buildBrowserNamespace(
  deps: BrowserNamespaceDependencies,
): BrowserNamespace {
  const { capabilities, getAllowLocalhost } = deps;

  if (!capabilities) {
    return buildGracefulBrowserNamespace();
  }

  return buildCapabilityBackedBrowserNamespace(capabilities, getAllowLocalhost);
}

// ========================================
// Capability-Backed Namespace
// ========================================

function buildCapabilityBackedBrowserNamespace(
  capabilities: IBrowserCapabilities,
  getAllowLocalhost?: () => boolean,
): BrowserNamespace {
  return {
    navigate: async (params): Promise<BrowserNavigateResult> => {
      // Validate URL against security blocklist
      const allowLocalhost = getAllowLocalhost?.() ?? false;
      const validationError = validateBrowserUrl(params.url, allowLocalhost);
      if (validationError) {
        return {
          success: false,
          url: params.url,
          title: '',
          error: validationError,
        };
      }

      // Validate viewport dimensions if provided
      if (params.viewport) {
        const { width, height } = params.viewport;
        if (
          !Number.isInteger(width) ||
          !Number.isInteger(height) ||
          width < 1 ||
          height < 1 ||
          width > 7680 ||
          height > 7680
        ) {
          return {
            success: false,
            url: params.url,
            title: '',
            error:
              'Invalid viewport dimensions. Width and height must be positive integers between 1 and 7680.',
          };
        }
      }

      try {
        // Pass agent-controlled session options (headless, viewport) to capabilities.
        // These only take effect when creating a NEW session.
        if (params.headless !== undefined || params.viewport) {
          capabilities.configureSession({
            ...(params.headless !== undefined && { headless: params.headless }),
            ...(params.viewport && { viewport: params.viewport }),
          });
        }

        return await capabilities.navigate(
          params.url,
          params.waitForLoad ?? true,
        );
      } catch (error) {
        return {
          success: false,
          url: params.url,
          title: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    screenshot: async (params): Promise<BrowserScreenshotResult> => {
      try {
        return await capabilities.screenshot(params);
      } catch (error) {
        return {
          data: '',
          format: params?.format ?? 'png',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    evaluate: async (params): Promise<BrowserEvaluateResult> => {
      // Enforce expression size limit
      if (params.expression.length > MAX_EXPRESSION_LENGTH) {
        return {
          value: null,
          type: 'error',
          error: `Expression exceeds maximum length of ${MAX_EXPRESSION_LENGTH} bytes (${params.expression.length} bytes provided).`,
        };
      }

      try {
        return await capabilities.evaluate(
          params.expression,
          params.returnByValue ?? true,
        );
      } catch (error) {
        return {
          value: null,
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    click: async (params): Promise<BrowserClickResult> => {
      if (!params.selector || params.selector.trim().length === 0) {
        return { success: false, error: 'Selector cannot be empty' };
      }
      try {
        return await capabilities.click(params.selector);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    type: async (params): Promise<BrowserTypeResult> => {
      if (!params.selector || params.selector.trim().length === 0) {
        return { success: false, error: 'Selector cannot be empty' };
      }
      if (params.text === undefined || params.text === null) {
        return { success: false, error: 'Text cannot be empty' };
      }
      try {
        return await capabilities.type(params.selector, params.text);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    getContent: async (params): Promise<BrowserContentResult> => {
      try {
        return await capabilities.getContent(params?.selector);
      } catch (error) {
        return {
          html: '',
          text: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    networkRequests: async (params): Promise<BrowserNetworkResult> => {
      try {
        return await capabilities.getNetworkRequests(params?.limit ?? 50);
      } catch (error) {
        return {
          requests: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    close: async (): Promise<{ success: boolean; error?: string }> => {
      try {
        await capabilities.close();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    status: async (): Promise<BrowserStatusResult> => {
      try {
        return await capabilities.status();
      } catch (error) {
        return {
          connected: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    recordStart: async (params): Promise<BrowserRecordStartResult> => {
      try {
        return await capabilities.startRecording(params);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    recordStop: async (): Promise<BrowserRecordStopResult> => {
      try {
        return await capabilities.stopRecording();
      } catch (error) {
        return {
          filePath: '',
          frameCount: 0,
          durationMs: 0,
          fileSizeBytes: 0,
          truncated: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

// ========================================
// Graceful Degradation Namespace
// ========================================

function buildGracefulBrowserNamespace(): BrowserNamespace {
  return {
    navigate: async (params) => ({
      success: false,
      url: params.url,
      title: '',
      error: BROWSER_NOT_AVAILABLE_MSG,
    }),
    screenshot: async () => ({
      data: '',
      format: 'png',
      error: BROWSER_NOT_AVAILABLE_MSG,
    }),
    evaluate: async () => ({
      value: null,
      type: 'error',
      error: BROWSER_NOT_AVAILABLE_MSG,
    }),
    click: async () => ({
      success: false,
      error: BROWSER_NOT_AVAILABLE_MSG,
    }),
    type: async () => ({
      success: false,
      error: BROWSER_NOT_AVAILABLE_MSG,
    }),
    getContent: async () => ({
      html: '',
      text: '',
      error: BROWSER_NOT_AVAILABLE_MSG,
    }),
    networkRequests: async () => ({
      requests: [],
      error: BROWSER_NOT_AVAILABLE_MSG,
    }),
    close: async () => ({
      success: false,
      error: BROWSER_NOT_AVAILABLE_MSG,
    }),
    status: async () => ({
      connected: false,
    }),
    recordStart: async () => ({
      success: false,
      error: BROWSER_NOT_AVAILABLE_MSG,
    }),
    recordStop: async () => ({
      filePath: '',
      frameCount: 0,
      durationMs: 0,
      fileSizeBytes: 0,
      truncated: false,
      error: BROWSER_NOT_AVAILABLE_MSG,
    }),
  };
}
