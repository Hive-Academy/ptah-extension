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
 * Contract: AST / tree-sitter parsing is NEVER exercised in VS Code
 * extension unit tests.
 */

const SENTINEL = '<test-stub-no-wasm>';

export const BUNDLE_DIR: string = SENTINEL;

export function resolveWasmPath(filename: string): string {
  throw new Error(
    `[wasm-bundle-dir mock] VS Code extension unit tests must not exercise ` +
      `tree-sitter; attempted to resolve "${filename}".`,
  );
}
