/**
 * tts.mjs — pluggable speech synthesis engines + the alignment→words bridge.
 *
 * Extracted from narrate.mjs so the scene-narration path and the self-shot path
 * share ONE implementation. narrate.mjs writes per-beat wavs for showcase
 * scenes; selfshot-narrate.mjs lays lines onto a timeline. Both need the same
 * engines, the same term normalization and the same alignment projection, and a
 * second copy of the ElevenLabs request logic would drift the moment either
 * changed.
 *
 * An engine exposes:
 *   descriptor        — { engine, voice, model, settings } stamped into output
 *                       manifests so a config change busts the reuse check.
 *   init()            — one-time setup (model load / credential check).
 *   synthesize(text, ctx?) -> { wav, sampleRate, durationMs, alignment? }
 *
 * ESM, Node >=22.9 (global fetch). Errors caught as `unknown`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { KokoroTTS, TextSplitterStream } from 'kokoro-js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const KOKORO_DEFAULT_VOICE = 'af_heart';
export const DEFAULT_SPEED = 1;

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1/text-to-speech';
export const ELEVENLABS_DEFAULT_MODEL = 'eleven_multilingual_v2';
/** wav we always WRITE is 16-bit LE mono @44.1k. */
export const ELEVENLABS_PCM_RATE = 44100;
// Default transport format. `pcm_*` is Pro-tier only; `mp3_44100_128` works on
// every tier, so we default to MP3 and transcode to PCM locally via ffmpeg.
export const ELEVENLABS_DEFAULT_FORMAT = 'mp3_44100_128';
const ELEVENLABS_SPEED_MIN = 0.7;
const ELEVENLABS_SPEED_MAX = 1.2;
// Tone defaults tuned for an energetic marketing read: lower stability lets
// the clone vary its delivery; modest style keeps it artifact-free.
export const ELEVENLABS_DEFAULT_STABILITY = 0.4;
export const ELEVENLABS_DEFAULT_SIMILARITY = 0.75;
export const ELEVENLABS_DEFAULT_STYLE = 0.2;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolve the bundled ffmpeg-static binary (also used by caption.mjs). */
export function ffmpegBin() {
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
export function decodeToPcm(input, rate, { loudnorm = false } = {}) {
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
    `[tts] elevenlabs: --${name} ${value} out of range [0, 1] — clamping to ${clamped}.`,
  );
  return clamped;
}

/**
 * Wrap headerless 16-bit little-endian mono PCM in a standard 44-byte
 * RIFF/WAVE header so the output matches the .wav layout of every other clip.
 */
export function pcmToWav(pcm, sampleRate) {
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

/**
 * Whole-word, case-sensitive normalization (text-normalization.json) that ALSO
 * returns a char map from each spoken (normalized) character back to the
 * original character it derives from. Replaced spans map every spoken char to
 * the start of the original match. The map lets ElevenLabs' character
 * alignment (timed against the SPOKEN text) be projected back onto the
 * ORIGINAL words, so rendered captions show "Ptah", not "puh-TAH".
 */
export function buildMappingNormalizer() {
  // The dict stays next to the scripts it documents, one level up from lib/.
  const dictPath = path.join(__dirname, '..', 'text-normalization.json');
  /** @type {Record<string,string>} */
  const dict = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
  // `_`-prefixed keys are notes for whoever edits the dict, not terms to match.
  const terms = Object.keys(dict)
    .filter((k) => !k.startsWith('_'))
    .sort((a, b) => b.length - a.length);
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
export function wordsFromAlignment(originalText, mapToOrig, alignment) {
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

/** Kokoro engine — pure-Node ONNX, no network, no billing. */
export function createKokoroEngine(opts) {
  let tts = null;
  return {
    descriptor: {
      engine: 'kokoro',
      voice: opts.voice,
      model: KOKORO_MODEL_ID,
      settings: `speed:${opts.speed}`,
    },
    async init() {
      console.log(`[tts] loading Kokoro (${KOKORO_MODEL_ID}, q8/cpu)…`);
      tts = await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
        dtype: 'q8',
        device: 'cpu',
      });
    },
    async synthesize(text) {
      // kokoro-js's single-shot `generate()` caps at ~510 tokens and silently
      // TRUNCATES longer text — which cut multi-paragraph beats off
      // mid-sentence. Stream through TextSplitterStream instead: it splits the
      // text into sentence-sized pieces, synthesizes each, and we concatenate
      // the raw float samples into one continuous clip.
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

/** ElevenLabs engine — cloud TTS, PCM->WAV, one retry on 429/5xx. Billed. */
export function createElevenLabsEngine(opts) {
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
      `[tts] elevenlabs: --speed ${speed} out of range ` +
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
        // clip makes consecutive lines read as one narration instead of N cold
        // starts (pitch resets between clips are the tell).
        ...(ctx.previousText ? { previous_text: ctx.previousText } : {}),
        ...(ctx.nextText ? { next_text: ctx.nextText } : {}),
        voice_settings: { speed, stability, similarity_boost: similarity, style },
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
        `[tts] using ElevenLabs (model ${model}, voice ${opts.voice}, ` +
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
            `[tts] elevenlabs: HTTP ${res.status} — retrying once in 2s…` +
              (body ? ` (${body.slice(0, 200)})` : ''),
          );
          await sleep(2000);
          res = await post(text, ctx);
        }
      } catch (error) {
        // Network-level failure (not an HTTP status): retry once.
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[tts] elevenlabs: request failed (${message}) — retrying once in 2s…`,
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
export function createEngine(opts) {
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
