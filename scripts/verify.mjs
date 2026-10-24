#!/usr/bin/env node
// One entry point for local verification. See CLAUDE.md "Verification".
//
//   npm run verify                         nx affected -t lint test typecheck --base=main
//   npm run verify -- -p shared,chat       nx run-many for those projects only
//   npm run verify -- -t test -p shared    selected targets only
//   npm run verify -- --base origin/main   another base for nx affected
//   npm run verify -- -p shared -- --skip-nx-cache   extra args go to nx
//   npm run verify -- --status             show the lock holder and the queue
//   node scripts/verify.mjs --exec --task <name> -- <command> [args...]
//                                          run any command under the lock
//   node scripts/verify.mjs --check-token  exit 0 when this process tree
//                                          already holds the lock
//
// Every run takes the machine-wide lock in scripts/verify-lock.mjs first, so
// only one heavy check runs at a time across all sessions and worktrees.
// Nx runs one task at a time (nx.json `parallel: 1`, and --parallel=1 here)
// and Jest uses 2 workers per task (jest.preset.js).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';

import {
  TOKEN_ENV,
  acquire,
  describe,
  lockPaths,
  readHolder,
  readQueue,
  recordChild,
} from './verify-lock.mjs';

const require = createRequire(import.meta.url);
const log = (message) =>
  console.log(`[verify ${new Date().toISOString()}] ${message}`);

function splitList(values) {
  return (values ?? [])
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
}

function parse(argv) {
  const separator = argv.indexOf('--');
  const own = separator === -1 ? argv : argv.slice(0, separator);
  const passthrough = separator === -1 ? [] : argv.slice(separator + 1);
  const { values } = parseArgs({
    args: own,
    options: {
      projects: { type: 'string', short: 'p', multiple: true },
      targets: { type: 'string', short: 't', multiple: true },
      base: { type: 'string', default: 'main' },
      head: { type: 'string' },
      task: { type: 'string' },
      exec: { type: 'boolean', default: false },
      status: { type: 'boolean', default: false },
      'check-token': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  return { values, passthrough };
}

function nxCommand(values, passthrough) {
  const nxBin = path.resolve(
    path.dirname(require.resolve('nx/package.json')),
    require('nx/package.json').bin.nx,
  );
  const targets = splitList(values.targets);
  const projects = splitList(values.projects);
  const targetList = (
    targets.length ? targets : ['lint', 'test', 'typecheck']
  ).join(',');
  const args = projects.length
    ? ['run-many', '-t', targetList, '-p', projects.join(',')]
    : ['affected', '-t', targetList, `--base=${values.base}`];
  if (!projects.length && values.head) args.push(`--head=${values.head}`);
  args.push('--parallel=1', ...passthrough);
  const label = projects.length
    ? projects.join(',')
    : `affected vs ${values.base}`;
  return {
    command: process.execPath,
    args: [nxBin, ...args],
    task: `verify ${targetList} (${label})`,
  };
}

// cmd.exe quoting for one argument. Windows needs a shell to start .cmd
// files such as npx.cmd, and Node refuses .cmd without one (CVE-2024-27980).
function quoteForCmd(arg) {
  if (/^[\w./:=,@+-]+$/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

// The PATH entry Windows would start for `command`, or null.
function resolveOnPath(command) {
  if (path.isAbsolute(command)) return existsSync(command) ? command : null;
  const extensions = path.extname(command)
    ? ['']
    : (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';');
  for (const dir of (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = path.join(dir, command + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

// Node puts each direct child in a kill-on-close job object on Windows, so a
// hard kill of this process also ends a node/exe child and, through the same
// mechanism, the Nx and Jest processes below it. cmd.exe breaks that chain:
// it dies, and its child survives. So cmd.exe is used only for .cmd/.bat.
function spawnCommand(command, args, env) {
  const resolved = process.platform === 'win32' ? resolveOnPath(command) : null;
  if (resolved && /\.(cmd|bat)$/i.test(resolved)) {
    const line = [command, ...args].map(quoteForCmd).join(' ');
    return spawn(line, { stdio: 'inherit', env, shell: true });
  }
  return spawn(command, args, { stdio: 'inherit', env });
}

// On Windows child.kill() ends only the direct child. Nx and Jest workers
// below it would keep running after the lock is released.
function killTree(child, signal) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
    });
  } else {
    child.kill(signal);
  }
}

function printStatus() {
  console.log(`lock dir: ${lockPaths().dir}`);
  const holder = readHolder();
  console.log(`holder: ${describe(holder)}`);
  const queue = readQueue();
  if (!queue.length) console.log('queue: empty');
  queue.forEach((ticket, i) =>
    console.log(`queue ${i + 1}: ${describe(ticket)}`),
  );
}

async function main() {
  const { values, passthrough } = parse(process.argv.slice(2));
  if (values.help) {
    console.log(
      'usage: npm run verify -- [-p a,b] [-t lint,test,typecheck] [--base main] [--head ref] [-- nx args]\n' +
        '       node scripts/verify.mjs --status\n' +
        '       node scripts/verify.mjs --exec --task <name> -- <command> [args...]',
    );
    return 0;
  }
  if (values.status) {
    printStatus();
    return 0;
  }
  if (values['check-token']) {
    const token = process.env[TOKEN_ENV];
    return token && readHolder()?.token === token ? 0 : 1;
  }

  let run;
  if (values.exec) {
    if (!passthrough.length) throw new Error('--exec needs a command after --');
    run = {
      command: passthrough[0],
      args: passthrough.slice(1),
      task: passthrough.join(' '),
    };
  } else {
    run = nxCommand(values, passthrough);
  }
  const task = values.task ?? run.task;
  const worktree = process.cwd();

  let child = null;
  let interrupted = null;
  const onSignal = (signal) => {
    interrupted = signal;
    if (child) {
      // The child usually got the same Ctrl-C from the console. Stop the
      // whole tree anyway for kill/SIGTERM, then release after it exits.
      killTree(child, signal);
    } else {
      log(`${signal} while waiting. Leaving the queue.`);
      process.exit(130);
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    process.on(signal, onSignal);
  }

  const waitStart = Date.now();
  const lock = await acquire({ task, worktree, onWait: log });
  if (lock.reentrant) {
    log(`lock already held by parent ${describe(lock.entry)}`);
  } else {
    const waited = Math.round((Date.now() - waitStart) / 1000);
    log(`lock acquired after ${waited}s: ${task}`);
  }

  const runStart = Date.now();
  const code = await new Promise((resolve) => {
    child = spawnCommand(run.command, run.args, {
      ...process.env,
      [TOKEN_ENV]: lock.entry.token,
    });
    if (!lock.reentrant && child.pid) recordChild(lock.entry, child.pid);
    child.on('error', (error) => {
      log(`could not start ${run.command}: ${error.message}`);
      resolve(1);
    });
    child.on('exit', (exitCode, signal) =>
      resolve(exitCode ?? (signal ? 1 : 0)),
    );
  });
  lock.release();
  const seconds = ((Date.now() - runStart) / 1000).toFixed(1);
  log(
    `${lock.reentrant ? 'done' : 'lock released'} after ${seconds}s, exit code ${code}`,
  );
  return interrupted ? 130 : code;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    log(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
