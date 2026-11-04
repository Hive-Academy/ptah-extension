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
// Preserve host pushes while lazy Angular chunks load and the message router
// attaches. RPC responses must reach the RPC client during bootstrap.
const earlyHostMessages: object[] = [];
const captureHostMessage = (event: MessageEvent): void => {
  const value: unknown = event.data;
  if (
    typeof value !== 'object' ||
    value === null ||
    !('type' in value) ||
    typeof value.type !== 'string' ||
    value.type === 'rpc:response'
  ) return;
  earlyHostMessages.push(value);
  event.stopImmediatePropagation();
};
window.addEventListener('message', captureHostMessage, { capture: true });
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
    window.removeEventListener('message', captureHostMessage, { capture: true });
    // `replayed` marks a push that predates any RPC answered during bootstrap.
    // BootStatusService reads it so a stale readiness push cannot rewind a
    // newer pulled snapshot. Literal key: importing core here would load
    // Angular before the optional Zone.js fallback.
    for (const value of earlyHostMessages) {
      const data = { ...value, replayed: true };
      window.dispatchEvent(new MessageEvent('message', { data }));
    }
  } catch (err) {
    window.removeEventListener('message', captureHostMessage, { capture: true });
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
