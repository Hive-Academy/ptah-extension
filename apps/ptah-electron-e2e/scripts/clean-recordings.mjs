/**
 * Wipe the showcase recordings dir before a fresh capture so each run produces
 * exactly the current take's video(s) — no stale clips accumulating across runs
 * (which `transcode.mjs` would otherwise pick up and convert).
 *
 * Usage: node apps/ptah-electron-e2e/scripts/clean-recordings.mjs
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const recordingsDir = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'dist',
  'apps',
  'ptah-electron-e2e',
  'recordings',
);

fs.rmSync(recordingsDir, { recursive: true, force: true });
console.log(`[clean-recordings] Cleared ${recordingsDir}`);
