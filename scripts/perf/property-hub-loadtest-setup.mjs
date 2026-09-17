#!/usr/bin/env node

/**
 * Creates an isolated property-hub clone and numbered worktrees for the manual
 * Electron load test. Dry run is the safe planning mode; execution is explicit.
 *
 * Usage: node property-hub-loadtest-setup.mjs --dry-run [options]
 */

import { access, rm } from 'node:fs/promises';

import {
  assertTargetIsNotLink,
  childFailure,
  resolveLoadtestPaths,
  run,
  writeMarker,
} from './property-hub-loadtest-paths.mjs';

const USAGE = `Usage: node property-hub-loadtest-setup.mjs (--dry-run | --execute) [options]

Options:
  --source PATH       Source git work tree (default: D:/projects/property-hub)
  --target PATH       Clone destination (default: D:/projects/property-hub-loadtest)
  --worktrees N       Number of worktrees, 1-40 (default: 16)
  --skip-install      Skip npm ci`;

function usageError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  throw error;
}

function nextValue(args, index, flag) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    usageError(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(args) {
  const options = {
    dryRun: false,
    execute: false,
    source: undefined,
    target: undefined,
    worktrees: 16,
    skipInstall: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--execute') {
      options.execute = true;
    } else if (arg === '--skip-install') {
      options.skipInstall = true;
    } else if (
      arg === '--source' ||
      arg === '--target' ||
      arg === '--worktrees'
    ) {
      const value = nextValue(args, index, arg);
      index += 1;
      if (arg === '--source') {
        options.source = value;
      }
      if (arg === '--target') {
        options.target = value;
      }
      if (arg === '--worktrees') {
        options.worktrees = Number(value);
      }
    } else {
      usageError(`unknown argument: ${arg}`);
    }
  }

  if (options.dryRun === options.execute) {
    usageError('exactly one of --dry-run or --execute is required');
  }
  if (
    !Number.isInteger(options.worktrees) ||
    options.worktrees < 1 ||
    options.worktrees > 40
  ) {
    usageError('--worktrees must be an integer from 1 to 40');
  }
  return options;
}

function quote(value) {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function commandText(command, args, cwd) {
  const prefix = cwd ? `(cwd ${quote(cwd)}) ` : '';
  return `${prefix}${command} ${args.map(quote).join(' ')}`;
}

async function exists(value) {
  try {
    await access(value);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function printManualProcedure() {
  console.log('\nManual load-test procedure:');
  console.log('  WARNING: do not run during a perf measurement.');
  console.log(
    '  From this Ptah worktree, set PTAH_PROFILE_ON_LAG_MS=500 and run:',
  );
  console.log('  npx nx serve ptah-electron');
  console.log('  With 3 streaming tiles running:');
  console.log('  B) Have an agent remove all worktrees in one Bash command.');
  console.log('  C) Run rm -rf node_modules && npm ci.');
  console.log('  D) Run npx nx run-many -t build.');
  console.log('  E) Use the git panel during C/D.');
  console.log(
    '  Inspect %APPDATA%\\Ptah Dev\\logs\\Ptah Electron-<date>.log for',
  );
  console.log(
    '  [event-loop] lag, git status timed out, storm lines, and [GitProcessGate] saturated.',
  );
  console.log('  Also inspect ptah-hang.log and crash dumps.');
  console.log('  Reproduce first on the installed build for a baseline.');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const paths = resolveLoadtestPaths({
    source: options.source,
    target: options.target,
  });

  console.log(`Mode: ${options.dryRun ? 'dry-run' : 'execute'}`);
  console.log(`Source: ${paths.source}`);
  console.log(`Target: ${paths.target}`);
  console.log(`Worktrees: ${options.worktrees}`);

  if (!(await exists(paths.source))) {
    throw new Error(`source missing: ${paths.source}`);
  }
  const sourceCheck = await run(
    'git',
    ['-C', paths.source, 'rev-parse', '--is-inside-work-tree'],
    { capture: true },
  );
  if (sourceCheck.code !== 0 || sourceCheck.stdout.trim() !== 'true') {
    childFailure('source git work-tree check', sourceCheck);
  }
  if (await exists(paths.target)) {
    throw new Error(`target already exists: ${paths.target}`);
  }

  const cloneArgs = ['clone', '--no-hardlinks', paths.source, paths.target];
  console.log(
    `Step 1: guards passed (git -C ${quote(paths.source)} rev-parse --is-inside-work-tree)`,
  );
  console.log(`Step 2: ${commandText('git', cloneArgs)}`);
  console.log(`Step 3: write marker .git/ptah-loadtest-clone.json`);
  console.log(
    `Step 4: ${commandText('git', ['-C', paths.target, 'remote', 'remove', 'origin'])}`,
  );
  if (options.skipInstall) {
    console.log('Step 5: skip npm ci (--skip-install)');
  } else {
    console.log(
      `Step 5: ${commandText(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci'], paths.target)}`,
    );
  }
  for (let index = 1; index <= options.worktrees; index += 1) {
    const number = String(index).padStart(2, '0');
    console.log(
      `Step 6.${number}: ${commandText('git', [
        '-C',
        paths.target,
        'worktree',
        'add',
        `.claude-worktrees/loadtest-${number}`,
        '-b',
        `loadtest/${number}`,
      ])}`,
    );
  }

  if (options.dryRun) {
    printManualProcedure();
    return;
  }

  const cloneResult = await run('git', cloneArgs);
  if (cloneResult.code !== 0) {
    if (await exists(paths.target)) {
      assertTargetIsNotLink(paths.target, { requireExisting: true });
      await rm(paths.target, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 500,
      });
    }
    childFailure('git clone', cloneResult);
  }

  let markerWritten = false;
  try {
    assertTargetIsNotLink(paths.target, { requireExisting: true });
    resolveLoadtestPaths({ source: paths.source, target: paths.target });
    try {
      await writeMarker(paths.target, {
        source: paths.source,
        createdAt: new Date().toISOString(),
        worktrees: options.worktrees,
      });
    } catch (error) {
      assertTargetIsNotLink(paths.target, { requireExisting: true });
      await rm(paths.target, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 500,
      });
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `write marker failed; unmarked clone removed: ${message}`,
      );
    }
    markerWritten = true;

    const remoteResult = await run('git', [
      '-C',
      paths.target,
      'remote',
      'remove',
      'origin',
    ]);
    if (remoteResult.code !== 0) {
      childFailure('remove origin remote', remoteResult, {
        markerWritten: true,
      });
    }

    if (!options.skipInstall) {
      const npmResult = await run(
        process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['ci'],
        {
          cwd: paths.target,
        },
      );
      if (npmResult.code !== 0) {
        childFailure('npm ci', npmResult, { markerWritten: true });
      }
    }

    for (let index = 1; index <= options.worktrees; index += 1) {
      const number = String(index).padStart(2, '0');
      const worktreeResult = await run('git', [
        '-C',
        paths.target,
        'worktree',
        'add',
        `.claude-worktrees/loadtest-${number}`,
        '-b',
        `loadtest/${number}`,
      ]);
      if (worktreeResult.code !== 0) {
        childFailure(`add worktree loadtest-${number}`, worktreeResult, {
          markerWritten: true,
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (markerWritten && !message.includes('run cleanup --execute')) {
      throw new Error(`${message}; run cleanup --execute`);
    }
    throw error;
  }

  printManualProcedure();
}

main().catch((error) => {
  const exitCode =
    error !== null && typeof error === 'object' && 'exitCode' in error
      ? error.exitCode
      : 1;
  console.error(error instanceof Error ? error.message : String(error));
  if (exitCode === 2) console.error(USAGE);
  process.exitCode = exitCode;
});
