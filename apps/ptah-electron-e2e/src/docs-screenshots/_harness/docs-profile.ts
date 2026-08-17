import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Builds the profile the docs screenshots are captured against.
 *
 * The Electron `userData` directory is where session metadata lives
 * (`workspace-storage/<encoded-path>/workspace-state.json`), along with the
 * license cache and settings. A fresh `mkdtemp` profile — what
 * `src/support/electron-launcher.ts` defaults to — therefore paints "No
 * sessions yet" on every session surface and drops the app to the community
 * tier, which is not what the docs describe.
 *
 * Launching against `~/.ptah` directly is worse: it collides with the running
 * app's single-instance lock, and a capture run would write to live state.
 *
 * So this COPIES the small, state-bearing part of the real profile into a
 * throwaway directory. Deliberately excluded: `state/` (a ~3 GB SQLite corpus),
 * `models/` (~4 GB of embedder weights), `logs/` and `curator-reports/`. Those
 * back the memory/index surfaces, and none of the 27 missing shots is one.
 */

/**
 * Files copied verbatim when present.
 *
 * The secret envelopes (`secrets.enc*`, `master-key-ref.json`) are deliberately
 * NOT copied. They hold the developer's provider keys and membership key, and a
 * copied membership key that fails re-verification puts a "Membership Key Not
 * Active" warning across the top of every Settings shot — a machine-specific
 * error state, not documentation.
 */
const PROFILE_FILES = [
  'global-state.json',
  'settings.json',
  '.machine-uuid',
  '.content-cache.json',
];

/** Directories copied recursively when present (all small). */
const PROFILE_DIRS = [
  'workspace-storage',
  'user',
  'skills',
  'plugins',
  'templates',
  'migrations',
];

export interface DocsProfile {
  /** Directory to pass as `--user-data-dir`. */
  dir: string;
  /** Removes the copy. Safe to call more than once. */
  cleanup: () => void;
  /** True when the real profile was found and copied. */
  seeded: boolean;
}

/** The real profile the copy is seeded from. */
export function realProfileDir(): string {
  return (
    process.env['PTAH_DOCS_SOURCE_PROFILE'] ?? path.join(os.homedir(), '.ptah')
  );
}

/**
 * Copy the real profile's state-bearing files into a temp directory. When the
 * real profile is absent the temp directory is still returned (empty), so a
 * capture run on a clean machine degrades to empty states rather than failing.
 */
export interface DocsProfileOptions {
  /**
   * Workspace folders to persist into the copy's `global-state.json`. The app
   * restores these on boot, which is the only way to get a multi-folder
   * workspace rail into a shot — adding one live goes through a native folder
   * dialog Playwright cannot drive.
   */
  folders?: string[];
}

export function prepareDocsProfile(
  options: DocsProfileOptions = {},
): DocsProfile {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-docs-profile-'));
  const source = realProfileDir();
  let seeded = false;

  if (fs.existsSync(source)) {
    for (const file of PROFILE_FILES) {
      const from = path.join(source, file);
      if (!fs.existsSync(from)) continue;
      fs.copyFileSync(from, path.join(dir, file));
      seeded = true;
    }
    for (const folder of PROFILE_DIRS) {
      const from = path.join(source, folder);
      if (!fs.existsSync(from)) continue;
      fs.cpSync(from, path.join(dir, folder), {
        recursive: true,
        // Junction targets (the skill links the app creates) must not be
        // followed — copying through them would pull in whole plugin repos.
        dereference: false,
        force: true,
      });
      seeded = true;
    }
  }

  const statePath = path.join(dir, 'global-state.json');
  if (fs.existsSync(statePath) || options.folders?.length) {
    const state: Record<string, unknown> = fs.existsSync(statePath)
      ? (JSON.parse(fs.readFileSync(statePath, 'utf8')) as Record<
          string,
          unknown
        >)
      : {};
    // Drop the cached license: it carries the developer's name and email, and
    // once it expires the Settings page opens on a "membership key could not be
    // verified" warning — a machine-specific error state, not documentation.
    delete state['ptah.licenseCache'];
    if (options.folders && options.folders.length > 0) {
      state['ptah.workspaces'] = {
        folders: options.folders,
        activeIndex: 0,
      };
    }
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
  }

  return {
    dir,
    seeded,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
