import { InjectionToken } from '@angular/core';

/**
 * How much session chrome a hosted chat view renders. `'bare'` hides the
 * session header and the "This session" inspector, because the host page
 * brings its own. Absent or `'full'` keeps the default chrome.
 */
export type SessionEmbedChrome = 'full' | 'bare';

export const SESSION_EMBED_CHROME = new InjectionToken<SessionEmbedChrome>(
  'SESSION_EMBED_CHROME',
);
