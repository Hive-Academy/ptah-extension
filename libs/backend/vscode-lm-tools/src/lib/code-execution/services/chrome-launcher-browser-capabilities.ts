/**
 * Chrome Launcher Browser Capabilities
 *
 * CDP browser integration using chrome-launcher + chrome-remote-interface.
 * Launches a Chrome instance with --remote-debugging-port and connects via CDP.
 * Used in VS Code (or any non-Electron platform) where Electron BrowserWindow is unavailable.
 *
 * Session lifecycle: 5-min inactivity timeout (headless) / 15-min (visible),
 * 30-min max lifetime, auto-cleanup.
 */

import type {
  IBrowserCapabilities,
  BrowserSessionOptions,
} from '../namespace-builders/browser-namespace.builder';
import {
  ESCAPED_PAGE_MESSAGE,
  evaluateFileUrl,
  FILE_URL_BLOCKED_MESSAGE,
  readContainedWorkspaceFile,
  sameWorkspaceRoots,
  toolMayReadPage,
} from '../namespace-builders/browser-file-url';
import { ScreenRecorderService } from './screen-recorder.service';
let launchChrome: ((...args: any[]) => Promise<any>) | undefined;
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
const VISIBLE_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes (visible)
const MAX_LIFETIME_MS = 30 * 60 * 1000; // 30 minutes
const MAX_NETWORK_ENTRIES = 500;

/** Default viewport dimensions (desktop) */
const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };

export class ChromeLauncherBrowserCapabilities implements IBrowserCapabilities {
  private chrome: any = null; // chrome-launcher instance
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

  /** Recording service */
  private recorder: ScreenRecorderService | null = null;
  /** Whether the screencast frame listener has been registered on the current CDP client */
  private screencastListenerRegistered = false;
  /** Whether current session is headless — agent-controlled, default false (visible) */
  private _headless = false;
  /** Current viewport dimensions — agent-controlled, default 1920x1080 (desktop) */
  private _viewport = { ...DEFAULT_VIEWPORT };
  /** Pending session options set by configureSession(), consumed by createSession() */
  private _pendingOptions: BrowserSessionOptions = {};
  /** Roots snapshotted when the current Chrome process was created. */
  private sessionRoots: readonly string[] = Object.freeze([]);
  /** Host roots changed; the next ensureSession() starts a new browser. */
  private rootsDirty = false;
  /** Bumps when requested roots differ from the live snapshot. */
  private rootsGeneration = 0;
  /** Generation whose roots were published on the live session. */
  private appliedRootsGeneration = 0;
  /** Follow-on http(s) localhost rule. Default matches validateBrowserUrl. */
  private allowLocalhost = false;
  constructor(private readonly getRecordingDir: () => string = () => '') {}

  configureSession(options: BrowserSessionOptions): void {
    if (options.allowLocalhost !== undefined) {
      this.allowLocalhost = options.allowLocalhost;
    }
    const frozenRoots = options.workspaceRoots
      ? Object.freeze([...options.workspaceRoots])
      : undefined;
    this._pendingOptions = {
      ...this._pendingOptions,
      ...options,
      ...(frozenRoots ? { workspaceRoots: frozenRoots } : {}),
    };
    const nextRoots = this._pendingOptions.workspaceRoots ?? [];
    if (!sameWorkspaceRoots(nextRoots, this.sessionRoots)) {
      this.rootsGeneration += 1;
      if (this._connected) {
        this.rootsDirty = true;
      }
    }
  }

  async navigate(
    url: string,
    waitForLoad = true,
  ): Promise<{ success: boolean; url: string; title: string; error?: string }> {
    try {
      await this.ensureSession();
      this.resetInactivityTimer();
      const destinationBlock = await this.blockFileDestination(url);
      if (destinationBlock) {
        return { success: false, url: '', title: '', error: destinationBlock };
      }

      const { Page, Runtime } = this.client;

      if (waitForLoad) {
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
      const evalResult = await Runtime.evaluate({
        expression:
          'JSON.stringify({ url: location.href, title: document.title })',
        returnByValue: true,
      });

      const pageInfo = JSON.parse(evalResult.result.value as string) as {
        url: string;
        title: string;
      };
      if (
        !(await toolMayReadPage(
          pageInfo.url,
          this.sessionRoots,
          this.allowLocalhost,
        ))
      ) {
        await this.blankEscapedPage();
        return {
          success: false,
          url: '',
          title: '',
          error: ESCAPED_PAGE_MESSAGE,
        };
      }

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
      const escaped = await this.rejectIfPageEscaped();
      if (escaped) {
        return { data: '', format: fmt, error: escaped };
      }

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
      const escaped = await this.rejectIfPageEscaped();
      if (escaped) {
        return { value: null, type: 'error', error: escaped };
      }

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
    if (!(await this.currentPageAllowed())) {
      return { requests: [] };
    }
    const entries = this.networkEntries.slice(
      -Math.min(limit, MAX_NETWORK_ENTRIES),
    );
    const visible: NetworkEntry[] = [];
    for (const entry of entries) {
      if (entry.url.toLowerCase().startsWith('file:')) {
        const decision = await evaluateFileUrl(entry.url, this.sessionRoots);
        if (!decision.allowed) {
          continue;
        }
      }
      visible.push(entry);
    }
    return { requests: visible };
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
    if (!this._connected || !this.client) {
      return { connected: false };
    }

    const uptimeMs = this.startedAt ? Date.now() - this.startedAt : 0;
    const autoCloseInMs = this.startedAt
      ? Math.max(0, MAX_LIFETIME_MS - uptimeMs)
      : 0;
    const metadata = {
      connected: true,
      uptimeMs,
      autoCloseInMs,
      headless: this._headless,
      recording: this.recorder?.isRecording() ?? false,
      viewport: { ...this._viewport },
    };
    if (!(await this.currentPageAllowed())) {
      return metadata;
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

      return {
        ...metadata,
        url: pageInfo.url,
        title: pageInfo.title,
      };
    } catch {
      return metadata;
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

  private async ensureSession(): Promise<void> {
    for (;;) {
      if (
        !this.rootsDirty &&
        this.appliedRootsGeneration === this.rootsGeneration &&
        this._connected &&
        this.client &&
        this.chrome
      ) {
        return;
      }
      if (this.sessionPromise) {
        await this.sessionPromise;
        continue;
      }

      this.sessionPromise = this.createSession();
      try {
        await this.sessionPromise;
      } finally {
        this.sessionPromise = null;
      }
    }
  }

  private async createSession(): Promise<void> {
    const pendingOptions: BrowserSessionOptions = { ...this._pendingOptions };
    await this.cleanup();

    await loadDependencies();

    if (!launchChrome || !CDPClient) {
      throw new Error(
        'Chrome dependencies not available. Ensure chrome-launcher and chrome-remote-interface are installed.',
      );
    }
    this._headless = pendingOptions.headless ?? false;
    this._viewport = pendingOptions.viewport
      ? { ...pendingOptions.viewport }
      : { ...DEFAULT_VIEWPORT };
    try {
      // A file:// document has an opaque origin unless Chrome is launched with
      // --allow-file-access-from-files. That flag, and --disable-web-security,
      // stay absent: script fetch of another file fails. Request interception
      // below is what stops a link, redirect, frame or subresource whose
      // realpath leaves the workspace. Do not cache that realpath.
      const chromeFlags = [
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-translate',
        '--disable-background-networking',
        `--window-size=${this._viewport.width},${this._viewport.height}`,
      ];
      if (this._headless) {
        chromeFlags.unshift('--headless');
      }

      this.chrome = await launchChrome({
        chromeFlags,
        port: 0,
      });
    } catch (error) {
      throw new Error(
        `Chrome/Chromium not found. Please install Google Chrome to use browser automation tools. ` +
          `(${error instanceof Error ? error.message : String(error)})`,
      );
    }
    try {
      this.client = await CDPClient({ port: this.chrome.port });
    } catch (error) {
      await this.chrome.kill();
      this.chrome = null;
      throw new Error(
        `Failed to connect to Chrome: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const { Page, Network, Runtime, Emulation, Fetch, Target } = this.client;
    try {
      await Page.enable();
      await Network.enable();
      await Runtime.enable();
      await this.installFileInterception(Fetch);
      await this.installPopupDenial(Target);
    } catch {
      await this.cleanup();
      throw new Error('Browser file-access guard could not be installed.');
    }
    await Emulation.setDeviceMetricsOverride({
      width: this._viewport.width,
      height: this._viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
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

    // Re-read roots after the awaits. A configureSession during launch
    // updates _pendingOptions; publishing that list here keeps it.
    this.sessionRoots = Object.freeze([
      ...(this._pendingOptions.workspaceRoots ?? []),
    ]);
    this.appliedRootsGeneration = this.rootsGeneration;
    this.rootsDirty = false;
    // Consumed after the awaits, so a configureSession during launch is
    // published above and is not discarded by cleanup().
    this._pendingOptions = {};
    this._connected = true;
    this.startedAt = Date.now();
    this.resetInactivityTimer();
    this.lifetimeTimer = setTimeout(() => {
      this.cleanup();
    }, MAX_LIFETIME_MS);
  }

  private resetInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }
    const timeout = this._headless
      ? INACTIVITY_TIMEOUT_MS
      : VISIBLE_INACTIVITY_TIMEOUT_MS;

    this.inactivityTimer = setTimeout(() => {
      this.cleanup();
    }, timeout);
  }

  private async cleanup(): Promise<void> {
    if (this.recorder?.isRecording()) {
      const recordingDir = this.getRecordingDir();
      await this.recorder.stopRecording(recordingDir || undefined);
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
      await this.client.close();
      this.client = null;
    }

    if (this.chrome) {
      await this.chrome.kill();
      this.chrome = null;
    }

    this._connected = false;
    this.screencastListenerRegistered = false;
    this.startedAt = null;
    this.sessionRoots = Object.freeze([]);
    this.networkEntries = [];
    this.pendingResponses.clear();
  }

  private async blockFileDestination(url: string): Promise<string | undefined> {
    if (!url.toLowerCase().startsWith('file:')) {
      return undefined;
    }
    const decision = await evaluateFileUrl(url, this.sessionRoots);
    return decision.allowed ? undefined : FILE_URL_BLOCKED_MESSAGE;
  }

  private async rejectIfPageEscaped(): Promise<string | undefined> {
    let href: string | undefined;
    try {
      href = await this.readCurrentUrl();
    } catch {
      return ESCAPED_PAGE_MESSAGE;
    }
    if (href === undefined) {
      return ESCAPED_PAGE_MESSAGE;
    }
    if (
      await toolMayReadPage(href, this.sessionRoots, this.allowLocalhost)
    ) {
      return undefined;
    }
    await this.blankEscapedPage();
    return ESCAPED_PAGE_MESSAGE;
  }

  private async currentPageAllowed(): Promise<boolean> {
    let href: string | undefined;
    try {
      href = await this.readCurrentUrl();
    } catch {
      // degradation-audit: optional-capability - an unreadable current URL
      // withholds the page (fail closed).
      return false;
    }
    if (typeof href !== 'string') {
      return false;
    }
    return toolMayReadPage(href, this.sessionRoots, this.allowLocalhost);
  }

  private async readCurrentUrl(): Promise<string | undefined> {
    const page = this.client?.Page as
      | {
          getFrameTree?: () => Promise<{
            frameTree?: { frame?: { url?: unknown } };
          }>;
        }
      | undefined;
    if (!page || typeof page.getFrameTree !== 'function') {
      return undefined;
    }
    const tree = await page.getFrameTree();
    const url = tree?.frameTree?.frame?.url;
    return typeof url === 'string' ? url : undefined;
  }

  private async blankEscapedPage(): Promise<void> {
    try {
      const page = this.client?.Page as
        | { navigate?: (params: { url: string }) => Promise<unknown> }
        | undefined;
      if (page && typeof page.navigate === 'function') {
        await page.navigate({ url: 'about:blank' });
      }
    } catch {
      // degradation-audit: optional-capability - blanking is best-effort;
      // callers still withhold content, screenshots and evaluation.
    }
  }

  private async installFileInterception(fetchDomain: {
    enable?: (params: {
      patterns: Array<{ urlPattern: string; requestStage: string }>;
    }) => Promise<void>;
    requestPaused?: (
      listener: (
        params: {
          requestId: string;
          request?: { url?: string };
          sessionId?: string;
        },
        sessionId?: string,
      ) => Promise<void> | void,
    ) => void;
    fulfillRequest?: (
      params: {
        requestId: string;
        responseCode: number;
        responseHeaders: Array<{ name: string; value: string }>;
        body: string;
      },
      sessionId?: string,
    ) => Promise<void>;
    failRequest?: (
      params: {
        requestId: string;
        errorReason: string;
      },
      sessionId?: string,
    ) => Promise<void>;
  }): Promise<void> {
    if (
      typeof fetchDomain?.enable !== 'function' ||
      typeof fetchDomain.requestPaused !== 'function' ||
      typeof fetchDomain.fulfillRequest !== 'function' ||
      typeof fetchDomain.failRequest !== 'function'
    ) {
      throw new Error('Browser file-access guard could not be installed.');
    }
    const fulfillRequest = fetchDomain.fulfillRequest.bind(fetchDomain);
    const failRequest = fetchDomain.failRequest.bind(fetchDomain);
    // chrome-remote-interface passes the child session id of an attached
    // frame or worker as the second listener argument, not in params.
    fetchDomain.requestPaused((params, sessionId) =>
      this.resolvePausedFileRequest(
        { ...params, sessionId: params.sessionId ?? sessionId },
        fulfillRequest,
        failRequest,
      ),
    );
    await fetchDomain.enable({
      patterns: [{ urlPattern: 'file:*', requestStage: 'Request' }],
    });
  }

  private async installPopupDenial(targetDomain: {
    setAutoAttach?: (params: {
      autoAttach: boolean;
      waitForDebuggerOnStart: boolean;
      flatten: boolean;
    }) => Promise<void>;
    attachedToTarget?: (
      listener: (params: {
        sessionId?: string;
        waitingForDebugger?: boolean;
        targetInfo?: { targetId?: string; type?: string; openerId?: string };
      }) => Promise<void> | void,
    ) => void;
    closeTarget?: (params: { targetId: string }) => Promise<void>;
    runIfWaitingForDebugger?: (params: { sessionId?: string }) => Promise<void>;
  } | null): Promise<void> {
    if (
      !targetDomain ||
      typeof targetDomain.setAutoAttach !== 'function' ||
      typeof targetDomain.attachedToTarget !== 'function' ||
      typeof targetDomain.closeTarget !== 'function'
    ) {
      throw new Error('Browser file-access guard could not be installed.');
    }
    const closeTarget = targetDomain.closeTarget.bind(targetDomain);
    targetDomain.attachedToTarget((params) =>
      this.handleAttachedTarget(params, closeTarget),
    );
    await targetDomain.setAutoAttach({
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    });
  }

  private async handleAttachedTarget(
    params: {
      sessionId?: string;
      waitingForDebugger?: boolean;
      targetInfo?: { targetId?: string; type?: string; openerId?: string };
    },
    closeTarget: (params: { targetId: string }) => Promise<void>,
  ): Promise<void> {
    const info = params.targetInfo;
    if (
      info?.type === 'page' &&
      typeof info.openerId === 'string' &&
      info.openerId.length > 0 &&
      typeof info.targetId === 'string'
    ) {
      await closeTarget({ targetId: info.targetId });
      return;
    }
    if (!params.waitingForDebugger || typeof params.sessionId !== 'string') {
      return;
    }
    const sessionId = params.sessionId;
    const guarded = await this.enableFetchOnSession(sessionId);
    if (!guarded) {
      if (typeof info?.targetId === 'string') {
        await closeTarget({ targetId: info.targetId });
      }
      return;
    }
    const resumed = await this.resumeAttachedSession(sessionId);
    if (!resumed && typeof info?.targetId === 'string') {
      await closeTarget({ targetId: info.targetId });
    }
  }

  private async enableFetchOnSession(sessionId: string): Promise<boolean> {
    const fetchDomain = this.client?.Fetch;
    if (!fetchDomain || typeof fetchDomain.enable !== 'function') {
      return true;
    }
    try {
      await fetchDomain.enable(
        { patterns: [{ urlPattern: 'file:*', requestStage: 'Request' }] },
        sessionId,
      );
      return true;
    } catch {
      // degradation-audit: optional-capability - Fetch.enable failed on the
      // attached session; the caller closes that target instead of resuming it.
      return false;
    }
  }

  private async resumeAttachedSession(sessionId: string): Promise<boolean> {
    const runtime = this.client?.Runtime;
    if (runtime && typeof runtime.runIfWaitingForDebugger === 'function') {
      await runtime.runIfWaitingForDebugger({}, sessionId);
      return true;
    }
    const send = this.client?.send;
    if (typeof send === 'function') {
      await send('Runtime.runIfWaitingForDebugger', {}, sessionId);
      return true;
    }
    return false;
  }

  private async resolvePausedFileRequest(
    params: {
      requestId: string;
      request?: { url?: string };
      sessionId?: string;
    },
    fulfillRequest: (
      paused: {
        requestId: string;
        responseCode: number;
        responseHeaders: Array<{ name: string; value: string }>;
        body: string;
      },
      sessionId?: string,
    ) => Promise<void>,
    failRequest: (
      paused: {
        requestId: string;
        errorReason: string;
      },
      sessionId?: string,
    ) => Promise<void>,
  ): Promise<void> {
    const sessionId =
      typeof params.sessionId === 'string' ? params.sessionId : undefined;
    const fail = async (): Promise<void> => {
      const blocked = {
        requestId: params.requestId,
        errorReason: 'BlockedByClient',
      };
      if (sessionId === undefined) {
        await failRequest(blocked);
        return;
      }
      await failRequest(blocked, sessionId);
    };
    try {
      const payload = await readContainedWorkspaceFile(
        params.request?.url ?? '',
        this.sessionRoots,
      );
      if (payload === undefined) {
        await fail();
        return;
      }
      const fulfilled = {
        requestId: params.requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: payload.contentType },
        ],
        body: payload.bodyBase64,
      };
      if (sessionId === undefined) {
        await fulfillRequest(fulfilled);
        return;
      }
      await fulfillRequest(fulfilled, sessionId);
    } catch {
      // degradation-audit: optional-capability - a failed block leaves the
      // file request paused, so Chrome does not deliver the body.
      try {
        await fail();
      } catch {
        // degradation-audit: optional-capability - the request stays paused.
      }
    }
  }

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
      const escaped = await this.rejectIfPageEscaped();
      if (escaped) {
        return { success: false, error: escaped };
      }
      this.recorder = new ScreenRecorderService();
      const startResult = this.recorder.startRecording(options);
      if (!startResult.success) {
        return startResult;
      }
      const { Page } = this.client;
      await Page.startScreencast({
        format: 'jpeg',
        quality: 60,
        maxWidth: 1280,
        maxHeight: 720,
        everyNthFrame: 3,
      });
      if (!this.screencastListenerRegistered) {
        Page.screencastFrame(
          (params: {
            data: string;
            metadata: { timestamp: number };
            sessionId: number;
          }) => {
            // degradation-audit: optional-capability - the CDP frame ack is a
            // protocol courtesy to keep Chrome's screencast stream flowing; a
            // single missed ack does not lose the frame, which is already
            // handed to this.recorder.addFrame below.
            Page.screencastFrameAck({ sessionId: params.sessionId }).catch(
              (_ackError: unknown) => {},
            );
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
      const escaped = await this.rejectIfPageEscaped();
      if (escaped) {
        this.recorder = null;
        return {
          filePath: '',
          frameCount: 0,
          durationMs: 0,
          fileSizeBytes: 0,
          truncated: false,
          error: escaped,
        };
      }
      if (this._connected && this.client) {
        const { Page } = this.client;
        // degradation-audit: optional-capability - the frames are already
        // captured by this.recorder; failing to formally stop the CDP
        // screencast (e.g. the browser session already closed) must not block
        // returning the recording that was successfully captured.
        await Page.stopScreencast().catch((_stopError: unknown) => {});
      }
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
