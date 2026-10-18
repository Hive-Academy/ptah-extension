import { InjectionToken, Signal } from '@angular/core';

/**
 * Optional injection token that overrides the global activeTabSessionId
 * when a ChatViewComponent is rendered inside a canvas tile.
 * Value is the tabId (NOT the claudeSessionId) of the tile.
 * When absent (null), the component falls back to the global active-tab signal.
 */
export const SESSION_CONTEXT = new InjectionToken<Signal<string | null>>(
  'SESSION_CONTEXT',
);

/** Hides the VS Code Agents sidebar when the host shows agents elsewhere. */
export const HIDE_AGENT_SIDEBAR = new InjectionToken<boolean>(
  'HIDE_AGENT_SIDEBAR',
);

/**
 * Optional injection token carrying whether the surface hosting a
 * ChatViewComponent is currently on-screen. Canvas tiles provide their
 * `visible` signal so a hidden-workspace tile's transcript freezes (pauses
 * reactivity) instead of re-rendering every streaming chunk. Absent → treated
 * as always visible (main panel, tribunal conductor, tests).
 */
export const SESSION_VISIBLE = new InjectionToken<Signal<boolean>>(
  'SESSION_VISIBLE',
);

/**
 * Optional injection token carrying whether the surface hosting a
 * ChatViewComponent is the FOCUSED tile. Canvas tiles provide their
 * `focused` signal so an unfocused tile's transcript shrinks its render
 * window and pauses decorative animations. Absent → treated as focused
 * (single chat view, tests).
 */
export const SESSION_FOCUSED = new InjectionToken<Signal<boolean>>(
  'SESSION_FOCUSED',
);

/**
 * Optional signal supplied by canvas tiles to force a compact card without
 * changing the tab's stored view mode. Absent means the host does not force
 * card mode; the user's selected view mode still applies.
 */
export const SESSION_FORCED_CARD = new InjectionToken<Signal<boolean>>(
  'SESSION_FORCED_CARD',
);

/** Optional composer guard. Null allows the next turn or queued message. */
export type SessionStartGuard = () => string | null;
export const SESSION_START_GUARD = new InjectionToken<SessionStartGuard>(
  'SESSION_START_GUARD',
);

/** Synchronous interception; the owner dispatches cancellation asynchronously. */
export type SessionStopHandler = (tabId: string) => 'handled' | 'not-handled';
export const SESSION_STOP_HANDLER = new InjectionToken<SessionStopHandler>(
  'SESSION_STOP_HANDLER',
);

/** Optional actions supplied by a canvas tile to the compact session card. */
export interface SessionCardActions {
  openLane(laneKey: string): void;
  openSession(): void;
}

export const SESSION_CARD_ACTIONS = new InjectionToken<SessionCardActions>(
  'SESSION_CARD_ACTIONS',
);

/** Opts a contextual Rail host into four-tab transcript retention. */
export const RAIL_TRANSCRIPT_RETENTION = new InjectionToken<boolean>(
  'RAIL_TRANSCRIPT_RETENTION',
);
