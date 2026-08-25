/**
 * probe-tui.mjs — exploratory driver that prints the screen after each keypress.
 *
 * Authoring a walkthrough means knowing which keys reach which surface. Guessing
 * costs a full recording per guess; this prints the frame after every step so a
 * real sequence can be written once. Throwaway tool, not part of the pipeline.
 *
 * Usage:
 *   node apps/ptah-video-studio/scripts/probe-tui.mjs --keys "down,down,enter"
 *     [--auth-from-home]   inherit the ~/.claude login (see record-tui.mjs)
 *     [--tail 22]          lines of each frame to print
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { WORKSPACE_ROOT, parseArgs } from './paths.mjs';

const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NAMED = {
  enter: '\r',
  escape: '\x1b',
  tab: '\t',
  up: '\x1b[A',
  down: '\x1b[B',
  left: '\x1b[D',
  right: '\x1b[C',
};

function stripAnsi(t) {
  /* eslint-disable no-control-regex */
  return t
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b[()][A-Za-z0-9]/g, '');
  /* eslint-enable no-control-regex */
}

async function main() {
  const args = parseArgs();
  const tail = args.tail ? Number(args.tail) : 22;
  const steps = String(args.keys ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  const pty = require('node-pty');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-tui-probe-'));
  fs.mkdirSync(path.join(home, '.ptah'), { recursive: true });

  if (args['auth-from-home']) {
    for (const name of ['.claude', '.claude.json']) {
      const src = path.join(os.homedir(), name);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(home, name), { recursive: true });
    }
  }

  const env = { ...process.env, HOME: home, USERPROFILE: home, TERM: 'xterm-256color' };
  env['APPDATA'] = path.join(home, 'AppData', 'Roaming');
  env['LOCALAPPDATA'] = path.join(home, 'AppData', 'Local');
  env['NO_COLOR'] = '1';
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY']) delete env[k];

  const child = pty.spawn(
    process.execPath,
    [path.join(WORKSPACE_ROOT, 'dist', 'apps', 'ptah-cli', 'main.mjs'), 'tui'],
    { name: 'xterm-256color', cols: 120, rows: 32, cwd: WORKSPACE_ROOT, env },
  );

  let buf = '';
  let last = Date.now();
  let exited = false;
  child.onData((d) => {
    buf += d;
    last = Date.now();
  });
  child.onExit(() => {
    exited = true;
  });

  const settle = async (quiet = 1200, timeout = 25_000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (exited || Date.now() - last > quiet) return;
      await sleep(100);
    }
  };
  const show = (label) => {
    const lines = stripAnsi(buf)
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.trim());
    console.log(`\n===== ${label} =====`);
    console.log(lines.slice(-tail).join('\n'));
  };

  await settle(1500, 90_000);
  show('BOOT');

  for (const step of steps) {
    buf = '';
    child.write(NAMED[step] ?? step);
    await sleep(400);
    await settle();
    show(`AFTER ${step}`);
  }

  try {
    child.write('\x03');
    child.write('\x03');
    await sleep(1500);
    if (!exited) child.kill();
  } catch {
    // already gone
  }
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 3 });
}

main().catch((e) => {
  console.error(`[probe] FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
