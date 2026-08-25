import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Isolated-home helper for the tray keep-alive e2e specs (TASK_2026_180 B5.2).
 *
 * `skillSynthesis.trayKeepalive` is a FILE_BASED_SETTINGS_KEY
 * (`libs/backend/platform-core/src/file-settings-keys.ts`), which
 * `PtahFileSettingsManager` persists to `os.homedir()/.ptah/settings.json` --
 * NOT to Electron's `--user-data-dir`. Writing that key before launch (to
 * force the flag-on path) therefore means writing to a real filesystem
 * location keyed off `os.homedir()`, and Node resolves `os.homedir()` from
 * `USERPROFILE` on Windows / `HOME` elsewhere. Overriding both env vars before
 * `_electron.launch()` (the same pattern `real-rpc-fixtures.ts` uses for the
 * same reason) redirects the launched app's home to a disposable tmp dir, so
 * these specs never read or write the developer's actual
 * `~/.ptah/settings.json`.
 *
 * `PtahFileSettingsManager.persist()` writes flat dot-notation keys back out
 * as NESTED JSON (`unflattenObject`, see `file-settings-manager.ts:486`), and
 * `loadSync()` flattens nested JSON back on read (`flattenObject`). So the
 * on-disk shape for `skillSynthesis.trayKeepalive` is
 * `{ skillSynthesis: { trayKeepalive: <bool> } }`, not a flat dotted key --
 * `seedTrayKeepalive` below reproduces that shape by hand so the app reads it
 * exactly as if a previous run's `setConfiguration` call had written it.
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
 * Deliberately does NOT create `<home>/.ptah/` -- that happens on first write
 * (either by us, via `seedTrayKeepalive`, or by the app itself).
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
 * Seed `<home>/.ptah/settings.json` with an explicit
 * `skillSynthesis.trayKeepalive` value, in the exact nested shape
 * `PtahFileSettingsManager` itself would have written.
 *
 * Passing `undefined` leaves no settings.json at all, so the app falls back
 * to `FILE_BASED_SETTINGS_DEFAULTS['skillSynthesis.trayKeepalive']` (`false`,
 * `file-settings-keys.ts:487`) -- this is what proves the DEFAULT path, as
 * opposed to an explicit `false` seed proving only "an explicit false works".
 */
export function seedTrayKeepalive(
  home: string,
  trayKeepalive: boolean | undefined,
): void {
  if (trayKeepalive === undefined) return;
  const ptahDir = path.join(home, '.ptah');
  fs.mkdirSync(ptahDir, { recursive: true });
  const settingsPath = path.join(ptahDir, 'settings.json');
  const contents = {
    $schema: 'https://ptah.live/schemas/settings.json',
    version: 1,
    skillSynthesis: { trayKeepalive },
  };
  fs.writeFileSync(settingsPath, JSON.stringify(contents, null, 2), 'utf-8');
}
