import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, rmdirSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { ClaudeAccountFilesystemIdentity } from '@ptah-extension/auth-providers-tokens';
import { PROVIDER_ACCOUNT_DUPLICATE_ROUTE_SUMMARY, type ProviderAccountResultCode } from '@ptah-extension/shared';

/**
 * Node and SQLite errors can come from another realm (Jest VM, native addon),
 * so `instanceof Error` is unreliable. Read the code structurally.
 */
export function providerAccountErrorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
}

/** Safe failures only: never attach filesystem or SQLite error messages. */
export class ProviderAccountStoreError extends Error {
  constructor(readonly code: Exclude<ProviderAccountResultCode, 'ok'>,
    summary = 'The local account operation could not be completed.') {
    super(summary);
    this.name = 'ProviderAccountStoreError';
  }
}

/** Backend metadata, not an admission certificate or a public routing request. */
export interface CanonicalProviderAccountRoute {
  readonly requestedPath: string;
  readonly canonicalPath: string;
  readonly filesystemIdentity: ClaudeAccountFilesystemIdentity;
  readonly fingerprint: string;
}

export function resolveProviderAccountRoute(directory: string): CanonicalProviderAccountRoute {
  try {
    if (!isAbsolute(directory)) throw new ProviderAccountStoreError('unsupported-source');
    const canonicalPath = realpathSync.native(directory);
    const stat = statSync(canonicalPath, { bigint: true });
    if (!stat.isDirectory() || stat.ino === 0n) {
      throw new ProviderAccountStoreError('unsupported-store');
    }
    const filesystemIdentity = Object.freeze({ volumeId: String(stat.dev), fileId: String(stat.ino) });
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([filesystemIdentity.volumeId, filesystemIdentity.fileId, String(stat.birthtimeNs)])).digest('hex');
    return Object.freeze({ requestedPath: directory, canonicalPath, filesystemIdentity, fingerprint });
  } catch (error: unknown) {
    if (error instanceof ProviderAccountStoreError) throw error;
    throw new ProviderAccountStoreError('unsupported-store');
  }
}

/** Call again immediately before the eventual child launch/action. */
export function revalidateProviderAccountRoute(route: CanonicalProviderAccountRoute): void {
  try {
    const current = resolveProviderAccountRoute(route.requestedPath);
    if (current.canonicalPath !== route.canonicalPath || current.fingerprint !== route.fingerprint ||
      current.filesystemIdentity.volumeId !== route.filesystemIdentity.volumeId ||
      current.filesystemIdentity.fileId !== route.filesystemIdentity.fileId) {
      throw new ProviderAccountStoreError('route-changed');
    }
  } catch {
    throw new ProviderAccountStoreError('route-changed');
  }
}

/** Creates only the final directory. Existing directories are never adopted.
 * The synchronous callback commits metadata; it must not return a Promise.
 */
export function withNewProviderAccountDirectory<T>(directory: string,
  commit: (route: CanonicalProviderAccountRoute, validateOwned: () => void) => T extends PromiseLike<unknown> ? never : T): T {
  if (!isAbsolute(directory)) throw new ProviderAccountStoreError('unsupported-source');
  try { mkdirSync(directory, { mode: 0o700 }); }
  catch (error: unknown) {
    if (providerAccountErrorCode(error) === 'EEXIST') {
      throw new ProviderAccountStoreError('conflict', PROVIDER_ACCOUNT_DUPLICATE_ROUTE_SUMMARY);
    }
    throw new ProviderAccountStoreError('unsupported-store');
  }
  const owned = lstatSync(directory, { bigint: true });
  try {
    const route = resolveProviderAccountRoute(directory);
    const validateOwned = (): void => {
      try {
        const current = lstatSync(directory, { bigint: true });
        const canonical = statSync(realpathSync.native(directory), { bigint: true });
        if (!owned.isDirectory() || owned.isSymbolicLink() || !current.isDirectory() || current.isSymbolicLink() ||
          current.dev !== owned.dev || current.ino !== owned.ino || current.birthtimeNs !== owned.birthtimeNs ||
          !canonical.isDirectory() || canonical.dev !== owned.dev || canonical.ino !== owned.ino) {
          throw new ProviderAccountStoreError('route-changed');
        }
        revalidateProviderAccountRoute(route);
      } catch {
        throw new ProviderAccountStoreError('route-changed');
      }
    };
    validateOwned();
    return commit(route, validateOwned);
  } catch (error: unknown) {
    try {
      const current = lstatSync(directory, { bigint: true });
      // Non-recursive removal also refuses any content written after creation.
      if (!current.isSymbolicLink() && current.dev === owned.dev && current.ino === owned.ino &&
        current.birthtimeNs === owned.birthtimeNs) rmdirSync(directory);
    } catch {
      // degradation-audit: optional-capability — cleanup is best effort; nonempty, replaced or inaccessible directories are preserved and the original error is rethrown
    }
    throw error;
  }
}
