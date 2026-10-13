/**
 * In-memory `ISessionRecordRepository` and `ISessionBlobStore` for specs.
 *
 * The repository follows the adapter's contract: project paths compare
 * through `normalizeWorkspaceRoot`, listings are newest first and limited to
 * the repository's host, `get` reads any host. Pass the same `records` map to
 * two instances to model two processes, or a restart, over one store.
 */

import type {
  ISessionBlobStore,
  ISessionRecordRepository,
  SessionRecord,
  SessionRecordHost,
  SessionRecordInput,
  SessionRecordListOptions,
} from '../../interfaces/session-record-repository.interface';
import { normalizeWorkspaceRoot } from '../../utils/normalize-workspace-root';

export type MockSessionRecordRepository =
  jest.Mocked<ISessionRecordRepository> & {
    readonly __records: Map<string, SessionRecord>;
  };

export function createMockSessionRecordRepository(options?: {
  host?: SessionRecordHost;
  records?: Map<string, SessionRecord>;
  /** Migration receipts, `<host>|<sourcePath>|<fingerprint>`. */
  sources?: Set<string>;
}): MockSessionRecordRepository {
  const host = options?.host ?? 'electron';
  const records = options?.records ?? new Map<string, SessionRecord>();
  const sources = options?.sources ?? new Set<string>();
  const clone = (r: SessionRecord): SessionRecord =>
    JSON.parse(JSON.stringify(r)) as SessionRecord;
  const list = (
    keep: (r: SessionRecord) => boolean,
    opts?: SessionRecordListOptions,
  ): SessionRecord[] =>
    [...records.values()]
      .filter(
        (r) =>
          r.host === host && (opts?.includeChildren || !r.isChild) && keep(r),
      )
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .map(clone);

  return {
    __records: records,
    get: jest.fn(async (sessionId: string) => {
      const r = records.get(sessionId);
      return r ? clone(r) : null;
    }),
    upsert: jest.fn(async (record: SessionRecordInput) => {
      records.set(record.sessionId, clone({ ...record, host }));
    }),
    delete: jest.fn(async (sessionId: string) => {
      records.delete(sessionId);
    }),
    listForWorkspace: jest.fn(
      async (workspacePath: string, opts?: SessionRecordListOptions) => {
        const key = normalizeWorkspaceRoot(workspacePath);
        return list(
          (r) =>
            r.workspacePath !== null &&
            normalizeWorkspaceRoot(r.workspacePath) === key,
          opts,
        );
      },
    ),
    listAll: jest.fn(async (opts?: SessionRecordListOptions) =>
      list(() => true, opts),
    ),
    hasMigrationSource: jest.fn(
      async (sourcePath: string, fingerprint: string) =>
        sources.has(`${host}|${sourcePath}|${fingerprint}`),
    ),
    recordMigrationSource: jest.fn(
      async (sourcePath: string, fingerprint: string, _copied: number) => {
        sources.add(`${host}|${sourcePath}|${fingerprint}`);
      },
    ),
  };
}

export type MockSessionBlobStore = jest.Mocked<ISessionBlobStore> & {
  /** Keyed `<sessionId>/<name>`. */
  readonly __blobs: Map<string, unknown>;
};

export function createMockSessionBlobStore(
  blobs: Map<string, unknown> = new Map(),
): MockSessionBlobStore {
  const key = (sessionId: string, name: string) => `${sessionId}/${name}`;
  return {
    __blobs: blobs,
    read: jest.fn(async <T>(sessionId: string, name: string) => {
      const value = blobs.get(key(sessionId, name));
      return value === undefined
        ? undefined
        : (JSON.parse(JSON.stringify(value)) as T);
    }) as MockSessionBlobStore['read'],
    write: jest.fn(async (sessionId: string, name: string, value: unknown) => {
      blobs.set(key(sessionId, name), JSON.parse(JSON.stringify(value)));
    }),
    remove: jest.fn(async (sessionId: string, name: string) => {
      blobs.delete(key(sessionId, name));
    }),
    removeAll: jest.fn(async (sessionId: string) => {
      for (const k of [...blobs.keys()]) {
        if (k.startsWith(`${sessionId}/`)) blobs.delete(k);
      }
    }),
  };
}
