const SENTINEL = '<test-stub-no-wasm>';

export const BUNDLE_DIR: string = SENTINEL;

/**
 * `workspace-intelligence`'s real `wasm-bundle-dir` uses `import.meta.url`,
 * which CommonJS ts-jest cannot parse. `vscode-lm-tools` reaches that barrel
 * only for `TypeScriptDiagnosticsProvider` (the compiler-backed diagnostics
 * source behind `ptah_get_diagnostics`), never for tree-sitter itself, so the
 * module is stubbed out here. Mirrors
 * `libs/backend/thoth-runtime/__mocks__/wasm-bundle-dir.ts`.
 */
export function resolveWasmPath(filename: string): string {
  throw new Error(
    `[wasm-bundle-dir mock] vscode-lm-tools unit tests must not exercise ` +
      `tree-sitter; attempted to resolve "${filename}". Move any test that ` +
      `needs it to libs/backend/workspace-intelligence.`,
  );
}
