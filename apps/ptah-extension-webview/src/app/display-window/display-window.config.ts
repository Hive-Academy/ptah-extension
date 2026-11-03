import {
  ErrorHandler,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  type ApplicationConfig,
} from '@angular/core';
import {
  ClaudeRpcService,
  MESSAGE_HANDLERS,
  provideMessageRouter,
  provideVSCodeService,
} from '@ptah-extension/core';
import { DisplayWindowStateHandler } from '@ptah-extension/chat';

// The bootstrap component, re-exported so `main.ts` lazy-imports one module.
export { DisplayWindowComponent } from '@ptah-extension/chat';

/** The `index.html` element the main app boots into. */
const MAIN_ROOT_SELECTOR = 'ptah-root';
/** `DisplayWindowComponent`'s selector. */
const DISPLAY_WINDOW_SELECTOR = 'ptah-display-window';

/**
 * Replaces the shared `index.html`'s `<ptah-root>` with the
 * `<ptah-display-window>` host element, so both windows load one HTML file
 * (and its CSP meta and theme boot script) unchanged.
 */
export function mountDisplayWindowHost(doc: Document): void {
  if (doc.querySelector(DISPLAY_WINDOW_SELECTOR) !== null) return;
  const host = doc.createElement(DISPLAY_WINDOW_SELECTOR);
  const mainRoot = doc.querySelector(MAIN_ROOT_SELECTOR);
  if (mainRoot !== null) {
    mainRoot.replaceWith(host);
  } else {
    doc.body.appendChild(host);
  }
}

class DisplayWindowErrorHandler implements ErrorHandler {
  public handleError(error: unknown): void {
    console.error('[DisplayWindow] Angular error:', error);
  }
}

/**
 * The detached Display window's application config (TASK_2026_853_3401, D4).
 *
 * Only the RPC client, the message router and the snapshot handler. The child
 * has no `ElectronLayoutService`, no chat or streaming stores, no router and
 * never calls `setState`. What it may call over IPC is decided in the main
 * process by `DISPLAY_WINDOW_ALLOWED_METHODS` (`apps/ptah-electron/src/ipc/ipc-bridge.ts`).
 * `DisplayWindowSync` is the main window's side and must not be provided here.
 */
export const displayWindowConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    { provide: ErrorHandler, useClass: DisplayWindowErrorHandler },
    provideVSCodeService(),
    provideMessageRouter(),
    { provide: MESSAGE_HANDLERS, useExisting: ClaudeRpcService, multi: true },
    {
      provide: MESSAGE_HANDLERS,
      useExisting: DisplayWindowStateHandler,
      multi: true,
    },
  ],
};
