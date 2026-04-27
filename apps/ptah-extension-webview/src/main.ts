// CRITICAL: Import Zone.js FIRST before any Angular imports
// Zone.js is required for provideZoneChangeDetection() to work
import 'zone.js';

import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';
import { getRpcClient } from '@ptah-extension/core';

// Type declaration for window globals injected by VS Code
declare global {
  interface Window {
    vscode?: unknown;
    ptahConfig?: unknown;
    ptahPreviousState?: unknown;
  }
}

// RPC hardening (Fix 2): the inline WEBVIEW_READY signal is posted from the
// host-generated HTML before Angular bootstraps. By the time we reach here the
// host's message pump is live, so we flip the RpcClient's ready gate so any
// RPC call made during bootstrap / first render is allowed to send. The
// RpcClient also auto-flips on the first inbound response as a defensive
// fallback. This reuses the existing ready protocol — no new signal invented.
getRpcClient().markReady();

bootstrapApplication(App, appConfig).catch((err) => {
  console.error('=== PTAH WEBVIEW BOOTSTRAP FAILED ===', err);
});
