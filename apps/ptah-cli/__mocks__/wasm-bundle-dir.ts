/**
 * Project-scoped CJS test stub for
 * `libs/backend/workspace-intelligence/src/ast/wasm-bundle-dir.ts`.
 *
 * The real module uses `import.meta.url`, which Jest's CJS loader cannot
 * parse. The static `CliDIContainer` import in `with-engine.ts` pulls in the
 * workspace-intelligence transitive graph, dragging this module along, so we
 * substitute it via `moduleNameMapper` in `apps/ptah-cli/jest.config.cjs`.
 *
 * Contract: AST / tree-sitter parsing is NEVER exercised in CLI unit tests.
 * If a future spec accidentally drives a code path that calls
 * `resolveWasmPath`, the runtime guard below fails loudly so the test surface
 * stays honest — callers must either (a) jest.mock this module per-test with
 * a real fixture path, or (b) move the test to a project where tree-sitter
 * runs for real (e.g. workspace-intelligence's own jest config).
 *
 * Lives under `apps/ptah-cli/__mocks__/` (not the repo root) so jest's
 * default `roots` resolution scopes the override to this project and there
 * is no risk of cross-project bleed.
 */

const SENTINEL = '<test-stub-no-wasm>';

/**
 * Sentinel string deliberately chosen to be invalid as a filesystem path so
 * any accidental use as a directory surfaces as a missing-file error rather
 * than silently succeeding against the repo root.
 */
export const BUNDLE_DIR: string = SENTINEL;

/**
 * Throws on access. CLI unit tests must not exercise tree-sitter; if they
 * do, this fails the test with a clear message instead of producing a
 * misleading "ENOENT in repo root" error.
 */
export function resolveWasmPath(filename: string): string {
  throw new Error(
    `[wasm-bundle-dir mock] CLI unit tests must not exercise tree-sitter; ` +
      `attempted to resolve "${filename}". If this code path is needed, ` +
      `jest.mock('./wasm-bundle-dir') per-test with a real fixture path or ` +
      `move the test to libs/backend/workspace-intelligence.`,
  );
}
