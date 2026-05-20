import 'zone.js';

import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';
import { getRpcClient } from '@ptah-extension/core';
declare global {
  interface Window {
    vscode?: unknown;
    ptahConfig?: unknown;
    ptahPreviousState?: unknown;
  }
}
getRpcClient().markReady();

bootstrapApplication(App, appConfig).catch((err) => {
  console.error('=== PTAH WEBVIEW BOOTSTRAP FAILED ===', err);
});
