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
