/**
 * caption.mjs — word-level caption timestamps via whisper.cpp.
 *
 * Pipeline per scene:
 *   1. ffmpeg-static concat of wav/*.wav (beat order) into wav/_concat.wav,
 *      resampled to 16kHz / mono / s16 — the format whisper.cpp requires and
 *      the exact track Remotion mixes, so word timings align to the final audio.
 *   2. @remotion/install-whisper-cpp: installWhisperCpp -> downloadWhisperModel
 *      (base.en) -> transcribe(tokenLevelTimestamps:true) -> toCaptions.
 *   3. Write captions.json = the Caption[] consumed by <LowerThird> /
 *      @remotion/captions.
 *
 * Binary + model cache under apps/ptah-video-studio/.whisper (gitignored,
 * idempotent first-run download ~150MB for base.en).
 *
 * Usage: node apps/ptah-video-studio/scripts/caption.mjs --scene editor-tour [--model base.en] [--force]
 *
 * ESM, Node >=22.9. Errors caught as `unknown`.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  installWhisperCpp,
  downloadWhisperModel,
  transcribe,
  toCaptions,
} from '@remotion/install-whisper-cpp';
import { parseArgs, sceneDir, listScenesWithBeats, WHISPER_DIR } from './paths.mjs';

const require = createRequire(import.meta.url);

const WHISPER_VERSION = '1.5.5';
const DEFAULT_MODEL = 'base.en';

function ffmpegBin() {
  const bin = require('ffmpeg-static');
  if (!bin || !fs.existsSync(bin)) {
    throw new Error('ffmpeg-static binary not found.');
  }
  return bin;
}

/** Ordered list of wav files for a scene (excluding the transient concat). */
function orderedWavs(wavDir) {
  if (!fs.existsSync(wavDir)) return [];
  return fs
    .readdirSync(wavDir)
    .filter((f) => /^\d+\.wav$/i.test(f))
    .sort()
    .map((f) => path.join(wavDir, f));
}

/** Concat + resample to 16kHz/mono/s16 -> wav/_concat.wav. */
function buildConcat(wavDir) {
  const wavs = orderedWavs(wavDir);
  if (wavs.length === 0) {
    throw new Error(`No per-beat wavs in ${wavDir} — run narrate.mjs first.`);
  }
  const concatPath = path.join(wavDir, '_concat.wav');
  const listPath = path.join(wavDir, '_concat-list.txt');
  // ffmpeg concat demuxer needs a list file with escaped absolute paths.
  const listBody = wavs
    .map((w) => `file '${w.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    .join('\n');
  fs.writeFileSync(listPath, listBody);

  execFileSync(
    ffmpegBin(),
    [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-ar', '16000',
      '-ac', '1',
      '-sample_fmt', 's16',
      concatPath,
    ],
    { stdio: 'inherit' },
  );
  fs.rmSync(listPath, { force: true });
  return concatPath;
}

async function captionScene(scene, opts) {
  const dir = sceneDir(scene);
  const wavDir = path.join(dir, 'wav');
  const captionsPath = path.join(dir, 'captions.json');

  if (!opts.force && fs.existsSync(captionsPath)) {
    const wavs = orderedWavs(wavDir);
    const newestWav = wavs.reduce(
      (acc, w) => Math.max(acc, fs.statSync(w).mtimeMs),
      0,
    );
    if (fs.statSync(captionsPath).mtimeMs >= newestWav) {
      console.log(`[caption] ${scene}: captions.json up to date — skipping (use --force).`);
      return;
    }
  }

  console.log(`[caption] ${scene}: building 16kHz mono concat…`);
  const concatPath = buildConcat(wavDir);

  // Do NOT pre-create WHISPER_DIR: installWhisperCpp rejects a pre-existing
  // folder that lacks the binary as a stale install. Let it own creation;
  // only ensure the parent exists.
  fs.mkdirSync(path.dirname(WHISPER_DIR), { recursive: true });
  console.log(`[caption] ${scene}: ensuring whisper.cpp @ ${WHISPER_DIR}…`);
  await installWhisperCpp({ to: WHISPER_DIR, version: WHISPER_VERSION });
  await downloadWhisperModel({ model: opts.model, folder: WHISPER_DIR });

  console.log(`[caption] ${scene}: transcribing (${opts.model})…`);
  const whisperOutput = await transcribe({
    inputPath: concatPath,
    whisperPath: WHISPER_DIR,
    whisperCppVersion: WHISPER_VERSION,
    model: opts.model,
    tokenLevelTimestamps: true,
  });

  const { captions } = toCaptions({ whisperCppOutput: whisperOutput });
  fs.writeFileSync(captionsPath, JSON.stringify(captions, null, 2));
  console.log(`[caption] ${scene}: wrote ${captions.length} caption token(s).`);
}

async function main() {
  const args = parseArgs();
  const opts = {
    model: typeof args.model === 'string' ? args.model : DEFAULT_MODEL,
    force: Boolean(args.force),
  };

  const scenes =
    typeof args.scene === 'string' ? [args.scene] : listScenesWithBeats();
  if (scenes.length === 0) {
    console.log('[caption] No scenes with beats.json found. Nothing to do.');
    return;
  }

  for (const scene of scenes) {
    await captionScene(scene, opts);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[caption] FAILED: ${message}`);
  process.exitCode = 1;
});
