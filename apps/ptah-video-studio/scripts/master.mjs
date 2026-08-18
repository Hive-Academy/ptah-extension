/**
 * master.mjs — measure or apply the final loudness master on rendered videos.
 *
 * render-promo.mjs / render-all.mjs / selfshot-render.mjs already master their
 * own output, so this CLI exists for two jobs the render scripts cannot do:
 * auditing what is on disk, and fixing the back catalogue without paying for a
 * re-render (or re-narration).
 *
 * Usage:
 *   node apps/ptah-video-studio/scripts/master.mjs --check --all
 *   node apps/ptah-video-studio/scripts/master.mjs --all
 *   node apps/ptah-video-studio/scripts/master.mjs --scene ptah-saas-story
 *   node apps/ptah-video-studio/scripts/master.mjs --file path/to/video.mp4
 *
 * Flags:
 *   --check           measure only, write nothing
 *   --force           re-master even when already on target
 *   --target <LUFS>   integrated target (default -14)
 *   --peak <dBTP>     true-peak ceiling (default -1.5)
 *
 * Output: rewrites each mp4 in place (video stream copied, audio re-encoded).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RECORDINGS_ROOT, parseArgs } from './paths.mjs';
import {
  TARGET_I,
  TARGET_TP,
  masterAudio,
  measureLoudness,
  describeMasterResult,
} from './lib/master-audio.mjs';

/** Every `<scene>/out/*.mp4` under the recordings root. */
function allRenderedVideos() {
  if (!fs.existsSync(RECORDINGS_ROOT)) return [];
  const out = [];
  for (const entry of fs.readdirSync(RECORDINGS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const outDir = path.join(RECORDINGS_ROOT, entry.name, 'out');
    if (!fs.existsSync(outDir)) continue;
    for (const file of fs.readdirSync(outDir)) {
      if (file.endsWith('.mp4')) out.push(path.join(outDir, file));
    }
  }
  return out.sort();
}

function resolveTargets(args) {
  if (args.all) return allRenderedVideos();
  if (typeof args.file === 'string') return [path.resolve(args.file)];
  if (typeof args.scene === 'string') {
    const outDir = path.join(RECORDINGS_ROOT, args.scene, 'out');
    if (!fs.existsSync(outDir)) throw new Error(`No renders for scene "${args.scene}" (${outDir}).`);
    return fs
      .readdirSync(outDir)
      .filter((f) => f.endsWith('.mp4'))
      .map((f) => path.join(outDir, f))
      .sort();
  }
  throw new Error('Usage: node master.mjs (--all | --scene <slug> | --file <path>) [--check] [--force]');
}

function main() {
  const args = parseArgs();
  const opts = {
    i: args.target != null ? Number(args.target) : TARGET_I,
    tp: args.peak != null ? Number(args.peak) : TARGET_TP,
    force: Boolean(args.force),
  };
  const files = resolveTargets(args);
  if (files.length === 0) {
    console.log('[master] No rendered mp4s found.');
    return;
  }

  console.log(
    `[master] ${args.check ? 'Checking' : 'Mastering'} ${files.length} file(s) ` +
      `against I=${opts.i} LUFS / TP=${opts.tp} dBTP\n`,
  );

  const failures = [];
  for (const file of files) {
    // Scene-relative for renders under the recordings root; bare filename for
    // an arbitrary --file elsewhere (which would otherwise be a ../../.. path).
    const relative = path.relative(RECORDINGS_ROOT, file).replace(/\\/g, '/');
    const label = relative.startsWith('..') ? path.basename(file) : relative;
    try {
      if (args.check) {
        const m = measureLoudness(file, opts);
        if (!m) {
          console.log(`       ${label}: no audio stream`);
          continue;
        }
        // loudnorm reports "-inf" on silent audio, which parses to NaN. Those
        // files are not "off target" — there is nothing to normalize.
        if (!Number.isFinite(m.inputI)) {
          console.log(`       ${label}: silent (no audio to master)`);
          continue;
        }
        const delta = m.inputI - opts.i;
        const flag = Math.abs(delta) <= 0.5 ? 'ok  ' : 'OFF ';
        console.log(
          `  ${flag} ${label}: ${m.inputI.toFixed(1)} LUFS ` +
            `(${delta >= 0 ? '+' : ''}${delta.toFixed(1)} LU), ` +
            `${m.inputTp.toFixed(1)} dBTP, LRA ${m.inputLra.toFixed(1)}`,
        );
      } else {
        console.log(`  ${label}: ${describeMasterResult(masterAudio(file, opts))}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ${label}: FAILED — ${message}`);
      failures.push(label);
    }
  }

  if (failures.length) {
    console.error(`\n[master] ${failures.length}/${files.length} failed: ${failures.join(', ')}`);
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[master] FAILED: ${message}`);
  process.exitCode = 1;
}
