/**
 * Guards every ESM bundle `apps/ptah-extension-vscode` produces.
 *
 * TASK_2026_383 Batch 4, Revision 1. This file used to live only inside
 * `apps/ptah-electron/src/config/esm-bundle-gate.spec.ts`, which scanned all
 * FOUR ESM-producing apps (`ptah-electron`, `ptah-cli`,
 * `ptah-extension-vscode`, `ptah-tui`) from inside ONE project's test
 * target. That broke CI: `nx affected -t build` only builds the projects
 * Nx's affected-graph selects, so a PR touching only `ptah-electron` left
 * this app's bundle missing, and `build-artifact-gate.ts`'s fail-not-skip
 * policy (Task 4.2) turned that absence into a hard CI failure on a host the
 * PR never touched (code-logic-review.md Batch 4, Blocking FM-1). Revision 1
 * splits the gate per app -- this file checks ONLY
 * `apps/ptah-extension-vscode/project.json`'s own ESM target, and this
 * app's `test` target now `dependsOn` that same target (see
 * `project.json`), so `nx affected -t test` for `ptah-extension-vscode`
 * guarantees its OWN bundle exists regardless of whether the other three
 * hosts are affected. Each of the three sibling apps carries its own
 * `esm-bundle-gate.spec.ts` with the same shape, scanning only its own
 * `project.json`.
 *
 * This app declares exactly one ESM target (`build-esbuild` → `main.mjs`)
 * and no worker-shaped targets, so the "executable self-test" family from
 * the electron/cli siblings degenerates to an empty, but still asserted,
 * set -- if a `build-*-worker` target is ever added here, the anti-vacuity
 * check below fails loudly rather than silently skipping it.
 *
 * Two families of assertion, both scoped to THIS app:
 *
 *   1. DISCOVERY + ANTI-VACUITY -- `apps/ptah-extension-vscode/project.json`
 *      is scanned for `@nx/esbuild:esbuild` targets with `options.format ===
 *      ['esm']`. The discovered set must contain the one known target by
 *      name (`EXPECTED_ESM_TARGETS`), so a rename shrinks the suite's
 *      COVERAGE rather than just its count.
 *   2. CONDITIONAL require invariant -- built-artifact only (gated by
 *      `build-artifact-gate.ts`): a bundle with no `Dynamic require of` shim
 *      needs no banner and passes trivially; a bundle that DOES emit the
 *      shim must define a real `require` (via
 *      `createRequire(import.meta.url)`) at a lower index. This target has
 *      no `better-sqlite3` external declared, so the shim is not expected to
 *      appear, but the check still runs unconditionally against whatever the
 *      built bundle actually contains.
 *
 * Sits at the top of `src/` beside `main.ts` and the app's other top-level
 * spec, `deactivate-order.spec.ts` -- this app's own existing precedent for
 * a top-level, non-nested spec (it has no `config`/`test-utils` directory
 * the way `ptah-electron` and `ptah-cli` do).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describeIfBuiltOrFail } from './build-artifact-gate';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const PROJECT_JSON_PATH = join(
  REPO_ROOT,
  'apps',
  'ptah-extension-vscode',
  'project.json',
);

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

/** The one ESM target `apps/ptah-extension-vscode` is known to declare. */
const EXPECTED_ESM_TARGETS = ['build-esbuild'] as const;

const projectConfig = loadProjectConfig();
const discoveredTargets = discoverEsmTargets(projectConfig);

describe('ptah-extension-vscode ESM bundle discovery (anti-vacuity)', () => {
  it('discovers at least the one known ESM esbuild target', () => {
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
      `nx run ptah-extension-vscode:${target.targetName}`,
    );

    describeBundle('built artifact', () => {
      it('defines require via createRequire before any dynamic-require shim can run', () => {
        const bundle = readFileSync(target.bundlePath, 'utf8');
        expect(bundle.length).toBeGreaterThan(0);

        const shimAt = bundle.indexOf('Dynamic require of');
        if (shimAt < 0) {
          // No dynamic-require shim was emitted -- nothing to require a real
          // `require` for.
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
// Worker-shaped target coverage (anti-vacuity) — this app declares none
// today. The check still runs so a future `build-*-worker` target here
// cannot silently bypass the executable-self-test family the electron/cli
// siblings enforce for their own worker targets (code-style-review.md
// minor).
// ---------------------------------------------------------------------------

const WORKER_TARGET_SUFFIX = /-worker$/;

/** No worker-shaped targets declared by this app today. */
const WORKER_ENTRY_GUARDS: Record<string, string> = {};

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
