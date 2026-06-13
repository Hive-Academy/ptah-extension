const SENTINEL = '<test-stub-no-wasm>';

export const BUNDLE_DIR: string = SENTINEL;

export function resolveWasmPath(filename: string): string {
  throw new Error(
    `[wasm-bundle-dir mock] TUI unit tests must not exercise tree-sitter; ` +
      `attempted to resolve "${filename}". If this code path is needed, ` +
      `jest.mock('./wasm-bundle-dir') per-test with a real fixture path or ` +
      `move the test to libs/backend/workspace-intelligence.`,
  );
}
