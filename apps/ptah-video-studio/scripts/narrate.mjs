/**
 * narrate.mjs — per-beat narration TTS for showcase SCENES.
 *
 * For a scene, reads its narration source (repo scene script if present, else
 * `narration-script.json`, else `beats.json` caption text), normalizes technical
 * terms, and synthesizes one WAV per beat into `recordings/<scene>/wav/0001.wav …`.
 * Also writes `durations.json` with each clip's measured duration so the
 * Remotion composition and Phase-2 hold-override pass can use real lengths.
 *
 * The engines themselves live in `lib/tts.mjs` — shared with
 * selfshot-narrate.mjs, which lays lines onto a timeline instead of per beat.
 *
 * Engines (--engine, default kokoro; also PTAH_TTS_ENGINE):
 *   kokoro     — kokoro-js pure-Node ONNX (no Python), the default. First run
 *     downloads ONNX weights into the HF cache; later runs are offline.
 *   elevenlabs — ElevenLabs cloud TTS, so you can narrate with a clone of your
 *     own voice (create an Instant Voice Clone in the ElevenLabs dashboard,
 *     then pass its voice id via --voice / PTAH_ELEVENLABS_VOICE_ID). Requires
 *     ELEVENLABS_API_KEY. Runs are billed, so the skip logic below is
 *     deliberately conservative and re-runs are logged loudly.
 *
 * Usage:
 *   node apps/ptah-video-studio/scripts/narrate.mjs --scene editor-tour
 *     [--engine kokoro|elevenlabs] [--voice <id>] [--speed 1]
 *     [--model <id>] [--source script|beats] [--force]
 *     [--stability 0.4] [--similarity 0.75] [--style 0.2]   (elevenlabs tone)
 *
 * ESM, Node >=22.9 (global fetch). Errors caught as `unknown`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseArgs,
  sceneDir,
  listScenesWithBeats,
  loadStudioEnv,
} from './paths.mjs';
import {
  createEngine,
  buildMappingNormalizer,
  wordsFromAlignment,
  KOKORO_DEFAULT_VOICE,
  DEFAULT_SPEED,
  ELEVENLABS_DEFAULT_MODEL,
  ELEVENLABS_DEFAULT_FORMAT,
  ELEVENLABS_DEFAULT_STABILITY,
  ELEVENLABS_DEFAULT_SIMILARITY,
  ELEVENLABS_DEFAULT_STYLE,
} from './lib/tts.mjs';

// Studio-local .env (API keys / voice ids) — shell environment takes precedence.
loadStudioEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Repo-tracked scene scripts (`{ scene, lines: string[] }`), the audio-first
 * narration source of truth. Living in the e2e app's source tree (not the
 * gitignored recordings dir) so scripts version with the scenes that speak
 * them, and `narrate` can run BEFORE any capture exists.
 */
const SCENE_SCRIPTS_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'ptah-electron-e2e',
  'src',
  'showcase',
  'scripts',
);

function sceneScriptPath(scene) {
  return path.join(SCENE_SCRIPTS_DIR, `${scene}.json`);
}

/**
 * Resolve the ordered list of narration entries for a scene, in priority order:
 *   1. Repo scene script `showcase/scripts/<scene>.json` — the audio-first
 *      source of truth, available BEFORE any capture exists.
 *   2. `narration-script.json` in the recordings dir (legacy polished VO).
 *   3. `beats.json` caption text (legacy capture-first flow / --source beats).
 * @returns {{ beatIndex: number, beatTMs: number, text: string }[]}
 */
function resolveEntries(scene, dir, source) {
  const repoScript = sceneScriptPath(scene);
  if (source !== 'beats' && fs.existsSync(repoScript)) {
    const script = JSON.parse(fs.readFileSync(repoScript, 'utf8'));
    return (script.lines ?? []).map((line, i) => ({
      beatIndex: i,
      beatTMs: 0,
      text: String(line).trim(),
    }));
  }

  const scriptPath = path.join(dir, 'narration-script.json');
  const beatsPath = path.join(dir, 'beats.json');

  const useScript = source !== 'beats' && fs.existsSync(scriptPath);

  if (useScript) {
    const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
    return (script.beats ?? []).map((b, i) => ({
      beatIndex: i,
      beatTMs: b.tMs ?? 0,
      text: (b.vo ?? b.text ?? '').trim(),
    }));
  }

  if (!fs.existsSync(beatsPath)) {
    throw new Error(
      `No narration source for ${scene}: no ${repoScript}, ` +
        `no narration-script.json and no beats.json in ${dir}.`,
    );
  }
  const manifest = JSON.parse(fs.readFileSync(beatsPath, 'utf8'));
  return (manifest.beats ?? []).map((b, i) => ({
    beatIndex: i,
    beatTMs: b.tMs ?? 0,
    text: (b.text ?? '').trim(),
  }));
}

/**
 * Decide whether the existing wavs can be reused. In addition to the original
 * mtime gate (durations.json newer than the narration source), the requested
 * engine/voice/model must match what durations.json was generated with —
 * otherwise switching engines would silently reuse the old audio.
 * @returns {{ skip: boolean, reason: string }}
 */
function evaluateSkip(scene, dir, durationsPath, descriptor, source) {
  if (!fs.existsSync(durationsPath)) {
    return { skip: false, reason: 'no durations.json yet' };
  }

  let prev;
  try {
    prev = JSON.parse(fs.readFileSync(durationsPath, 'utf8'));
  } catch {
    return { skip: false, reason: 'durations.json unreadable' };
  }

  if ((prev.engine ?? 'kokoro') !== descriptor.engine) {
    return {
      skip: false,
      reason: `engine changed (${prev.engine ?? 'kokoro'} -> ${descriptor.engine})`,
    };
  }
  if ((prev.voice ?? '') !== descriptor.voice) {
    return {
      skip: false,
      reason: `voice changed (${prev.voice ?? '—'} -> ${descriptor.voice})`,
    };
  }
  // model was not recorded before this change; only compare when present.
  if (prev.model !== undefined && prev.model !== descriptor.model) {
    return {
      skip: false,
      reason: `model changed (${prev.model} -> ${descriptor.model})`,
    };
  }
  // settings (speed/tone fingerprint) likewise lenient for legacy files.
  if (prev.settings !== undefined && prev.settings !== descriptor.settings) {
    return {
      skip: false,
      reason: `voice settings changed (${prev.settings} -> ${descriptor.settings})`,
    };
  }

  const beatsPath = path.join(dir, 'beats.json');
  const scriptPath = path.join(dir, 'narration-script.json');
  const repoScript = sceneScriptPath(scene);
  const srcPath =
    source !== 'beats' && fs.existsSync(repoScript)
      ? repoScript
      : fs.existsSync(scriptPath) && source !== 'beats'
        ? scriptPath
        : beatsPath;
  if (!fs.existsSync(srcPath)) {
    return { skip: false, reason: 'narration source missing' };
  }
  if (fs.statSync(durationsPath).mtimeMs < fs.statSync(srcPath).mtimeMs) {
    return { skip: false, reason: 'narration source is newer' };
  }

  return { skip: true, reason: 'up to date' };
}

async function narrateScene(scene, opts) {
  const dir = sceneDir(scene);
  // Audio-first: narration runs BEFORE the first capture, so create the scene
  // dir rather than requiring a recording to exist.
  fs.mkdirSync(dir, { recursive: true });

  const entries = resolveEntries(scene, dir, opts.source).filter((e) => e.text);
  if (entries.length === 0) {
    console.log(`[narrate] ${scene}: no narration text — skipping.`);
    return;
  }

  const wavDir = path.join(dir, 'wav');
  fs.mkdirSync(wavDir, { recursive: true });

  const durationsPath = path.join(dir, 'durations.json');
  const engine = createEngine(opts);

  // Content- + config-keyed skip: reuse wavs only when the narration source is
  // unchanged AND the engine/voice/model match what durations.json recorded.
  if (!opts.force) {
    const { skip } = evaluateSkip(scene, dir, durationsPath, engine.descriptor, opts.source);
    if (skip) {
      console.log(
        `[narrate] ${scene}: up to date (engine ${engine.descriptor.engine}, ` +
          `voice ${engine.descriptor.voice}) — skipping (use --force to regen).`,
      );
      return;
    }
  }

  await engine.init();

  const normalizeMapped = buildMappingNormalizer();
  // Pre-normalize every line once so each request can carry its neighbors as
  // prosody context (previous_text / next_text).
  const prepared = entries.map((entry) => ({
    ...entry,
    ...normalizeMapped(entry.text),
  }));

  const clips = [];
  let totalChars = 0;

  for (let i = 0; i < prepared.length; i++) {
    const entry = prepared[i];
    const index = entry.beatIndex + 1; // 1-based, zero-padded file names
    const padded = String(index).padStart(4, '0');
    const file = path.join('wav', `${padded}.wav`);
    const absFile = path.join(dir, file);
    const spoken = entry.spoken;
    totalChars += spoken.length;

    console.log(
      `[narrate] ${scene}: beat ${padded} -> ${file} (${spoken.length} chars)`,
    );
    const { wav, sampleRate, durationMs, alignment } = await engine.synthesize(
      spoken,
      {
        previousText: prepared[i - 1]?.spoken,
        nextText: prepared[i + 1]?.spoken,
      },
    );
    fs.writeFileSync(absFile, wav);

    // Clip-relative word timings for rendered captions, projected back onto
    // the ORIGINAL text so replacements ("puh-TAH") never leak on screen.
    // Engines without alignment (kokoro) leave words empty — caption.mjs's
    // whisper pass remains the fallback for those.
    const words = alignment
      ? wordsFromAlignment(entry.text, entry.mapToOrig, alignment)
      : [];

    clips.push({
      index,
      beatTMs: entry.beatTMs,
      file: file.replace(/\\/g, '/'),
      sampleRate,
      durationMs,
      chars: spoken.length,
      text: spoken,
      ...(words.length > 0 ? { words } : {}),
    });
  }

  const durations = {
    scene,
    engine: engine.descriptor.engine,
    voice: engine.descriptor.voice,
    model: engine.descriptor.model,
    settings: engine.descriptor.settings,
    speed: opts.speed,
    totalChars,
    generatedAt: new Date().toISOString(),
    clips,
  };
  fs.writeFileSync(durationsPath, JSON.stringify(durations, null, 2));
  console.log(
    `[narrate] ${scene}: wrote ${clips.length} clip(s) + durations.json ` +
      `(${totalChars} chars total via ${engine.descriptor.engine}).`,
  );
}

async function main() {
  const args = parseArgs();
  const engine =
    typeof args.engine === 'string'
      ? args.engine
      : process.env.PTAH_TTS_ENGINE || 'kokoro';

  // --voice / model defaults are engine-specific.
  const voice =
    typeof args.voice === 'string'
      ? args.voice
      : engine === 'elevenlabs'
        ? process.env.PTAH_ELEVENLABS_VOICE_ID || ''
        : KOKORO_DEFAULT_VOICE;
  const model =
    typeof args.model === 'string'
      ? args.model
      : engine === 'elevenlabs'
        ? process.env.PTAH_ELEVENLABS_MODEL || ELEVENLABS_DEFAULT_MODEL
        : undefined;

  const outputFormat =
    typeof args['output-format'] === 'string'
      ? args['output-format']
      : process.env.PTAH_ELEVENLABS_OUTPUT_FORMAT || ELEVENLABS_DEFAULT_FORMAT;

  const opts = {
    engine,
    voice,
    model,
    outputFormat,
    speed: args.speed ? Number(args.speed) : DEFAULT_SPEED,
    stability: args.stability
      ? Number(args.stability)
      : ELEVENLABS_DEFAULT_STABILITY,
    similarity: args.similarity
      ? Number(args.similarity)
      : ELEVENLABS_DEFAULT_SIMILARITY,
    style: args.style ? Number(args.style) : ELEVENLABS_DEFAULT_STYLE,
    source: typeof args.source === 'string' ? args.source : 'script',
    force: Boolean(args.force),
  };

  // Audio-first: scenes with a repo script narrate before any capture exists;
  // legacy scenes (beats.json only) stay narratable too.
  const scripted = fs.existsSync(SCENE_SCRIPTS_DIR)
    ? fs
        .readdirSync(SCENE_SCRIPTS_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))
    : [];
  const scenes =
    typeof args.scene === 'string'
      ? [args.scene]
      : [...new Set([...scripted, ...listScenesWithBeats()])];
  if (scenes.length === 0) {
    console.log(
      '[narrate] No scene scripts or beats.json found. Nothing to do.',
    );
    return;
  }

  for (const scene of scenes) {
    await narrateScene(scene, opts);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[narrate] FAILED: ${message}`);
  process.exitCode = 1;
});
