/**
 * Transcode showcase recordings (Playwright .webm) into marketing-ready .mp4.
 *
 * Playwright writes VP8 .webm with randomized filenames. This pass converts
 * each .webm in the recordings dir to H.264 .mp4 at a high bitrate (good for
 * editing / upload), using the ffmpeg binary bundled with `ffmpeg-static`
 * (already a workspace dependency — see ptah-electron externals).
 *
 * Usage: node apps/ptah-electron-e2e/scripts/transcode.mjs
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
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

if (!fs.existsSync(recordingsDir)) {
  console.log(`[transcode] No recordings dir yet: ${recordingsDir}`);
  process.exit(0);
}

const ffmpegPath = require('ffmpeg-static');
if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
  console.error('[transcode] ffmpeg-static binary not found.');
  process.exit(1);
}

const webms = fs
  .readdirSync(recordingsDir)
  .filter((f) => f.toLowerCase().endsWith('.webm'));

if (webms.length === 0) {
  console.log('[transcode] No .webm files to transcode.');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(recordingsDir, 'mp4');
fs.mkdirSync(outDir, { recursive: true });

for (const webm of webms) {
  const src = path.join(recordingsDir, webm);
  const base = path.basename(webm, '.webm');
  const out = path.join(outDir, `${base}-${stamp}.mp4`);
  console.log(`[transcode] ${webm} -> mp4/${path.basename(out)}`);
  execFileSync(
    ffmpegPath,
    [
      '-y',
      '-i', src,
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      out,
    ],
    { stdio: 'inherit' },
  );
}

console.log(`[transcode] Done. MP4s in: ${outDir}`);
