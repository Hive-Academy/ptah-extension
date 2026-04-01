/**
 * Chrome Launcher Browser Capabilities
 * TASK_2025_244: CDP browser integration using chrome-launcher + chrome-remote-interface
 *
 * Launches a Chrome instance with --remote-debugging-port and connects via CDP.
 * Used in VS Code (or any non-Electron platform) where Electron BrowserWindow is unavailable.
 *
 * Session lifecycle: 5-min inactivity timeout (headless) / 15-min (visible),
 * 30-min max lifetime, auto-cleanup.
 */

import type { IBrowserCapabilities } from '../namespace-builders/browser-namespace.builder';
import { ScreenRecorderService } from './screen-recorder.service';

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

const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes (headless)
const VISIBLE_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes (visible, TASK_2025_254)
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

  /** Recording service (TASK_2025_254) */
  private recorder: ScreenRecorderService | null = null;
  /** Whether the screencast frame listener has been registered on the current CDP client */
  private screencastListenerRegistered = false;
  /** Whether current session is headless (TASK_2025_254) */
  private _headless = true;
  /** Inactivity timer paused flag (TASK_2025_254) */
  private _inactivityPaused = false;

  constructor(
    private readonly getHeadless: () => boolean = () => true,
    private readonly getRecordingDir: () => string = () => '',
  ) {}

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
    headless?: boolean;
    recording?: boolean;
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
        headless: this._headless,
        recording: this.recorder?.isRecording() ?? false,
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

    // Read headless setting at session creation time (TASK_2025_254)
    this._headless = this.getHeadless();

    // Launch Chrome with remote debugging
    try {
      const chromeFlags = [
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-translate',
        '--disable-background-networking',
      ];

      // Conditionally include --headless (TASK_2025_254)
      if (this._headless) {
        chromeFlags.unshift('--headless');
      }

      this.chrome = await launchChrome({
        chromeFlags,
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
    // TASK_2025_254: Skip reset if timer is paused during wait-for-user
    if (this._inactivityPaused) return;

    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }

    // TASK_2025_254: Use longer timeout for visible mode
    const timeout = this._headless
      ? INACTIVITY_TIMEOUT_MS
      : VISIBLE_INACTIVITY_TIMEOUT_MS;

    this.inactivityTimer = setTimeout(() => {
      this.cleanup();
    }, timeout);
  }

  /**
   * Pause the inactivity timer. Used during wait-for-user interactions
   * to prevent the session from closing while the user is active.
   * (TASK_2025_254)
   */
  pauseInactivityTimer(): void {
    this._inactivityPaused = true;
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  /**
   * Resume the inactivity timer after a wait-for-user interaction completes.
   * (TASK_2025_254)
   */
  resumeInactivityTimer(): void {
    this._inactivityPaused = false;
    this.resetInactivityTimer();
  }

  private async cleanup(): Promise<void> {
    // TASK_2025_254: Stop recording if active (best-effort GIF save)
    if (this.recorder?.isRecording()) {
      try {
        const recordingDir = this.getRecordingDir();
        await this.recorder.stopRecording(recordingDir || undefined);
      } catch {
        // Best-effort: don't let recording cleanup failure block session cleanup
      }
    }
    this.recorder = null;

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
    this.screencastListenerRegistered = false;
    this.startedAt = null;
    this.networkEntries = [];
    this.pendingResponses.clear();
  }

  // Recording methods (TASK_2025_254)

  async startRecording(options?: {
    maxFrames?: number;
    frameDelay?: number;
  }): Promise<{ success: boolean; error?: string }> {
    if (this.recorder?.isRecording()) {
      return {
        success: false,
        error:
          'Recording already in progress. Stop the current recording first.',
      };
    }

    try {
      await this.ensureSession();
      this.resetInactivityTimer();

      // Initialize recorder
      this.recorder = new ScreenRecorderService();
      const startResult = this.recorder.startRecording(options);
      if (!startResult.success) {
        return startResult;
      }

      // Start CDP screencast
      const { Page } = this.client;
      await Page.startScreencast({
        format: 'jpeg',
        quality: 60,
        maxWidth: 1280,
        maxHeight: 720,
        everyNthFrame: 3,
      });

      // Register the frame listener only once per CDP session to prevent accumulation
      // across start/stop recording cycles. The listener checks isRecording() to
      // avoid processing frames when recording is inactive.
      if (!this.screencastListenerRegistered) {
        Page.screencastFrame(
          (params: {
            data: string;
            metadata: { timestamp: number };
            sessionId: number;
          }) => {
            // Acknowledge frame immediately to avoid backpressure
            Page.screencastFrameAck({ sessionId: params.sessionId }).catch(
              (_ackError: unknown) => {
                // Intentionally swallowed: ack failures are non-critical
              },
            );

            // Only buffer frames when actively recording
            if (this.recorder?.isRecording()) {
              this.recorder.addFrame(params.data);
            }
          },
        );
        this.screencastListenerRegistered = true;
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async stopRecording(): Promise<{
    filePath: string;
    frameCount: number;
    durationMs: number;
    fileSizeBytes: number;
    truncated: boolean;
    error?: string;
  }> {
    if (!this.recorder?.isRecording()) {
      return {
        filePath: '',
        frameCount: 0,
        durationMs: 0,
        fileSizeBytes: 0,
        truncated: false,
        error: 'No recording in progress.',
      };
    }

    try {
      // Stop CDP screencast
      if (this._connected && this.client) {
        const { Page } = this.client;
        await Page.stopScreencast().catch((_stopError: unknown) => {
          // Intentionally swallowed: screencast may already be stopped
        });
      }

      // Assemble GIF
      const recordingDir = this.getRecordingDir();
      return await this.recorder.stopRecording(recordingDir || undefined);
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
  }
}
