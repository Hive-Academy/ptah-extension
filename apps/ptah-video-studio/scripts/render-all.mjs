/**
 * render-all.mjs — render one mp4 per captured scene.
 *
 * For each scene that has a beats.json under RECORDINGS_ROOT:
 *   1. Validate beats.json and load durations.json / captions.json.
 *   2. Build a props JSON (rawVideo path, manifest, narrationFiles map,
 *      durations, captions) written to recordings/<scene>/render-props.json.
 *   3. Invoke `remotion render src/Root.tsx ShowcaseVideo <out> --props=…`.
 *
 * Output: recordings/<scene>/out/<scene>.mp4 (H.264, per remotion.config.ts).
 * This replaces transcode.mjs as the mp4 producer for the full pipeline.
 *
 * Usage: node apps/ptah-video-studio/scripts/render-all.mjs [--scene editor-tour] [--concurrency N]
 *
 * ESM, Node >=22.9. Errors caught as `unknown`.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseArgs,
  sceneDir,
  listScenesWithBeats,
  APP_ROOT,
} from './paths.mjs';

const ROOT_ENTRY = 'src/Root.tsx';
const COMPOSITION_ID = 'ShowcaseVideo';

function readJsonIfExists(p) {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

/** Build the props object Remotion's ShowcaseVideo expects for one scene. */
function buildProps(scene) {
  const dir = sceneDir(scene);
  const manifest = readJsonIfExists(path.join(dir, 'beats.json'));
  if (!manifest) {
    throw new Error(`No beats.json for scene ${scene}`);
  }

  const rawVideo = path.join(dir, 'raw.webm');
  if (!fs.existsSync(rawVideo)) {
    throw new Error(`No raw.webm for scene ${scene} at ${rawVideo}`);
  }

  const durations = readJsonIfExists(path.join(dir, 'durations.json'));
  const captions = readJsonIfExists(path.join(dir, 'captions.json')) ?? [];

  // Map beat index (1-based) -> absolute wav path, if narrate.mjs produced it.
  const narrationFiles = {};
  const wavDir = path.join(dir, 'wav');
  if (fs.existsSync(wavDir)) {
    for (const f of fs.readdirSync(wavDir)) {
      const m = /^(\d+)\.wav$/i.exec(f);
      if (m) narrationFiles[Number(m[1])] = path.join(wavDir, f);
    }
  }

  return {
    rawVideo,
    manifest,
    narrationFiles,
    durations,
    captions,
    kenBurns: true,
  };
}

function renderScene(scene, concurrency) {
  const dir = sceneDir(scene);
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${scene}.mp4`);

  const props = buildProps(scene);
  const propsPath = path.join(dir, 'render-props.json');
  fs.writeFileSync(propsPath, JSON.stringify(props, null, 2));

  const args = [
    'remotion',
    'render',
    ROOT_ENTRY,
    COMPOSITION_ID,
    outFile,
    `--props=${propsPath}`,
  ];
  if (concurrency) args.push(`--concurrency=${concurrency}`);

  console.log(`[render] ${scene} -> ${outFile}`);
  execFileSync('npx', args, {
    cwd: APP_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

function main() {
  const args = parseArgs();
  const concurrency = args.concurrency ? Number(args.concurrency) : undefined;

  const scenes =
    typeof args.scene === 'string' ? [args.scene] : listScenesWithBeats();
  if (scenes.length === 0) {
    console.log('[render] No scenes with beats.json found. Nothing to do.');
    return;
  }

  for (const scene of scenes) {
    renderScene(scene, concurrency);
  }
  console.log(`[render] Done. Rendered ${scenes.length} scene(s).`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[render] FAILED: ${message}`);
  process.exitCode = 1;
}
