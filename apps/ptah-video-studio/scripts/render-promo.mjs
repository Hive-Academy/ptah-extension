/**
 * render-promo.mjs — capture-free promotional videos from a JSON spec.
 *
 * Reads `promos/<slug>.json` (a PromoSpec: ordered slides with on-screen copy
 * and optional per-slide narration `vo` lines), narrates the voiced slides via
 * the existing narrate.mjs machinery, and renders the PromoReel composition —
 * no Playwright capture, no e2e stack, no beats/shots.
 *
 * Flow:
 *   1. Write `narration-script.json` into the promo's recordings dir (the
 *      narration source narrate.mjs already understands), one beat per slide —
 *      silent slides keep their index so wav numbering stays aligned.
 *   2. Spawn `narrate.mjs --scene <slug>` (skips when up to date).
 *   3. Build PromoReel props (spec + per-slide clip durations + wav paths)
 *      and `npx remotion render` with `--public-dir` = the promo dir.
 *
 * Usage:
 *   node apps/ptah-video-studio/scripts/render-promo.mjs --promo dyad-vs-ptah-landscape
 *     [--force-narration]
 *
 * Output: dist/apps/ptah-electron-e2e/recordings/<slug>/out/<slug>.mp4
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { APP_ROOT, sceneDir, parseArgs, loadStudioEnv } from './paths.mjs';

loadStudioEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMOS_DIR = path.resolve(APP_ROOT, 'promos');
const MUSIC_DIR = path.resolve(APP_ROOT, 'assets', 'music');
const SFX_DIR = path.resolve(APP_ROOT, 'assets', 'sfx');
// Shared 3D assets (GLB models, etc.) live under public/ so staticFile()
// resolves them in Remotion Studio (default public dir). render() below sets
// --public-dir to the per-scene recordings dir, so these must ALSO be copied
// there or 3D scenes 404 on render. See stagePublicAssets().
const PUBLIC_DIR = path.resolve(APP_ROOT, 'public');

// Cut/accent SFX staged into every promo's public dir when present on disk —
// see assets/sfx/SFX-CREDITS.md. Never fails on a missing file (PromoReel/
// PromoSoundDesign treat an absent prop as "skip this sound").
const SFX_FILES = {
  whooshFile: 'whoosh.mp3',
  tickFile: 'tick.mp3',
  chimeFile: 'chime.mp3',
};

/**
 * Copy whichever cut/accent SFX exist on disk into the promo's public dir.
 * Returns a partial PromoReelProps object — only props for files that actually
 * exist are set, so a missing file just means that sound is skipped.
 */
function stagePromoSfx(dir) {
  const props = {};
  for (const [propName, fileName] of Object.entries(SFX_FILES)) {
    const src = path.join(SFX_DIR, fileName);
    if (!fs.existsSync(src)) continue;
    const destName = `sfx-${fileName}`;
    fs.copyFileSync(src, path.join(dir, destName));
    props[propName] = destName;
  }
  return props;
}

// Background music bed applied to every promo unless a spec sets `music: null`.
// `music: "<file>"` picks a different track from assets/music/. Volume sits low
// so narration stays clearly on top.
const DEFAULT_MUSIC = 'rising-dawn.mp3';
const DEFAULT_MUSIC_VOLUME = 0.24;

/**
 * Resolve the music bed for a spec and copy it into the scene's public dir so
 * staticFile() can load it. Returns { musicFile, musicVolume } or {} when there
 * is no track (spec disabled it, or the file is missing).
 */
function resolveMusic(spec, dir) {
  const name = spec.music === undefined ? DEFAULT_MUSIC : spec.music;
  if (!name) return {};
  const src = path.isAbsolute(name) ? name : path.join(MUSIC_DIR, name);
  if (!fs.existsSync(src)) {
    console.warn(`[promo] music not found: ${src} — rendering without a bed.`);
    return {};
  }
  const destName = `music${path.extname(src) || '.mp3'}`;
  fs.copyFileSync(src, path.join(dir, destName));
  return {
    musicFile: destName,
    musicVolume: typeof spec.musicVolume === 'number' ? spec.musicVolume : DEFAULT_MUSIC_VOLUME,
  };
}

/**
 * Recursively copy a directory (Node >=16 has fs.cpSync). Used to mirror
 * public/ subdirs (models/, hdri/, …) into the per-scene public dir so
 * staticFile('models/x.glb') resolves under --public-dir=<sceneDir>.
 */
function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true });
}

/**
 * Stage shared 3D/static assets from apps/ptah-video-studio/public/ into the
 * scene's public dir (which render() passes as --public-dir). Mirrors known
 * asset subfolders so staticFile() paths line up between Studio (public/) and
 * headless render (scene dir). Missing folders are skipped silently.
 */
function stagePublicAssets(dir) {
  if (!fs.existsSync(PUBLIC_DIR)) return;
  for (const sub of ['models', 'hdri']) {
    const src = path.join(PUBLIC_DIR, sub);
    if (!fs.existsSync(src)) continue;
    copyDir(src, path.join(dir, sub));
  }
}

function loadSpec(slug) {
  const specPath = path.join(PROMOS_DIR, `${slug}.json`);
  if (!fs.existsSync(specPath)) {
    const available = fs.existsSync(PROMOS_DIR)
      ? fs
          .readdirSync(PROMOS_DIR)
          .filter((f) => f.endsWith('.json'))
          .map((f) => f.replace(/\.json$/, ''))
          .join(', ')
      : '(none)';
    throw new Error(
      `No promo spec at ${specPath}. Available promos: ${available}`,
    );
  }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  if (!Array.isArray(spec.slides) || spec.slides.length === 0) {
    throw new Error(`Promo ${slug}: spec has no slides.`);
  }
  spec.slug = slug;
  return spec;
}

/**
 * Materialize the narration source narrate.mjs consumes. One beat per slide —
 * silent slides carry empty text (narrate skips them) so clip file numbering
 * (1-based beat index) stays aligned with slide indices.
 */
function writeNarrationScript(spec, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const scriptPath = path.join(dir, 'narration-script.json');
  const next = {
    scene: spec.slug,
    beats: spec.slides.map((slide, i) => ({ tMs: i, vo: slide.vo ?? '' })),
  };
  const serialized = JSON.stringify(next, null, 2);
  // Only touch the file when the lines changed — narrate.mjs's skip logic is
  // mtime-based, so a no-op rewrite would force a full re-synthesis.
  if (
    !fs.existsSync(scriptPath) ||
    fs.readFileSync(scriptPath, 'utf8') !== serialized
  ) {
    fs.writeFileSync(scriptPath, serialized);
  }
}

/**
 * Narrate the promo's voiced slides. A spec may pin the engine/voice/model
 * — those flags override narrate.mjs's env defaults; unset ones fall through
 * to PH_TTS_ENGINE / PH_ELEVENLABS_VOICE_ID.
 */
function narrate(slug, spec, force) {
  const args = [path.join(__dirname, 'narrate.mjs'), '--scene', slug];
  if (spec.engine) args.push('--engine', spec.engine);
  if (spec.voice) args.push('--voice', spec.voice);
  if (spec.model) args.push('--model', spec.model);
  // Per-spec delivery controls (deliberate/premium tuning). Unset ones fall
  // through to narrate.mjs's engine-aware defaults. A change to any of these is
  // part of the settings fingerprint, so it busts the wav-reuse skip.
  if (spec.speed != null) args.push('--speed', String(spec.speed));
  if (spec.stability != null) args.push('--stability', String(spec.stability));
  if (spec.similarity != null) args.push('--similarity', String(spec.similarity));
  if (spec.style != null) args.push('--style', String(spec.style));
  if (force) args.push('--force');
  execFileSync(process.execPath, args, { stdio: 'inherit' });
}

/** Per-slide clip durations + wav paths from durations.json (1-based index). */
function narrationProps(spec, dir) {
  const durationsPath = path.join(dir, 'durations.json');
  const clipDurationsMs = new Array(spec.slides.length).fill(null);
  const narrationFiles = {};
  if (!fs.existsSync(durationsPath)) return { clipDurationsMs, narrationFiles };
  const durations = JSON.parse(fs.readFileSync(durationsPath, 'utf8'));
  for (const clip of durations.clips ?? []) {
    const slideIndex = (clip.index ?? 0) - 1;
    if (slideIndex < 0 || slideIndex >= spec.slides.length) continue;
    if (typeof clip.durationMs === 'number') {
      clipDurationsMs[slideIndex] = clip.durationMs;
    }
    if (clip.file) narrationFiles[slideIndex] = clip.file;
  }
  return { clipDurationsMs, narrationFiles };
}

function render(spec, dir) {
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${spec.slug}.mp4`);

  // Mirror public/ 3D assets into this scene's public dir before render.
  stagePublicAssets(dir);

  const props = {
    spec,
    ...narrationProps(spec, dir),
    ...resolveMusic(spec, dir),
    ...stagePromoSfx(dir),
  };
  const propsPath = path.join(dir, 'promo-props.json');
  fs.writeFileSync(propsPath, JSON.stringify(props, null, 2));

  const voiced = Object.keys(props.narrationFiles).length;
  console.log(
    `[promo] ${spec.slug}: ${spec.slides.length} slide(s), ${voiced} narrated, ` +
      `music ${props.musicFile ? 'on' : 'off'}, ` +
      `${spec.format === 'landscape' ? '1920x1080' : '1080x1920'} -> ${outFile}`,
  );

  execFileSync(
    'npx',
    [
      'remotion',
      'render',
      'src/Root.tsx',
      'PromoReel',
      outFile,
      `--props=${propsPath}`,
      `--public-dir=${dir}`,
    ],
    { cwd: APP_ROOT, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  console.log(`[promo] Done: ${outFile}`);
}

function renderPromo(slug, force) {
  const spec = loadSpec(slug);
  const dir = sceneDir(slug);
  writeNarrationScript(spec, dir);
  if (spec.slides.some((s) => s.vo)) {
    narrate(slug, spec, force);
  }
  render(spec, dir);
}

/** Every `promos/*.json` slug (for --all campaign renders). */
function allSlugs() {
  if (!fs.existsSync(PROMOS_DIR)) return [];
  return fs
    .readdirSync(PROMOS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

function main() {
  const args = parseArgs();
  const force = Boolean(args['force-narration']);

  // Slug sources: --all (whole campaign), --promo <slug>, or positional slugs
  // (`render-promo one two three`). Multiple slugs render sequentially.
  let slugs;
  if (args.all) {
    slugs = allSlugs();
  } else if (typeof args.promo === 'string') {
    slugs = [args.promo];
  } else if (args._.length > 0) {
    slugs = args._;
  } else {
    throw new Error(
      'Usage: node render-promo.mjs (--promo <slug> | <slug...> | --all) [--force-narration]',
    );
  }

  if (slugs.length === 0) {
    console.log('[promo] No promos to render.');
    return;
  }

  const failures = [];
  for (const slug of slugs) {
    try {
      console.log(`\n[promo] ===== ${slug} =====`);
      renderPromo(slug, force);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[promo] ${slug} FAILED: ${message}`);
      failures.push(slug);
    }
  }

  if (slugs.length > 1) {
    console.log(
      `\n[promo] Campaign done: ${slugs.length - failures.length}/${slugs.length} rendered` +
        (failures.length ? ` — failed: ${failures.join(', ')}` : '.'),
    );
  }
  if (failures.length) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[promo] FAILED: ${message}`);
  process.exitCode = 1;
}
