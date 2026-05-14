/**
 * `createMockFileSystemProvider` — seedable in-memory `jest.Mocked<IFileSystemProvider>`.
 *
 * Behaviour:
 *   - Writes / deletes mutate an internal `Map<string, Uint8Array>` store so
 *     round-trip tests (write → read) work without touching disk.
 *   - Every method is a `jest.fn()` so call counts / argument assertions remain
 *     available for tests that still want spy semantics.
 *   - `overrides` shallow-merge on top of the default implementation, preserving
 *     Jest's `.mock` metadata by re-wrapping replacements with `jest.fn()` when
 *     they aren't already mocks.
 *
 * Pattern source: the inline jest.Mocked<IFileSystemProvider> block at
 * `libs/backend/workspace-intelligence/src/services/file-system.service.spec.ts:14-34`.
 */

import type { IFileSystemProvider } from '../../interfaces/file-system-provider.interface';
import type {
  DirectoryEntry,
  FileStat,
  IFileWatcher,
} from '../../types/platform.types';
import { FileType } from '../../types/platform.types';
import { createEvent } from '../../utils/event-emitter';

export interface MockFileSystemProviderState {
  /** Backing store — exposed so tests can seed fixtures directly. */
  readonly files: Map<string, Uint8Array>;
  /** Backing directories — set membership only. Auto-populated by writes. */
  readonly directories: Set<string>;
}

export type MockFileSystemProvider = jest.Mocked<IFileSystemProvider> & {
  readonly __state: MockFileSystemProviderState;
};

function toBytes(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

function fromBytes(content: Uint8Array): string {
  return new TextDecoder().decode(content);
}

function parentDir(path: string): string {
  const posix = path.replace(/\\/g, '/');
  const idx = posix.lastIndexOf('/');
  return idx <= 0 ? '' : posix.slice(0, idx);
}

function enoent(path: string): Error {
  const err = new Error(`ENOENT: no such file or directory, '${path}'`);
  (err as Error & { code?: string }).code = 'ENOENT';
  return err;
}

function createEmptyWatcher(): IFileWatcher {
  const [onDidChange] = createEvent<string>();
  const [onDidCreate] = createEvent<string>();
  const [onDidDelete] = createEvent<string>();
  return {
    onDidChange,
    onDidCreate,
    onDidDelete,
    dispose: jest.fn(),
  };
}

export function createMockFileSystemProvider(
  overrides?: Partial<IFileSystemProvider>,
): MockFileSystemProvider {
  const files = new Map<string, Uint8Array>();
  const directories = new Set<string>();

  const registerDirChain = (path: string): void => {
    let dir = parentDir(path);
    while (dir && !directories.has(dir)) {
      directories.add(dir);
      dir = parentDir(dir);
    }
  };

  const mock: MockFileSystemProvider = {
    readFile: jest.fn(async (path: string): Promise<string> => {
      const bytes = files.get(path);
      if (!bytes) throw enoent(path);
      return fromBytes(bytes);
    }),
    readFileBytes: jest.fn(async (path: string): Promise<Uint8Array> => {
      const bytes = files.get(path);
      if (!bytes) throw enoent(path);
      return bytes;
    }),
    writeFile: jest.fn(async (path: string, content: string): Promise<void> => {
      files.set(path, toBytes(content));
      registerDirChain(path);
    }),
    writeFileBytes: jest.fn(
      async (path: string, content: Uint8Array): Promise<void> => {
        files.set(path, content);
        registerDirChain(path);
      },
    ),
    readDirectory: jest.fn(async (path: string): Promise<DirectoryEntry[]> => {
      const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
      if (!directories.has(normalized) && normalized !== '') {
        // Allow reading a directory that only exists because files live under
        // it. For tests, treat missing dir as empty if not seeded.
        // But if no descendants, throw.
        const hasDescendant =
          [...files.keys()].some((k) =>
            k.replace(/\\/g, '/').startsWith(`${normalized}/`),
          ) || [...directories].some((d) => d.startsWith(`${normalized}/`));
        if (!hasDescendant) throw enoent(path);
      }
      const seen = new Map<string, FileType>();
      for (const key of files.keys()) {
        const posix = key.replace(/\\/g, '/');
        if (!posix.startsWith(`${normalized}/`)) continue;
        const rest = posix.slice(normalized.length + 1);
        const head = rest.split('/')[0];
        if (!head) continue;
        const isDirectChild = !rest.includes('/');
        seen.set(head, isDirectChild ? FileType.File : FileType.Directory);
      }
      for (const dir of directories) {
        if (!dir.startsWith(`${normalized}/`)) continue;
        const rest = dir.slice(normalized.length + 1);
        const head = rest.split('/')[0];
        if (!head) continue;
        if (!seen.has(head)) seen.set(head, FileType.Directory);
      }
      return [...seen.entries()].map(([name, type]) => ({ name, type }));
    }),
    stat: jest.fn(async (path: string): Promise<FileStat> => {
      const bytes = files.get(path);
      if (bytes) {
        return {
          type: FileType.File,
          ctime: 0,
          mtime: 0,
          size: bytes.byteLength,
        };
      }
      const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
      if (directories.has(normalized)) {
        return { type: FileType.Directory, ctime: 0, mtime: 0, size: 0 };
      }
      throw enoent(path);
    }),
    exists: jest.fn(async (path: string): Promise<boolean> => {
      if (files.has(path)) return true;
      const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
      return directories.has(normalized);
    }),
    delete: jest.fn(
      async (
        path: string,
        options?: { recursive?: boolean },
      ): Promise<void> => {
        const posix = path.replace(/\\/g, '/').replace(/\/$/, '');
        if (files.delete(path) || files.delete(posix)) return;
        if (directories.has(posix)) {
          directories.delete(posix);
          if (options?.recursive) {
            for (const key of [...files.keys()]) {
              if (key.replace(/\\/g, '/').startsWith(`${posix}/`)) {
                files.delete(key);
              }
            }
            for (const dir of [...directories]) {
              if (dir.startsWith(`${posix}/`)) directories.delete(dir);
            }
          }
          return;
        }
        throw enoent(path);
      },
    ),
    createDirectory: jest.fn(async (path: string): Promise<void> => {
      const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
      directories.add(normalized);
      registerDirChain(`${normalized}/.`);
    }),
    copy: jest.fn(
      async (
        source: string,
        destination: string,
        options?: { overwrite?: boolean },
      ): Promise<void> => {
        const bytes = files.get(source);
        if (!bytes) throw enoent(source);
        if (files.has(destination) && options?.overwrite === false) {
          throw new Error(`EEXIST: file already exists, '${destination}'`);
        }
        files.set(destination, bytes);
        registerDirChain(destination);
      },
    ),
    findFiles: jest.fn(
      async (
        pattern: string,
        _exclude?: string[],
        maxResults?: number,
      ): Promise<string[]> => {
        // Minimal glob: treat `**/*` as match-all, else suffix match on the
        // trailing literal segment. Consumers who need richer matching should
        // override this method via the `overrides` argument.
        const matchAll = pattern.includes('**/*') || pattern === '*';
        const suffix = pattern.replace(/^.*\*/, '');
        const results: string[] = [];
        for (const key of files.keys()) {
          if (matchAll || key.endsWith(suffix)) {
            results.push(key);
            if (maxResults && results.length >= maxResults) break;
          }
        }
        return results;
      },
    ),
    createFileWatcher: jest.fn((_pattern: string): IFileWatcher => {
      return createEmptyWatcher();
    }),
    __state: { files, directories },
  } as MockFileSystemProvider;

  if (overrides) {
    for (const [key, value] of Object.entries(overrides) as Array<
      [keyof IFileSystemProvider, unknown]
    >) {
      if (typeof value === 'function') {
        (mock as unknown as Record<string, unknown>)[key] = jest.fn(
          value as (...args: unknown[]) => unknown,
        );
      }
    }
  }

  return mock;
}
