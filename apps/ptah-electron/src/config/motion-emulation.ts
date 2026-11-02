import type { MotionPreference } from './motion-preference';
import { motionMediaValue } from './motion-preference';

/** The Electron debugger and webContents operations needed for media emulation. */
export interface MotionWebContents {
  readonly session: unknown;
  readonly debugger: {
    isAttached(): boolean;
    attach(protocolVersion?: string): void;
    sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
    on(event: 'detach', listener: (_event: unknown, reason: string) => void): unknown;
  };
  isDestroyed(): boolean;
  on(event: 'did-start-navigation', listener: (details: { isMainFrame: boolean; isSameDocument: boolean }) => void): unknown;
  on(event: 'did-finish-load' | 'devtools-closed', listener: () => void): unknown;
}

/** Attach before the first load; reassert the override when navigation starts. */
export function installMotionEmulation(
  contents: MotionWebContents,
  preference: MotionPreference,
  reportError: (error: Error) => void,
  reportWarning: (warning: Error) => void,
  appSession: unknown,
): void {
  const value = motionMediaValue(preference);
  // Only the app's default-session renderers own this debugger. The browser
  // tool uses a separate session and must be free to attach its own debugger.
  if (value === null || contents.session !== appSession) return;

  const reportedErrors = new Set<string>();
  const reportErrorOnce = (message: string, cause: unknown): void => {
    const key = `${message}: ${cause instanceof Error ? cause.message : String(cause)}`;
    if (reportedErrors.has(key)) return;
    reportedErrors.add(key);
    reportError(new Error(message, { cause }));
  };

  const apply = (): void => {
    if (contents.isDestroyed()) return;
    try {
      if (!contents.debugger.isAttached()) contents.debugger.attach();
      void contents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value }],
      }).catch((cause: unknown) => {
        reportErrorOnce('Failed to emulate Electron motion preference', cause);
      });
    } catch (cause: unknown) {
      reportErrorOnce('Failed to attach Electron motion emulation', cause);
    }
  };

  contents.debugger.on('detach', (_event, reason) => {
    if (contents.isDestroyed()) return;
    const normalizedReason = reason.toLowerCase().replace(/[\s_-]+/g, ' ');
    if (normalizedReason === 'replaced with devtools' || normalizedReason === 'target closed') return;
    reportWarning(new Error(`Electron motion emulation detached: ${reason}`));
  });
  contents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) apply();
  });
  contents.on('did-finish-load', apply);
  // Opening DevTools detaches Electron's debugger; restore the override when it closes.
  contents.on('devtools-closed', apply);
  apply();
}
