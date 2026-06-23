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

/**
 * Optional injection token that hides the per-session "Agents" right sidebar
 * (toggle tab + monitor panel) when a ChatViewComponent is embedded in a
 * surface that already surfaces its sub-agents elsewhere — e.g. the Tribunal
 * conductor, whose panelists render as their own tiles. Absent/false → the
 * sidebar shows as normal.
 */
export const HIDE_AGENT_SIDEBAR = new InjectionToken<boolean>(
  'HIDE_AGENT_SIDEBAR',
);
