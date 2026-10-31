/**
 * Detached Display window (TASK_2026_853_3401, plan D3).
 *
 * `ElectronDisplayWindowHost` is the Electron adapter of `IDisplayWindowHost`.
 * It owns at most one child `BrowserWindow` that shows the Display panel for
 * the main window's active tab. The main renderer stays authoritative: it
 * publishes snapshots, the adapter caches the latest one and forwards it to
 * the child, and child actions travel back to the main renderer as pushes.
 *
 * Detaching must never affect the chat window: the child has no parent, gets
 * no stream events, may call only a handful of RPC methods (enforced in
 * `IpcBridge`), and every failure here is contained to the child.
 */

import { BrowserWindow, type Rectangle } from 'electron';
import * as path from 'path';
import type {
  IDisplayWindowHost,
  IStateStorage,
} from '@ptah-extension/platform-core';
import {
  DISPLAY_WINDOW_PUSH_TYPES,
  type DisplayWindowAction,
  type DisplayWindowActionPushPayload,
  type DisplayWindowOpenResult,
  type DisplayWindowSnapshot,
} from '@ptah-extension/shared';
import { PRODUCT_DISPLAY_NAME } from '../config/product-identity';
import {
  installNavigationGuard,
  isOnScreen,
  type WindowBounds,
} from './window-guards';

/** Storage key, beside the main window's `window.bounds`. */
export const DISPLAY_WINDOW_BOUNDS_KEY = 'displayWindow.bounds';
export const DISPLAY_WINDOW_TITLE = `${PRODUCT_DISPLAY_NAME} - Display`;
export const DISPLAY_WINDOW_MIN_WIDTH = 360;
export const DISPLAY_WINDOW_MIN_HEIGHT = 400;
export const DISPLAY_WINDOW_DEFAULT_WIDTH = 520;
export const DISPLAY_WINDOW_DEFAULT_HEIGHT = 760;
/** Gap between the main window and a default-placed Display window. */
const PLACEMENT_GAP = 8;

/**
 * The part of the child `BrowserWindow` the adapter drives. A real
 * `BrowserWindow` satisfies it; specs pass a plain fake.
 */
export interface DisplayChildWindow {
  readonly webContents: {
    readonly id: number;
    send(channel: string, ...args: unknown[]): void;
    isDestroyed(): boolean;
    on(
      event: 'did-fail-load',
      listener: (
        event: unknown,
        errorCode: number,
        errorDescription: string,
        validatedURL: string,
        isMainFrame: boolean,
      ) => void,
    ): unknown;
    on(
      event: 'render-process-gone',
      listener: (event: unknown, details: { reason: string }) => void,
    ): unknown;
  };
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
  close(): void;
  getBounds(): Rectangle;
  on(event: 'close', listener: () => void): unknown;
  once(event: 'closed', listener: () => void): unknown;
  loadFile(
    filePath: string,
    options: { query: Record<string, string> },
  ): Promise<void>;
}

/** The part of the main `BrowserWindow` the adapter reads. */
export interface DisplayMainWindow {
  isDestroyed(): boolean;
  getBounds(): Rectangle;
  once(event: 'closed', listener: () => void): unknown;
  removeListener(event: 'closed', listener: () => void): unknown;
}

/** The part of `IpcBridge` the adapter drives. */
export interface DisplayWindowIpcBridge {
  setDisplayWindowSender(webContentsId: number | null): void;
  sendToRenderer(message: unknown): boolean;
}

export interface ElectronDisplayWindowHostOptions {
  /** The main window, or `null` before it exists or after it closed. */
  readonly getMainWindow: () => DisplayMainWindow | null;
  readonly bridge: DisplayWindowIpcBridge;
  /** The storage that holds `window.bounds`; `undefined` while not resolved. */
  readonly resolveStateStorage: () => IStateStorage | undefined;
  /** Directory holding `preload.js`, `renderer/` and `assets/` (the bundle dir). */
  readonly appDir: string;
  /** Window factory; tests replace it. Defaults to {@link createDisplayWindow}. */
  readonly createWindow?: (
    options: CreateDisplayWindowOptions,
  ) => DisplayChildWindow;
}

export interface CreateDisplayWindowOptions {
  readonly appDir: string;
  /** Saved bounds already checked to be on screen, or a default placement. */
  readonly placement: Partial<WindowBounds> & { width: number; height: number };
}

/**
 * Create the child window. Same security posture as the main window
 * (`main-window.ts`): same preload, `contextIsolation`, no Node integration,
 * sandbox, web security, and the same navigation guard. The host then loads
 * the same renderer document with `?ptahWindow=display`, which the navigation
 * policy ignores and the renderer reads to boot the Display-only app.
 *
 * The session permission policy is NOT installed here: it lives on the shared
 * default session and is bound to the main window's webContents, so a second
 * install would replace the main window's grants. The child is therefore
 * denied every permission request (fail-closed), which the Display panel does
 * not need.
 */
export function createDisplayWindow(
  options: CreateDisplayWindowOptions,
): BrowserWindow {
  const { placement, appDir } = options;
  const window = new BrowserWindow({
    width: placement.width,
    height: placement.height,
    ...(placement.x !== undefined && placement.y !== undefined
      ? { x: placement.x, y: placement.y }
      : {}),
    minWidth: DISPLAY_WINDOW_MIN_WIDTH,
    minHeight: DISPLAY_WINDOW_MIN_HEIGHT,
    title: DISPLAY_WINDOW_TITLE,
    icon: path.join(appDir, 'assets', 'icons', 'icon.png'),
    show: true,
    webPreferences: {
      preload: path.join(appDir, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  installNavigationGuard(window);
  return window;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Saved bounds that are well-formed, at least the minimum size and on a display. */
function usableSavedBounds(value: unknown): WindowBounds | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('x' in value) ||
    !('y' in value) ||
    !('width' in value) ||
    !('height' in value)
  ) {
    return null;
  }
  const { x, y, width, height } = value;
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height)
  ) {
    return null;
  }
  if (width < DISPLAY_WINDOW_MIN_WIDTH || height < DISPLAY_WINDOW_MIN_HEIGHT) {
    return null;
  }
  const bounds = { x, y, width, height };
  return isOnScreen(bounds) ? bounds : null;
}

/**
 * Default placement: right of the main window, else left of it, else let the
 * OS place it (centered). Only an on-screen position is used.
 */
function defaultPlacement(
  main: Rectangle | null,
): CreateDisplayWindowOptions['placement'] {
  const size = {
    width: DISPLAY_WINDOW_DEFAULT_WIDTH,
    height: DISPLAY_WINDOW_DEFAULT_HEIGHT,
  };
  if (!main) return size;
  const candidates: WindowBounds[] = [
    { ...size, x: main.x + main.width + PLACEMENT_GAP, y: main.y },
    { ...size, x: main.x - size.width - PLACEMENT_GAP, y: main.y },
  ];
  return candidates.find((bounds) => isOnScreen(bounds)) ?? size;
}

/** Chromium's net error for an aborted (superseded) navigation. */
const ERR_ABORTED = -3;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ElectronDisplayWindowHost implements IDisplayWindowHost {
  readonly supported = true;

  private window: DisplayChildWindow | null = null;
  private snapshot: DisplayWindowSnapshot | null = null;

  constructor(private readonly options: ElectronDisplayWindowHostOptions) {}

  async open(): Promise<DisplayWindowOpenResult> {
    const existing = this.liveWindow();
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return { ok: true };
    }

    const main = this.options.getMainWindow();
    if (!main || main.isDestroyed()) return { ok: false, reason: 'not-ready' };

    let child: DisplayChildWindow;
    try {
      const saved = usableSavedBounds(
        this.options
          .resolveStateStorage()
          ?.get<unknown>(DISPLAY_WINDOW_BOUNDS_KEY),
      );
      const create = this.options.createWindow ?? createDisplayWindow;
      child = create({
        appDir: this.options.appDir,
        placement: saved ?? defaultPlacement(main.getBounds()),
      });
    } catch (error: unknown) {
      // The port contract says `open` never rejects. A window that cannot be
      // created leaves the chat window untouched and reports not-ready.
      console.error(
        '[Ptah Electron] Display window could not be created:',
        errorMessage(error),
      );
      return { ok: false, reason: 'not-ready' };
    }

    this.window = child;
    this.options.bridge.setDisplayWindowSender(child.webContents.id);

    // The child never outlives the main window.
    const closeWithMain = (): void => {
      if (!child.isDestroyed()) child.close();
    };
    main.once('closed', closeWithMain);

    child.on('close', () => this.saveBounds(child));
    child.once('closed', () => {
      if (!main.isDestroyed()) main.removeListener('closed', closeWithMain);
      this.onChildClosed(child);
    });

    // A child without a working document is closed, not left blank: the
    // `closed` handler then tells the main renderer, which re-attaches.
    const closeBroken = (what: string, detail: string): void => {
      console.error(`[Ptah Electron] Display window ${what}:`, detail);
      // degradation-audit: reported — BrowserWindow.close() is synchronous (not the host's async close); the failure is logged above.
      if (!child.isDestroyed()) child.close();
    };
    child.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, _url, isMainFrame) => {
        // ERR_ABORTED (-3) is a superseded navigation, not a failed document.
        if (isMainFrame && errorCode !== ERR_ABORTED) {
          closeBroken(
            'renderer did not load',
            `${errorCode} ${errorDescription}`,
          );
        }
      },
    );
    child.webContents.on('render-process-gone', (_event, details) => {
      closeBroken('renderer is gone', details.reason);
    });

    const rendererPath = path.join(
      this.options.appDir,
      'renderer',
      'index.html',
    );
    child
      .loadFile(rendererPath, { query: { ptahWindow: 'display' } })
      .catch((error: unknown) => {
        closeBroken('renderer did not load', errorMessage(error));
      });

    return { ok: true };
  }

  async close(): Promise<boolean> {
    const child = this.liveWindow();
    if (!child) return false;
    // `isOpen()` turns false now; the `closed` handler still untrusts the
    // sender and tells the main renderer once Electron has torn it down.
    this.window = null;
    child.close();
    return true;
  }

  isOpen(): boolean {
    return this.liveWindow() !== null;
  }

  publishState(snapshot: DisplayWindowSnapshot): boolean {
    this.snapshot = snapshot;
    const child = this.liveWindow();
    if (child && !child.webContents.isDestroyed()) {
      child.webContents.send('to-renderer', {
        type: DISPLAY_WINDOW_PUSH_TYPES.state,
        payload: snapshot,
      });
    }
    return true;
  }

  getState(): DisplayWindowSnapshot | null {
    return this.snapshot;
  }

  relayAction(tabId: string, action: DisplayWindowAction): boolean {
    // An action on a snapshot of another tab is stale: the main renderer
    // would drop it, so report it as not relayed. Re-attach always goes through.
    if (
      action.type !== 'attach' &&
      this.snapshot !== null &&
      this.snapshot.tabId !== tabId
    ) {
      return false;
    }
    const payload: DisplayWindowActionPushPayload = { tabId, action };
    return this.options.bridge.sendToRenderer({
      type: DISPLAY_WINDOW_PUSH_TYPES.action,
      payload,
    });
  }

  private liveWindow(): DisplayChildWindow | null {
    const child = this.window;
    if (!child) return null;
    if (child.isDestroyed()) {
      this.window = null;
      return null;
    }
    return child;
  }

  private saveBounds(child: DisplayChildWindow): void {
    const storage = this.options.resolveStateStorage();
    if (!storage || child.isDestroyed()) return;
    const bounds = child.getBounds();
    storage
      .update(DISPLAY_WINDOW_BOUNDS_KEY, bounds)
      .catch((error: unknown) => {
        console.error(
          '[Ptah Electron] Failed to persist Display window bounds:',
          errorMessage(error),
        );
      });
  }

  private onChildClosed(child: DisplayChildWindow): void {
    // A newer window opened while this one was closing keeps its trust and
    // the cached snapshot; only this window's state is dropped.
    if (this.window !== null && this.window !== child) return;
    this.window = null;
    this.snapshot = null;
    this.options.bridge.setDisplayWindowSender(null);
    this.options.bridge.sendToRenderer({
      type: DISPLAY_WINDOW_PUSH_TYPES.closed,
    });
  }
}
