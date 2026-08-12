/**
 * master-audio.mjs — final loudness master for rendered videos.
 *
 * Remotion mixes narration + music + SFX at the relative levels set in
 * PromoSoundDesign / SoundDesign, but nothing ever sets the ABSOLUTE level of
 * the finished file. Measured on the shipped cuts, that lands us around
 * -22.7 LUFS integrated against a -15.5 LUFS reference (Spotify's Xirp promo).
 *
 * That 7 dB gap is not cosmetic. YouTube normalizes loud uploads DOWN toward
 * -14 LUFS but does not lift quiet ones, so an unmastered render plays back
 * audibly weaker than anything else on the page regardless of how good the mix
 * is. This module closes it with a standard two-pass EBU R128 `loudnorm`:
 *
 *   pass 1 — measure (print_format=json), parse the summary off stderr
 *   pass 2 — normalize with those measurements fed back in, video stream copied
 *
 * Pass 2 re-encodes audio only (`-c:v copy`), so it is fast and leaves the
 * picture bit-identical. Files already within TOLERANCE_LU of the target are
 * skipped, which keeps the pass idempotent — re-running it over the back
 * catalogue does not stack generation loss from repeated AAC encodes.
 *
 * ESM, Node >=22.9.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ffmpegBin, hasAudioStream } from './media.mjs';

/** Integrated loudness target. YouTube/Spotify normalize to about -14 LUFS. */
export const TARGET_I = -14;
/** True-peak ceiling, in dBFS. -1.5 leaves headroom for lossy-codec overshoot. */
export const TARGET_TP = -1.5;
/** Loudness range target, in LU. */
export const TARGET_LRA = 7;
/** Skip mastering when integrated loudness is already this close to target. */
const TOLERANCE_LU = 0.5;

/** Output audio encode settings for pass 2 (video is stream-copied). */
const AUDIO_CODEC = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000'];

/** dBFS -> linear amplitude, the unit `alimiter`'s `limit` expects. */
function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

/** Run ffmpeg, returning its stderr (ffmpeg writes all diagnostics there). */
function runFfmpeg(args) {
  const res = spawnSync(ffmpegBin(), args, {
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
  if (res.error) throw res.error;
  return `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
}

/** Last balanced `{...}` block in a string — loudnorm's JSON report. */
function lastJsonBlock(text) {
  const end = text.lastIndexOf('}');
  const start = text.lastIndexOf('{', end);
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Measure a file with the same loudnorm filter pass 2 will use, so the returned
 * numbers can be fed straight back in. Returns null when the file has no audio
 * or ffmpeg emitted no parseable report.
 *
 * `input_i` and friends come back as strings, and are "-inf" on silent audio —
 * callers must treat a non-finite `inputI` as "do not master".
 */
export function measureLoudness(file, { i = TARGET_I, tp = TARGET_TP, lra = TARGET_LRA } = {}) {
  if (!hasAudioStream(file)) return null;
  const report = lastJsonBlock(
    runFfmpeg([
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-af',
      `loudnorm=I=${i}:TP=${tp}:LRA=${lra}:print_format=json`,
      '-f',
      'null',
      '-',
    ]),
  );
  if (!report) return null;
  return {
    inputI: Number(report.input_i),
    inputTp: Number(report.input_tp),
    inputLra: Number(report.input_lra),
    inputThresh: Number(report.input_thresh),
    targetOffset: Number(report.target_offset),
  };
}

/**
 * Normalize `file` in place to the R128 target. Returns a result describing
 * what happened:
 *
 *   { status: 'mastered', before, after }  — re-encoded
 *   { status: 'skipped', reason, before }  — already on target, silent, or no audio
 *
 * The rewrite goes to a sibling temp file and is renamed over the original only
 * after ffmpeg exits cleanly, so an interrupted run never leaves a truncated mp4
 * where a good render used to be.
 */
export function masterAudio(
  file,
  { i = TARGET_I, tp = TARGET_TP, lra = TARGET_LRA, force = false } = {},
) {
  if (!fs.existsSync(file)) throw new Error(`master-audio: no such file: ${file}`);

  const before = measureLoudness(file, { i, tp, lra });
  if (!before) return { status: 'skipped', reason: 'no audio stream', before: null };
  if (!Number.isFinite(before.inputI)) {
    return { status: 'skipped', reason: 'silent audio', before };
  }
  if (!force && Math.abs(before.inputI - i) <= TOLERANCE_LU && before.inputTp <= tp + 0.1) {
    return { status: 'skipped', reason: 'already on target', before };
  }

  // Pass 2 measurements must come from pass 1 verbatim; loudnorm uses them to
  // pick linear gain when it fits under the peak ceiling and dynamic (limited)
  // mode when it does not. Our renders need ~8 dB of gain, so dynamic is the
  // expected path — that is also what gives the tighter, more "produced" range.
  const measured = [
    `measured_I=${before.inputI}`,
    `measured_TP=${before.inputTp}`,
    `measured_LRA=${before.inputLra}`,
    `measured_thresh=${before.inputThresh}`,
    `offset=${before.targetOffset}`,
  ].join(':');

  const tmp = path.join(
    path.dirname(file),
    `.master-${path.basename(file, path.extname(file))}${path.extname(file)}`,
  );
  const res = spawnSync(
    ffmpegBin(),
    [
      '-y',
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-c:v',
      'copy',
      '-af',
      // loudnorm's dynamic mode limits, but not true-peak-accurately — measured
      // overshoots to -0.6 dBTP against a -1.5 target on some scenes. A hard
      // limiter after it enforces the ceiling. `level=disabled` stops alimiter
      // from applying its own auto-gain and undoing the loudness we just set.
      `loudnorm=I=${i}:TP=${tp}:LRA=${lra}:${measured}:print_format=summary,` +
        `alimiter=limit=${dbToLinear(tp).toFixed(4)}:level=disabled`,
      ...AUDIO_CODEC,
      '-movflags',
      '+faststart',
      tmp,
    ],
    { encoding: 'utf8', maxBuffer: 1 << 26 },
  );
  if (res.status !== 0) {
    if (fs.existsSync(tmp)) fs.rmSync(tmp);
    throw new Error(
      `master-audio: ffmpeg exited ${res.status} on ${file}\n${(res.stderr ?? '').slice(-2000)}`,
    );
  }
  fs.renameSync(tmp, file);

  return { status: 'mastered', before, after: measureLoudness(file, { i, tp, lra }) };
}

/** One-line human summary of a masterAudio() result, for pipeline logs. */
export function describeMasterResult(result) {
  const { status, before, after } = result;
  if (status === 'skipped') {
    const level = before && Number.isFinite(before.inputI) ? ` (${before.inputI.toFixed(1)} LUFS)` : '';
    return `skipped — ${result.reason}${level}`;
  }
  const from = `${before.inputI.toFixed(1)} LUFS / ${before.inputTp.toFixed(1)} dBTP`;
  const to = after
    ? `${after.inputI.toFixed(1)} LUFS / ${after.inputTp.toFixed(1)} dBTP`
    : 'remeasure failed';
  return `${from} -> ${to}`;
}
