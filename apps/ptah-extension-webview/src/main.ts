import { useZoneChangeDetectionFallback } from './app/zone-change-detection';
declare global {
  interface Window {
    vscode?: unknown;
    ptahConfig?: unknown;
    ptahPreviousState?: unknown;
  }
}

// The detached Display window (TASK_2026_853_3401) loads the same index.html
// with `?ptahWindow=display` and boots its own small app from a lazy chunk.
// Inlined check: importing the config module here would make it eager.
void bootstrapRenderer();

async function bootstrapRenderer(): Promise<void> {
  try {
    if (useZoneChangeDetectionFallback()) await import('zone.js');
    const { getRpcClient } = await import('./app/rpc-ready');
    getRpcClient().markReady();
    const { bootstrapApplication } = await import('@angular/platform-browser');
    if (new URLSearchParams(window.location.search).get('ptahWindow') === 'display') {
      await bootstrapDisplayWindow(bootstrapApplication);
    } else {
      const [{ App }, { appConfig }] = await Promise.all([import('./app/app'), import('./app/app.config')]);
      await bootstrapApplication(App, appConfig);
    }
  } catch (err) {
    console.error('=== PTAH WEBVIEW BOOTSTRAP FAILED ===', err);
  }
}

async function bootstrapDisplayWindow(bootstrapApplication: typeof import('@angular/platform-browser').bootstrapApplication): Promise<void> {
  try {
    const { DisplayWindowComponent, displayWindowConfig, mountDisplayWindowHost } =
      await import('./app/display-window/display-window.config');
    mountDisplayWindowHost(document);
    await bootstrapApplication(DisplayWindowComponent, displayWindowConfig);
  } catch (err) {
    console.error('=== PTAH DISPLAY WINDOW BOOTSTRAP FAILED ===', err);
  }
}
