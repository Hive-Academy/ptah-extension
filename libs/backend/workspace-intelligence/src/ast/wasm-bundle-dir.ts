/**
 * Resolves the directory containing the bundled WASM files at runtime.
 *
 * Isolated into its own module because `import.meta.url` cannot be parsed by
 * Node's CJS loader (Jest's default). Tests that load the TreeSitterParser
 * service can `jest.mock('./wasm-bundle-dir')` to supply a stub `BUNDLE_DIR`
 * without triggering the ESM-only access path.
 *
 * In the final ESM bundle, esbuild's banner injects:
 *   `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`
 * which makes `import.meta.url` available at module scope. TypeScript rejects
 * it during library compilation (CJS target) with TS1470, so we suppress with
 * `@ts-ignore`. The try/catch around the access is defensive -- in true CJS
 * runtime (not Jest, which fails at parse), `import.meta` would be undefined
 * and fall through to `__dirname`.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';

function resolveBundleDir(): string {
  try {
    // In the ESM bundle, esbuild's banner provides `import.meta.url`.
    // In CJS tests, this module is mocked, so this branch is never evaluated.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore TS1470: import.meta not allowed in CJS output. Safe: the final ESM bundle provides it.
    const metaUrl: string | undefined = import.meta?.url;
    if (metaUrl) {
      return path.dirname(fileURLToPath(metaUrl));
    }
  } catch {
    // Fall through to __dirname fallback below.
  }
  return __dirname;
}

export const BUNDLE_DIR: string = resolveBundleDir();

export function resolveWasmPath(filename: string): string {
  return path.join(BUNDLE_DIR, 'wasm', filename);
}
