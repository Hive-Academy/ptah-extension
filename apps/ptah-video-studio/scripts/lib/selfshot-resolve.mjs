/**
 * selfshot-resolve.mjs — validate a self-shot beats manifest and resolve it.
 *
 * Plain `.mjs` (no TS import) so the render/draft scripts can use it directly.
 * MIRRORS the zod schema in `src/selfshot/manifest.ts` — keep the two in
 * lockstep (same discipline as `shots.ts` ↔ `render-all.mjs:validateShotsFile`).
 *
 * Exposes:
 *   - loadWords(dir)                → normalized word list from words.json
 *   - resolveAnchor(anchor, words)  → absolute ms (seconds passthrough OR word anchor)
 *   - validateManifest(raw)         → throws with a clear message on any mismatch
 *   - captionsFromWords(words)      → CaptionToken[] for <LowerThird>
 *   - resolveBeats(beats, words, opts) → { shots, overlays, layouts }
 *
 * ESM, Node >=22.9.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Per-type default visible durations (ms) when neither `until` nor
//    `durationMs` is given. Tuned to read on screen without lingering. ──────────
export const DEFAULT_DURATION_MS = {
  'lower-third': 3400,
  keyword: 1900,
  stat: 2800,
  broll: 4000,
  highlight: 2200,
  zoom: 2600,
};

const CORNERS = ['tl', 'tr', 'bl', 'br'];
const LAYOUTS = [
  'camera-full',
  'screen-full-with-bubble',
  'side-by-side',
  'screen-only',
];
const EASES = ['ramp', 'smooth', 'cut'];
const MODES = ['talking-head', 'screen-demo', 'hybrid'];

/** Normalize a token for matching: lowercase, strip surrounding punctuation. */
function normWord(w) {
  return String(w)
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** Load words.json (array OR { words: [...] }) → [{ text, startMs, endMs }]. */
export function loadWords(dir) {
  const p = path.join(dir, 'words.json');
  if (!fs.existsSync(p)) return [];
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw.words) ? raw.words : [];
  return arr.map((w) => ({
    text: String(w.text ?? ''),
    startMs: Number(w.startMs ?? 0),
    endMs: Number(w.endMs ?? w.startMs ?? 0),
  }));
}

/**
 * Resolve an anchor (seconds number OR { word, occurrence, offsetMs }) to
 * absolute ms. Throws when a word anchor can't be found so a typo fails loudly.
 */
export function resolveAnchor(anchor, words, where = 'anchor') {
  if (typeof anchor === 'number') return Math.round(anchor * 1000);
  if (anchor && typeof anchor === 'object' && typeof anchor.word === 'string') {
    const target = normWord(anchor.word);
    const occurrence = anchor.occurrence ?? 1;
    let seen = 0;
    for (const w of words) {
      if (normWord(w.text) === target) {
        seen++;
        if (seen === occurrence) {
          return Math.max(0, Math.round(w.startMs + (anchor.offsetMs ?? 0)));
        }
      }
    }
    throw new Error(
      `${where}: word anchor "${anchor.word}" occurrence ${occurrence} not found in words.json ` +
        `(${words.length} words; did transcription run?).`,
    );
  }
  throw new Error(`${where}: invalid anchor — must be seconds (number) or { word, occurrence? }.`);
}

// ── Structural validation (mirrors selfShotManifestSchema) ────────────────────
function fail(msg) {
  throw new Error(msg);
}
function isRect(r) {
  return (
    r != null &&
    typeof r === 'object' &&
    ['x', 'y', 'w', 'h'].every((k) => typeof r[k] === 'number')
  );
}
function checkAnchor(a, where) {
  if (typeof a === 'number') {
    if (a < 0) fail(`${where}: seconds must be non-negative.`);
    return;
  }
  if (a && typeof a === 'object' && typeof a.word === 'string' && a.word.length > 0) {
    if (a.occurrence !== undefined && (!Number.isInteger(a.occurrence) || a.occurrence < 1)) {
      fail(`${where}: occurrence must be a positive integer.`);
    }
    if (a.offsetMs !== undefined && typeof a.offsetMs !== 'number') {
      fail(`${where}: offsetMs must be a number.`);
    }
    return;
  }
  fail(`${where}: invalid anchor — must be seconds (number) or { word, occurrence? }.`);
}

export function validateManifest(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('manifest: top-level value must be an object.');
  }
  if (!MODES.includes(raw.mode)) {
    fail(`manifest.mode must be one of: ${MODES.join(', ')}.`);
  }
  if (raw.input == null || typeof raw.input !== 'object') {
    fail('manifest.input must be an object with cameraVideo/screenVideo/audio.');
  }
  for (const k of ['cameraVideo', 'screenVideo', 'audio']) {
    if (raw.input[k] !== undefined && typeof raw.input[k] !== 'string') {
      fail(`manifest.input.${k} must be a string filename.`);
    }
  }
  if (!Array.isArray(raw.beats)) fail('manifest.beats must be an array.');

  raw.beats.forEach((beat, i) => {
    const at = `manifest.beats[${i}]`;
    if (beat == null || typeof beat !== 'object') fail(`${at} must be an object.`);
    checkAnchor(beat.at, `${at}.at`);
    if (beat.until !== undefined) checkAnchor(beat.until, `${at}.until`);
    if (beat.durationMs !== undefined && (typeof beat.durationMs !== 'number' || beat.durationMs <= 0)) {
      fail(`${at}.durationMs must be a positive number.`);
    }
    switch (beat.type) {
      case 'layout-switch':
        if (!LAYOUTS.includes(beat.layout)) fail(`${at}.layout must be one of: ${LAYOUTS.join(', ')}.`);
        break;
      case 'lower-third':
        if (typeof beat.title !== 'string') fail(`${at}.title must be a string.`);
        if (beat.subtitle !== undefined && typeof beat.subtitle !== 'string') fail(`${at}.subtitle must be a string.`);
        break;
      case 'keyword':
        if (typeof beat.text !== 'string') fail(`${at}.text must be a string.`);
        if (beat.corner !== undefined && !CORNERS.includes(beat.corner)) fail(`${at}.corner must be one of: ${CORNERS.join(', ')}.`);
        break;
      case 'stat':
        if (typeof beat.value !== 'string') fail(`${at}.value must be a string.`);
        if (typeof beat.label !== 'string') fail(`${at}.label must be a string.`);
        if (beat.corner !== undefined && !CORNERS.includes(beat.corner)) fail(`${at}.corner must be one of: ${CORNERS.join(', ')}.`);
        break;
      case 'broll':
        if (typeof beat.src !== 'string') fail(`${at}.src must be a string (filename or scene slug).`);
        if (beat.layout !== undefined && !['full', 'pip'].includes(beat.layout)) fail(`${at}.layout must be "full" or "pip".`);
        if (beat.corner !== undefined && !CORNERS.includes(beat.corner)) fail(`${at}.corner must be one of: ${CORNERS.join(', ')}.`);
        break;
      case 'highlight':
        if (!isRect(beat.rect)) fail(`${at}.rect must be a { x, y, w, h } rect.`);
        break;
      case 'zoom':
        if (!isRect(beat.rect)) fail(`${at}.rect must be a { x, y, w, h } rect.`);
        if (beat.ring !== undefined && typeof beat.ring !== 'boolean') fail(`${at}.ring must be a boolean.`);
        if (beat.ease !== undefined && !EASES.includes(beat.ease)) fail(`${at}.ease must be one of: ${EASES.join(', ')}.`);
        if (beat.transMs !== undefined && (typeof beat.transMs !== 'number' || beat.transMs <= 0)) fail(`${at}.transMs must be a positive number.`);
        break;
      default:
        fail(`${at}.type must be one of: layout-switch, lower-third, keyword, stat, broll, highlight, zoom.`);
    }
  });
  return raw;
}

/** CaptionToken[] (footage clock) from whisper words. */
export function captionsFromWords(words) {
  return words.map((w) => ({
    text: w.text,
    startMs: Math.round(w.startMs),
    endMs: Math.round(w.endMs),
    timestampMs: Math.round((w.startMs + w.endMs) / 2),
    confidence: 1,
  }));
}

/** Resolve a beat's [atMs, durationMs] using anchors + per-type defaults. */
function resolveWindow(beat, words, i) {
  const atMs = resolveAnchor(beat.at, words, `beats[${i}].at`);
  let durationMs;
  if (typeof beat.durationMs === 'number') {
    durationMs = beat.durationMs;
  } else if (beat.until !== undefined) {
    const untilMs = resolveAnchor(beat.until, words, `beats[${i}].until`);
    durationMs = Math.max(200, untilMs - atMs);
  } else {
    durationMs = DEFAULT_DURATION_MS[beat.type] ?? 2500;
  }
  return { atMs, durationMs };
}

/**
 * Lower the authored beats to the resolved render tracks:
 *   - zoom/highlight → a `shots[]` virtual-camera track (with a full-frame
 *     establishing shot at 0 and a release shot after each punch/ring).
 *   - lower-third/keyword/stat/broll → `overlays[]` (absolute ms windows).
 *   - layout-switch → `layouts[]` (absolute ms).
 * `resolveBrollSrc(srcName)` maps a b-roll src to a staged, staticFile-relative
 * name (the caller stages the file and returns the name).
 */
export function resolveBeats(beats, words, opts = {}) {
  const { mode = 'screen-demo', resolveBrollSrc = (s) => s } = opts;
  const shots = [{ fromMs: 0 }]; // full-frame establishing shot
  const overlays = [];
  const layouts = [];

  beats.forEach((beat, i) => {
    const { atMs, durationMs } = resolveWindow(beat, words, i);
    switch (beat.type) {
      case 'zoom': {
        shots.push({
          fromMs: atMs,
          focus: beat.rect,
          ...(beat.ring ? { ring: beat.rect } : {}),
          ...(beat.transMs ? { transMs: beat.transMs } : {}),
          ...(beat.ease ? { ease: beat.ease } : {}),
        });
        shots.push({ fromMs: atMs + durationMs, transMs: 650, ease: 'smooth' });
        break;
      }
      case 'highlight': {
        // Ring only — no camera move (focus stays full-frame).
        shots.push({ fromMs: atMs, ring: beat.rect });
        shots.push({ fromMs: atMs + durationMs });
        break;
      }
      case 'lower-third':
        overlays.push({ type: 'lower-third', atMs, durationMs, title: beat.title, ...(beat.subtitle ? { subtitle: beat.subtitle } : {}) });
        break;
      case 'keyword':
        overlays.push({ type: 'keyword', atMs, durationMs, text: beat.text, ...(beat.corner ? { corner: beat.corner } : {}) });
        break;
      case 'stat':
        overlays.push({ type: 'stat', atMs, durationMs, value: beat.value, label: beat.label, ...(beat.corner ? { corner: beat.corner } : {}) });
        break;
      case 'broll':
        overlays.push({
          type: 'broll',
          atMs,
          durationMs,
          src: resolveBrollSrc(beat.src),
          layout: beat.layout ?? 'full',
          ...(beat.corner ? { corner: beat.corner } : {}),
        });
        break;
      case 'layout-switch':
        layouts.push({ atMs, layout: beat.layout });
        break;
      default:
        break;
    }
  });

  shots.sort((a, b) => a.fromMs - b.fromMs);
  layouts.sort((a, b) => a.atMs - b.atMs);
  overlays.sort((a, b) => a.atMs - b.atMs);

  // Seed the hybrid layout state at t=0 so there is always an active layout.
  if (mode === 'hybrid' && (layouts.length === 0 || layouts[0].atMs > 0)) {
    layouts.unshift({ atMs: 0, layout: 'camera-full' });
  }

  return { shots, overlays, layouts };
}
