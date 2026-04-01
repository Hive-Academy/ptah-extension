/**
 * Browser Namespace Builder
 * TASK_2025_244: CDP browser integration for AI agent access
 *
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
  BrowserWaitForUserResult,
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
export interface IBrowserCapabilities {
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
  }>;

  isConnected(): boolean;

  // Recording methods (TASK_2025_254)

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

  /** Pause inactivity timer (during wait-for-user). Optional -- only needed for TASK_2025_254. */
  pauseInactivityTimer?(): void;
  /** Resume inactivity timer (after wait-for-user). Optional -- only needed for TASK_2025_254. */
  resumeInactivityTimer?(): void;
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
  /** Returns whether the browser should run in headless mode (TASK_2025_254) */
  getHeadless?: () => boolean;
  // Note: recordingDir is configured via the capabilities constructor, not here.
  /**
   * Wait-for-user implementation (TASK_2025_254).
   * In VS Code: uses WebviewManager + PermissionPromptService.
   * In Electron: uses dialog.showMessageBox.
   * Returns { ready, reason?, waitDurationMs }.
   */
  waitForUser?: (params: {
    message: string;
    timeout?: number;
  }) => Promise<BrowserWaitForUserResult>;
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
  const { capabilities, getAllowLocalhost, getHeadless, waitForUser } = deps;

  if (!capabilities) {
    return buildGracefulBrowserNamespace();
  }

  return buildCapabilityBackedBrowserNamespace(
    capabilities,
    getAllowLocalhost,
    getHeadless,
    waitForUser,
  );
}

// ========================================
// Capability-Backed Namespace
// ========================================

function buildCapabilityBackedBrowserNamespace(
  capabilities: IBrowserCapabilities,
  getAllowLocalhost?: () => boolean,
  getHeadless?: () => boolean,
  waitForUser?: (params: {
    message: string;
    timeout?: number;
  }) => Promise<BrowserWaitForUserResult>,
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

      try {
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

    waitForUser: async (params): Promise<BrowserWaitForUserResult> => {
      // Require active session
      if (!capabilities.isConnected()) {
        return {
          ready: false,
          waitDurationMs: 0,
          error: 'No active browser session. Navigate to a page first.',
        };
      }

      // Check the session's actual headless state (not the live config setting,
      // which may have changed after session creation)
      const statusResult = await capabilities.status();
      const isHeadless = statusResult.headless ?? getHeadless?.() ?? true;
      if (isHeadless) {
        return {
          ready: false,
          waitDurationMs: 0,
          error:
            'Wait-for-user requires visible browser mode. Set ptah.browser.headless to false in settings and restart the browser session.',
        };
      }

      // Delegate to platform-specific implementation
      if (!waitForUser) {
        return {
          ready: false,
          waitDurationMs: 0,
          error: 'Wait-for-user not available on this platform.',
        };
      }

      // Pause inactivity timer during user interaction
      capabilities.pauseInactivityTimer?.();
      try {
        return await waitForUser(params);
      } finally {
        // Resume inactivity timer after user interaction completes
        capabilities.resumeInactivityTimer?.();
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
    waitForUser: async () => ({
      ready: false,
      waitDurationMs: 0,
      error: BROWSER_NOT_AVAILABLE_MSG,
    }),
  };
}
