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
} from './paths.mjs';

const require = createRequire(import.meta.url);

const ROOT_ENTRY = 'src/Root.tsx';
const COMPOSITION_ID = 'ShowcaseVideo';

/** Sound-design assets, served via --public-dir/staticFile when present. */
const WHOOSH_ASSET = path.join(APP_ROOT, 'assets', 'sfx', 'whoosh.mp3');
const MUSIC_ASSET = path.join(APP_ROOT, 'assets', 'music', 'bed.mp3');

/** Breath left before the first narration line after trimming the dead lead-in. */
const LEAD_IN_MS = 700;

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
function buildProps(scene, outRes) {
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
  let captions = readJsonIfExists(path.join(dir, 'captions.json')) ?? [];
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

  // Asset paths are relative (forward-slash) to the scene dir, which is passed
  // to `remotion render` as --public-dir. Remotion serves local assets over its
  // internal http server via staticFile(); absolute file:// paths are rejected
  // by the renderer's asset loader.
  const narrationFiles = {};
  const wavDir = path.join(dir, 'wav');
  if (fs.existsSync(wavDir)) {
    for (const f of fs.readdirSync(wavDir)) {
      const m = /^(\d+)\.wav$/i.exec(f);
      if (m) narrationFiles[Number(m[1])] = `wav/${f}`;
    }
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
  // it down and the camera may punch in further while staying crisp.
  const captureH = manifest.res?.height ?? source.height;
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
  const sound = stageSoundAssets(dir);

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
    ...(leadTrimMs > 0 ? { trimBeforeMs: leadTrimMs } : {}),
    ...(outRes ? { outRes } : {}),
    ...(sound.whooshSfx ? { whooshSfx: sound.whooshSfx } : {}),
    ...(sound.musicBed ? { musicBed: sound.musicBed } : {}),
  };
}

/**
 * Stage optional sound-design assets into the scene dir so they resolve through
 * Remotion's staticFile() (which serves relative to --public-dir = scene dir;
 * it rejects absolute file:// paths). Copies whoosh.mp3 / bed.mp3 from the app's
 * assets/ into <sceneDir>/_sfx/ when present. Returns the relative names to hand
 * the composition, or nulls when an asset is missing (→ render stays silent).
 */
function stageSoundAssets(dir) {
  const result = { whooshSfx: null, musicBed: null };
  const stageDir = path.join(dir, '_sfx');
  const stage = (srcAbs, relName) => {
    if (!fs.existsSync(srcAbs)) return null;
    fs.mkdirSync(stageDir, { recursive: true });
    const dest = path.join(stageDir, relName);
    fs.copyFileSync(srcAbs, dest);
    return `_sfx/${relName}`; // forward-slash, relative to --public-dir
  };
  result.whooshSfx = stage(WHOOSH_ASSET, 'whoosh.mp3');
  result.musicBed = stage(MUSIC_ASSET, 'bed.mp3');
  return result;
}

function renderScene(scene, concurrency, outRes) {
  const dir = sceneDir(scene);
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${scene}.mp4`);

  const props = buildProps(scene, outRes);
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

function main() {
  const args = parseArgs();
  const concurrency = args.concurrency ? Number(args.concurrency) : undefined;
  // --out-res accepts a preset key or `native` (default). String `true` guards
  // against `--out-res` passed with no value.
  const outRes = resolveOutRes(
    typeof args['out-res'] === 'string' ? args['out-res'] : 'native',
  );

  const scenes =
    typeof args.scene === 'string' ? [args.scene] : listScenesWithBeats();
  if (scenes.length === 0) {
    console.log('[render] No scenes with beats.json found. Nothing to do.');
    return;
  }

  for (const scene of scenes) {
    renderScene(scene, concurrency, outRes);
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
