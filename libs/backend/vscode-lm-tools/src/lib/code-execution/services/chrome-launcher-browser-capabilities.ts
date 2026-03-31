/**
 * Chrome Launcher Browser Capabilities
 * TASK_2025_244: CDP browser integration using chrome-launcher + chrome-remote-interface
 *
 * Launches a Chrome instance with --remote-debugging-port and connects via CDP.
 * Used in VS Code (or any non-Electron platform) where Electron BrowserWindow is unavailable.
 *
 * Session lifecycle: 5-min inactivity timeout, 30-min max lifetime, auto-cleanup.
 */

import type { IBrowserCapabilities } from '../namespace-builders/browser-namespace.builder';

// Dynamic imports to avoid bundling issues when this module isn't used (e.g., Electron)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let launchChrome: ((...args: any[]) => Promise<any>) | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let CDPClient: ((...args: any[]) => Promise<any>) | undefined;

async function loadDependencies(): Promise<void> {
  if (!launchChrome) {
    const chromeLauncher = await import('chrome-launcher');
    launchChrome = chromeLauncher.launch;
  }
  if (!CDPClient) {
    CDPClient = (await import('chrome-remote-interface')).default;
  }
}

/** Network request entry stored in ring buffer */
interface NetworkEntry {
  url: string;
  method: string;
  status: number;
  type: string;
  size?: number;
}

const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_LIFETIME_MS = 30 * 60 * 1000; // 30 minutes
const MAX_NETWORK_ENTRIES = 500;

export class ChromeLauncherBrowserCapabilities implements IBrowserCapabilities {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private chrome: any = null; // chrome-launcher instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null; // chrome-remote-interface client
  private _connected = false;
  private startedAt: number | null = null;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
  private networkEntries: NetworkEntry[] = [];
  private pendingResponses = new Map<
    string,
    { method: string; url: string; type: string }
  >();
  /** Concurrency guard — prevents duplicate session creation from parallel calls */
  private sessionPromise: Promise<void> | null = null;

  async navigate(
    url: string,
    waitForLoad = true,
  ): Promise<{ success: boolean; url: string; title: string; error?: string }> {
    try {
      await this.ensureSession();
      this.resetInactivityTimer();

      const { Page, Runtime } = this.client;

      if (waitForLoad) {
        // Navigate and wait for load event with 30-second timeout
        const loadTimeout = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Page load timed out after 30 seconds')),
            30000,
          ),
        );
        await Promise.race([
          Promise.all([Page.loadEventFired(), Page.navigate({ url })]),
          loadTimeout,
        ]);
      } else {
        await Page.navigate({ url });
      }

      // Get final URL and title
      const evalResult = await Runtime.evaluate({
        expression:
          'JSON.stringify({ url: location.href, title: document.title })',
        returnByValue: true,
      });

      const pageInfo = JSON.parse(evalResult.result.value as string) as {
        url: string;
        title: string;
      };

      return { success: true, url: pageInfo.url, title: pageInfo.title };
    } catch (error) {
      return {
        success: false,
        url,
        title: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async screenshot(options?: {
    format?: string;
    quality?: number;
    fullPage?: boolean;
  }): Promise<{ data: string; format: string; error?: string }> {
    const fmt = options?.format ?? 'png';
    try {
      await this.ensureSession();
      this.resetInactivityTimer();

      const { Page } = this.client;
      const result = await Page.captureScreenshot({
        format: fmt === 'png' ? 'png' : fmt === 'webp' ? 'webp' : 'jpeg',
        quality: fmt === 'png' ? undefined : (options?.quality ?? 80),
        captureBeyondViewport: options?.fullPage ?? false,
      });

      return { data: result.data, format: fmt };
    } catch (error) {
      return {
        data: '',
        format: fmt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async evaluate(
    expression: string,
    returnByValue = true,
  ): Promise<{ value: unknown; type: string; error?: string }> {
    try {
      await this.ensureSession();
      this.resetInactivityTimer();

      const { Runtime } = this.client;
      const result = await Runtime.evaluate({
        expression,
        returnByValue,
        awaitPromise: true,
        timeout: 10000,
      });

      if (result.exceptionDetails) {
        return {
          value: null,
          type: 'error',
          error:
            result.exceptionDetails.exception?.description ??
            result.exceptionDetails.text ??
            'Evaluation error',
        };
      }

      return { value: result.result.value, type: result.result.type };
    } catch (error) {
      return {
        value: null,
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async click(selector: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureSession();
      this.resetInactivityTimer();

      const evalResult = await this.evaluate(
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { found: false };
          el.click();
          return { found: true };
        })()`,
      );

      if (evalResult.error) {
        return { success: false, error: evalResult.error };
      }

      const val = evalResult.value as { found: boolean } | null;
      if (!val?.found) {
        return { success: false, error: `Element not found: ${selector}` };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async type(
    selector: string,
    text: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureSession();
      this.resetInactivityTimer();

      // Focus the element
      const focusResult = await this.evaluate(
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { found: false };
          el.focus();
          return { found: true };
        })()`,
      );

      if (focusResult.error) {
        return { success: false, error: focusResult.error };
      }

      const val = focusResult.value as { found: boolean } | null;
      if (!val?.found) {
        return { success: false, error: `Element not found: ${selector}` };
      }

      // Type using Input.insertText
      const { Input } = this.client;
      await Input.insertText({ text });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getContent(
    selector?: string,
  ): Promise<{ html: string; text: string; error?: string }> {
    try {
      await this.ensureSession();
      this.resetInactivityTimer();

      const sel = selector ? JSON.stringify(selector) : "'html'";

      const result = await this.evaluate(
        `(() => {
          const el = document.querySelector(${sel});
          if (!el) return { html: '', text: '', error: 'Element not found' };
          return { html: el.outerHTML, text: el.innerText || el.textContent || '' };
        })()`,
      );

      if (result.error) {
        return { html: '', text: '', error: result.error };
      }

      return result.value as { html: string; text: string; error?: string };
    } catch (error) {
      return {
        html: '',
        text: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getNetworkRequests(limit = 50): Promise<{
    requests: Array<{
      url: string;
      method: string;
      status: number;
      type: string;
      size?: number;
    }>;
    error?: string;
  }> {
    if (!this.isConnected()) {
      return {
        requests: [],
        error: 'No active browser session. Navigate to a page first.',
      };
    }
    this.resetInactivityTimer();
    const entries = this.networkEntries.slice(
      -Math.min(limit, MAX_NETWORK_ENTRIES),
    );
    return { requests: entries };
  }

  async close(): Promise<void> {
    await this.cleanup();
  }

  async status(): Promise<{
    connected: boolean;
    url?: string;
    title?: string;
    uptimeMs?: number;
    autoCloseInMs?: number;
  }> {
    if (!this._connected || !this.client) {
      return { connected: false };
    }

    try {
      const { Runtime } = this.client;
      const result = await Runtime.evaluate({
        expression:
          'JSON.stringify({ url: location.href, title: document.title })',
        returnByValue: true,
      });

      const pageInfo = JSON.parse(result.result.value as string) as {
        url: string;
        title: string;
      };

      const uptimeMs = this.startedAt ? Date.now() - this.startedAt : 0;
      const autoCloseInMs = this.startedAt
        ? Math.max(0, MAX_LIFETIME_MS - uptimeMs)
        : 0;

      return {
        connected: true,
        url: pageInfo.url,
        title: pageInfo.title,
        uptimeMs,
        autoCloseInMs,
      };
    } catch {
      return { connected: false };
    }
  }

  isConnected(): boolean {
    return this._connected && !!this.client;
  }

  /**
   * Clean up resources. Call on extension deactivation.
   */
  async dispose(): Promise<void> {
    await this.cleanup();
  }

  // ========================================
  // Private helpers
  // ========================================

  private async ensureSession(): Promise<void> {
    if (this._connected && this.client && this.chrome) {
      return;
    }

    // Concurrency guard: if a session is already being created, await it
    if (this.sessionPromise) {
      await this.sessionPromise;
      return;
    }

    this.sessionPromise = this.createSession();
    try {
      await this.sessionPromise;
    } finally {
      this.sessionPromise = null;
    }
  }

  private async createSession(): Promise<void> {
    // Clean up any stale state from a crashed session (auto-reconnect)
    await this.cleanup();

    await loadDependencies();

    if (!launchChrome || !CDPClient) {
      throw new Error(
        'Chrome dependencies not available. Ensure chrome-launcher and chrome-remote-interface are installed.',
      );
    }

    // Launch Chrome with remote debugging
    try {
      this.chrome = await launchChrome({
        chromeFlags: [
          '--headless',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-extensions',
          '--disable-translate',
          '--disable-background-networking',
        ],
        // Let chrome-launcher pick an available port
        port: 0,
      });
    } catch (error) {
      throw new Error(
        `Chrome/Chromium not found. Please install Google Chrome to use browser automation tools. ` +
          `(${error instanceof Error ? error.message : String(error)})`,
      );
    }

    // Connect CDP client
    try {
      this.client = await CDPClient({ port: this.chrome.port });
    } catch (error) {
      await this.chrome.kill();
      this.chrome = null;
      throw new Error(
        `Failed to connect to Chrome: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Enable CDP domains
    const { Page, Network, Runtime } = this.client;
    await Page.enable();
    await Network.enable();
    await Runtime.enable();

    // Set up network monitoring
    this.networkEntries = [];
    this.pendingResponses.clear();

    Network.requestWillBeSent(
      (params: {
        requestId: string;
        request: { url: string; method: string };
        type?: string;
      }) => {
        this.pendingResponses.set(params.requestId, {
          method: params.request.method,
          url: params.request.url,
          type: params.type ?? 'Other',
        });
      },
    );

    Network.responseReceived(
      (params: {
        requestId: string;
        response: {
          status: number;
          headers?: Record<string, string>;
        };
      }) => {
        const pending = this.pendingResponses.get(params.requestId);
        if (pending) {
          const contentLength = params.response.headers?.['content-length'];
          this.networkEntries.push({
            url: pending.url,
            method: pending.method,
            status: params.response.status,
            type: pending.type,
            size: contentLength ? parseInt(contentLength, 10) : undefined,
          });

          if (this.networkEntries.length > MAX_NETWORK_ENTRIES) {
            this.networkEntries =
              this.networkEntries.slice(-MAX_NETWORK_ENTRIES);
          }

          this.pendingResponses.delete(params.requestId);
        }
      },
    );

    this._connected = true;
    this.startedAt = Date.now();

    // Set up session lifecycle timers
    this.resetInactivityTimer();
    this.lifetimeTimer = setTimeout(() => {
      this.cleanup();
    }, MAX_LIFETIME_MS);
  }

  private resetInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }
    this.inactivityTimer = setTimeout(() => {
      this.cleanup();
    }, INACTIVITY_TIMEOUT_MS);
  }

  private async cleanup(): Promise<void> {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    if (this.lifetimeTimer) {
      clearTimeout(this.lifetimeTimer);
      this.lifetimeTimer = null;
    }

    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // Client may already be closed
      }
      this.client = null;
    }

    if (this.chrome) {
      try {
        await this.chrome.kill();
      } catch {
        // Chrome may already be killed
      }
      this.chrome = null;
    }

    this._connected = false;
    this.startedAt = null;
    this.networkEntries = [];
    this.pendingResponses.clear();
  }
}
