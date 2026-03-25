/**
 * SDK Runtime Resolver
 * TASK_2025_197: Resolve ESM-only SDK packages at runtime from user-installed locations.
 *
 * These SDKs (@github/copilot-sdk, @openai/codex-sdk) are NOT bundled with the
 * extension. Instead, they are discovered from the user's system at runtime:
 *
 * 1. Try bare import (standard Node.js resolution)
 * 2. Fall back to locating the package relative to the CLI binary's install location
 * 3. Throw a descriptive error with install instructions if both fail
 */
import { realpathSync, existsSync } from 'fs';
import { dirname, join, sep } from 'path';
import { pathToFileURL } from 'url';

/**
 * Dynamic import wrapper. With esbuild ESM output, native import() works directly
 * and is not transformed by the bundler. This thin wrapper keeps a single call site
 * for easier debugging and future extensibility.
 */
async function dynamicImport(specifier: string): Promise<unknown> {
  return import(specifier);
}

/**
 * Resolve and dynamically import an ESM-only SDK package that is NOT bundled
 * with the extension. Tries standard Node.js resolution first, then falls
 * back to locating the package relative to the CLI binary's install location.
 *
 * @param packageName - npm package name (e.g., '@github/copilot-sdk')
 * @param cliBinaryPath - Absolute path to the CLI binary (from detect())
 * @returns The loaded module
 * @throws Error with install instructions if the package cannot be found
 */
export async function resolveAndImportSdk<T>(
  packageName: string,
  cliBinaryPath?: string,
): Promise<T> {
  let lastError: unknown;

  // Attempt 1: Standard Node.js module resolution
  try {
    return (await dynamicImport(packageName)) as T;
  } catch (e) {
    lastError = e;
    // MODULE_NOT_FOUND -- expected when not bundled
  }

  // Attempt 2: Resolve from CLI binary's install tree
  if (cliBinaryPath) {
    const sdkPath = findPackageFromBinary(cliBinaryPath, packageName);
    if (sdkPath) {
      try {
        // Use file:// URL for cross-platform ESM import from absolute paths
        const fileUrl = pathToFileURL(sdkPath).href;
        return (await dynamicImport(fileUrl)) as T;
      } catch (e) {
        lastError = e;
        // Found the path but import failed -- fall through to error
      }
    }
  }

  // All attempts failed
  const detail = lastError instanceof Error ? lastError.message : '';
  throw new Error(
    `${packageName} is not installed or could not be loaded.` +
      `${detail ? ` (${detail})` : ''} ` +
      `Install it globally: npm install -g ${packageName}`,
  );
}

/**
 * Given a CLI binary path (possibly a symlink), resolve the real path
 * and walk up the directory tree to find the SDK package in a sibling
 * node_modules directory.
 *
 * On npm global installs, the binary is symlinked from the global bin/
 * directory to the package in lib/node_modules/. Walking up from the
 * real path finds the global node_modules where sibling SDK packages
 * are also installed.
 */
function findPackageFromBinary(
  binaryPath: string,
  packageName: string,
): string | null {
  try {
    const realPath = realpathSync(binaryPath);
    let dir = dirname(realPath);

    // Walk up looking for node_modules/<packageName>
    // Stop at filesystem root
    const root = dir.substring(0, dir.indexOf(sep) + 1) || sep;
    let iterations = 0;
    while (dir !== root && iterations++ < 50) {
      const candidate = join(dir, 'node_modules', ...packageName.split('/'));
      if (existsSync(join(candidate, 'package.json'))) {
        return candidate;
      }
      dir = dirname(dir);
    }
  } catch {
    // realpathSync failed -- binary path invalid
  }
  return null;
}
