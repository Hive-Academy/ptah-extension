/**
 * render-all.mjs — render one mp4 per captured scene.
 *
 * For each scene that has a beats.json under RECORDINGS_ROOT:
 *   1. Validate beats.json and load durations.json / captions.json.
 *   2. Build a props JSON (rawVideo path, manifest, narrationFiles map,
 *      durations, captions) written to recordings/<scene>/render-props.json.
 *   3. Invoke `remotion render src/Root.tsx ShowcaseVideo <out> --props=…`.
 *
 * Output: recordings/<scene>/out/<scene>.mp4 (H.264, per remotion.config.ts).
 * This replaces transcode.mjs as the mp4 producer for the full pipeline.
 *
 * Usage:
 *   node apps/ptah-video-studio/scripts/render-all.mjs \
 *     [--scene editor-tour] [--concurrency N] [--out-res 1080p|1440p|4k|native]
 *
 * --out-res sets the OUTPUT composition size. `native` (default) renders at the
 * capture resolution. When the capture is taller than the output (e.g. captured
 * at 1440p, rendered at 1080p) the footage is supersampled: DeviceFrame scales
 * the higher-res capture down and the virtual camera can punch in past 2.4× and
 * still resolve real pixels, so the zooms stay crisp.
 *
 * ESM, Node >=22.9. Errors caught as `unknown`.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseArgs,
  sceneDir,
  listScenesWithBeats,
  APP_ROOT,
  WORKSPACE_ROOT,
} from './paths.mjs';

const require = createRequire(import.meta.url);

const ROOT_ENTRY = 'src/Root.tsx';
const COMPOSITION_ID = 'ShowcaseVideo';

/** Sound-design assets, served via --public-dir/staticFile when present. */
const WHOOSH_ASSET = path.join(APP_ROOT, 'assets', 'sfx', 'whoosh.mp3');

/** Breath left before the first narration line after trimming the dead lead-in. */
const LEAD_IN_MS = 700;

/**
 * Camera grammar: the body always OPENS full-frame for at least this long so
 * the viewer sees the whole app before the first punch-in.
 */
const ESTABLISH_MS = 2600;
/** Minimum time between camera shots — punch-ins faster than this read as jitter. */
const MIN_SHOT_MS = 1400;

// ── Segment-based timeline (time-remap) ─────────────────────────────────────
// Capture is real-time, so slow UI mounts BETWEEN narration beats film as dead
// silent footage (measured 31s + 12s gaps in editor-tour). We decouple OUTPUT
// time from CAPTURE time: footage under narration ("active windows") plays at
// 1×; dead spans between windows are compressed (speed-ramp, capped) or, when
// enormous, hard-cut to a short connective segment. See buildSegments().

/** Extra hold kept after a narration clip finishes before its window closes. */
const BREATH_MS = 400;
/** Active hold for a beat with no resolvable narration clip (legacy/silent). */
const DEFAULT_HOLD_MS = 2500;
/** A dead span shorter than this is left at 1× (absorbed as a connective beat). */
const GAP_OUT_CAP_MS = 900;
/** Fastest a dead span is speed-ramped before we hard-cut instead. */
const MAX_GAP_RATE = 8;
/** Length of the short 1× segment a hard-cut keeps (from the TAIL of the span). */
const HARDCUT_MS = 700;

/**
 * Enforce the camera grammar on a (body-local, post-trim) shot list:
 *   1. Insert a full-frame establishing shot at 0 and push any focus shot that
 *      fired inside the establishing window out to `ESTABLISH_MS` (keeping only
 *      the last such shot — earlier ones would flash by anyway).
 *   2. Drop shots that start within `MIN_SHOT_MS` of the previous kept shot.
 */
function applyCameraGrammar(shots) {
  if (shots.length === 0) return shots;
  const sorted = [...shots].sort((a, b) => a.fromMs - b.fromMs);

  const earlyFocus = sorted.filter((s) => s.fromMs < ESTABLISH_MS && s.focus);
  const kept = [{ fromMs: 0 }];
  if (earlyFocus.length > 0) {
    kept.push({ ...earlyFocus[earlyFocus.length - 1], fromMs: ESTABLISH_MS });
  }
  for (const s of sorted) {
    if (s.fromMs < ESTABLISH_MS) continue; // covered by the opener / pushed shot
    kept.push(s);
  }

  const spaced = [];
  for (const s of kept.sort((a, b) => a.fromMs - b.fromMs)) {
    const prev = spaced[spaced.length - 1];
    if (prev && s.fromMs - prev.fromMs < MIN_SHOT_MS) continue;
    spaced.push(s);
  }
  return spaced;
}

/**
 * Word-accurate captions synthesized from ElevenLabs character alignment
 * (durations.json `clips[].words`, clip-relative ms) instead of a whisper
 * transcription pass. Each beat's words are shifted onto the footage clock at
 * the beat's recorded tMs. Returns null when no clip carries words (legacy /
 * kokoro narration) so the caller falls back to captions.json.
 */
function captionsFromAlignment(beats, durations) {
  const clips = durations?.clips ?? [];
  if (!clips.some((c) => Array.isArray(c.words) && c.words.length > 0)) {
    return null;
  }
  // In a scripted scene (any beat carries scriptIndex), a beat WITHOUT one is
  // a legacy/dynamic beat with no pre-generated clip — position-mapping it
  // would steal another line's clip, so it gets no tokens. Pure-legacy scenes
  // (no scriptIndex anywhere) keep the position mapping.
  const scripted = beats.some((b) => b.scriptIndex !== undefined);
  const byIndex = new Map(clips.map((c) => [c.index, c]));
  const tokens = [];
  beats.forEach((beat, i) => {
    const wavIndex = scripted ? beat.scriptIndex : i;
    if (wavIndex === undefined) return;
    const clip = byIndex.get(wavIndex + 1);
    for (const w of clip?.words ?? []) {
      tokens.push({
        text: w.text,
        startMs: beat.tMs + w.startMs,
        endMs: beat.tMs + w.endMs,
        timestampMs: beat.tMs + Math.round((w.startMs + w.endMs) / 2),
        confidence: 1,
      });
    }
  });
  return tokens;
}

/**
 * Ms of dead footage to skip at the front: everything up to `LEAD_IN_MS` before
 * the first beat. Returns 0 when the first beat already starts within the lead-in
 * window (nothing to trim) or there are no beats.
 */
function computeLeadTrim(manifest) {
  const firstBeatMs = manifest.beats?.[0]?.tMs ?? 0;
  return Math.max(0, firstBeatMs - LEAD_IN_MS);
}

/**
 * Shift every shot back by `trimMs`. Shots that fell entirely inside the trimmed
 * lead-in collapse to the opening shot: the last such shot is kept at fromMs 0
 * (so the scene opens on the region it was framing), earlier ones are dropped.
 */
function shiftShots(shots, trimMs) {
  const shifted = shots.map((s) => ({ ...s, fromMs: s.fromMs - trimMs }));
  const after = shifted.filter((s) => s.fromMs > 0);
  const before = shifted.filter((s) => s.fromMs <= 0);
  if (before.length > 0) {
    after.unshift({ ...before[before.length - 1], fromMs: 0 });
  }
  return after;
}

/**
 * Shift every caption token back by `trimMs`, dropping tokens that end before the
 * new start and clamping a token straddling the cut to start at 0.
 */
function shiftCaptions(captions, trimMs) {
  return captions
    .map((c) => ({
      ...c,
      startMs: c.startMs - trimMs,
      endMs: c.endMs - trimMs,
      timestampMs: c.timestampMs == null ? null : c.timestampMs - trimMs,
    }))
    .filter((c) => c.endMs > 0)
    .map((c) => ({ ...c, startMs: Math.max(0, c.startMs) }));
}

/**
 * Resolve the narration clip that plays under a beat and its duration (ms).
 * Mirrors the beat→wav mapping used for narrationFiles / captionsFromAlignment:
 * in a scripted scene a beat maps to the clip of its SCRIPT line (scriptIndex),
 * otherwise to the position-matched clip. Returns null when no clip resolves.
 */
function clipForBeat(beat, i, scripted, byIndex) {
  const wavIndex = scripted ? beat.scriptIndex : i;
  if (wavIndex === undefined) return null;
  return byIndex.get(wavIndex + 1) ?? null;
}

/**
 * Narration "active windows" on the CURRENT beat clock (body-local, post
 * lead-trim). Each beat's window is [tMs, tMs + clipDurationMs + BREATH_MS];
 * a beat with no clip still gets a DEFAULT_HOLD_MS window so its footage is
 * held at 1× rather than compressed. Returns windows sorted by start (unmerged).
 */
function narrationWindows(beats, durations) {
  const clips = durations?.clips ?? [];
  const byIndex = new Map(clips.map((c) => [c.index, c]));
  const scripted = beats.some((b) => b.scriptIndex !== undefined);
  return beats
    .map((beat, i) => {
      const clip = clipForBeat(beat, i, scripted, byIndex);
      const hold = clip?.durationMs
        ? clip.durationMs + BREATH_MS
        : DEFAULT_HOLD_MS;
      return { startMs: beat.tMs, endMs: beat.tMs + hold };
    })
    .sort((a, b) => a.startMs - b.startMs);
}

/**
 * Compress one dead span [srcFrom, srcTo] (ms, current clock) into one or more
 * output pieces. A span within GAP_OUT_CAP_MS passes at 1×; a longer span is
 * speed-ramped so its OUTPUT length is GAP_OUT_CAP_MS (up to MAX_GAP_RATE×);
 * an enormous span is hard-cut — only the TAIL (HARDCUT_MS, so it flows into the
 * next narration) is kept at 1×, the rest dropped. Returns raw pieces
 * { srcFromMs, srcToMs, out, rate }.
 */
function planGap(srcFromMs, srcToMs) {
  const len = srcToMs - srcFromMs;
  if (len <= GAP_OUT_CAP_MS) {
    return [{ srcFromMs, srcToMs, out: len, rate: 1 }];
  }
  if (len <= MAX_GAP_RATE * GAP_OUT_CAP_MS) {
    return [
      { srcFromMs, srcToMs, out: GAP_OUT_CAP_MS, rate: len / GAP_OUT_CAP_MS },
    ];
  }
  return [
    { srcFromMs: srcToMs - HARDCUT_MS, srcToMs, out: HARDCUT_MS, rate: 1 },
  ];
}

/**
 * Build the piecewise time-remap for a scene: 1× segments over narration active
 * windows, compressed segments over the dead spans between them (plus head/tail
 * edges). Returns { segments, remap, totalOutMs } or null when the data can't
 * support it (no beats / no clips) so the caller falls back to the single-video
 * path.
 *
 * `segments` tile the OUTPUT timeline contiguously (outToMs[i] === outFromMs[i+1]);
 * the SOURCE may have gaps where a hard-cut dropped footage. `remap` is the one
 * monotonic src→out function applied to EVERYTHING downstream (narration
 * placement, shots, captions, total duration) so nothing is shifted twice.
 */
function buildSegments(beats, durations, bodyDurationMs) {
  if (!Array.isArray(beats) || beats.length === 0) return null;
  if (!durations || !Array.isArray(durations.clips) || durations.clips.length === 0) {
    return null;
  }

  // Merge windows whose gap is within the pass-through cap so tiny dead spans
  // stay part of the natural 1× flow instead of fragmenting into segments.
  const windows = narrationWindows(beats, durations);
  const merged = [];
  for (const w of windows) {
    const start = Math.max(0, Math.min(w.startMs, bodyDurationMs));
    const end = Math.max(start, Math.min(w.endMs, bodyDurationMs));
    const prev = merged[merged.length - 1];
    if (prev && start - prev.endMs <= GAP_OUT_CAP_MS) {
      prev.endMs = Math.max(prev.endMs, end);
    } else {
      merged.push({ startMs: start, endMs: end });
    }
  }
  if (merged.length === 0) return null;

  const segments = [];
  let srcCursor = 0;
  let outCursor = 0;
  const push = (srcFromMs, srcToMs, out, rate) => {
    segments.push({
      srcFromMs,
      srcToMs,
      outFromMs: outCursor,
      outToMs: outCursor + out,
      playbackRate: rate,
    });
    outCursor += out;
  };

  for (const w of merged) {
    if (w.startMs > srcCursor) {
      for (const g of planGap(srcCursor, w.startMs)) {
        push(g.srcFromMs, g.srcToMs, g.out, g.rate);
      }
    }
    const activeLen = w.endMs - w.startMs;
    if (activeLen > 0) push(w.startMs, w.endMs, activeLen, 1);
    srcCursor = w.endMs;
  }
  if (bodyDurationMs > srcCursor) {
    for (const g of planGap(srcCursor, bodyDurationMs)) {
      push(g.srcFromMs, g.srcToMs, g.out, g.rate);
    }
  }

  const remap = makeRemap(segments);
  return { segments, remap, totalOutMs: outCursor };
}

/**
 * Monotonic src→out remap over `segments`. A src time inside a segment
 * interpolates linearly; a src time before a segment (including a hard-cut's
 * dropped region) collapses to that segment's output start; past the end it
 * clamps to the final output. One consistent function for every downstream time.
 */
function makeRemap(segments) {
  return (srcMs) => {
    for (const s of segments) {
      if (srcMs <= s.srcFromMs) return s.outFromMs;
      if (srcMs <= s.srcToMs) {
        const span = s.srcToMs - s.srcFromMs;
        const frac = span > 0 ? (srcMs - s.srcFromMs) / span : 0;
        return s.outFromMs + frac * (s.outToMs - s.outFromMs);
      }
    }
    const last = segments[segments.length - 1];
    return last ? last.outToMs : srcMs;
  };
}

/** Output-resolution presets (16:9). `native` keeps the capture size. */
const OUT_RES_PRESETS = {
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
};

/**
 * Resolve --out-res into an explicit { width, height } (or null for native).
 * Accepts a preset key (1080p/1440p/4k) or `native`. Throws on anything else so
 * a typo fails loudly rather than silently rendering at the wrong size.
 */
function resolveOutRes(value) {
  if (!value || value === 'native') return null;
  const preset = OUT_RES_PRESETS[value];
  if (!preset) {
    throw new Error(
      `Invalid --out-res '${value}'. Use one of: native, ${Object.keys(
        OUT_RES_PRESETS,
      ).join(', ')}.`,
    );
  }
  return preset;
}

function readJsonIfExists(p) {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

/**
 * Detect the real UI content height of a capture. Electron/Playwright pad the
 * recorded frame with a uniform mid-gray (~rgb 128) band at the bottom when the
 * web-contents viewport is shorter than the record size. We find where that
 * band starts so DeviceFrame can clip it. Returns { width, height, contentHeight }.
 * Falls back to full height on any failure (no crop).
 */
function detectSource(rawVideo, fallbackW, fallbackH) {
  const full = { width: fallbackW, height: fallbackH, contentHeight: fallbackH };
  try {
    const ffmpeg = require('ffmpeg-static');
    const sharp = require('sharp');
    const tmpPng = path.join(path.dirname(rawVideo), '_probe.png');
    // Grab a frame a few seconds in (past any opening fade).
    execFileSync(ffmpeg, ['-y', '-ss', '3', '-i', rawVideo, '-frames:v', '1', tmpPng], {
      stdio: 'ignore',
    });
    // sharp is async; run synchronously via a spawned helper is overkill — use
    // the sync-ish deasync pattern by reading raw pixels through a child eval.
    const out = execFileSync(
      process.execPath,
      [
        '-e',
        `const sharp=require(${JSON.stringify(require.resolve('sharp'))});(async()=>{const {data,info}=await sharp(${JSON.stringify(
          tmpPng,
        )}).raw().toBuffer({resolveWithObject:true});const ch=info.channels,W=info.width,H=info.height;const rowStat=(y)=>{let s=0,s2=0;for(let x=0;x<W;x++){const i=(y*W+x)*ch;const l=0.299*data[i]+0.587*data[i+1]+0.114*data[i+2];s+=l;s2+=l*l;}const m=s/W;return{m,v:s2/W-m*m};};let top=H;for(let y=H-1;y>=0;y--){const {m,v}=rowStat(y);if(m>110&&m<140&&v<80){top=y;}else break;}console.log(JSON.stringify({W,H,top}));})();`,
      ],
      { encoding: 'utf8' },
    );
    fs.rmSync(tmpPng, { force: true });
    const { W, H, top } = JSON.parse(out.trim().split('\n').pop());
    // Guard against implausible detection (>35% band → treat as no band).
    const band = H - top;
    const contentHeight = band > 0 && band < H * 0.35 ? top : H;
    return { width: W, height: H, contentHeight };
  } catch {
    return full;
  }
}

/**
 * Structural validation of a parsed shots.json, mirroring `shotsFileSchema`
 * (src/lib/shots.ts). render-all is ESM `.mjs` and can't import the TS zod
 * schema (no jiti/tsx import pattern exists in this pipeline — the authoritative
 * zod parse still runs composition-side via `parseShots`), so we do a minimal
 * structural check here and fail with a clear per-scene message. Keep this in
 * lockstep with `shotSchema` when its fields change.
 *
 * Returns the validated `shots` array. Throws with a `<scene>: …` message.
 */
function validateShotsFile(scene, raw) {
  const where = `shots.json for scene ${scene}`;
  if (raw === null) return []; // absent file → no camera track (allowed)
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${where}: top-level value must be an object.`);
  }
  if (typeof raw.scene !== 'string') {
    throw new Error(`${where}: missing string field "scene".`);
  }
  if (!Array.isArray(raw.shots)) {
    throw new Error(`${where}: field "shots" must be an array.`);
  }

  const isRect = (r) =>
    r != null &&
    typeof r === 'object' &&
    ['x', 'y', 'w', 'h'].every((k) => typeof r[k] === 'number');

  raw.shots.forEach((shot, i) => {
    const at = `${where}: shots[${i}]`;
    if (shot == null || typeof shot !== 'object') {
      throw new Error(`${at} must be an object.`);
    }
    if (typeof shot.fromMs !== 'number' || shot.fromMs < 0) {
      throw new Error(`${at}.fromMs must be a non-negative number.`);
    }
    if (shot.focus !== undefined && !isRect(shot.focus)) {
      throw new Error(`${at}.focus must be a {x,y,w,h} rect.`);
    }
    if (shot.ring !== undefined && !isRect(shot.ring)) {
      throw new Error(`${at}.ring must be a {x,y,w,h} rect.`);
    }
    if (
      shot.captionPos !== undefined &&
      !['top', 'bottom'].includes(shot.captionPos)
    ) {
      throw new Error(`${at}.captionPos must be "top" or "bottom".`);
    }
    if (shot.callout !== undefined) {
      const c = shot.callout;
      if (
        c == null ||
        typeof c.text !== 'string' ||
        !['tl', 'tr', 'bl', 'br'].includes(c.pos)
      ) {
        throw new Error(
          `${at}.callout must be { text: string, pos: tl|tr|bl|br }.`,
        );
      }
    }
    // New optional motion fields (backwards compatible).
    if (
      shot.transMs !== undefined &&
      (typeof shot.transMs !== 'number' || shot.transMs <= 0)
    ) {
      throw new Error(`${at}.transMs must be a positive number.`);
    }
    if (
      shot.ease !== undefined &&
      !['ramp', 'cut', 'smooth'].includes(shot.ease)
    ) {
      throw new Error(`${at}.ease must be "ramp", "cut" or "smooth".`);
    }
  });

  return raw.shots;
}

/** Build the props object Remotion's ShowcaseVideo expects for one scene. */
function buildProps(scene, outRes, opts = {}) {
  const { useSegments = true, musicPath = null } = opts;
  const dir = sceneDir(scene);
  const manifest = readJsonIfExists(path.join(dir, 'beats.json'));
  if (!manifest) {
    throw new Error(`No beats.json for scene ${scene}`);
  }

  const rawVideo = path.join(dir, 'raw.webm');
  if (!fs.existsSync(rawVideo)) {
    throw new Error(`No raw.webm for scene ${scene} at ${rawVideo}`);
  }

  const durations = readJsonIfExists(path.join(dir, 'durations.json'));
  // Prefer word-accurate captions from the narration's character alignment;
  // captions.json (whisper) remains the fallback for alignment-less engines.
  const aligned = captionsFromAlignment(manifest.beats ?? [], durations);
  let captions =
    aligned ?? readJsonIfExists(path.join(dir, 'captions.json')) ?? [];
  if (aligned) {
    console.log(
      `[render] ${scene}: captions from narration alignment (${aligned.length} tokens).`,
    );
  }
  // Optional camera / annotation track. Hand-authored per scene today; the
  // Director will emit it from spotlighted element boxes for designed scenes.
  // Validated structurally here (mirrors shotsFileSchema) so a malformed track
  // fails with a clear per-scene message instead of silently mis-rendering.
  const shotsFile = readJsonIfExists(path.join(dir, 'shots.json'));
  let shots = validateShotsFile(scene, shotsFile);

  // ── Lead-in trim ──────────────────────────────────────────────────────────
  // Captures open with seconds of setup (dismiss dialogs, navigate, wait for the
  // workspace) BEFORE the first narration beat — dead air that made every video
  // feel like it "waits for something" at the start. Skip the footage up to just
  // before the first beat and shift beats, shots and captions by the same amount
  // so audio / camera / words stay locked to the (now front-trimmed) footage.
  // DeviceFrame applies the matching `trimBefore` on the <OffthreadVideo>.
  const leadTrimMs = computeLeadTrim(manifest);
  if (leadTrimMs > 0) {
    manifest.beats = (manifest.beats ?? []).map((b) => ({
      ...b,
      tMs: Math.max(0, b.tMs - leadTrimMs),
    }));
    manifest.durationMs = Math.max(1, (manifest.durationMs ?? 0) - leadTrimMs);
    shots = shiftShots(shots, leadTrimMs);
    captions = shiftCaptions(captions, leadTrimMs);
    console.log(
      `[render] ${scene}: trimmed ${leadTrimMs}ms dead lead-in ` +
        `(first beat was at ${leadTrimMs + LEAD_IN_MS}ms).`,
    );
  }

  // ── Segment-based time-remap ───────────────────────────────────────────────
  // Decouple OUTPUT time from CAPTURE time: keep footage under narration at 1×,
  // compress the dead spans between beats. Runs AFTER lead-trim (so it works on
  // the body-local clock) and BEFORE camera grammar (so the camera track is
  // spaced on the REMAPPED times). ONE remap function is applied to beats,
  // shots, captions and the total duration — nothing is shifted twice.
  let segments = null;
  if (useSegments) {
    const built = buildSegments(manifest.beats ?? [], durations, manifest.durationMs);
    if (built) {
      segments = built.segments;
      const { remap } = built;
      manifest.beats = (manifest.beats ?? []).map((b) => ({
        ...b,
        tMs: Math.round(remap(b.tMs)),
      }));
      shots = shots.map((s) => ({ ...s, fromMs: Math.round(remap(s.fromMs)) }));
      captions = captions.map((c) => ({
        ...c,
        startMs: Math.round(remap(c.startMs)),
        endMs: Math.round(remap(c.endMs)),
        timestampMs:
          c.timestampMs == null ? null : Math.round(remap(c.timestampMs)),
      }));
      const beforeMs = manifest.durationMs;
      manifest.durationMs = Math.max(1, Math.round(built.totalOutMs));
      const compressed = built.segments.filter((s) => s.playbackRate > 1 || s.outToMs - s.outFromMs < s.srcToMs - s.srcFromMs);
      console.log(
        `[render] ${scene}: segmented timeline ${Math.round(beforeMs / 1000)}s→` +
          `${Math.round(manifest.durationMs / 1000)}s ` +
          `(${segments.length} segments, ${compressed.length} compressed).`,
      );
    } else {
      console.log(
        `[render] ${scene}: segments unavailable (no beats/clips) — single-video fallback.`,
      );
    }
  }

  // Camera grammar on the (now body-local, remapped) track: full-frame
  // establishing opening, then minimum-spaced punch-ins.
  shots = applyCameraGrammar(shots);

  // Narration windows on the FINAL beat clock (output ms, body-local) for the
  // music-bed ducking envelope — only beats that carry a real clip (so we never
  // duck the bed where nothing is actually spoken). Uses the same beat→clip
  // mapping as the audio placement, so ducking lines up with what's audible.
  const musicWindows = (() => {
    const clips = durations?.clips ?? [];
    const byIndex = new Map(clips.map((c) => [c.index, c]));
    const scripted = (manifest.beats ?? []).some(
      (b) => b.scriptIndex !== undefined,
    );
    return (manifest.beats ?? [])
      .map((beat, i) => {
        const clip = clipForBeat(beat, i, scripted, byIndex);
        if (!clip?.durationMs) return null;
        return {
          startMs: Math.round(beat.tMs),
          endMs: Math.round(beat.tMs + clip.durationMs),
        };
      })
      .filter((w) => w !== null);
  })();

  // Asset paths are relative (forward-slash) to the scene dir, which is passed
  // to `remotion render` as --public-dir. Remotion serves local assets over its
  // internal http server via staticFile(); absolute file:// paths are rejected
  // by the renderer's asset loader.
  // Beat position -> narration wav. Beats tagged with `scriptIndex` (emitted
  // by director.say) map to the wav of their SCRIPT line, so pre-generated
  // clips stay locked to their lines even when a conditional beat was skipped
  // at capture; untagged beats keep the legacy position-based mapping.
  const narrationFiles = {};
  const wavDir = path.join(dir, 'wav');
  if (fs.existsSync(wavDir)) {
    // See captionsFromAlignment: in a scripted scene, a beat without a
    // scriptIndex has no clip of its own — never position-map it onto one.
    const scripted = (manifest.beats ?? []).some(
      (b) => b.scriptIndex !== undefined,
    );
    (manifest.beats ?? []).forEach((beat, i) => {
      const wavIndex = scripted ? beat.scriptIndex : i;
      if (wavIndex === undefined) return;
      const f = `${String(wavIndex + 1).padStart(4, '0')}.wav`;
      if (fs.existsSync(path.join(wavDir, f))) {
        narrationFiles[i + 1] = `wav/${f}`;
      }
    });
  }

  const source = detectSource(
    rawVideo,
    manifest.res?.width ?? 1920,
    manifest.res?.height ?? 1080,
  );
  console.log(
    `[render] ${scene}: source ${source.width}x${source.height}, content ${source.contentHeight}px (band ${source.height - source.contentHeight}px)`,
  );

  // Output size: --out-res override, or the capture res (native). Footage is
  // supersampled when the capture is taller than the output — DeviceFrame scales
  // it down and the camera may punch in further while staying crisp. Use the
  // probed frame height (`source.height`), not `manifest.res` — the launcher now
  // records the CSS viewport there, which is smaller than the device frame on a
  // scaled display.
  const captureH = source.height;
  const supersample = !!outRes && outRes.height < captureH;
  if (outRes) {
    console.log(
      `[render] ${scene}: output ${outRes.width}x${outRes.height}` +
        (supersample ? ` (supersampled from ${captureH}p capture)` : ''),
    );
  }

  // Sound-design assets are optional: include them only when the files exist so
  // a missing asset renders silent rather than failing (paths are relative to
  // --public-dir → the scene dir, so we serve them via a symlink/copy? No —
  // staticFile resolves against the scene dir; the asset lives in the app's
  // assets/. We pass an absolute-ish public path by copying is overkill: instead
  // we hand the composition a name it can staticFile-resolve. Since --public-dir
  // is the scene dir, we stage the assets into the scene dir once per render.)
  const sound = stageSoundAssets(dir, musicPath);

  return {
    rawVideo: 'raw.webm',
    manifest,
    narrationFiles,
    durations,
    captions,
    source,
    shots,
    kenBurns: true,
    supersample,
    ...(segments ? { segments } : {}),
    ...(musicWindows.length > 0 ? { narrationWindows: musicWindows } : {}),
    ...(leadTrimMs > 0 ? { trimBeforeMs: leadTrimMs } : {}),
    ...(outRes ? { outRes } : {}),
    ...(sound.whooshSfx ? { whooshSfx: sound.whooshSfx } : {}),
    ...(sound.musicBed ? { musicBed: sound.musicBed } : {}),
  };
}

/**
 * Resolve the music-bed source: an explicit `--music <path>` (absolute or
 * repo-relative) wins; otherwise the FIRST audio file dropped into
 * `apps/ptah-video-studio/assets/music/` is used. Returns an absolute path or
 * null (→ no bed, exactly the pre-music behavior, no warning noise).
 */
const MUSIC_DIR = path.join(APP_ROOT, 'assets', 'music');
const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus', '.flac']);

function resolveMusic(musicArg) {
  if (typeof musicArg === 'string' && musicArg.length > 0) {
    const abs = path.isAbsolute(musicArg)
      ? musicArg
      : path.resolve(WORKSPACE_ROOT, musicArg);
    if (!fs.existsSync(abs)) {
      throw new Error(`--music file not found: ${abs}`);
    }
    return abs;
  }
  if (!fs.existsSync(MUSIC_DIR)) return null;
  const found = fs
    .readdirSync(MUSIC_DIR)
    .filter((f) => AUDIO_EXTS.has(path.extname(f).toLowerCase()))
    .sort();
  return found.length > 0 ? path.join(MUSIC_DIR, found[0]) : null;
}

/**
 * Stage optional sound-design assets into the scene dir so they resolve through
 * Remotion's staticFile() (which serves relative to --public-dir = scene dir;
 * it rejects absolute file:// paths). Copies the whoosh SFX and the resolved
 * music bed (any absolute path, e.g. from --music or assets/music/) into
 * <sceneDir>/_sfx/. Returns the relative names to hand the composition, or nulls
 * when an asset is missing (→ that layer renders silent; the render never fails).
 */
function stageSoundAssets(dir, musicPath) {
  const result = { whooshSfx: null, musicBed: null };
  const stageDir = path.join(dir, '_sfx');
  const stage = (srcAbs, relName) => {
    if (!srcAbs || !fs.existsSync(srcAbs)) return null;
    fs.mkdirSync(stageDir, { recursive: true });
    const dest = path.join(stageDir, relName);
    fs.copyFileSync(srcAbs, dest);
    return `_sfx/${relName}`; // forward-slash, relative to --public-dir
  };
  result.whooshSfx = stage(WHOOSH_ASSET, 'whoosh.mp3');
  result.musicBed = musicPath
    ? stage(musicPath, `bed${path.extname(musicPath).toLowerCase() || '.mp3'}`)
    : null;
  return result;
}

function renderScene(scene, concurrency, outRes, opts) {
  const dir = sceneDir(scene);
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${scene}.mp4`);

  const props = buildProps(scene, outRes, opts);
  const propsPath = path.join(dir, 'render-props.json');
  fs.writeFileSync(propsPath, JSON.stringify(props, null, 2));

  const args = [
    'remotion',
    'render',
    ROOT_ENTRY,
    COMPOSITION_ID,
    outFile,
    `--props=${propsPath}`,
    `--public-dir=${dir}`,
  ];
  if (concurrency) args.push(`--concurrency=${concurrency}`);

  console.log(`[render] ${scene} -> ${outFile}`);
  execFileSync('npx', args, {
    cwd: APP_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

const HELP = `render-all.mjs — render one mp4 per captured scene.

Usage:
  node apps/ptah-video-studio/scripts/render-all.mjs [options]

Options:
  --scene <slug>       Render only this scene (default: all with beats.json).
  --out-res <preset>   native (default) | 1080p | 1440p | 4k.
  --concurrency <N>    Remotion render concurrency.
  --no-segments        Disable the segment-based time-remap (single-video path);
                       dead footage between narration beats plays real-time.
  --music <path>       Music-bed audio (absolute or repo-relative). Absent → the
                       first audio file in apps/ptah-video-studio/assets/music/
                       is used, if any. No bed found → silent, no warning.
  --help               Show this help.

The music bed is ducked under narration and rises in the gaps; drop a track into
apps/ptah-video-studio/assets/music/ (nothing is committed there) to enable it.`;

function main() {
  const args = parseArgs();
  if (args.help) {
    console.log(HELP);
    return;
  }
  const concurrency = args.concurrency ? Number(args.concurrency) : undefined;
  // --out-res accepts a preset key or `native` (default). String `true` guards
  // against `--out-res` passed with no value.
  const outRes = resolveOutRes(
    typeof args['out-res'] === 'string' ? args['out-res'] : 'native',
  );

  // --no-segments falls back to the single-video path; --music picks the bed.
  const useSegments = !args['no-segments'];
  const musicPath = resolveMusic(
    typeof args.music === 'string' ? args.music : null,
  );
  if (musicPath) {
    console.log(`[render] music bed: ${musicPath}`);
  }
  const opts = { useSegments, musicPath };

  const scenes =
    typeof args.scene === 'string' ? [args.scene] : listScenesWithBeats();
  if (scenes.length === 0) {
    console.log('[render] No scenes with beats.json found. Nothing to do.');
    return;
  }

  for (const scene of scenes) {
    renderScene(scene, concurrency, outRes, opts);
  }
  console.log(`[render] Done. Rendered ${scenes.length} scene(s).`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[render] FAILED: ${message}`);
  process.exitCode = 1;
}
