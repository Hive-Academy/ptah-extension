/**
 * media.mjs — small ffmpeg helpers shared by the self-shot scripts.
 *
 * Uses the hoisted `ffmpeg-static` binary (same dep the showcase caption/render
 * scripts use). Only duration/size probing + 16k resample are needed — parsed
 * from ffmpeg's stderr (ffmpeg-static ships no ffprobe).
 *
 * ESM, Node >=22.9.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';

const require = createRequire(import.meta.url);

export function ffmpegBin() {
  const bin = require('ffmpeg-static');
  if (!bin || !fs.existsSync(bin)) throw new Error('ffmpeg-static binary not found.');
  return bin;
}

/** Run ffmpeg and return its stderr text (ffmpeg writes info to stderr). */
function ffmpegInfo(args) {
  const res = spawnSync(ffmpegBin(), args, { encoding: 'utf8' });
  return `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
}

/** Media duration in ms (parsed from `Duration: HH:MM:SS.ss`), or null. */
export function getMediaDurationMs(file) {
  const out = ffmpegInfo(['-i', file]);
  const m = /Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/.exec(out);
  if (!m) return null;
  const [, hh, mm, ss, cs] = m;
  return (
    (Number(hh) * 3600 + Number(mm) * 60 + Number(ss)) * 1000 +
    Number((cs + '00').slice(0, 3))
  );
}

/** First video stream size `{ width, height }` (parsed from `NNNNxNNNN`), or null. */
export function getVideoSize(file) {
  const out = ffmpegInfo(['-i', file]);
  const m = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(out);
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** Whether a file has an audio stream. */
export function hasAudioStream(file) {
  return /Stream #\d+:\d+.*: Audio:/.test(ffmpegInfo(['-i', file]));
}

/** Resample any media to 16kHz/mono/s16 wav (the format whisper.cpp needs). */
export function extractAudio16k(srcFile, outWav) {
  execFileSync(
    ffmpegBin(),
    ['-y', '-i', srcFile, '-vn', '-ar', '16000', '-ac', '1', '-sample_fmt', 's16', outWav],
    { stdio: 'ignore' },
  );
}
