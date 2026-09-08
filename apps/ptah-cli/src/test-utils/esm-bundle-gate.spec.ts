/**
 * Guards every ESM bundle `apps/ptah-cli` produces.
 *
 * TASK_2026_383 Batch 4, Revision 1. This file used to live only inside
 * `apps/ptah-electron/src/config/esm-bundle-gate.spec.ts`, which scanned all
 * FOUR ESM-producing apps (`ptah-electron`, `ptah-cli`,
 * `ptah-extension-vscode`, `ptah-tui`) from inside ONE project's test
 * target. That broke CI: `nx affected -t build` only builds the projects
 * Nx's affected-graph selects, so a PR touching only `ptah-electron` left
 * this app's bundles missing, and `build-artifact-gate.ts`'s fail-not-skip
 * policy (Task 4.2) turned that absence into a hard CI failure on a host the
 * PR never touched (code-logic-review.md Batch 4, Blocking FM-1). Revision 1
 * splits the gate per app -- this file checks ONLY
 * `apps/ptah-cli/project.json`'s own ESM targets, and this app's `test`
 * target now `dependsOn` those same targets (see `project.json`), so
 * `nx affected -t test` for `ptah-cli` guarantees its OWN bundles exist
 * regardless of whether the other three hosts are affected. Each of the
 * three sibling apps carries its own `esm-bundle-gate.spec.ts` with the same
 * shape, scanning only its own `project.json`.
 *
 * `integrity-worker.ts` loads its native dependency with a plain
 * `require('better-sqlite3')` because `better-sqlite3` is a CommonJS native
 * addon that must stay `external`. But `external` only tells esbuild not to
 * inline the package -- it does NOT make a bare `require` call work in an
 * `"format": ["esm"]` output. esbuild rewrites every `require` it cannot
 * statically resolve into a shim that throws:
 *
 *     throw Error('Dynamic require of "' + x + '" is not supported');
 *
 * ...unless a real `require` is in scope, which the shim probes for. The
 * effect was silent and total (TASK_2026_380, finding F-1): the worker threw
 * on its first line of real work and nothing surfaced to the user.
 *
 * Three families of assertion, all scoped to THIS app (no worker-wiring
 * family -- `apps/ptah-cli/CLAUDE.md` has no "three-place rule" the way
 * `apps/ptah-electron` does):
 *
 *   1. DISCOVERY + ANTI-VACUITY -- `apps/ptah-cli/project.json` is scanned
 *      for `@nx/esbuild:esbuild` targets with `options.format === ['esm']`.
 *      The discovered set must contain the three known targets by name
 *      (`EXPECTED_ESM_TARGETS`), so a rename shrinks the suite's COVERAGE
 *      rather than just its count.
 *   2. CONDITIONAL require invariant -- built-artifact only (gated by
 *      `build-artifact-gate.ts`): a bundle with no `Dynamic require of` shim
 *      needs no banner and passes trivially (`embedder-worker.mjs` emits no
 *      shim); a bundle that DOES emit the shim must define a real `require`
 *      (via `createRequire(import.meta.url)`) at a lower index.
 *   3. EXECUTABLE self-test -- every discovered target whose NAME ends in
 *      `-worker` is spawned bare under `node --input-type=module` with a
 *      bounded, PID-scoped timeout, and must fail with ONLY its own entry
 *      guard. `WORKER_ENTRY_GUARDS` is tied to discovery by an anti-vacuity
 *      assertion (Revision 1: code-style-review.md minor -- the original
 *      `WORKER_BUNDLES` literal had no such tie, so a new worker target
 *      would pass discovery and the conditional-require check while
 *      silently never being spawned bare). `build-esbuild` (`main.mjs`) is a
 *      real entry point, not a worker -- it has no "run standalone and fail
 *      fast" contract, and its name does not match the `-worker` suffix, so
 *      it is correctly excluded from this family.
 *
 * Lives beside `agent-sdk-mock.ts` because `test-utils/` is this app's
 * existing support-style location for non-production test code.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { describeIfBuiltOrFail } from './build-artifact-gate';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const PROJECT_JSON_PATH = join(REPO_ROOT, 'apps', 'ptah-cli', 'project.json');

interface EsbuildTargetOptions {
  format?: string[];
  external?: string[];
  outputPath?: string;
  outputFileName?: string;
  esbuildConfig?: string;
  esbuildOptions?: { banner?: { js?: string } };
}

interface NxProjectConfig {
  targets?: Record<
    string,
    {
      executor?: string;
      options?: EsbuildTargetOptions;
    }
  >;
}

function loadProjectConfig(): NxProjectConfig {
  return JSON.parse(readFileSync(PROJECT_JSON_PATH, 'utf8')) as NxProjectConfig;
}

interface DiscoveredTarget {
  targetName: string;
  options: EsbuildTargetOptions;
  bundlePath: string;
}

/**
 * Discover every `@nx/esbuild:esbuild` target in THIS app's `project.json`
 * whose `options.format` is exactly `['esm']`. Anti-vacuity is enforced by
 * the caller against `EXPECTED_ESM_TARGETS`, not here -- this function
 * returning an empty map on its own is exactly the silent-shrink failure
 * mode this file exists to catch.
 */
function discoverEsmTargets(
  config: NxProjectConfig,
): Map<string, DiscoveredTarget> {
  const discovered = new Map<string, DiscoveredTarget>();

  for (const [targetName, target] of Object.entries(config.targets ?? {})) {
    const options = target.options;
    if (
      target.executor !== '@nx/esbuild:esbuild' ||
      !Array.isArray(options?.format) ||
      options.format.length !== 1 ||
      options.format[0] !== 'esm' ||
      !options.outputPath ||
      !options.outputFileName
    ) {
      continue;
    }
    discovered.set(targetName, {
      targetName,
      options,
      bundlePath: join(REPO_ROOT, options.outputPath, options.outputFileName),
    });
  }

  return discovered;
}

/** The three ESM targets `apps/ptah-cli` is known to declare. */
const EXPECTED_ESM_TARGETS = [
  'build-esbuild',
  'build-embedder-worker',
  'build-integrity-worker',
] as const;

const projectConfig = loadProjectConfig();
const discoveredTargets = discoverEsmTargets(projectConfig);

describe('ptah-cli ESM bundle discovery (anti-vacuity)', () => {
  it('discovers at least the three known ESM esbuild targets', () => {
    for (const expected of EXPECTED_ESM_TARGETS) {
      expect(discoveredTargets.has(expected)).toBe(true);
    }
  });
});

function bannerSourceOf(target: DiscoveredTarget): string {
  const banner = target.options.esbuildOptions?.banner?.js;
  if (banner) return banner;
  if (target.options.esbuildConfig) {
    return readFileSync(join(REPO_ROOT, target.options.esbuildConfig), 'utf8');
  }
  return '';
}

describe.each(EXPECTED_ESM_TARGETS)(
  '%s — conditional require invariant',
  (targetName) => {
    const target = discoveredTargets.get(targetName);

    it('anti-vacuity: the target was discovered', () => {
      expect(target).toBeDefined();
    });

    if (!target) return;

    const describeBundle = describeIfBuiltOrFail(
      target.bundlePath,
      `nx run ptah-cli:${target.targetName}`,
    );

    describeBundle('built artifact', () => {
      it('defines require via createRequire before any dynamic-require shim can run', () => {
        const bundle = readFileSync(target.bundlePath, 'utf8');
        expect(bundle.length).toBeGreaterThan(0);

        const shimAt = bundle.indexOf('Dynamic require of');
        if (shimAt < 0) {
          // No dynamic-require shim was emitted -- nothing to require a real
          // `require` for. embedder-worker.mjs lands here: it has no
          // CJS-native external and correctly passes without a banner.
          return;
        }

        const bannerSource = bannerSourceOf(target);
        expect(bannerSource).toContain('createRequire');
        expect(bannerSource).toContain('import.meta.url');

        const createRequireAt = bundle.indexOf(
          'createRequire(import.meta.url)',
        );
        expect(createRequireAt).toBeGreaterThanOrEqual(0);
        expect(createRequireAt).toBeLessThan(shimAt);
      });
    });
  },
);

// ---------------------------------------------------------------------------
// Executable self-test — worker-shaped bundles only (R-8).
//
// A discovered target counts as "worker-shaped" when its NAME ends in
// `-worker` -- a structural rule, not a hardcoded id list, so a future
// worker target is automatically subject to the tie-in anti-vacuity check
// below instead of silently bypassing it (code-style-review.md minor).
//
// integrity-worker.ts and embedder-worker.ts already fail deterministically
// when run bare: both probe for `process.parentPort` (Electron
// utilityProcess) and `node:worker_threads`' `parentPort`, and throw
// synchronously at module-evaluation time when neither is present -- no
// `--self-test` entry argument was needed for either (R-8). Both entry
// guards run before any heavy import (the ONNX work is behind a
// lazily-invoked function), so the bounded timeout below is a safety net,
// not the expected path.
// ---------------------------------------------------------------------------

const WORKER_TARGET_SUFFIX = /-worker$/;

/**
 * Hand-maintained entry-guard strings, one per worker-shaped target. Tied to
 * discovery by the anti-vacuity test immediately below: this map's key set
 * must equal the discovered worker-shaped target names exactly, so adding a
 * new `build-*-worker` target without adding its entry here FAILS loudly
 * instead of silently skipping the executable self-test.
 */
const WORKER_ENTRY_GUARDS: Record<string, string> = {
  'build-integrity-worker':
    'integrity-worker.ts must be run as a worker (no Electron parentPort and no worker_threads parentPort)',
  'build-embedder-worker':
    'embedder-worker.ts must be run as a worker (no Electron parentPort and no worker_threads parentPort)',
};

const discoveredWorkerTargetNames = [...discoveredTargets.keys()]
  .filter((name) => WORKER_TARGET_SUFFIX.test(name))
  .sort();

describe('worker-shaped target coverage (anti-vacuity)', () => {
  it('WORKER_ENTRY_GUARDS covers exactly the discovered -worker targets', () => {
    expect(Object.keys(WORKER_ENTRY_GUARDS).sort()).toEqual(
      discoveredWorkerTargetNames,
    );
  });
});

const SELF_TEST_TIMEOUT_MS = 10_000;

interface BareRunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Spawn `node --input-type=module`, feed it the built bundle's source over
 * stdin (rather than `node <path>`), and collect the outcome under a
 * bounded, PID-scoped timeout. Stdin, not a file argument, so the module is
 * evaluated as source text with no dependency on Node's extension-based ESM
 * detection -- the bundle IS the module.
 *
 * `spawn(process.execPath, ...)` is not wrapped in a try/catch: `execPath`
 * is always a valid, resolvable path to the running Node binary, so `spawn`
 * cannot throw synchronously here the way it could for a caller-supplied
 * executable path (e.g. `EMFILE` under fd exhaustion surfaces asynchronously
 * via the `'error'` event below, not as a thrown exception from `spawn`
 * itself).
 */
function runBundleBare(bundlePath: string): Promise<BareRunResult> {
  const source = readFileSync(bundlePath, 'utf8');

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        try {
          process.kill(child.pid, 'SIGKILL');
        } catch {
          // Already exited between the timer firing and the kill call.
        }
      }
    }, SELF_TEST_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error: unknown) => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });

    child.stdin.write(source);
    child.stdin.end();
  });
}

describe.each(discoveredWorkerTargetNames)(
  '%s — executable self-test',
  (targetName) => {
    const target = discoveredTargets.get(targetName);
    const entryGuard = WORKER_ENTRY_GUARDS[targetName];

    it('anti-vacuity: the target was discovered and has an entry guard', () => {
      expect(target).toBeDefined();
      expect(entryGuard).toBeDefined();
    });

    if (!target || !entryGuard) return;

    const describeBundle = describeIfBuiltOrFail(
      target.bundlePath,
      `nx run ptah-cli:${target.targetName}`,
    );

    describeBundle('spawned bare under node --input-type=module', () => {
      it(
        'fails only with its own entry guard',
        async () => {
          const result = await runBundleBare(target.bundlePath);

          expect(result.timedOut).toBe(false);
          expect(result.code).not.toBe(0);
          expect(result.stderr).toContain(entryGuard);
        },
        SELF_TEST_TIMEOUT_MS + 5_000,
      );
    });
  },
);
