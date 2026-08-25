/**
 * tui-frames.mjs — turn a recorded asciicast into per-frame screen grids.
 *
 * This is the stage that makes the whole TUI pipeline deterministic. A terminal
 * emulator is STATEFUL: frame N depends on every byte before it. Remotion, by
 * contrast, renders frames out of order and in parallel across browser tabs, so
 * driving an emulator live inside a composition would produce a different
 * picture depending on which tab got which frame. That is the trap this file
 * exists to avoid.
 *
 * So the emulation happens exactly once, here, in Node:
 *
 *   cast (ANSI + timings) --> @xterm/headless --> grid snapshot per frame --> JSON
 *
 * Remotion then renders a dumb array of styled cells. Stateless, order-
 * independent, and fast.
 *
 * Usage:
 *   node apps/ptah-video-studio/scripts/tui-frames.mjs --scene tui-orchestration
 *     [--fps 30]        must match PROMO_FPS
 *     [--speed 1]       >1 compresses dead air (e.g. 1.4 = 40% faster playback)
 *     [--max-idle-ms N] clamp any gap longer than N to N, so long agent thinking
 *                       pauses do not become long dead frames (default 1200)
 *
 * Output: dist/apps/ptah-electron-e2e/recordings/<scene>/tui-frames.json
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { sceneDir, parseArgs } from './paths.mjs';

const require = createRequire(import.meta.url);

/** Default xterm 256-colour palette entries we care about, as CSS. */
const DEFAULT_FG = '#d4d4d4';
const DEFAULT_BG = 'transparent';

/**
 * Read an asciicast v2 file: a JSON header line, then one JSON array per event.
 * Malformed lines are skipped rather than fatal — a truncated tail (killed
 * recorder) should still render everything up to the cut.
 */
function readCast(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const header = JSON.parse(lines[0]);
  const events = [];
  for (const line of lines.slice(1)) {
    try {
      const [t, type, data] = JSON.parse(line);
      if (type === 'o' && typeof data === 'string') events.push([t, data]);
    } catch {
      // skip
    }
  }
  return { header, events };
}

/**
 * Compress idle gaps. A live agent turn can sit silent for 20s while it thinks;
 * that is honest but unwatchable. Clamping each inter-event gap keeps the real
 * ORDER and the real typing rhythm while removing dead air, which is the same
 * trade the Electron pipeline makes with its segment time-remap.
 */
function retime(events, { speed, maxIdleMs }) {
  const out = [];
  let prevSrc = 0;
  let acc = 0;
  for (const [t, data] of events) {
    const gapMs = Math.max(0, (t - prevSrc) * 1000);
    acc += Math.min(gapMs, maxIdleMs) / speed;
    out.push([acc, data]);
    prevSrc = t;
  }
  return out;
}

/** One cell -> a compact tuple the renderer can consume cheaply. */
function packRow(buffer, y, cols) {
  const line = buffer.getLine(y);
  if (!line) return [];
  const runs = [];
  let cur = null;
  for (let x = 0; x < cols; x++) {
    const cell = line.getCell(x);
    if (!cell) continue;
    const chars = cell.getChars() || ' ';
    const fg = cell.isFgDefault() ? DEFAULT_FG : cssColor(cell, 'fg');
    const bg = cell.isBgDefault() ? DEFAULT_BG : cssColor(cell, 'bg');
    const bold = cell.isBold() ? 1 : 0;
    const dim = cell.isDim() ? 1 : 0;
    // Merge adjacent cells that share styling into one run — a 120x32 grid is
    // 3840 cells, but a real TUI frame is only a few dozen styled runs.
    if (cur && cur.fg === fg && cur.bg === bg && cur.b === bold && cur.d === dim) {
      cur.t += chars;
    } else {
      cur = { t: chars, fg, bg, b: bold, d: dim };
      runs.push(cur);
    }
  }
  // Trim trailing blank run so the JSON stays small.
  while (runs.length && runs[runs.length - 1].t.trim() === '' && runs[runs.length - 1].bg === DEFAULT_BG) {
    runs.pop();
  }
  return runs;
}

/** xterm cell colour -> CSS. Handles palette, RGB and default. */
function cssColor(cell, which) {
  const isRgb = which === 'fg' ? cell.isFgRGB() : cell.isBgRGB();
  const isPalette = which === 'fg' ? cell.isFgPalette() : cell.isBgPalette();
  const code = which === 'fg' ? cell.getFgColor() : cell.getBgColor();
  if (isRgb) {
    return `#${(code & 0xffffff).toString(16).padStart(6, '0')}`;
  }
  if (isPalette) return PALETTE[code] ?? DEFAULT_FG;
  return which === 'fg' ? DEFAULT_FG : DEFAULT_BG;
}

/** xterm's default 256-colour palette, generated once. */
const PALETTE = (() => {
  const base = [
    '#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf',
    '#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec',
  ];
  const out = [...base];
  const level = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++)
      for (let b = 0; b < 6; b++)
        out.push(
          `#${level[r].toString(16).padStart(2, '0')}${level[g]
            .toString(16)
            .padStart(2, '0')}${level[b].toString(16).padStart(2, '0')}`,
        );
  for (let i = 0; i < 24; i++) {
    const v = (8 + i * 10).toString(16).padStart(2, '0');
    out.push(`#${v}${v}${v}`);
  }
  return out;
})();

async function main() {
  const args = parseArgs();
  const scene = typeof args.scene === 'string' ? args.scene : 'tui-orchestration';
  const fps = args.fps ? Number(args.fps) : 30;
  const speed = args.speed ? Number(args.speed) : 1;
  const maxIdleMs = args['max-idle-ms'] ? Number(args['max-idle-ms']) : 1200;

  const dir = sceneDir(scene);
  const castPath = path.join(dir, 'tui.cast');
  if (!fs.existsSync(castPath)) {
    throw new Error(`No cast at ${castPath}. Record it first: record-tui.mjs --scene ${scene}`);
  }

  // @xterm/headless ships CJS, so a dynamic import() hands back a namespace with
  // the real module under `default` and no named `Terminal`. createRequire is
  // the same escape hatch narrate.mjs / caption.mjs use for ffmpeg-static.
  const { Terminal } = require('@xterm/headless');
  const { header, events } = readCast(castPath);
  const cols = header.width ?? 120;
  const rows = header.height ?? 32;

  const timed = retime(events, { speed, maxIdleMs });
  const totalMs = timed.length ? timed[timed.length - 1][0] : 0;
  const frameCount = Math.max(1, Math.ceil((totalMs / 1000) * fps) + fps); // +1s tail

  const term = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 0 });

  /** `write` is async in xterm; await each so the buffer is settled before we snapshot. */
  const write = (data) => new Promise((resolve) => term.write(data, resolve));

  const frames = [];
  let cursor = 0;
  for (let f = 0; f < frameCount; f++) {
    const tMs = (f / fps) * 1000;
    while (cursor < timed.length && timed[cursor][0] <= tMs) {
      await write(timed[cursor][1]);
      cursor++;
    }
    const buf = term.buffer.active;
    const grid = [];
    for (let y = 0; y < rows; y++) grid.push(packRow(buf, y, cols));
    // Frames are usually identical to their predecessor (a TUI repaints rarely).
    // Store a back-reference instead of a duplicate grid — this is the
    // difference between a 4 MB file and a 90 MB one.
    const prev = frames[frames.length - 1];
    const same = prev && JSON.stringify(prev.g ?? frames[prev.r].g) === JSON.stringify(grid);
    frames.push(same ? { r: prev.g ? frames.length - 1 : prev.r } : { g: grid });
  }

  term.dispose();

  const outPath = path.join(dir, 'tui-frames.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify({ scene, cols, rows, fps, frameCount, durationMs: Math.round(totalMs), frames }),
  );

  const uniq = frames.filter((f) => f.g).length;
  console.log(
    `[frames] ${scene}: ${frameCount} frames (${uniq} unique, ${Math.round(
      (1 - uniq / frameCount) * 100,
    )}% deduped), ${cols}x${rows}, ${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB`,
  );
  console.log(`[frames] -> ${outPath}`);
}

main().catch((error) => {
  console.error(`[frames] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
