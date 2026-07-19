/**
 * selfshot-transcribe.mjs — whisper word-level timestamps for a self-shot video.
 *
 * Reuses the SAME whisper.cpp path as the showcase caption pipeline
 * (@remotion/install-whisper-cpp, model cached under `.whisper/`): extract the
 * voice track to 16k mono, transcribe with token-level timestamps, merge BPE
 * fragments into whole words, and write `selfshot/<slug>/words.json`. That file
 * powers BOTH the on-screen captions and the beats manifest's word anchors.
 *
 * Voice source priority: input.audio > camera video > screen video
 * (auto-detected by filename convention; see selfshot-paths.mjs).
 *
 * Usage:
 *   node scripts/selfshot-transcribe.mjs --slug my-intro [--model base.en] [--force]
 *   node scripts/selfshot-transcribe.mjs --slug my-intro --input path/to/voice.wav
 *
 * ESM, Node >=22.9.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  installWhisperCpp,
  downloadWhisperModel,
  transcribe,
  toCaptions,
} from '@remotion/install-whisper-cpp';
import { parseArgs, WHISPER_DIR } from './paths.mjs';
import { ingestDir, detectInputs, voiceSource } from './lib/selfshot-paths.mjs';
import { extractAudio16k } from './lib/media.mjs';

const WHISPER_VERSION = '1.5.5';
const DEFAULT_MODEL = 'base.en';

/** Merge whisper's sub-word / punctuation tokens into whole words (see caption.mjs). */
function mergeToWords(tokens) {
  const words = [];
  for (const t of tokens) {
    const trimmed = t.text.trim();
    if (!trimmed) continue;
    const isPunct = /^[.,!?;:'")\]}%…–-]+$/.test(trimmed);
    const startsWord = /^\s/.test(t.text) && !isPunct;
    if (words.length === 0 || startsWord) {
      words.push({ text: trimmed, startMs: t.startMs, endMs: t.endMs });
    } else {
      const w = words[words.length - 1];
      w.text += trimmed;
      w.endMs = t.endMs;
    }
  }
  return words;
}

async function main() {
  const args = parseArgs();
  const slug = typeof args.slug === 'string' ? args.slug : null;
  if (!slug) throw new Error('Pass --slug <name> (the folder under selfshot/).');
  const model = typeof args.model === 'string' ? args.model : DEFAULT_MODEL;

  const dir = ingestDir(slug);
  if (!fs.existsSync(dir)) {
    throw new Error(`Ingest folder not found: ${dir}. Create it and drop your recording(s) in.`);
  }

  const wordsPath = path.join(dir, 'words.json');
  if (fs.existsSync(wordsPath) && !args.force) {
    console.log(`[transcribe] ${slug}: words.json exists — skipping (use --force to redo).`);
    return;
  }

  // Explicit --input wins; else read input from an existing beats.json; else sniff.
  let manifestInput;
  const beatsPath = path.join(dir, 'beats.json');
  if (fs.existsSync(beatsPath)) {
    try {
      manifestInput = JSON.parse(fs.readFileSync(beatsPath, 'utf8')).input;
    } catch {
      manifestInput = undefined;
    }
  }
  const inputs = detectInputs(dir, manifestInput);
  const voice =
    typeof args.input === 'string'
      ? path.isAbsolute(args.input)
        ? args.input
        : path.join(dir, args.input)
      : voiceSource(dir, inputs);
  if (!voice || !fs.existsSync(voice)) {
    throw new Error(
      `No voice track found in ${dir}. Drop a camera.*, screen.* or audio.* file, or pass --input <file>.`,
    );
  }
  console.log(`[transcribe] ${slug}: voice source = ${path.basename(voice)}`);

  const tmp16k = path.join(dir, '_voice16k.wav');
  extractAudio16k(voice, tmp16k);

  fs.mkdirSync(path.dirname(WHISPER_DIR), { recursive: true });
  console.log(`[transcribe] ${slug}: ensuring whisper.cpp @ ${WHISPER_DIR}…`);
  await installWhisperCpp({ to: WHISPER_DIR, version: WHISPER_VERSION });
  await downloadWhisperModel({ model, folder: WHISPER_DIR });

  console.log(`[transcribe] ${slug}: transcribing (${model})…`);
  const whisperOutput = await transcribe({
    inputPath: tmp16k,
    whisperPath: WHISPER_DIR,
    whisperCppVersion: WHISPER_VERSION,
    model,
    tokenLevelTimestamps: true,
  });
  const { captions } = toCaptions({ whisperCppOutput: whisperOutput });
  const words = mergeToWords(captions).map((w) => ({
    text: w.text,
    startMs: Math.round(w.startMs),
    endMs: Math.round(w.endMs),
  }));
  fs.rmSync(tmp16k, { force: true });

  fs.writeFileSync(
    wordsPath,
    JSON.stringify({ slug, model, generatedAt: new Date().toISOString(), words }, null, 2),
  );
  console.log(`[transcribe] ${slug}: wrote ${words.length} words → ${wordsPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[transcribe] FAILED: ${message}`);
  process.exitCode = 1;
});
