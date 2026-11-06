import type { App, PowerMonitor } from 'electron';
import type { Logger } from '@ptah-extension/vscode-core';

/** Records the synchronous caller of each close signal for early-exit diagnosis. */
export function installCloseInitiatorLogger(
  app: App,
  powerMonitor: PowerMonitor,
  logger: () => Logger | null,
  flags: () => Record<string, boolean | number | string>,
): void {
  const seen = new Set<string>();
  const record = (event: string): void => {
    if (seen.has(event)) return;
    seen.add(event);
    const stack = new Error().stack?.split('\n').slice(0, 13).join('\n') ?? '';
    const context = { event, ...flags(), stack };
    const activeLogger = logger();
    if (activeLogger) activeLogger.info('[lifecycle] close initiator', context);
    else console.info('[Ptah Electron] INFO [lifecycle] close initiator', context);
  };

  app.on('browser-window-created', (_event, window) => {
    window.on('close', () => record(`window-close:${window.id}`));
    if (process.platform === 'win32') {
      window.on('session-end', () => record(`session-end:${window.id}`));
    }
  });
  app.on('before-quit', () => record('before-quit'));
  app.on('window-all-closed', () => record('window-all-closed'));
  app.on('will-quit', () => record('will-quit'));
  powerMonitor.on('shutdown', () => record('power-shutdown'));
}
