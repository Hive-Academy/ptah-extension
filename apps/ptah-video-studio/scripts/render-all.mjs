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
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseArgs,
  sceneDir,
  listScenesWithBeats,
  APP_ROOT,
} from './paths.mjs';

const require = createRequire(import.meta.url);

const ROOT_ENTRY = 'src/Root.tsx';
const COMPOSITION_ID = 'ShowcaseVideo';

function readJsonIfExists(p) {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

/**
 * Detect the real UI content height of a capture. Electron/Playwright pad the
 * recorded frame with a uniform mid-gray (~rgb 128) band at the bottom when the
 * web-contents viewport is shorter than the record size. We find where that
 * band starts so DeviceFrame can clip it. Returns { width, height, contentHeight }.
 * Falls back to full height on any failure (no crop).
 */
function detectSource(rawVideo, fallbackW, fallbackH) {
  const full = { width: fallbackW, height: fallbackH, contentHeight: fallbackH };
  try {
    const ffmpeg = require('ffmpeg-static');
    const sharp = require('sharp');
    const tmpPng = path.join(path.dirname(rawVideo), '_probe.png');
    // Grab a frame a few seconds in (past any opening fade).
    execFileSync(ffmpeg, ['-y', '-ss', '3', '-i', rawVideo, '-frames:v', '1', tmpPng], {
      stdio: 'ignore',
    });
    // sharp is async; run synchronously via a spawned helper is overkill — use
    // the sync-ish deasync pattern by reading raw pixels through a child eval.
    const out = execFileSync(
      process.execPath,
      [
        '-e',
        `const sharp=require(${JSON.stringify(require.resolve('sharp'))});(async()=>{const {data,info}=await sharp(${JSON.stringify(
          tmpPng,
        )}).raw().toBuffer({resolveWithObject:true});const ch=info.channels,W=info.width,H=info.height;const rowStat=(y)=>{let s=0,s2=0;for(let x=0;x<W;x++){const i=(y*W+x)*ch;const l=0.299*data[i]+0.587*data[i+1]+0.114*data[i+2];s+=l;s2+=l*l;}const m=s/W;return{m,v:s2/W-m*m};};let top=H;for(let y=H-1;y>=0;y--){const {m,v}=rowStat(y);if(m>110&&m<140&&v<80){top=y;}else break;}console.log(JSON.stringify({W,H,top}));})();`,
      ],
      { encoding: 'utf8' },
    );
    fs.rmSync(tmpPng, { force: true });
    const { W, H, top } = JSON.parse(out.trim().split('\n').pop());
    // Guard against implausible detection (>35% band → treat as no band).
    const band = H - top;
    const contentHeight = band > 0 && band < H * 0.35 ? top : H;
    return { width: W, height: H, contentHeight };
  } catch {
    return full;
  }
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
  // Optional camera / annotation track. Hand-authored per scene today; the
  // Director will emit it from spotlighted element boxes for designed scenes.
  const shotsFile = readJsonIfExists(path.join(dir, 'shots.json'));
  const shots = Array.isArray(shotsFile?.shots) ? shotsFile.shots : [];

  // Asset paths are relative (forward-slash) to the scene dir, which is passed
  // to `remotion render` as --public-dir. Remotion serves local assets over its
  // internal http server via staticFile(); absolute file:// paths are rejected
  // by the renderer's asset loader.
  const narrationFiles = {};
  const wavDir = path.join(dir, 'wav');
  if (fs.existsSync(wavDir)) {
    for (const f of fs.readdirSync(wavDir)) {
      const m = /^(\d+)\.wav$/i.exec(f);
      if (m) narrationFiles[Number(m[1])] = `wav/${f}`;
    }
  }

  const source = detectSource(
    rawVideo,
    manifest.res?.width ?? 1920,
    manifest.res?.height ?? 1080,
  );
  console.log(
    `[render] ${scene}: source ${source.width}x${source.height}, content ${source.contentHeight}px (band ${source.height - source.contentHeight}px)`,
  );

  return {
    rawVideo: 'raw.webm',
    manifest,
    narrationFiles,
    durations,
    captions,
    source,
    shots,
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
    `--public-dir=${dir}`,
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
