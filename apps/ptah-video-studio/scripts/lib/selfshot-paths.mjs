/**
 * selfshot-paths.mjs — ingest-folder layout + input auto-detection.
 *
 * The founder drops recordings into `apps/ptah-video-studio/selfshot/<slug>/`:
 *   camera.*  → his camera footage (face)
 *   screen.*  → his screen recording
 *   audio.*   → optional separate voice track (else the video audio is used)
 * plus (generated): words.json, beats.json, out/, _public/.
 *
 * ESM, Node >=22.9.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ROOT } from './../paths.mjs';

const _scriptsDir = path.dirname(fileURLToPath(import.meta.url));
void _scriptsDir;

/** apps/ptah-video-studio/selfshot */
export const SELFSHOT_ROOT = path.join(APP_ROOT, 'selfshot');

/** Showcase recordings root (existing AI-narrated mp4s → b-roll sources). */
export function ingestDir(slug) {
  return path.join(SELFSHOT_ROOT, slug);
}

const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.mkv', '.m4v'];
const AUDIO_EXTS = ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.flac'];

/** First file in `dir` whose basename starts with one of `prefixes` and has an
 *  allowed extension (case-insensitive). Returns the bare filename or null. */
function findByPrefix(dir, prefixes, exts) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  for (const prefix of prefixes) {
    const hit = files.find((f) => {
      const lower = f.toLowerCase();
      return lower.startsWith(prefix) && exts.includes(path.extname(lower));
    });
    if (hit) return hit;
  }
  return null;
}

/**
 * Auto-detect the ingest media by filename convention. `manifest.input` (when a
 * beats.json already exists) always wins; otherwise we sniff files prefixed
 * camera / screen / audio / voice. Returns { cameraVideo, screenVideo, audio }
 * (bare names relative to the ingest dir; any may be undefined).
 */
export function detectInputs(dir, manifestInput) {
  const camera =
    manifestInput?.cameraVideo ?? findByPrefix(dir, ['camera', 'cam', 'face'], VIDEO_EXTS) ?? undefined;
  const screen =
    manifestInput?.screenVideo ?? findByPrefix(dir, ['screen', 'demo', 'desktop'], VIDEO_EXTS) ?? undefined;
  const audio =
    manifestInput?.audio ?? findByPrefix(dir, ['audio', 'voice', 'mic'], AUDIO_EXTS) ?? undefined;
  return { cameraVideo: camera, screenVideo: screen, audio };
}

/** Pick the voice-bearing file to transcribe: separate audio > camera > screen. */
export function voiceSource(dir, inputs) {
  const pick = inputs.audio ?? inputs.cameraVideo ?? inputs.screenVideo;
  return pick ? path.join(dir, pick) : null;
}
