/**
 * SDK Resolver - Dynamic import wrapper for bundled SDK packages
 *
 * With esbuild bundling (TASK_2025_232), SDK packages (@github/copilot-sdk,
 * @openai/codex-sdk) are resolved at bundle time and inlined into main.mjs.
 * The dynamic import() call returns the bundled module directly.
 *
 * This module retains the resolveAndImportSdk() function signature for API
 * compatibility with existing callers (copilot-sdk.adapter.ts, codex-cli.adapter.ts).
 */

/**
 * Import an SDK package. With esbuild bundling, the package is resolved
 * at bundle time and the dynamic import() returns the bundled module.
 *
 * The cliBinaryPath parameter is retained for API compatibility but unused
 * since SDKs are now bundled into main.mjs.
 *
 * @param packageName - npm package name (e.g., '@github/copilot-sdk')
 * @param _cliBinaryPath - Unused (retained for API compatibility)
 * @returns The loaded module
 */
export async function resolveAndImportSdk<T>(
  packageName: string,
  _cliBinaryPath?: string,
): Promise<T> {
  return (await import(packageName)) as T;
}
