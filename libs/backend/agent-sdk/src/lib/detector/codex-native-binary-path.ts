/**
 * Path of the native Codex binary from the `@openai/codex-<platform>` package.
 *
 * Lives here so both the Codex CLI lanes (cli-agent-runtime) and the Codex
 * account-usage read (auth-providers) spawn the binary itself. Spawning the
 * `codex.js` launcher with `process.execPath` starts a second Ptah app on
 * Electron, because the app binary is not a Node runtime there.
 */

import { existsSync } from 'fs';
import path from 'path';

/**
 * Platform binary package names used by the Codex SDK.
 * Maps target triple to npm package name (mirrors PLATFORM_PACKAGE_BY_TARGET in codex-sdk).
 */
const CODEX_PLATFORM_PACKAGES: Record<string, string> = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64',
};

/**
 * Vendor sub-directories that have carried the Codex native binary, newest
 * layout first. `@openai/codex-<platform>` >= 0.147 ships it under
 * `vendor/<triple>/bin/`; earlier releases used `vendor/<triple>/codex/`.
 * The SDK's own resolver probes the same two, in the same order.
 */
const CODEX_VENDOR_DIRS = ['bin', 'codex'] as const;

/**
 * Expand a native-binary candidate into the paths worth probing on disk.
 *
 * Electron packs app code into `app.asar`; `electron-builder`'s `asarUnpack`
 * copies native binaries into the sibling `app.asar.unpacked` tree. A path
 * inside `app.asar` still satisfies `existsSync` through the asar shim but
 * cannot be spawned, so any candidate landing there must also be probed as its
 * unpacked twin. Returns the candidate alone when it is not inside an asar.
 */
export function withAsarUnpackedTwin(candidate: string): string[] {
  const unpacked = candidate.replace(
    /app\.asar(?!\.unpacked)/,
    'app.asar.unpacked',
  );
  return unpacked === candidate ? [candidate] : [candidate, unpacked];
}

/**
 * Resolve the target triple for the current platform.
 * Returns the Rust-style target triple used by the Codex SDK binary packages.
 */
function getTargetTriple(): string | undefined {
  const { platform, arch } = process;
  if (platform === 'win32') {
    return arch === 'arm64'
      ? 'aarch64-pc-windows-msvc'
      : 'x86_64-pc-windows-msvc';
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  }
  if (platform === 'linux') {
    return arch === 'arm64'
      ? 'aarch64-unknown-linux-musl'
      : 'x86_64-unknown-linux-musl';
  }
  return undefined;
}

/**
 * Cross-platform resolver for the Codex native binary.
 *
 * The Codex SDK spawns a platform-specific Rust executable directly (no shim).
 * On Windows, npm installs a `.cmd` wrapper that invokes a `.js` launcher —
 * passing either to the SDK as `codexPathOverride` produces `spawn EFTYPE`.
 * On every OS we must point to the actual native binary inside the
 * `@openai/codex-<platform>` package's vendor directory. Every candidate root
 * below is probed for both vendor layouts — current `vendor/<triple>/bin/`
 * first, legacy `vendor/<triple>/codex/` second (see CODEX_VENDOR_DIRS).
 *
 * Resolution order (first existing path wins):
 *   1. Electron packaged: `<resourcesPath>/app.asar.unpacked/node_modules/...`
 *   2. `require.resolve('@openai/codex-<platform>/package.json')` → vendor/...
 *      (works when the SDK and its optional-dep platform package are installed
 *      under the host's node_modules — covers dev/unbundled and most installs)
 *   3. Walk up from `@openai/codex-sdk/package.json`'s node_modules root
 *      (with app.asar → app.asar.unpacked rewrite, covers older Electron builds)
 *   4. npm global roots (when user did `npm i -g @openai/codex`):
 *      Win  → `%APPDATA%\npm\node_modules\...`
 *      Unix → `/usr/local/lib/node_modules`, `/usr/lib/node_modules`,
 *             `$HOME/.npm-global/lib/node_modules`,
 *             `$HOME/.nvm/versions/node/<ver>/lib/node_modules`
 *   5. Walk up from the detected CLI path (`which codex` → its sibling
 *      `node_modules/@openai/codex-<platform>/...`) — last-resort heuristic.
 *
 * Returns `undefined` if no candidate exists. Callers must NOT pass the bare
 * `detectedCliPath` (a `.cmd` or `.js` shim) to the SDK in that case — let the
 * SDK's own `findCodexPath()` surface a clearer error than EFTYPE.
 */
export function resolveCodexNativeBinaryPath(
  detectedCliPath?: string,
): string | undefined {
  const targetTriple = getTargetTriple();
  if (!targetTriple) return undefined;

  const platformPkg = CODEX_PLATFORM_PACKAGES[targetTriple];
  if (!platformPkg) return undefined;

  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const pkgDir = platformPkg.split('/')[1];
  /** `vendor/<triple>/<layout>/<binary>`, relative to the platform package root. */
  const relsFromPkg = CODEX_VENDOR_DIRS.map((vendorDir) =>
    path.join('vendor', targetTriple, vendorDir, binaryName),
  );
  const relsFromNodeModules = relsFromPkg.map((rel) =>
    path.join('@openai', pkgDir, rel),
  );
  const relsFromBin = relsFromNodeModules.map((rel) =>
    path.join('node_modules', rel),
  );

  const candidates: string[] = [];
  /** Probe `root` for every vendor layout, current layout first. */
  const pushLayouts = (root: string, rels: readonly string[]): void => {
    for (const rel of rels) candidates.push(path.join(root, rel));
  };

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  if (resourcesPath) {
    pushLayouts(path.join(resourcesPath, 'app.asar.unpacked'), relsFromBin);
  }

  try {
    const platformPkgJson = require.resolve(`${platformPkg}/package.json`);
    pushLayouts(path.dirname(platformPkgJson), relsFromPkg);
  } catch {
    // noop
  }

  try {
    const sdkPkgJsonPath = require.resolve('@openai/codex-sdk/package.json');
    const nodeModulesRoot = path.resolve(sdkPkgJsonPath, '..', '..', '..');
    for (const rel of relsFromNodeModules) {
      candidates.push(...withAsarUnpackedTwin(path.join(nodeModulesRoot, rel)));
    }
  } catch {
    // noop
  }
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'];
    if (appData) {
      pushLayouts(path.join(appData, 'npm'), relsFromBin);
    }
  } else {
    pushLayouts('/usr/local/lib', relsFromBin);
    pushLayouts('/usr/lib', relsFromBin);
    const home = process.env['HOME'];
    if (home) {
      pushLayouts(path.join(home, '.npm-global', 'lib'), relsFromBin);
      pushLayouts(
        path.join(home, '.nvm', 'versions', 'node', process.version, 'lib'),
        relsFromBin,
      );
    }
  }
  if (detectedCliPath) {
    const cliDir = path.dirname(detectedCliPath);
    pushLayouts(cliDir, relsFromBin);
    pushLayouts(
      path.join(cliDir, 'node_modules', '@openai', 'codex', 'node_modules'),
      relsFromNodeModules,
    );
    if (process.platform !== 'win32' && path.basename(cliDir) === 'bin') {
      pushLayouts(path.join(path.dirname(cliDir), 'lib'), relsFromBin);
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return undefined;
}
