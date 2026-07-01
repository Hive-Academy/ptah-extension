/**
 * narrate.mjs — Kokoro-82M TTS (pure-Node ONNX, no Python) per beat.
 *
 * For a scene, reads its narration source (polished `narration-script.json` if
 * present, else `beats.json` caption text), normalizes technical terms, and
 * synthesizes one WAV per beat into `recordings/<scene>/wav/0001.wav …`.
 * Also writes `durations.json` with each clip's measured duration so the
 * Remotion composition and Phase-2 hold-override pass can use real lengths.
 *
 * Engine: kokoro-js (already a workspace dependency) ->
 *   KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',
 *     { dtype: 'q8', device: 'cpu' })
 * First run downloads ONNX weights into the HF cache; later runs are offline.
 *
 * Usage:
 *   node apps/ptah-video-studio/scripts/narrate.mjs --scene editor-tour
 *     [--voice af_heart] [--speed 1] [--source script|beats] [--force]
 *
 * ESM, Node >=22.9. Errors caught as `unknown`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KokoroTTS } from 'kokoro-js';
import { parseArgs, sceneDir, listScenesWithBeats } from './paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DEFAULT_VOICE = 'af_heart';
const DEFAULT_SPEED = 1;

/** Load + compile the whole-word, case-sensitive normalization replacer. */
function buildNormalizer() {
  const dictPath = path.join(__dirname, 'text-normalization.json');
  /** @type {Record<string,string>} */
  const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
  // Longest keys first so multi-word terms ("VS Code") win over substrings.
  const terms = Object.keys(dict).sort((a, b) => b.length - a.length);
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(?<![\\w-])(?:${escaped.join('|')})(?![\\w-])`, 'g');
  return (text) => text.replace(re, (m) => dict[m] ?? m);
}

/**
 * Resolve the ordered list of narration entries for a scene.
 * Prefers narration-script.json (polished VO) unless --source beats.
 * @returns {{ beatIndex: number, beatTMs: number, text: string }[]}
 */
function resolveEntries(dir, source) {
  const scriptPath = path.join(dir, 'narration-script.json');
  const beatsPath = path.join(dir, 'beats.json');

  const useScript =
    source !== 'beats' && fs.existsSync(scriptPath);

  if (useScript) {
    const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
    return (script.beats ?? []).map((b, i) => ({
      beatIndex: i,
      beatTMs: b.tMs ?? 0,
      text: (b.vo ?? b.text ?? '').trim(),
    }));
  }

  if (!fs.existsSync(beatsPath)) {
    throw new Error(`No beats.json (and no narration-script.json) in ${dir}`);
  }
  const manifest = JSON.parse(fs.readFileSync(beatsPath, 'utf8'));
  return (manifest.beats ?? []).map((b, i) => ({
    beatIndex: i,
    beatTMs: b.tMs ?? 0,
    text: (b.text ?? '').trim(),
  }));
}

async function narrateScene(scene, opts) {
  const dir = sceneDir(scene);
  if (!fs.existsSync(dir)) {
    throw new Error(`Scene dir does not exist: ${dir}`);
  }

  const entries = resolveEntries(dir, opts.source).filter((e) => e.text);
  if (entries.length === 0) {
    console.log(`[narrate] ${scene}: no narration text — skipping.`);
    return;
  }

  const wavDir = path.join(dir, 'wav');
  fs.mkdirSync(wavDir, { recursive: true });

  const durationsPath = path.join(dir, 'durations.json');
  // Content-keyed skip: if durations.json is newer than the source manifest and
  // not forced, assume the wavs are current (NFR-2 deterministic re-render).
  if (!opts.force && fs.existsSync(durationsPath)) {
    const beatsPath = path.join(dir, 'beats.json');
    const scriptPath = path.join(dir, 'narration-script.json');
    const srcPath = fs.existsSync(scriptPath) && opts.source !== 'beats' ? scriptPath : beatsPath;
    if (
      fs.existsSync(srcPath) &&
      fs.statSync(durationsPath).mtimeMs >= fs.statSync(srcPath).mtimeMs
    ) {
      console.log(`[narrate] ${scene}: durations.json up to date — skipping (use --force to regen).`);
      return;
    }
  }

  console.log(`[narrate] ${scene}: loading Kokoro (${MODEL_ID}, q8/cpu)…`);
  const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: 'q8',
    device: 'cpu',
  });

  const normalize = buildNormalizer();
  const clips = [];

  for (const entry of entries) {
    const index = entry.beatIndex + 1; // 1-based, zero-padded file names
    const padded = String(index).padStart(4, '0');
    const file = path.join('wav', `${padded}.wav`);
    const absFile = path.join(dir, file);
    const spoken = normalize(entry.text);

    console.log(`[narrate] ${scene}: beat ${padded} -> ${file}`);
    const audio = await tts.generate(spoken, {
      voice: opts.voice,
      speed: opts.speed,
    });
    await audio.save(absFile);

    const durationMs = Math.round(
      (audio.audio.length / audio.sampling_rate) * 1000,
    );
    clips.push({
      index,
      beatTMs: entry.beatTMs,
      file: file.replace(/\\/g, '/'),
      sampleRate: audio.sampling_rate,
      durationMs,
      text: spoken,
    });
  }

  const durations = {
    scene,
    voice: opts.voice,
    speed: opts.speed,
    generatedAt: new Date().toISOString(),
    clips,
  };
  fs.writeFileSync(durationsPath, JSON.stringify(durations, null, 2));
  console.log(
    `[narrate] ${scene}: wrote ${clips.length} clip(s) + durations.json`,
  );
}

async function main() {
  const args = parseArgs();
  const opts = {
    voice: typeof args.voice === 'string' ? args.voice : DEFAULT_VOICE,
    speed: args.speed ? Number(args.speed) : DEFAULT_SPEED,
    source: typeof args.source === 'string' ? args.source : 'script',
    force: Boolean(args.force),
  };

  const scenes =
    typeof args.scene === 'string' ? [args.scene] : listScenesWithBeats();
  if (scenes.length === 0) {
    console.log('[narrate] No scenes with beats.json found. Nothing to do.');
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
