// CRITICAL: Import Zone.js FIRST before any Angular imports
// Zone.js is required for provideZoneChangeDetection() to work
import 'zone.js';

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Type declaration for window globals injected by VS Code
declare global {
  interface Window {
    vscode?: unknown;
    ptahConfig?: unknown;
    ptahPreviousState?: unknown;
  }
}

console.log('=== PTAH WEBVIEW BOOTSTRAP STARTING ===');
console.log('Window globals:', {
  hasVscode: !!(window as Window).vscode,
  hasPtahConfig: !!(window as Window).ptahConfig,
});

bootstrapApplication(App, appConfig)
  .then(() => {
    console.log('=== PTAH WEBVIEW BOOTSTRAP COMPLETE ===');
  })
  .catch((err) => {
    console.error('=== PTAH WEBVIEW BOOTSTRAP FAILED ===', err);
  });
