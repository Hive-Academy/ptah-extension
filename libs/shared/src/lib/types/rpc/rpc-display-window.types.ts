/**
 * `displayWindow:*` RPC wire contract (TASK_2026_853_3401, plan D2).
 *
 * The detached Display window is a second Electron renderer. The main renderer
 * stays authoritative: it publishes a JSON snapshot of the bound tab's display
 * state, the host caches the latest one and pushes it to the child, and the
 * child pulls it on boot. The child sends user actions back through the host,
 * which relays them to the main renderer.
 *
 * Only Electron has a detached window. Every other host answers `open` with
 * the typed `desktop-only` result and the other methods with their negative
 * values (`closed: false`, `delivered: false`, `state: null`, ...).
 *
 * Plain types and literals only: this module is reached from the zod-free
 * main `@ptah-extension/shared` barrel. The strict zod schemas that parse
 * these params live in the RPC handler (plan D2). The snapshot is opaque JSON
 * here: the renderer owns its shape (`display-window-wire.ts`), so this file
 * imports no frontend code.
 */

// ---------------------------------------------------------------------------
// JSON snapshot
// ---------------------------------------------------------------------------

/** A JSON value as it crosses IPC: no Maps, Sets, functions or `undefined`. */
export type DisplayWindowJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly DisplayWindowJsonValue[]
  | DisplayWindowJsonObject;

/** A JSON object as it crosses IPC. */
export interface DisplayWindowJsonObject {
  readonly [key: string]: DisplayWindowJsonValue;
}

/**
 * The largest serialized snapshot the host accepts, in bytes of JSON text
 * (4 MiB). A larger `publishState` is refused, not truncated.
 */
export const DISPLAY_WINDOW_STATE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * One published display state: the tab it belongs to, a revision that only
 * grows for that tab, and the renderer-built wire state.
 *
 * The child window pulls this with `displayWindow:getState` and receives it
 * with the `displayWindow:state` push.
 */
export interface DisplayWindowSnapshot {
  readonly tabId: string;
  readonly revision: number;
  readonly state: DisplayWindowJsonObject;
}

// ---------------------------------------------------------------------------
// Actions (child -> main renderer)
// ---------------------------------------------------------------------------

/**
 * A user action taken in the detached window. The main renderer applies it to
 * its own dock state, and only when `tabId` equals the tab it bound.
 *
 * - `select`: select the strip entry `key` (`summary`, `artifact:<id>`, a
 *   surface key).
 * - `fullscreen-closed`: the panel left its own full screen.
 * - `view-state`: a surface renderer changed its view state.
 * - `open-file`: open one file of the selected turn's change set.
 * - `review`: review the selected turn's whole change set.
 * - `attach`: close the detached window and show the panel in the main window.
 */
export type DisplayWindowAction =
  | { readonly type: 'select'; readonly key: string }
  | { readonly type: 'fullscreen-closed' }
  | {
      readonly type: 'view-state';
      readonly surfaceKey: string;
      readonly viewState: DisplayWindowJsonObject;
    }
  | { readonly type: 'open-file'; readonly path: string }
  | { readonly type: 'review' }
  | { readonly type: 'attach' };

/** Every `DisplayWindowAction['type']`, for schema enums and exhaustive specs. */
export const DISPLAY_WINDOW_ACTION_TYPES = [
  'select',
  'fullscreen-closed',
  'view-state',
  'open-file',
  'review',
  'attach',
] as const satisfies readonly DisplayWindowAction['type'][];

// ---------------------------------------------------------------------------
// Pushes (host -> renderer)
// ---------------------------------------------------------------------------

/**
 * Push message types.
 * - `state` goes to the child; payload `DisplayWindowStatePushPayload`.
 * - `action` goes to the main renderer; payload `DisplayWindowActionPushPayload`.
 * - `closed` goes to the main renderer when the child closes; no payload.
 */
export const DISPLAY_WINDOW_PUSH_TYPES = {
  state: 'displayWindow:state',
  action: 'displayWindow:action',
  closed: 'displayWindow:closed',
} as const;

export type DisplayWindowPushType =
  (typeof DISPLAY_WINDOW_PUSH_TYPES)[keyof typeof DISPLAY_WINDOW_PUSH_TYPES];

export type DisplayWindowStatePushPayload = DisplayWindowSnapshot;

export interface DisplayWindowActionPushPayload {
  readonly tabId: string;
  readonly action: DisplayWindowAction;
}

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

/** `displayWindow:open`, `:close`, `:status` and `:getState` take no params. */
export type DisplayWindowEmptyParams = Record<string, never>;

export type DisplayWindowOpenParams = DisplayWindowEmptyParams;
export type DisplayWindowCloseParams = DisplayWindowEmptyParams;
export type DisplayWindowStatusParams = DisplayWindowEmptyParams;
export type DisplayWindowGetStateParams = DisplayWindowEmptyParams;

/** `displayWindow:publishState`: the main renderer's latest snapshot. */
export type DisplayWindowPublishStateParams = DisplayWindowSnapshot;

/** `displayWindow:action`: a child action for the main renderer. */
export type DisplayWindowActionParams = DisplayWindowActionPushPayload;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * Why `displayWindow:open` did not open a window.
 * - `desktop-only`: this host has no detached window (VS Code, CLI).
 * - `not-ready`: the desktop host has not bound its window host yet.
 */
export type DisplayWindowUnavailableReason = 'desktop-only' | 'not-ready';

/**
 * `displayWindow:open`: the window is open and focused (newly created or
 * already open), or the typed reason it cannot be.
 */
export type DisplayWindowOpenResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: DisplayWindowUnavailableReason };

/** `displayWindow:close`: `true` when an open window was closed. */
export interface DisplayWindowCloseResult {
  readonly closed: boolean;
}

/** `displayWindow:status`: whether the host has the window, and whether it is open. */
export interface DisplayWindowStatusResult {
  readonly supported: boolean;
  readonly open: boolean;
}

/** `displayWindow:publishState`: `true` when the host cached and forwarded it. */
export interface DisplayWindowPublishStateResult {
  readonly delivered: boolean;
}

/** `displayWindow:getState`: the latest cached snapshot, or `null`. */
export interface DisplayWindowGetStateResult {
  readonly state: DisplayWindowSnapshot | null;
}

/** `displayWindow:action`: `true` when the host relayed it to the main renderer. */
export interface DisplayWindowActionResult {
  readonly relayed: boolean;
}
