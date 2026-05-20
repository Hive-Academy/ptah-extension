/**
 * Project-scoped CJS test stub for
 * `libs/backend/workspace-intelligence/src/ast/wasm-bundle-dir.ts`.
 *
 * The real module uses `import.meta.url`, which Jest's CJS loader cannot
 * parse. The DI smoke test in `src/di/container.smoke.spec.ts` imports from
 * `@ptah-extension/rpc-handlers`, which transitively pulls
 * `workspace-intelligence` and drags this module along, so we substitute it
 * via `moduleNameMapper` in `jest.config.ts`.
 *
 * Contract: AST / tree-sitter parsing is NEVER exercised in Electron unit
 * tests. If a future spec accidentally drives a code path that calls
 * `resolveWasmPath`, the runtime guard below fails loudly so the test surface
 * stays honest.
 */

const SENTINEL = '<test-stub-no-wasm>';

export const BUNDLE_DIR: string = SENTINEL;

export function resolveWasmPath(filename: string): string {
  throw new Error(
    `[wasm-bundle-dir mock] Electron unit tests must not exercise ` +
      `tree-sitter; attempted to resolve "${filename}". If this code path ` +
      `is needed, jest.mock('./wasm-bundle-dir') per-test with a real ` +
      `fixture path or move the test to libs/backend/workspace-intelligence.`,
  );
}
