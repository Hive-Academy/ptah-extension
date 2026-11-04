const SENTINEL = '<test-stub-no-wasm>';

export const BUNDLE_DIR: string = SENTINEL;

/**
 * `workspace-intelligence`'s real `wasm-bundle-dir` uses `import.meta.url`,
 * which CommonJS ts-jest cannot parse. thoth-runtime only reaches that barrel
 * for the `CODE_SYMBOL_INDEXER` token, never for tree-sitter itself, so the
 * module is stubbed out here.
 */
export function resolveWasmPath(filename: string): string {
  throw new Error(
    `[wasm-bundle-dir mock] thoth-runtime unit tests must not exercise ` +
      `tree-sitter; attempted to resolve "${filename}". Move any test that ` +
      `needs it to libs/backend/workspace-intelligence.`,
  );
}
