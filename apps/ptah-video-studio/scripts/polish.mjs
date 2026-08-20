/**
 * polish.mjs — OPTIONAL, dev-only caption -> voiceover prose rewrite.
 *
 * Uses the in-repo `@anthropic-ai/claude-agent-sdk` (no new dependency) to turn
 * terse on-screen captions from beats.json into natural spoken sentences, then
 * writes `narration-script.json` = { scene, beats: [{ tMs, text, vo }] }.
 *
 * Fully skippable:
 *   - Runs ONLY when PTAH_POLISH=1 is set (network + Anthropic auth required).
 *   - narrate.mjs falls back to beats.json caption text when this file is
 *     absent (NFR-1 offline path), so the rest of the pipeline never depends
 *     on it.
 *
 * Usage: PTAH_POLISH=1 node apps/ptah-video-studio/scripts/polish.mjs --scene editor-tour
 *
 * ESM, Node >=22.9. Errors caught as `unknown`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs, sceneDir, listScenesWithBeats } from './paths.mjs';

const MAX_WORDS = 18;

const SYSTEM_PROMPT = [
  'You rewrite terse on-screen product-demo captions into natural spoken',
  'voiceover sentences for a narrated marketing video.',
  'Rules: one sentence per caption; keep technical terms verbatim; warm,',
  `confident, concise; at most ${MAX_WORDS} words; no emojis; no preamble.`,
  'Reply with ONLY a JSON array of strings, one rewritten line per input',
  'caption, in the same order. No markdown fences.',
].join(' ');

function extractJsonArray(text) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model did not return a JSON array.');
  }
  return JSON.parse(text.slice(start, end + 1));
}

async function polishScene(scene) {
  const dir = sceneDir(scene);
  const beatsPath = path.join(dir, 'beats.json');
  if (!fs.existsSync(beatsPath)) {
    throw new Error(`No beats.json in ${dir}`);
  }
  const manifest = JSON.parse(fs.readFileSync(beatsPath, 'utf8'));
  const beats = manifest.beats ?? [];
  if (beats.length === 0) {
    console.log(`[polish] ${scene}: no beats — skipping.`);
    return;
  }

  // Dynamic import so the SDK is only loaded when polish actually runs.
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  const numbered = beats
    .map((b, i) => `${i + 1}. ${b.text}`)
    .join('\n');
  const prompt = `Rewrite these ${beats.length} captions as voiceover lines:\n${numbered}`;

  let answer = '';
  for await (const message of query({
    prompt,
    options: { systemPrompt: SYSTEM_PROMPT, maxTurns: 1 },
  })) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') answer += block.text;
      }
    } else if (message.type === 'result' && message.subtype === 'success') {
      if (!answer && typeof message.result === 'string') answer = message.result;
    }
  }

  const lines = extractJsonArray(answer);
  if (!Array.isArray(lines) || lines.length !== beats.length) {
    throw new Error(
      `Expected ${beats.length} VO lines, got ${Array.isArray(lines) ? lines.length : 'non-array'}.`,
    );
  }

  const out = {
    scene,
    generatedAt: new Date().toISOString(),
    beats: beats.map((b, i) => ({
      tMs: b.tMs,
      text: b.text,
      vo: String(lines[i]).trim(),
    })),
  };
  fs.writeFileSync(
    path.join(dir, 'narration-script.json'),
    JSON.stringify(out, null, 2),
  );
  console.log(`[polish] ${scene}: wrote narration-script.json (${out.beats.length} lines).`);
}

async function main() {
  if (process.env['PTAH_POLISH'] !== '1') {
    console.log(
      '[polish] PTAH_POLISH != 1 — skipping (narrate.mjs will use raw beats.json captions).',
    );
    return;
  }

  const args = parseArgs();
  const scenes =
    typeof args.scene === 'string' ? [args.scene] : listScenesWithBeats();
  if (scenes.length === 0) {
    console.log('[polish] No scenes with beats.json found. Nothing to do.');
    return;
  }

  for (const scene of scenes) {
    await polishScene(scene);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[polish] FAILED: ${message}`);
  process.exitCode = 1;
});
