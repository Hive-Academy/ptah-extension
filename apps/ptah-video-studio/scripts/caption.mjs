/**
 * caption.mjs — word-level caption timestamps via whisper.cpp.
 *
 * Pipeline per scene (per-beat, footage-timed):
 *   1. For each beat wav (wav/NNNN.wav), ffmpeg-static resamples it to
 *      16kHz / mono / s16 — the format whisper.cpp requires.
 *   2. @remotion/install-whisper-cpp: installWhisperCpp -> downloadWhisperModel
 *      (base.en) -> transcribe(tokenLevelTimestamps:true) -> toCaptions, per wav.
 *   3. Each beat's tokens are OFFSET by that beat's recorded `tMs` (from
 *      durations.json / beats.json) so caption timings live on the same footage
 *      timeline as the per-beat <Audio> placements. This keeps voice and words
 *      locked even when beats are spread across the scene (no concat drift).
 *   4. Write captions.json = the flat Caption[] (footage-timed, sorted by
 *      startMs) consumed by <LowerThird> / @remotion/captions with offsetMs=0.
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

/**
 * Merge whisper's sub-word / punctuation tokens into whole words.
 *
 * `tokenLevelTimestamps` emits BPE fragments — "refactors" arrives as
 * "ref"+"act"+"ors" and "." as its own token. A new word is signalled by a
 * LEADING SPACE in the token text; continuations and bare punctuation attach to
 * the previous word. Word start = first fragment's start; end = last fragment's
 * end. Without this, captions render as "ref act ors . valid ator".
 */
function mergeToWords(tokens) {
  const words = [];
  for (const t of tokens) {
    const trimmed = t.text.trim();
    if (!trimmed) continue;
    const isPunct = /^[.,!?;:'")\]}%…–-]+$/.test(trimmed);
    const startsWord = /^\s/.test(t.text) && !isPunct;
    if (words.length === 0 || startsWord) {
      words.push({
        text: trimmed,
        startMs: t.startMs,
        endMs: t.endMs,
        timestampMs: t.timestampMs ?? null,
        confidence: t.confidence ?? null,
      });
    } else {
      const w = words[words.length - 1];
      w.text += trimmed;
      w.endMs = t.endMs;
    }
  }
  return words;
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

/** Resample a single wav to 16kHz/mono/s16 (the format whisper.cpp needs). */
function resample16k(srcWav, outWav) {
  execFileSync(
    ffmpegBin(),
    ['-y', '-i', srcWav, '-ar', '16000', '-ac', '1', '-sample_fmt', 's16', outWav],
    { stdio: 'inherit' },
  );
}

/**
 * Ordered [{ wav, beatTMs }] for a scene. Prefers durations.json (authoritative
 * beatTMs written by narrate.mjs); falls back to pairing sorted wavs with
 * beats.json tMs by order.
 */
function orderedClips(dir, wavDir) {
  const durationsPath = path.join(dir, 'durations.json');
  if (fs.existsSync(durationsPath)) {
    const d = JSON.parse(fs.readFileSync(durationsPath, 'utf8'));
    return (d.clips ?? [])
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((c) => ({ wav: path.join(dir, c.file), beatTMs: c.beatTMs ?? 0 }));
  }
  const beatsPath = path.join(dir, 'beats.json');
  const beats = fs.existsSync(beatsPath)
    ? JSON.parse(fs.readFileSync(beatsPath, 'utf8')).beats ?? []
    : [];
  return orderedWavs(wavDir).map((wav, i) => ({
    wav,
    beatTMs: beats[i]?.tMs ?? 0,
  }));
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

  const clips = orderedClips(dir, wavDir);
  if (clips.length === 0) {
    throw new Error(`No per-beat wavs in ${wavDir} — run narrate.mjs first.`);
  }

  // Do NOT pre-create WHISPER_DIR: installWhisperCpp rejects a pre-existing
  // folder that lacks the binary as a stale install. Let it own creation;
  // only ensure the parent exists.
  fs.mkdirSync(path.dirname(WHISPER_DIR), { recursive: true });
  console.log(`[caption] ${scene}: ensuring whisper.cpp @ ${WHISPER_DIR}…`);
  await installWhisperCpp({ to: WHISPER_DIR, version: WHISPER_VERSION });
  await downloadWhisperModel({ model: opts.model, folder: WHISPER_DIR });

  const tmp16k = path.join(wavDir, '_t16k.wav');
  const all = [];
  console.log(`[caption] ${scene}: transcribing ${clips.length} beat(s) (${opts.model})…`);
  for (const { wav, beatTMs } of clips) {
    if (!fs.existsSync(wav)) continue;
    resample16k(wav, tmp16k);
    const whisperOutput = await transcribe({
      inputPath: tmp16k,
      whisperPath: WHISPER_DIR,
      whisperCppVersion: WHISPER_VERSION,
      model: opts.model,
      tokenLevelTimestamps: true,
    });
    const { captions } = toCaptions({ whisperCppOutput: whisperOutput });
    // Merge sub-word tokens into whole words, then shift each word onto the
    // footage timeline so it aligns with the beat's <Audio> (placed at tMs).
    for (const w of mergeToWords(captions)) {
      all.push({
        text: w.text,
        startMs: w.startMs + beatTMs,
        endMs: w.endMs + beatTMs,
        timestampMs: w.timestampMs == null ? null : w.timestampMs + beatTMs,
        confidence: w.confidence ?? null,
      });
    }
  }
  fs.rmSync(tmp16k, { force: true });
  all.sort((a, b) => a.startMs - b.startMs);
  fs.writeFileSync(captionsPath, JSON.stringify(all, null, 2));
  console.log(
    `[caption] ${scene}: wrote ${all.length} caption token(s) across ${clips.length} beat(s).`,
  );
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
