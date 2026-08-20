/**
 * render-outro.mjs — render the branded end card as a standalone clip.
 *
 * The self-shot pipeline can already append `EndCard` to a body it rendered
 * itself, but a tutorial cut in DaVinci/Premiere needs that card as its own
 * file. This renders the `Outro` composition and nothing else.
 *
 * `--fps` MATTERS. Default 30 suits a freshly recorded 30fps edit; pass the
 * host timeline's real rate (24 for a Resolve export) or the splice judders.
 *
 * Usage:
 *   node scripts/render-outro.mjs [--fps 24] [--seconds 8] [--format 16x9|9x16|both]
 *                                 [--headline "Ptah"] [--slug outro]
 *
 * ESM, Node >=22.9.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs, APP_ROOT } from './paths.mjs';
import { SELFSHOT_ROOT } from './lib/selfshot-paths.mjs';
import { measureLoudness } from './lib/master-audio.mjs';

const ROOT_ENTRY = 'src/Root.tsx';
const SFX_DIR = path.join(APP_ROOT, 'assets', 'sfx');
/** Cued to the card's motion in Outro.tsx; a missing file drops its cue. */
const SFX_ASSETS = { whoosh: 'whoosh.mp3', ring: 'ring.mp3' };

const FORMAT_RES = {
  '16x9': { width: 1920, height: 1080 },
  '9x16': { width: 1080, height: 1920 },
};

function stage(publicDir, srcAbs, relName) {
  if (!fs.existsSync(srcAbs)) return null;
  fs.mkdirSync(publicDir, { recursive: true });
  fs.copyFileSync(srcAbs, path.join(publicDir, relName));
  return relName;
}

function main() {
  const args = parseArgs();
  const slug = typeof args.slug === 'string' ? args.slug : 'outro';
  const fps = Number(args.fps ?? 30);
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('--fps must be a positive number.');
  const seconds = Number(args.seconds ?? 8);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('--seconds must be a positive number.');
  const headline = typeof args.headline === 'string' ? args.headline : undefined;

  const formats =
    args.format === 'both' ? ['16x9', '9x16'] : args.format === '9x16' ? ['9x16'] : ['16x9'];

  const dir = path.join(SELFSHOT_ROOT, slug);
  const publicDir = path.join(dir, '_public');
  fs.rmSync(publicDir, { recursive: true, force: true });
  fs.mkdirSync(publicDir, { recursive: true });

  const sfx = {};
  for (const [role, file] of Object.entries(SFX_ASSETS)) {
    const staged = stage(publicDir, path.join(SFX_DIR, file), file);
    if (staged) sfx[role] = staged;
  }

  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir, { recursive: true });

  for (const format of formats) {
    const props = {
      res: FORMAT_RES[format],
      fps,
      durationMs: Math.round(seconds * 1000),
      ...(headline ? { headline } : {}),
      ...sfx,
    };
    const propsPath = path.join(dir, `render-props.${format}.json`);
    fs.writeFileSync(propsPath, JSON.stringify(props, null, 2));

    const outFile = path.join(outDir, `${slug}-${format}.mp4`);
    console.log(`[outro] ${slug} [${format}] ${seconds}s @ ${fps}fps → ${outFile}`);
    execFileSync(
      'npx',
      [
        'remotion',
        'render',
        ROOT_ENTRY,
        'Outro',
        outFile,
        `--props=${propsPath}`,
        `--public-dir=${publicDir}`,
      ],
      { cwd: APP_ROOT, stdio: 'inherit', shell: process.platform === 'win32' },
    );

    // NOT loudness-mastered, unlike every other render here. `masterAudio` lifts
    // a file to -14 LUFS because YouTube never lifts a quiet STANDALONE upload —
    // but this clip is spliced into a video that gets mastered as a whole. An
    // outro carrying only SFX measures ~-29 LUFS, so normalizing it in isolation
    // applies ~+15 dB and the accents end up louder than the narration they sit
    // after. Left alone, the whoosh peaks near -13 dBTP, which is where an accent
    // belongs. Master the finished video, not this piece of it.
    const level = measureLoudness(outFile);
    if (level && Number.isFinite(level.inputI)) {
      console.log(
        `[outro] ${slug} [${format}] level: ${level.inputI.toFixed(1)} LUFS / ` +
          `${level.inputTp.toFixed(1)} dBTP (unmastered by design — splice, then master the whole cut)`,
      );
    }
  }

  console.log(`[outro] Done. Rendered ${formats.length} format(s).`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[outro] FAILED: ${message}`);
  process.exitCode = 1;
}
