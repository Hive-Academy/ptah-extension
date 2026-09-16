#!/usr/bin/env node

/**
 * Shared safety boundary for the property-hub load-test setup and cleanup tools.
 * Resolves lexical and real paths, rejects link-based targets, owns marker I/O,
 * and provides the dependency-free child-process helpers used by both CLIs.
 *
 * Usage: node property-hub-loadtest-paths.mjs --self-test
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = '.git/ptah-loadtest-clone.json';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PTAH_REPO = path.resolve(path.dirname(SCRIPT_PATH), '..', '..');
const PTAH_REPO_REAL = realpathSync.native(PTAH_REPO);

export function comparable(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isWithinOrEqual(candidate, parent) {
  const relative = path.relative(comparable(parent), comparable(candidate));
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function refuse(message) {
  throw new Error(message);
}

function errorCode(error) {
  return error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : error instanceof SyntaxError
      ? 'INVALID_JSON'
      : 'UNKNOWN';
}

function lstatIfPresent(value) {
  try {
    return lstatSync(value);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return null;
    }
    refuse(`refusing target: cannot inspect path (${code}): ${value}`);
  }
}

export function assertTargetIsNotLink(
  target,
  { requireExisting = false } = {},
) {
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  const components = path
    .relative(root, resolved)
    .split(path.sep)
    .filter(Boolean);
  let current = root;
  let targetExists = components.length === 0;

  for (const component of components) {
    current = path.join(current, component);
    const stats = lstatIfPresent(current);
    if (stats === null) {
      targetExists = false;
      break;
    }
    if (stats.isSymbolicLink()) {
      refuse(
        `refusing target: target path contains a symlink or junction: ${current}`,
      );
    }
    targetExists = comparable(current) === comparable(resolved);
  }

  if (requireExisting && !targetExists) {
    refuse(`refusing target: target does not exist: ${resolved}`);
  }
  return resolved;
}

function realPathFromNearestExisting(value) {
  const resolved = path.resolve(value);
  const missing = [];
  let cursor = resolved;

  while (true) {
    const stats = lstatIfPresent(cursor);
    if (stats !== null) {
      try {
        const realAncestor = realpathSync.native(cursor);
        return path.resolve(realAncestor, ...missing);
      } catch (error) {
        refuse(
          `refusing target: cannot resolve real path (${errorCode(error)}): ${cursor}`,
        );
      }
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      refuse(`refusing target: no existing ancestor for path: ${resolved}`);
    }
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
}

export function isStrictlyWithin(candidate, parent) {
  const relative = path.relative(comparable(parent), comparable(candidate));
  return (
    relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
  );
}

export function run(command, args, { cwd, capture = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    if (capture) {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
    }
    child.on('error', (error) =>
      resolve({ code: null, stdout, stderr, spawnError: error }),
    );
    child.on('close', (code) =>
      resolve({ code: code ?? 1, stdout, stderr, spawnError: null }),
    );
  });
}

export function childFailure(step, result, { markerWritten = false } = {}) {
  const cleanup = markerWritten ? '; run cleanup --execute' : '';
  const exit =
    result.code === null
      ? `unavailable (spawn error: ${result.spawnError instanceof Error ? result.spawnError.message : String(result.spawnError)})`
      : result.code;
  throw new Error(`${step} failed with child exit code ${exit}${cleanup}`);
}

export function resolveLoadtestPaths({
  source = 'D:/projects/property-hub',
  target = 'D:/projects/property-hub-loadtest',
} = {}) {
  const resolvedSource = path.resolve(source);
  const resolvedTarget = path.resolve(target);
  assertTargetIsNotLink(resolvedTarget);
  const realSource = realPathFromNearestExisting(resolvedSource);
  const realTarget = realPathFromNearestExisting(resolvedTarget);
  const sourceKey = comparable(realSource);
  const targetKey = comparable(realTarget);
  const targetRoot = path.parse(realTarget).root;

  if (sourceKey === targetKey) {
    refuse('refusing target: target equals source');
  }
  if (targetKey === comparable(targetRoot)) {
    refuse('refusing target: target is a filesystem root');
  }
  if (
    isWithinOrEqual(realTarget, realSource) ||
    isWithinOrEqual(realSource, realTarget)
  ) {
    refuse('refusing target: source and target must not contain one another');
  }
  if (
    isWithinOrEqual(realTarget, PTAH_REPO_REAL) ||
    isWithinOrEqual(PTAH_REPO_REAL, realTarget)
  ) {
    refuse(
      'refusing target: target must not be inside or contain the Ptah repo',
    );
  }

  const basename = path.basename(resolvedTarget);
  const suffixMatches =
    process.platform === 'win32'
      ? basename.toLowerCase().endsWith('-loadtest')
      : basename.endsWith('-loadtest');
  if (!suffixMatches) {
    refuse('refusing target: target basename must end in -loadtest');
  }

  return {
    source: realSource,
    target: realTarget,
    ptahRepo: PTAH_REPO_REAL,
  };
}

export async function writeMarker(target, marker) {
  await writeFile(
    path.join(target, MARKER),
    `${JSON.stringify(marker, null, 2)}\n`,
    'utf8',
  );
}

function isIsoDate(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

export async function readMarker(target) {
  try {
    const value = JSON.parse(await readFile(path.join(target, MARKER), 'utf8'));
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof value.source !== 'string' ||
      !isIsoDate(value.createdAt) ||
      !Number.isInteger(value.worktrees)
    ) {
      console.error(
        `marker validation failed (INVALID_SHAPE): ${path.join(target, MARKER)}`,
      );
      return null;
    }
    return {
      source: value.source,
      createdAt: value.createdAt,
      worktrees: value.worktrees,
    };
  } catch (error) {
    // All normal filesystem and parse failures collapse to null by contract.
    if (error instanceof Error) {
      console.error(
        `marker read failed (${errorCode(error)}): ${path.join(target, MARKER)}`,
      );
      return null;
    }
    throw error;
  }
}

function expectRefusal(input, message) {
  assert.throws(() => resolveLoadtestPaths(input), new RegExp(message, 'i'));
}

function runSelfTest() {
  const source = path.resolve(
    path.parse(PTAH_REPO).root,
    'tmp',
    'property-hub',
  );
  const validTarget = path.resolve(
    path.parse(PTAH_REPO).root,
    'tmp',
    'property-hub-loadtest',
  );

  assert.equal(
    resolveLoadtestPaths({ source, target: validTarget }).target,
    validTarget,
  );
  expectRefusal({ source, target: `${source}${path.sep}` }, 'equals source');
  expectRefusal(
    { source, target: path.join(source, 'nested-loadtest') },
    'contain one another',
  );
  expectRefusal(
    { source: path.join(validTarget, 'nested-source'), target: validTarget },
    'contain one another',
  );
  expectRefusal(
    {
      source,
      target: path.resolve(path.parse(PTAH_REPO).root, 'tmp', 'wrong-name'),
    },
    'must end in -loadtest',
  );
  expectRefusal(
    { source, target: path.join(PTAH_REPO, 'unsafe-loadtest') },
    'Ptah repo',
  );
  expectRefusal({ source, target: PTAH_REPO }, 'Ptah repo');
  expectRefusal({ source, target: path.dirname(PTAH_REPO) }, 'Ptah repo');
  expectRefusal(
    { source, target: path.parse(PTAH_REPO).root },
    'filesystem root',
  );

  if (process.platform === 'win32') {
    const upperSource = source.toUpperCase();
    expectRefusal(
      { source, target: `${upperSource}${path.sep}` },
      'equals source',
    );
    assert.equal(
      comparable(
        resolveLoadtestPaths({ source, target: validTarget.toUpperCase() })
          .target,
      ),
      comparable(validTarget.toUpperCase()),
    );
  }

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'ptah-loadtest-paths-'));
  const standInRepo = path.join(tempRoot, 'stand-in-repo');
  const junction = path.join(tempRoot, 'junction-loadtest');
  mkdirSync(standInRepo);
  try {
    symlinkSync(
      standInRepo,
      junction,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expectRefusal(
      { source: path.join(tempRoot, 'source-repo'), target: junction },
      'symlink or junction',
    );
    expectRefusal(
      {
        source: path.join(tempRoot, 'source-repo'),
        target: path.join(junction, 'nested-loadtest'),
      },
      'symlink or junction',
    );
    console.log('self-test junction refusal OK');
  } finally {
    const junctionStats = lstatIfPresent(junction);
    if (junctionStats !== null) {
      assert.equal(
        junctionStats.isSymbolicLink(),
        true,
        'temporary link changed type',
      );
      rmSync(junction, { force: true });
    }
    assert.equal(
      lstatIfPresent(junction),
      null,
      'temporary junction still exists',
    );
    console.log('self-test junction cleanup OK');
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log('self-test OK');
}

const isDirectRun =
  process.argv[1] !== undefined &&
  comparable(process.argv[1]) === comparable(SCRIPT_PATH);

if (isDirectRun) {
  if (process.argv.length === 3 && process.argv[2] === '--self-test') {
    try {
      runSelfTest();
    } catch (error) {
      console.error(
        `self-test FAILED: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    }
  } else {
    console.error(`Usage: node ${path.basename(SCRIPT_PATH)} --self-test`);
    process.exitCode = 2;
  }
}
