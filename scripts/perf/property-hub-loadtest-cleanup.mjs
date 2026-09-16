#!/usr/bin/env node

/**
 * Removes a property-hub load-test clone only after validating its marker,
 * real path, junction-free target chain, and registered worktrees.
 *
 * Usage: node property-hub-loadtest-cleanup.mjs --dry-run [--target PATH]
 */

import path from 'node:path';
import { rm } from 'node:fs/promises';

import {
  assertTargetIsNotLink,
  childFailure,
  comparable,
  isStrictlyWithin,
  readMarker,
  resolveLoadtestPaths,
  run,
} from './property-hub-loadtest-paths.mjs';

const USAGE = `Usage: node property-hub-loadtest-cleanup.mjs (--dry-run | --execute) [--target PATH]`;

function usageError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  throw error;
}

function parseArgs(args) {
  const options = { dryRun: false, execute: false, target: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--execute') {
      options.execute = true;
    } else if (arg === '--target') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        usageError('--target requires a value');
      }
      options.target = value;
      index += 1;
    } else {
      usageError(`unknown argument: ${arg}`);
    }
  }
  if (options.dryRun === options.execute) {
    usageError('exactly one of --dry-run or --execute is required');
  }
  return options;
}

function parseWorktrees(output) {
  return output
    .split(/\r?\n\r?\n/)
    .map((block) => block.match(/^worktree (.+)$/m)?.[1])
    .filter((value) => value !== undefined)
    .map((value) => path.resolve(value));
}

async function main() {
  const startedAt = Date.now();
  const options = parseArgs(process.argv.slice(2));
  const requestedTarget = options.target ?? 'D:/projects/property-hub-loadtest';
  assertTargetIsNotLink(requestedTarget);
  // Provisional only: the marker supplies the source for the authoritative guard below.
  const initial = resolveLoadtestPaths({ target: options.target });
  const marker = await readMarker(initial.target);
  if (marker === null) {
    throw new Error(`not a load-test clone: ${initial.target}`);
  }

  const paths = resolveLoadtestPaths({
    source: marker.source,
    target: initial.target,
  });
  console.log(`Mode: ${options.dryRun ? 'dry-run' : 'execute'}`);
  console.log(`Target: ${paths.target}`);
  console.log(`Marker: source=${marker.source}, worktrees=${marker.worktrees}`);

  if (options.dryRun) {
    console.log(`Step 1: git -C ${paths.target} worktree list --porcelain`);
    console.log(
      'Step 2: remove every registered non-main worktree inside the target',
    );
    console.log(`Step 3: git -C ${paths.target} worktree prune`);
    console.log(`Step 4: remove marked target ${paths.target}`);
    console.log(`Dry run complete in ${Date.now() - startedAt} ms`);
    return;
  }

  const listResult = await run(
    'git',
    ['-C', paths.target, 'worktree', 'list', '--porcelain'],
    { capture: true },
  );
  if (listResult.code !== 0) childFailure('list worktrees', listResult);

  const worktrees = parseWorktrees(listResult.stdout);
  if (
    !worktrees.some(
      (worktree) => comparable(worktree) === comparable(paths.target),
    )
  ) {
    throw new Error(
      'refusing cleanup: target is not the main registered worktree',
    );
  }

  const linkedWorktrees = worktrees.filter(
    (worktree) => comparable(worktree) !== comparable(paths.target),
  );
  for (const worktree of linkedWorktrees) {
    assertTargetIsNotLink(worktree);
    if (!isStrictlyWithin(worktree, paths.target)) {
      throw new Error(
        `refusing cleanup: registered worktree is outside target: ${worktree}`,
      );
    }
  }

  for (const worktree of linkedWorktrees) {
    const removeResult = await run('git', [
      '-C',
      paths.target,
      'worktree',
      'remove',
      '--force',
      worktree,
    ]);
    if (removeResult.code !== 0) {
      childFailure(`remove worktree ${worktree}`, removeResult);
    }
  }

  const pruneResult = await run('git', [
    '-C',
    paths.target,
    'worktree',
    'prune',
  ]);
  if (pruneResult.code !== 0) {
    childFailure('prune worktrees', pruneResult);
  }

  assertTargetIsNotLink(paths.target, { requireExisting: true });
  const deletionPaths = resolveLoadtestPaths({
    source: marker.source,
    target: paths.target,
  });
  await rm(deletionPaths.target, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 500,
  });
  console.log(`Cleanup complete in ${Date.now() - startedAt} ms`);
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
