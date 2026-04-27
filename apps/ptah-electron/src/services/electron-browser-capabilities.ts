/**
 * Electron Browser Capabilities
 * TASK_2025_244: CDP browser integration using Electron's native BrowserWindow
 * TASK_2025_254: Visible mode, screen recording, inactivity timer control
 *
 * Uses a dedicated BrowserWindow with webContents.debugger for CDP access.
 * Zero external dependencies — leverages Electron's built-in Chromium engine.
 *
 * Session lifecycle: 5-min inactivity timeout (headless) / 15-min (visible),
 * 30-min max lifetime, auto-cleanup.
 */

import { BrowserWindow } from 'electron';
import type {
  IBrowserCapabilities,
  BrowserSessionOptions,
} from '@ptah-extension/vscode-lm-tools';
import { ScreenRecorderService } from '@ptah-extension/vscode-lm-tools';

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

/** Default viewport dimensions (desktop) */
const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };

export class ElectronBrowserCapabilities implements IBrowserCapabilities {
  private window: BrowserWindow | null = null;
  private connected = false;
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
  /** Whether current session is headless — agent-controlled, default false (visible) */
  private _headless = false;
  /** Current viewport dimensions — agent-controlled, default 1920x1080 (desktop) */
  private _viewport = { ...DEFAULT_VIEWPORT };
  /** Pending session options set by configureSession(), consumed by createSession() */
  private _pendingOptions: BrowserSessionOptions = {};
  constructor(private readonly getRecordingDir: () => string = () => '') {}

  configureSession(options: BrowserSessionOptions): void {
    this._pendingOptions = { ...this._pendingOptions, ...options };
  }

  async navigate(
    url: string,
    waitForLoad = true,
  ): Promise<{ success: boolean; url: string; title: string; error?: string }> {
    try {
      await this.ensureSession();
      this.resetInactivityTimer();

      const win = this.window;
      if (!win) {
        throw new Error(
          'ElectronBrowserCapabilities.navigate: BrowserWindow is null after ensureSession()',
        );
      }

      if (waitForLoad) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Page load timed out after 30 seconds')),
            30000,
          );
          win.webContents.once('did-finish-load', () => {
            clearTimeout(timeout);
            resolve();
          });
          win.webContents.once('did-fail-load', (_e, code, desc) => {
            clearTimeout(timeout);
            reject(new Error(`Page load failed: ${desc} (code ${code})`));
          });
          win.loadURL(url);
        });
      } else {
        win.loadURL(url);
      }

      const title = win.webContents.getTitle();
      const finalUrl = win.webContents.getURL();

      return { success: true, url: finalUrl, title };
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

      const result = await this.sendCDP('Page.captureScreenshot', {
        format: fmt === 'png' ? 'png' : fmt === 'webp' ? 'webp' : 'jpeg',
        quality: fmt === 'png' ? undefined : (options?.quality ?? 80),
        captureBeyondViewport: options?.fullPage ?? false,
      });

      return { data: result.data as string, format: fmt };
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

      const result = await this.sendCDP('Runtime.evaluate', {
        expression,
        returnByValue,
        awaitPromise: true,
        timeout: 10000,
      });

      const remote = result.result as {
        type: string;
        value?: unknown;
        description?: string;
      };
      const exceptionDetails = result.exceptionDetails as
        | { text?: string; exception?: { description?: string } }
        | undefined;

      if (exceptionDetails) {
        return {
          value: null,
          type: 'error',
          error:
            exceptionDetails.exception?.description ??
            exceptionDetails.text ??
            'Evaluation error',
        };
      }

      return { value: remote.value, type: remote.type };
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
        return {
          success: false,
          error: `Element not found: ${selector}`,
        };
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
        return {
          success: false,
          error: `Element not found: ${selector}`,
        };
      }

      // Type the text using Input.insertText
      await this.sendCDP('Input.insertText', { text });

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
    viewport?: { width: number; height: number };
  }> {
    if (!this.connected || !this.window || this.window.isDestroyed()) {
      return { connected: false };
    }

    const uptimeMs = this.startedAt ? Date.now() - this.startedAt : 0;
    const autoCloseInMs = this.startedAt
      ? Math.max(0, MAX_LIFETIME_MS - uptimeMs)
      : 0;

    return {
      connected: true,
      url: this.window.webContents.getURL(),
      title: this.window.webContents.getTitle(),
      uptimeMs,
      autoCloseInMs,
      headless: this._headless,
      recording: this.recorder?.isRecording() ?? false,
      viewport: { ...this._viewport },
    };
  }

  isConnected(): boolean {
    return this.connected && !!this.window && !this.window.isDestroyed();
  }

  /**
   * Clean up resources. Call on app shutdown.
   */
  async dispose(): Promise<void> {
    await this.cleanup();
  }

  // ========================================
  // Private helpers
  // ========================================

  private async ensureSession(): Promise<void> {
    if (this.window && !this.window.isDestroyed() && this.connected) {
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

    // Consume pending session options (agent-controlled headless + viewport)
    this._headless = this._pendingOptions.headless ?? false;
    this._viewport = this._pendingOptions.viewport
      ? { ...this._pendingOptions.viewport }
      : { ...DEFAULT_VIEWPORT };
    this._pendingOptions = {};

    // Create BrowserWindow — visible when not headless
    this.window = new BrowserWindow({
      show: !this._headless,
      width: this._viewport.width,
      height: this._viewport.height,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });

    // Attach CDP debugger
    try {
      this.window.webContents.debugger.attach('1.3');
    } catch (err) {
      this.window.destroy();
      this.window = null;
      throw new Error(
        `Failed to attach debugger: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Enable CDP domains
    await this.sendCDP('Page.enable', {});
    await this.sendCDP('Network.enable', {});
    await this.sendCDP('Runtime.enable', {});

    // Set viewport via CDP Emulation (matches ChromeLauncherBrowserCapabilities behavior)
    await this.sendCDP('Emulation.setDeviceMetricsOverride', {
      width: this._viewport.width,
      height: this._viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // Set up network monitoring
    this.networkEntries = [];
    this.pendingResponses.clear();

    this.window.webContents.debugger.on(
      'message',
      (
        _event: Electron.Event,
        method: string,
        params: Record<string, unknown>,
      ) => {
        this.handleCDPEvent(method, params);
      },
    );

    // Handle window destruction
    this.window.on('closed', () => {
      this.connected = false;
      this.window = null;
    });

    this.connected = true;
    this.startedAt = Date.now();

    // Set up session lifecycle timers
    this.resetInactivityTimer();
    this.lifetimeTimer = setTimeout(() => {
      this.cleanup();
    }, MAX_LIFETIME_MS);
  }

  private async sendCDP(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this.window || this.window.isDestroyed()) {
      throw new Error('Browser session not active');
    }
    return this.window.webContents.debugger.sendCommand(
      method,
      params,
    ) as Promise<Record<string, unknown>>;
  }

  private handleCDPEvent(
    method: string,
    params: Record<string, unknown>,
  ): void {
    if (method === 'Network.requestWillBeSent') {
      const request = params.request as {
        url: string;
        method: string;
      };
      const requestId = params.requestId as string;
      const type = (params.type as string) ?? 'Other';

      this.pendingResponses.set(requestId, {
        method: request.method,
        url: request.url,
        type,
      });
    }

    if (method === 'Network.responseReceived') {
      const requestId = params.requestId as string;
      const response = params.response as {
        status: number;
        headers?: Record<string, string>;
      };

      const pending = this.pendingResponses.get(requestId);
      if (pending) {
        const contentLength = response.headers?.['content-length'];

        this.networkEntries.push({
          url: pending.url,
          method: pending.method,
          status: response.status,
          type: pending.type,
          size: contentLength ? parseInt(contentLength, 10) : undefined,
        });

        // Ring buffer — keep only the last N entries
        if (this.networkEntries.length > MAX_NETWORK_ENTRIES) {
          this.networkEntries = this.networkEntries.slice(-MAX_NETWORK_ENTRIES);
        }

        this.pendingResponses.delete(requestId);
      }
    }

    // TASK_2025_254: Handle screencast frames for recording
    if (method === 'Page.screencastFrame') {
      const data = params.data as string;
      const sessionId = params.sessionId as number;

      // Acknowledge frame immediately to avoid backpressure
      this.sendCDP('Page.screencastFrameAck', { sessionId }).catch(
        (_ackError: unknown) => {
          // Intentionally swallowed: ack failures are non-critical
        },
      );

      // Add frame data to ring buffer
      this.recorder?.addFrame(data);
    }
  }

  private resetInactivityTimer(): void {
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

    if (this.window && !this.window.isDestroyed()) {
      try {
        this.window.webContents.debugger.detach();
      } catch {
        // Debugger may already be detached
      }
      this.window.destroy();
    }

    this.window = null;
    this.connected = false;
    this.startedAt = null;
    this.networkEntries = [];
    this.pendingResponses.clear();
    this._pendingOptions = {};
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

      // Start CDP screencast via Electron debugger
      await this.sendCDP('Page.startScreencast', {
        format: 'jpeg',
        quality: 60,
        maxWidth: 1280,
        maxHeight: 720,
        everyNthFrame: 3,
      });

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
      if (this.connected && this.window && !this.window.isDestroyed()) {
        await this.sendCDP('Page.stopScreencast', {}).catch(
          (_stopError: unknown) => {
            // Intentionally swallowed: screencast may already be stopped
          },
        );
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
