/**
 * CJS test stub for `wasm-bundle-dir.ts` — the real module uses `import.meta`
 * which Jest's CJS loader cannot parse. Tests that pull in the workspace-
 * intelligence transitive graph (via `CliDIContainer` etc.) get this stub
 * via `moduleNameMapper`. Tree-sitter parsing is never exercised in CLI
 * unit tests, so a placeholder bundle dir is sufficient.
 */

import * as path from 'path';

export const BUNDLE_DIR: string = __dirname;

export function resolveWasmPath(filename: string): string {
  return path.join(BUNDLE_DIR, 'wasm', filename);
}
