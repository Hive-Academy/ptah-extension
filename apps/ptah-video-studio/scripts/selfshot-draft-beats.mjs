/**
 * selfshot-draft-beats.mjs — generate a starter beats.json from words.json.
 *
 * A hand-off point: it writes a REASONABLE first draft the founder then edits.
 * Auto-content:
 *   - mode inferred from the detected inputs (camera+screen → hybrid,
 *     screen only → screen-demo, camera only → talking-head).
 *   - an intro lower-third at 0.5s.
 *   - keyword pop-up chips at the FIRST spoken occurrence of each configured
 *     keyword (default: "open source", "agents", "memory", "Builders").
 *   - an end card enabled (appended after the body by the renderer).
 * Word anchors are emitted (not raw seconds) so edits to pacing stay locked to
 * what he actually says.
 *
 * Usage:
 *   node scripts/selfshot-draft-beats.mjs --slug my-intro
 *   node scripts/selfshot-draft-beats.mjs --slug my-intro --keywords "open source,agents,memory,Builders" \
 *        --title "Ptah" --subtitle "open source" --mode talking-head [--force]
 *
 * ESM, Node >=22.9.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from './paths.mjs';
import { ingestDir, detectInputs } from './lib/selfshot-paths.mjs';
import { loadWords } from './lib/selfshot-resolve.mjs';

const DEFAULT_KEYWORDS = ['open source', 'agents', 'memory', 'Builders'];

function normWord(w) {
  return String(w).toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** Find the FIRST word index whose (normalized) text matches `phrase`'s first token. */
function firstOccurrence(words, phrase) {
  const first = normWord(phrase.split(/\s+/)[0]);
  const idx = words.findIndex((w) => normWord(w.text) === first);
  return idx;
}

function inferMode(inputs) {
  if (inputs.cameraVideo && inputs.screenVideo) return 'hybrid';
  if (inputs.screenVideo) return 'screen-demo';
  return 'talking-head';
}

function main() {
  const args = parseArgs();
  const slug = typeof args.slug === 'string' ? args.slug : null;
  if (!slug) throw new Error('Pass --slug <name>.');

  const dir = ingestDir(slug);
  const beatsPath = path.join(dir, 'beats.json');
  if (fs.existsSync(beatsPath) && !args.force) {
    throw new Error(`beats.json already exists at ${beatsPath}. Edit it, or pass --force to overwrite.`);
  }

  const words = loadWords(dir);
  if (words.length === 0) {
    throw new Error(`No words.json in ${dir}. Run selfshot-transcribe first.`);
  }

  const inputs = detectInputs(dir);
  const mode = typeof args.mode === 'string' ? args.mode : inferMode(inputs);
  const keywords =
    typeof args.keywords === 'string'
      ? args.keywords.split(',').map((k) => k.trim()).filter(Boolean)
      : DEFAULT_KEYWORDS;
  const title = typeof args.title === 'string' ? args.title : 'Ptah';
  const subtitle = typeof args.subtitle === 'string' ? args.subtitle : 'open source';

  const beats = [];

  // Intro lower-third at 0.5s.
  beats.push({ type: 'lower-third', at: 0.5, title, subtitle, durationMs: 3600 });

  // Keyword chips at the first occurrence of each configured keyword.
  const usedCorners = ['tr', 'br', 'tl', 'bl'];
  let placed = 0;
  for (const kw of keywords) {
    const idx = firstOccurrence(words, kw);
    if (idx < 0) {
      console.log(`[draft] keyword "${kw}" not spoken — skipped.`);
      continue;
    }
    beats.push({
      type: 'keyword',
      at: { word: words[idx].text, occurrence: 1 },
      text: kw,
      corner: usedCorners[placed % usedCorners.length],
      note: `auto: first occurrence of "${kw}"`,
    });
    placed++;
  }

  const manifest = {
    slug,
    mode,
    input: {
      ...(inputs.cameraVideo ? { cameraVideo: inputs.cameraVideo } : {}),
      ...(inputs.screenVideo ? { screenVideo: inputs.screenVideo } : {}),
      ...(inputs.audio ? { audio: inputs.audio } : {}),
    },
    ...(mode === 'screen-demo' || mode === 'hybrid'
      ? { bubble: { enabled: !!inputs.cameraVideo, corner: 'br', sizePct: 0.24 } }
      : {}),
    endCard: { enabled: true, durationMs: 6000 },
    beats,
  };

  // Seed a couple of hybrid layout switches so the state machine has content.
  if (mode === 'hybrid') {
    manifest.beats.push({ type: 'layout-switch', at: 0, layout: 'camera-full', note: 'auto: open on camera' });
    const third = words[Math.floor(words.length / 3)];
    if (third) manifest.beats.push({ type: 'layout-switch', at: { word: third.text, occurrence: 1 }, layout: 'screen-full-with-bubble', note: 'auto: cut to screen' });
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(beatsPath, JSON.stringify(manifest, null, 2));
  console.log(`[draft] ${slug}: wrote ${manifest.beats.length}-beat manifest (mode=${mode}) → ${beatsPath}`);
  console.log('[draft] Review/edit it, then: npm run selfshot:render -- --slug ' + slug);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[draft] FAILED: ${message}`);
  process.exitCode = 1;
}
