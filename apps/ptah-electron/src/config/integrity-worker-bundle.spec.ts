/**
 * Guards the one thing that makes the out-of-process database integrity check
 * able to run at all: a real `require` inside its ESM bundle.
 *
 * `integrity-worker.ts` loads its native dependency with a plain
 * `require('better-sqlite3')` (integrity-worker.ts:123) because `better-sqlite3`
 * is a CommonJS native addon that must stay `external`. But `external` only
 * tells esbuild not to inline the package -- it does NOT make a bare `require`
 * call work in an `"format": ["esm"]` output. esbuild rewrites every `require`
 * it cannot statically resolve into a shim that reads:
 *
 *     throw Error('Dynamic require of "' + x + '" is not supported');
 *
 * ...unless a real `require` is in scope, which the shim probes for
 * (`typeof require !== "undefined"`). `build-main` gets one from the `banner`
 * block in apps/ptah-electron/esbuild.config.cjs, and `apps/ptah-cli`'s
 * `build-esbuild` gets one from an inline `esbuildOptions.banner`.
 * `build-integrity-worker` originally had neither, in BOTH hosts.
 *
 * The effect was silent and total (TASK_2026_380, finding F-1): the worker threw
 * on its first line of real work, `SqliteIntegrityService.record()` correctly
 * treated the resulting `'unavailable'` verdict as inconclusive and wrote no
 * record, so `isDue()` stayed true forever and the corruption canary never ran
 * once -- while every log line stayed at `warn` level and nothing surfaced to
 * the user.
 *
 * These specs pin the banner in both project.json files (always) and the built
 * artifact when one is present (skipped otherwise, so a clean checkout with no
 * `dist/` still runs the suite).
 *
 * This lives beside packaged-deps.spec.ts because that is where this app
 * already asserts against its own `project.json` build wiring.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

const TARGET = 'build-integrity-worker';

/** Both hosts build the SAME worker source and need the SAME banner. */
const HOSTS = [
  {
    name: 'ptah-electron',
    projectJson: join(REPO_ROOT, 'apps', 'ptah-electron', 'project.json'),
    bundle: join(
      REPO_ROOT,
      'dist',
      'apps',
      'ptah-electron',
      'integrity-worker.mjs',
    ),
  },
  {
    name: 'ptah-cli',
    projectJson: join(REPO_ROOT, 'apps', 'ptah-cli', 'project.json'),
    bundle: join(REPO_ROOT, 'dist', 'apps', 'ptah-cli', 'integrity-worker.mjs'),
  },
] as const;

interface NxProjectConfig {
  targets?: Record<
    string,
    {
      options?: {
        format?: string[];
        external?: string[];
        esbuildConfig?: string;
        esbuildOptions?: { banner?: { js?: string } };
      };
    }
  >;
}

function targetOptions(projectJsonPath: string) {
  const config = JSON.parse(
    readFileSync(projectJsonPath, 'utf8'),
  ) as NxProjectConfig;
  return config.targets?.[TARGET]?.options;
}

describe.each(HOSTS)('$name integrity worker bundle', (host) => {
  const options = targetOptions(host.projectJson);

  // Anti-vacuity: every assertion below reads this object, and a renamed or
  // deleted target would otherwise make them all pass against `undefined`.
  it('anti-vacuity: the build target exists and still emits ESM with better-sqlite3 external', () => {
    expect(options).toBeDefined();
    expect(options?.format).toEqual(['esm']);
    expect(options?.external).toContain('better-sqlite3');
  });

  it('injects a real createRequire so the CJS native addon can be required', () => {
    // Either idiom is acceptable: an inline banner (the apps/ptah-cli
    // precedent) or a shared esbuildConfig file (the build-main precedent).
    const banner = options?.esbuildOptions?.banner?.js;
    const bannerSource =
      banner ??
      (options?.esbuildConfig
        ? readFileSync(join(REPO_ROOT, options.esbuildConfig), 'utf8')
        : '');

    expect(bannerSource).toContain('createRequire');
    expect(bannerSource).toContain('import.meta.url');
  });

  const describeBundle = existsSync(host.bundle) ? describe : describe.skip;

  describeBundle('built artifact', () => {
    const bundle = existsSync(host.bundle)
      ? readFileSync(host.bundle, 'utf8')
      : '';

    it('anti-vacuity: the bundle is non-empty and is the integrity worker', () => {
      expect(bundle.length).toBeGreaterThan(0);
      expect(bundle).toContain('better-sqlite3');
    });

    it('defines require via createRequire before any dynamic-require shim can run', () => {
      const createRequireAt = bundle.indexOf('createRequire(import.meta.url)');
      expect(createRequireAt).toBeGreaterThanOrEqual(0);

      // The shim itself may still be emitted -- it is harmless once a real
      // `require` is in scope, because it delegates to it. What must never
      // happen is the shim being reachable BEFORE the banner defines one.
      const shimAt = bundle.indexOf('Dynamic require of');
      if (shimAt >= 0) {
        expect(createRequireAt).toBeLessThan(shimAt);
      }
    });
  });
});
