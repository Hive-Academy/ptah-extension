import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Isolated-home helper for Electron e2e specs. Overriding the home environment
 * variables before launch keeps file settings out of the developer's profile.
 */

/** Env vars Node's `os.homedir()` consults, per platform. */
export const HOME_ENV_KEYS = ['USERPROFILE', 'HOME'] as const;

export interface IsolatedPtahHome {
  /** The tmp dir standing in for `os.homedir()`. */
  readonly home: string;
  /** Env overrides to merge into the launched app's environment. */
  readonly env: Record<string, string>;
  /** Removes the tmp dir. Best-effort -- Windows can hold file handles past exit. */
  cleanup(): void;
}

/**
 * Create a disposable `os.homedir()` stand-in for one test.
 *
 * The app creates `<home>/.ptah/` on its first settings write.
 */
export function createIsolatedPtahHome(): IsolatedPtahHome {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-e2e-tray-home-'));
  const env: Record<string, string> = {};
  for (const key of HOME_ENV_KEYS) env[key] = home;
  return {
    home,
    env,
    cleanup(): void {
      try {
        fs.rmSync(home, { recursive: true, force: true });
      } catch {
        // A leaked tmp home is not a spec failure -- see real-rpc-fixtures.ts.
      }
    },
  };
}

/**
 * Compatibility export for the tray spec until that obsolete spec is removed.
 * The retired keepalive setting must no longer be written to settings.json.
 */
export function seedTrayKeepalive(
  _home: string,
  _trayKeepalive: boolean | undefined,
): void {
  // Kept only to satisfy the existing import; there is no setting to seed.
}
