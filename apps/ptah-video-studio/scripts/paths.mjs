/**
 * Shared path constants for the video-studio pipeline scripts.
 *
 * `RECORDINGS_ROOT` MUST resolve to the exact same directory that the showcase
 * capture writes to and that `transcode.mjs` reads from
 * (`apps/ptah-electron-e2e/scripts/transcode.mjs:20-29`). Both resolve
 * `<workspaceRoot>/dist/apps/ptah-electron-e2e/recordings`. transcode.mjs walks
 * up three dirs from `apps/ptah-electron-e2e/scripts`; these scripts live at
 * `apps/ptah-video-studio/scripts`, which is the same depth, so the same
 * three-level walk lands on the workspace root.
 *
 * ESM, Node >=22.9.
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

/** Workspace root: apps/ptah-video-studio/scripts -> apps/ptah-video-studio -> apps -> <root>. */
export const WORKSPACE_ROOT = path.resolve(scriptsDir, '..', '..', '..');

/** apps/ptah-video-studio (this app's root). */
export const APP_ROOT = path.resolve(scriptsDir, '..');

/** Same recordings dir the showcase capture + transcode.mjs use. */
export const RECORDINGS_ROOT = path.resolve(
  WORKSPACE_ROOT,
  'dist',
  'apps',
  'ptah-electron-e2e',
  'recordings',
);

/** App-local whisper.cpp binary + model cache (gitignored). */
export const WHISPER_DIR = path.resolve(APP_ROOT, '.whisper');

/** Per-scene recording subdir, e.g. recordings/editor-tour. */
export function sceneDir(scene) {
  return path.join(RECORDINGS_ROOT, scene);
}

/** Parse `--scene <slug>` (and a couple other simple flags) from argv. */
export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

/**
 * Enumerate scene slugs that have a beats.json under RECORDINGS_ROOT.
 * Used by render-all.mjs (and as the default when --scene is omitted).
 */
export function listScenesWithBeats() {
  if (!fs.existsSync(RECORDINGS_ROOT)) return [];
  return fs
    .readdirSync(RECORDINGS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => fs.existsSync(path.join(RECORDINGS_ROOT, name, 'beats.json')));
}
