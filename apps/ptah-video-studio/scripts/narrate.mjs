/**
 * narrate.mjs — per-beat narration TTS with a pluggable engine.
 *
 * For a scene, reads its narration source (polished `narration-script.json` if
 * present, else `beats.json` caption text), normalizes technical terms, and
 * synthesizes one WAV per beat into `recordings/<scene>/wav/0001.wav …`.
 * Also writes `durations.json` with each clip's measured duration so the
 * Remotion composition and Phase-2 hold-override pass can use real lengths.
 *
 * Engines (--engine, default kokoro; also PTAH_TTS_ENGINE):
 *   kokoro     — kokoro-js pure-Node ONNX (no Python), the default. Uses
 *     KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',
 *       { dtype: 'q8', device: 'cpu' }). First run downloads ONNX weights
 *     into the HF cache; later runs are offline.
 *   elevenlabs — ElevenLabs cloud TTS, so you can narrate with a clone of
 *     your own voice (create an Instant Voice Clone in the ElevenLabs
 *     dashboard, then pass its voice id via --voice / PTAH_ELEVENLABS_VOICE_ID).
 *     Requires ELEVENLABS_API_KEY. Requests raw PCM (pcm_44100) and wraps it
 *     in a 44-byte RIFF/WAVE header locally. Runs are billed, so the skip
 *     logic below is deliberately conservative and re-runs are logged loudly.
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
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { KokoroTTS, TextSplitterStream } from 'kokoro-js';
import {
  parseArgs,
  sceneDir,
  listScenesWithBeats,
  loadStudioEnv,
} from './paths.mjs';

const require = createRequire(import.meta.url);

// Studio-local .env (API keys / voice ids) — shell environment takes precedence.
loadStudioEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const KOKORO_DEFAULT_VOICE = 'af_heart';
const DEFAULT_SPEED = 1;

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1/text-to-speech';
const ELEVENLABS_DEFAULT_MODEL = 'eleven_multilingual_v2';
const ELEVENLABS_PCM_RATE = 44100; // wav we always WRITE is 16-bit LE mono @44.1k
// Default transport format. `pcm_*` is Pro-tier only; `mp3_44100_128` works on
// every tier, so we default to MP3 and transcode to PCM locally via ffmpeg.
// Override with --output-format / PTAH_ELEVENLABS_OUTPUT_FORMAT (e.g. pcm_44100
// on a Pro plan to skip the transcode).
const ELEVENLABS_DEFAULT_FORMAT = 'mp3_44100_128';
const ELEVENLABS_SPEED_MIN = 0.7;
const ELEVENLABS_SPEED_MAX = 1.2;
// Tone defaults tuned for an energetic marketing read: lower stability lets
// the clone vary its delivery; modest style keeps it artifact-free.
const ELEVENLABS_DEFAULT_STABILITY = 0.4;
const ELEVENLABS_DEFAULT_SIMILARITY = 0.75;
const ELEVENLABS_DEFAULT_STYLE = 0.2;

/** Resolve the bundled ffmpeg-static binary (also used by caption.mjs). */
function ffmpegBin() {
  const bin = require('ffmpeg-static');
  if (!bin || !fs.existsSync(bin)) {
    throw new Error('ffmpeg-static binary not found (npm install to fetch it).');
  }
  return bin;
}

/**
 * Decode a compressed audio buffer (e.g. ElevenLabs MP3) to raw 16-bit LE mono
 * PCM at `rate` Hz via ffmpeg, so it can flow through the same pcmToWav() path
 * as native PCM. Returns the PCM Buffer.
 */
function decodeToPcm(input, rate, { loudnorm = false } = {}) {
  const args = ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0'];
  if (loudnorm) {
    // EBU R128 one-pass loudness normalization so every clip lands at the same
    // perceived level (-16 LUFS, the podcast/VO standard) regardless of how hot
    // the TTS render came back. Gain-only in effect for speech clips — no
    // time-stretch, so alignment timestamps stay valid.
    args.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11');
  }
  args.push('-ar', String(rate), '-ac', '1', '-f', 's16le', 'pipe:1');
  return execFileSync(ffmpegBin(), args, { input, maxBuffer: 1 << 28 });
}

/** Clamp a 0..1 voice_settings knob, warning when the input was out of range. */
function clamp01(name, value) {
  if (value >= 0 && value <= 1) return value;
  const clamped = Math.min(1, Math.max(0, value));
  console.warn(
    `[narrate] elevenlabs: --${name} ${value} out of range [0, 1] — clamping to ${clamped}.`,
  );
  return clamped;
}

/**
 * Whole-word, case-sensitive normalization (text-normalization.json) that ALSO
 * returns a char map from each spoken (normalized) character back to the
 * original character it derives from. Replaced spans map every spoken char to
 * the start of the original match. The map lets ElevenLabs' character
 * alignment (timed against the SPOKEN text) be projected back onto the
 * ORIGINAL words, so rendered captions show "Ptah", not "puh-TAH".
 */
function buildMappingNormalizer() {
  const dictPath = path.join(__dirname, 'text-normalization.json');
  /** @type {Record<string,string>} */
  const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
  const terms = Object.keys(dict).sort((a, b) => b.length - a.length);
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(?<![\\w-])(?:${escaped.join('|')})(?![\\w-])`, 'g');

  return (text) => {
    let spoken = '';
    /** @type {number[]} spoken char index -> original char index */
    const mapToOrig = [];
    let cursor = 0;
    for (const m of text.matchAll(re)) {
      for (let i = cursor; i < m.index; i++) {
        mapToOrig.push(i);
        spoken += text[i];
      }
      const replacement = dict[m[0]] ?? m[0];
      for (let i = 0; i < replacement.length; i++) {
        mapToOrig.push(m.index);
        spoken += replacement[i];
      }
      cursor = m.index + m[0].length;
    }
    for (let i = cursor; i < text.length; i++) {
      mapToOrig.push(i);
      spoken += text[i];
    }
    return { spoken, mapToOrig };
  };
}

/**
 * Project ElevenLabs character alignment (timed against the SPOKEN text) onto
 * the ORIGINAL text's words via the normalization char map. Returns
 * clip-relative word tokens `{ text, startMs, endMs }`, one per whitespace-
 * separated original word. Words whose chars were all consumed by a
 * replacement inherit the replacement span's timing.
 */
function wordsFromAlignment(originalText, mapToOrig, alignment) {
  const chars = alignment?.characters ?? [];
  const starts = alignment?.character_start_times_seconds ?? [];
  const ends = alignment?.character_end_times_seconds ?? [];
  if (chars.length === 0) return [];

  // Original char index -> [minStartSec, maxEndSec] over spoken chars mapping to it.
  const spanForOrig = new Map();
  const n = Math.min(chars.length, mapToOrig.length);
  for (let s = 0; s < n; s++) {
    const o = mapToOrig[s];
    const cur = spanForOrig.get(o);
    if (cur) {
      cur[0] = Math.min(cur[0], starts[s]);
      cur[1] = Math.max(cur[1], ends[s]);
    } else {
      spanForOrig.set(o, [starts[s], ends[s]]);
    }
  }

  const words = [];
  for (const m of originalText.matchAll(/\S+/g)) {
    // Standalone punctuation ("—") is not a caption word: extend the previous
    // word over its time span instead of emitting a floating token.
    const prev = words[words.length - 1];
    const isPunctuation = !/[\p{L}\p{N}]/u.test(m[0]);

    let lo = Infinity;
    let hi = -Infinity;
    for (let o = m.index; o < m.index + m[0].length; o++) {
      const span = spanForOrig.get(o);
      if (span) {
        lo = Math.min(lo, span[0]);
        hi = Math.max(hi, span[1]);
      }
    }
    if (lo === Infinity) {
      // Whole word swallowed by a replacement keyed to an earlier char (rare);
      // reuse the previous word's end as a zero-width anchor.
      lo = prev ? prev.endMs / 1000 : 0;
      hi = lo;
    }

    if (isPunctuation && prev) {
      prev.endMs = Math.max(prev.endMs, Math.round(hi * 1000));
      continue;
    }
    words.push({
      text: m[0],
      startMs: Math.round(lo * 1000),
      endMs: Math.round(hi * 1000),
    });
  }
  return words;
}

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
 * Wrap headerless 16-bit little-endian mono PCM in a standard 44-byte
 * RIFF/WAVE header so the output matches the .wav layout of every other clip.
 * @param {Buffer} pcm raw samples
 * @param {number} sampleRate samples per second
 * @returns {Buffer}
 */
function pcmToWav(pcm, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4); // ChunkSize
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
  header.writeUInt16LE(1, 20); // AudioFormat = PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40); // Subchunk2Size
  return Buffer.concat([header, pcm]);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A synthesis engine exposes:
 *   descriptor  — { engine, voice, model } stamped into durations.json.
 *   init()      — one-time setup (model load / credential check).
 *   synthesize(text) -> { wav: Buffer, sampleRate, durationMs }
 */

/** Kokoro engine — pure-Node ONNX, unchanged behavior from prior versions. */
function createKokoroEngine(opts) {
  let tts = null;
  return {
    descriptor: {
      engine: 'kokoro',
      voice: opts.voice,
      model: KOKORO_MODEL_ID,
      settings: `speed:${opts.speed}`,
    },
    async init() {
      console.log(
        `[narrate] loading Kokoro (${KOKORO_MODEL_ID}, q8/cpu)…`,
      );
      tts = await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
        dtype: 'q8',
        device: 'cpu',
      });
    },
    async synthesize(text) {
      // kokoro-js's single-shot `generate()` caps at ~510 tokens and silently
      // TRUNCATES longer text — which cut the multi-paragraph beats off
      // mid-sentence. Stream through TextSplitterStream instead: it splits the
      // text into sentence-sized pieces, synthesizes each, and we concatenate
      // the raw float samples into one continuous clip (converted to 16-bit PCM
      // so it matches every other wav's layout via pcmToWav).
      const splitter = new TextSplitterStream();
      const stream = tts.stream(splitter, { voice: opts.voice, speed: opts.speed });
      splitter.push(text);
      splitter.close();

      const parts = [];
      let sampleRate = 24000;
      let total = 0;
      for await (const { audio } of stream) {
        sampleRate = audio.sampling_rate;
        parts.push(audio.audio); // Float32Array in [-1, 1]
        total += audio.audio.length;
      }

      const pcm = Buffer.alloc(total * 2);
      let off = 0;
      for (const part of parts) {
        for (let i = 0; i < part.length; i++) {
          const s = Math.max(-1, Math.min(1, part[i]));
          pcm.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), off);
          off += 2;
        }
      }

      const wav = pcmToWav(pcm, sampleRate);
      const durationMs = Math.round((total / sampleRate) * 1000);
      return { wav, sampleRate, durationMs };
    },
  };
}

/** ElevenLabs engine — cloud TTS, PCM->WAV, one retry on 429/5xx. */
function createElevenLabsEngine(opts) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const model = opts.model || ELEVENLABS_DEFAULT_MODEL;

  // Clamp --speed into ElevenLabs' supported range and warn if it was out.
  let speed = opts.speed;
  if (speed < ELEVENLABS_SPEED_MIN || speed > ELEVENLABS_SPEED_MAX) {
    const clamped = Math.min(
      ELEVENLABS_SPEED_MAX,
      Math.max(ELEVENLABS_SPEED_MIN, speed),
    );
    console.warn(
      `[narrate] elevenlabs: --speed ${speed} out of range ` +
        `[${ELEVENLABS_SPEED_MIN}, ${ELEVENLABS_SPEED_MAX}] — clamping to ${clamped}.`,
    );
    speed = clamped;
  }

  // Tone knobs (0..1). stability: lower = more expressive delivery variation;
  // similarity_boost: adherence to the cloned timbre; style: exaggeration of
  // the reference clip's speaking style (high values can add artifacts).
  const stability = clamp01('stability', opts.stability);
  const similarity = clamp01('similarity', opts.similarity);
  const style = clamp01('style', opts.style);

  const format = opts.outputFormat || ELEVENLABS_DEFAULT_FORMAT;
  const isMp3 = format.startsWith('mp3');
  // `/with-timestamps` returns JSON: base64 audio + character-level alignment.
  // The alignment drives word-accurate rendered captions directly (no whisper
  // transcription pass) — see wordsFromAlignment().
  const url =
    `${ELEVENLABS_API}/${encodeURIComponent(opts.voice)}` +
    `/with-timestamps?output_format=${encodeURIComponent(format)}`;

  async function post(text, ctx = {}) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: model,
        // Prosody continuity: telling the model what was said before/after this
        // clip makes consecutive beats read as one narration instead of nine
        // cold starts (pitch resets between clips are the tell).
        ...(ctx.previousText ? { previous_text: ctx.previousText } : {}),
        ...(ctx.nextText ? { next_text: ctx.nextText } : {}),
        voice_settings: {
          speed,
          stability,
          similarity_boost: similarity,
          style,
        },
      }),
    });
  }

  return {
    descriptor: {
      engine: 'elevenlabs',
      voice: opts.voice,
      model,
      // Settings fingerprint — a tone/format change must bust the wav-reuse skip.
      settings: `speed:${speed}|stability:${stability}|similarity:${similarity}|style:${style}|fmt:${format}`,
    },
    async init() {
      if (!apiKey) {
        throw new Error(
          'ELEVENLABS_API_KEY is not set. Export your ElevenLabs API key to ' +
            'use --engine elevenlabs (see the README "Voice cloning" section).',
        );
      }
      if (!opts.voice) {
        throw new Error(
          'No ElevenLabs voice id. Pass --voice <voice_id> or set ' +
            'PTAH_ELEVENLABS_VOICE_ID (copy it from the ElevenLabs dashboard).',
        );
      }
      console.log(
        `[narrate] using ElevenLabs (model ${model}, voice ${opts.voice}, ` +
          `speed ${speed}, stability ${stability}, similarity ${similarity}, ` +
          `style ${style}).`,
      );
    },
    async synthesize(text, ctx = {}) {
      let res;
      try {
        res = await post(text, ctx);
        if ((res.status === 429 || res.status >= 500) && !res.ok) {
          const body = await res.text();
          console.warn(
            `[narrate] elevenlabs: HTTP ${res.status} — retrying once in 2s…` +
              (body ? ` (${body.slice(0, 200)})` : ''),
          );
          await sleep(2000);
          res = await post(text, ctx);
        }
      } catch (error) {
        // Network-level failure (not an HTTP status): retry once.
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[narrate] elevenlabs: request failed (${message}) — retrying once in 2s…`,
        );
        await sleep(2000);
        res = await post(text, ctx);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
          `ElevenLabs TTS failed: HTTP ${res.status} ${res.statusText}` +
            (body ? ` — ${body.slice(0, 500)}` : ''),
        );
      }

      const payload = await res.json();
      const raw = Buffer.from(payload.audio_base64, 'base64');
      // MP3 (all tiers) → decode + loudness-normalize to PCM in one ffmpeg
      // pass; PCM (Pro tier) → normalize likewise (input is headerless s16le,
      // so wrap it before piping).
      const pcm = isMp3
        ? decodeToPcm(raw, ELEVENLABS_PCM_RATE, { loudnorm: true })
        : decodeToPcm(pcmToWav(raw, ELEVENLABS_PCM_RATE), ELEVENLABS_PCM_RATE, {
            loudnorm: true,
          });
      const wav = pcmToWav(pcm, ELEVENLABS_PCM_RATE);
      const samples = pcm.length / 2; // 16-bit LE
      const durationMs = Math.round((samples / ELEVENLABS_PCM_RATE) * 1000);
      return {
        wav,
        sampleRate: ELEVENLABS_PCM_RATE,
        durationMs,
        alignment: payload.alignment ?? null,
      };
    },
  };
}

/** Instantiate the requested engine (no I/O beyond credential capture). */
function createEngine(opts) {
  switch (opts.engine) {
    case 'kokoro':
      return createKokoroEngine(opts);
    case 'elevenlabs':
      return createElevenLabsEngine(opts);
    default:
      throw new Error(
        `Unknown --engine "${opts.engine}" (expected kokoro or elevenlabs).`,
      );
  }
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
