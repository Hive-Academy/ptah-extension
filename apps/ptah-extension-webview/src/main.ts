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

// The detached Display window (TASK_2026_853_3401) loads the same index.html
// with `?ptahWindow=display` and boots its own small app from a lazy chunk.
// Inlined check: importing the config module here would make it eager.
if (new URLSearchParams(window.location.search).get('ptahWindow') === 'display') {
  void bootstrapDisplayWindow();
} else {
  bootstrapApplication(App, appConfig).catch((err) => {
    console.error('=== PTAH WEBVIEW BOOTSTRAP FAILED ===', err);
  });
}

async function bootstrapDisplayWindow(): Promise<void> {
  try {
    const { DisplayWindowComponent, displayWindowConfig, mountDisplayWindowHost } =
      await import('./app/display-window/display-window.config');
    mountDisplayWindowHost(document);
    await bootstrapApplication(DisplayWindowComponent, displayWindowConfig);
  } catch (err) {
    console.error('=== PTAH DISPLAY WINDOW BOOTSTRAP FAILED ===', err);
  }
}
