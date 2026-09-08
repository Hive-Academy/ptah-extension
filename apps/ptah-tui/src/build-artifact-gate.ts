/**
 * Gates a `describe` block on a build artifact existing on disk.
 *
 * TASK_2026_383 Batch 4 (Task 4.2, Revision 1): each ESM-producing app now
 * owns its own copy of this gate and its own `esm-bundle-gate.spec.ts`
 * (Revision 1 split the original cross-host spec per app to close FM-1 --
 * a PR touching only one app's source was failing CI on the OTHER three
 * apps' unbuilt bundles). Skipping a suite gated by this helper is permitted
 * ONLY when the developer opts in with `PTAH_ALLOW_SKIP_UNBUILT=1` (local dev
 * loop without a build). Without it, a missing artifact FAILS the suite with
 * a message naming the exact build command.
 *
 * `apps/ptah-electron/src/config/build-artifact-gate.ts`,
 * `apps/ptah-cli/src/test-utils/build-artifact-gate.ts` and
 * `apps/ptah-extension-vscode/src/build-artifact-gate.ts` are
 * near-duplicates of this file. Four apps do not justify extracting a shared
 * lib for one ~25-line gate (`batches.md` Batch 4). This app has no
 * pre-existing `support`/`config`/`test-utils` directory, so this file sits
 * at the top of `src/` beside `main.tsx` -- the app's only other top-level
 * file.
 */
import { existsSync } from 'node:fs';

const SKIP_ENV_VAR = 'PTAH_ALLOW_SKIP_UNBUILT';

/**
 * Returns the `describe` function to use for a suite that depends on a build
 * artifact: the real `describe` when the artifact exists, `describe.skip`
 * when the artifact is missing AND the escape hatch is set, or a `describe`
 * wrapping a single failing test (naming `buildCommand` and the env var)
 * otherwise.
 */
export function describeIfBuiltOrFail(
  artifactPath: string,
  buildCommand: string,
): jest.Describe {
  if (existsSync(artifactPath)) {
    return describe;
  }

  if (process.env[SKIP_ENV_VAR] === '1') {
    return describe.skip;
  }

  // Jest's `Describe` type is a call signature (`(name, fn, timeout?) =>
  // void`) plus `.only`/`.skip`/`.each` properties. The closure below
  // satisfies the CALL shape exactly (that is what Jest actually invokes)
  // but is not nominally a `Describe` -- it carries none of those extra
  // properties, which nothing here calls. `as unknown as jest.Describe` is
  // a structural-vs-nominal cast, not an unsafe one; it is not `@ts-ignore`
  // because the value genuinely behaves like the type at every call site.
  return ((name: string, _fn: () => void) => {
    describe(name, () => {
      it(`requires a build -- run \`${buildCommand}\`, or set ${SKIP_ENV_VAR}=1 to skip locally`, () => {
        throw new Error(
          `${artifactPath} not found. Run \`${buildCommand}\` to build it, ` +
            `or set ${SKIP_ENV_VAR}=1 to skip this suite on an unbuilt checkout.`,
        );
      });
    });
  }) as unknown as jest.Describe;
}
