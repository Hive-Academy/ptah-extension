/**
 * selfshot-render.mjs — validate + resolve a beats manifest, then render.
 *
 * Mirrors render-all.mjs's "resolve in the script, render dumb" split: it turns
 * the authored beats manifest (word anchors + seconds) into fully-numeric
 * `ResolvedSelfShotProps`, stages every asset the composition references into a
 * `_public` dir (so Remotion's staticFile can serve them), and invokes
 * `remotion render` with the composition chosen from `mode`
 * (talking-head→TalkingHead, screen-demo→ScreenDemo, hybrid→Hybrid).
 *
 * The SAME manifest renders both horizontal (1920x1080) and vertical (1080x1920)
 * — the compositions are percentage-based so they reflow; the render just sets
 * the output size per format.
 *
 * Usage:
 *   node scripts/selfshot-render.mjs --slug my-intro [--format 16x9|9x16|both] \
 *        [--range 0-90] [--concurrency N]
 *
 * ESM, Node >=22.9.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs, APP_ROOT, sceneDir } from './paths.mjs';
import { ingestDir, detectInputs } from './lib/selfshot-paths.mjs';
import {
  loadWords,
  validateManifest,
  captionsFromWords,
  resolveBeats,
} from './lib/selfshot-resolve.mjs';
import { getMediaDurationMs, getVideoSize } from './lib/media.mjs';

const ROOT_ENTRY = 'src/Root.tsx';
const WHOOSH_ASSET = path.join(APP_ROOT, 'assets', 'sfx', 'whoosh.mp3');
const MUSIC_DIR = path.join(APP_ROOT, 'assets', 'music');

const COMPOSITION_BY_MODE = {
  'talking-head': 'TalkingHead',
  'screen-demo': 'ScreenDemo',
  hybrid: 'Hybrid',
};

const FORMAT_RES = {
  '16x9': { width: 1920, height: 1080 },
  '9x16': { width: 1080, height: 1920 },
};

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Copy `srcAbs` into the public dir under `relName`; returns relName or null. */
function stage(publicDir, srcAbs, relName) {
  if (!srcAbs || !fs.existsSync(srcAbs)) return null;
  fs.mkdirSync(publicDir, { recursive: true });
  fs.copyFileSync(srcAbs, path.join(publicDir, relName));
  return relName;
}

/** Resolve a b-roll `src` (ingest file OR showcase scene slug) to an absolute path. */
function resolveBrollAbs(dir, src) {
  const local = path.join(dir, src);
  if (fs.existsSync(local)) return local;
  // Treat as a showcase scene slug → its rendered out mp4 (b-roll only).
  const showcase = path.join(sceneDir(src), 'out', `${src}.mp4`);
  if (fs.existsSync(showcase)) return showcase;
  return null;
}

/** Music-bed source: manifest.music (ingest dir or assets/music/) → absolute or null. */
function resolveMusic(dir, music) {
  if (!music) return null;
  const local = path.join(dir, music);
  if (fs.existsSync(local)) return local;
  const asset = path.join(MUSIC_DIR, music);
  if (fs.existsSync(asset)) return asset;
  return null;
}

function primaryMedia(mode, inputs, dir) {
  const abs = (name) => (name ? path.join(dir, name) : null);
  if (mode === 'talking-head') return abs(inputs.cameraVideo) ?? abs(inputs.audio);
  if (mode === 'screen-demo') return abs(inputs.screenVideo) ?? abs(inputs.audio);
  return abs(inputs.cameraVideo) ?? abs(inputs.screenVideo) ?? abs(inputs.audio);
}

function buildProps(slug, mode, res, ctx) {
  const { inputs, dir, publicDir, words, resolvedBeats, bodyMs, manifest } = ctx;
  const ext = (name) => path.extname(name).toLowerCase();

  const cameraSrc = inputs.cameraVideo
    ? stage(publicDir, path.join(dir, inputs.cameraVideo), `camera${ext(inputs.cameraVideo)}`)
    : undefined;
  const screenSrc = inputs.screenVideo
    ? stage(publicDir, path.join(dir, inputs.screenVideo), `screen${ext(inputs.screenVideo)}`)
    : undefined;
  const audioSrc = inputs.audio
    ? stage(publicDir, path.join(dir, inputs.audio), `audio${ext(inputs.audio)}`)
    : undefined;
  const muteVideo = !!inputs.audio;

  const whoosh = stage(publicDir, WHOOSH_ASSET, 'whoosh.mp3') ?? undefined;
  const musicAbs = resolveMusic(dir, manifest.music);
  const music = musicAbs ? stage(publicDir, musicAbs, `music${ext(musicAbs)}`) ?? undefined : undefined;

  // Screen geometry for the virtual-camera math (probe, else declared, else full).
  let screenSource;
  if (mode === 'screen-demo' && inputs.screenVideo) {
    const size = manifest.screenSource ?? getVideoSize(path.join(dir, inputs.screenVideo));
    if (size) screenSource = { width: size.width, height: size.height, contentHeight: size.contentHeight ?? size.height };
  }

  const bubble =
    (mode === 'screen-demo' || mode === 'hybrid') && manifest.bubble?.enabled !== false && (manifest.bubble || mode === 'hybrid')
      ? { corner: manifest.bubble?.corner ?? 'br', sizePct: manifest.bubble?.sizePct ?? 0.24 }
      : undefined;

  const endEnabled = manifest.endCard?.enabled !== false;
  const endMs = endEnabled ? manifest.endCard?.durationMs ?? 6000 : 0;

  return {
    slug,
    mode,
    fps: 30,
    res,
    bodyMs,
    durationMs: bodyMs + endMs,
    ...(cameraSrc ? { cameraSrc } : {}),
    ...(screenSrc ? { screenSrc } : {}),
    ...(audioSrc ? { audioSrc } : {}),
    ...(muteVideo ? { muteVideo } : {}),
    ...(screenSource ? { screenSource } : {}),
    captions: captionsFromWords(words),
    shots: resolvedBeats.shots,
    overlays: resolvedBeats.overlays,
    layouts: resolvedBeats.layouts,
    ...(bubble ? { bubble } : {}),
    ...(endMs > 0 ? { endCard: { atMs: bodyMs, durationMs: endMs, ...(manifest.endCard?.headline ? { headline: manifest.endCard.headline } : {}) } } : {}),
    ...(music ? { music } : {}),
    ...(whoosh ? { whoosh } : {}),
  };
}

function main() {
  const args = parseArgs();
  const slug = typeof args.slug === 'string' ? args.slug : null;
  if (!slug) throw new Error('Pass --slug <name>.');

  const dir = ingestDir(slug);
  const beatsPath = path.join(dir, 'beats.json');
  if (!fs.existsSync(beatsPath)) {
    throw new Error(`No beats.json in ${dir}. Run selfshot-draft-beats first (or author one).`);
  }

  const manifest = validateManifest(readJson(beatsPath));
  const mode = manifest.mode;
  const compositionId = COMPOSITION_BY_MODE[mode];
  const inputs = detectInputs(dir, manifest.input);

  const words = loadWords(dir);
  if (words.length === 0) {
    console.warn(`[selfshot] ${slug}: no words.json — captions + word anchors unavailable.`);
  }

  const primary = primaryMedia(mode, inputs, dir);
  if (!primary || !fs.existsSync(primary)) {
    throw new Error(`Primary media for mode "${mode}" not found in ${dir}.`);
  }
  const bodyMs = getMediaDurationMs(primary);
  if (!bodyMs) throw new Error(`Could not read duration of ${path.basename(primary)}.`);
  console.log(`[selfshot] ${slug}: mode=${mode}, body=${(bodyMs / 1000).toFixed(1)}s (${path.basename(primary)}).`);

  // Stage b-roll sources referenced by beats and rewrite their src to staged names.
  const publicDir = path.join(dir, '_public');
  fs.rmSync(publicDir, { recursive: true, force: true });
  fs.mkdirSync(publicDir, { recursive: true });
  const brollCache = new Map();
  const resolveBrollSrc = (src) => {
    if (brollCache.has(src)) return brollCache.get(src);
    const abs = resolveBrollAbs(dir, src);
    if (!abs) throw new Error(`b-roll src "${src}" not found (not a file in ${dir} nor a rendered showcase scene).`);
    const rel = `broll-${brollCache.size}${path.extname(abs).toLowerCase()}`;
    stage(publicDir, abs, rel);
    brollCache.set(src, rel);
    return rel;
  };

  const resolvedBeats = resolveBeats(manifest.beats, words, { mode, resolveBrollSrc });

  const formats =
    args.format === 'both'
      ? ['16x9', '9x16']
      : args.format === '9x16'
        ? ['9x16']
        : ['16x9'];

  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir, { recursive: true });

  for (const format of formats) {
    const res = FORMAT_RES[format];
    const props = buildProps(slug, mode, res, { inputs, dir, publicDir, words, resolvedBeats, bodyMs, manifest });
    const propsPath = path.join(dir, `render-props.${format}.json`);
    fs.writeFileSync(propsPath, JSON.stringify(props, null, 2));

    const outFile = path.join(outDir, `${slug}-${format}.mp4`);
    const cmd = ['remotion', 'render', ROOT_ENTRY, compositionId, outFile, `--props=${propsPath}`, `--public-dir=${publicDir}`];
    if (typeof args.range === 'string') cmd.push(`--frames=${args.range}`);
    if (args.concurrency) cmd.push(`--concurrency=${args.concurrency}`);

    console.log(`[selfshot] ${slug} [${format}] → ${outFile}${args.range ? ` (frames ${args.range})` : ''}`);
    execFileSync('npx', cmd, { cwd: APP_ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  }

  console.log(`[selfshot] Done. Rendered ${formats.length} format(s) for ${slug}.`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[selfshot] FAILED: ${message}`);
  process.exitCode = 1;
}
