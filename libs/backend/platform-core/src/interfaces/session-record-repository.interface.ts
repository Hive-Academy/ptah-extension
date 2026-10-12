/**
 * Session record repository port — one session store for every project
 * (Plane PTAH-35, MP-1).
 *
 * Sessions used to live in the active workspace's state store, so a write for
 * a session of another project landed in the wrong store or was dropped
 * (PTAH-32). A record here is keyed by its session id alone and carries its
 * own project, so where it is written never depends on which project the UI
 * has open.
 *
 * Adapter lives in @ptah-extension/persistence-sqlite (`sessions.sqlite`, a
 * file of its own so older builds keep opening `ptah.sqlite`). It is
 * registered in Electron and the CLI. VS Code does not register it: consumers
 * inject the token `{ isOptional: true }` and keep their workspace-state path.
 *
 * The record is deliberately untyped JSON: the session shape is owned by
 * agent-sdk, which this shared lib must not depend on.
 */

/** The host process that wrote a record. Listings return their own host only. */
export type SessionRecordHost = 'electron' | 'cli';

export interface SessionRecord {
  readonly sessionId: string;
  /** Project root as the session reported it. Null for a projectless session (Phase 2). */
  readonly workspacePath: string | null;
  readonly host: SessionRecordHost;
  readonly name: string;
  readonly createdAt: number;
  readonly lastActiveAt: number;
  /** Child sessions are hidden from sidebar listings. */
  readonly isChild: boolean;
  /** Lean listing entry. */
  readonly summary: Readonly<Record<string, unknown>>;
  /** Full record, without bulk agent output. */
  readonly detail: Readonly<Record<string, unknown>>;
}

/** What a caller writes. The repository stamps its own host. */
export type SessionRecordInput = Omit<SessionRecord, 'host'>;

export interface SessionRecordListOptions {
  /** Include child sessions. Default false. */
  readonly includeChildren?: boolean;
}

export interface ISessionRecordRepository {
  /** The record, or null. Reads any host, so a session is never invisible to its own id. */
  get(sessionId: string): Promise<SessionRecord | null>;

  /** Insert or replace by session id, as this repository's host. */
  upsert(record: SessionRecordInput): Promise<void>;

  delete(sessionId: string): Promise<void>;

  /**
   * This host's records for one project, newest first. The path is compared
   * through `normalizeWorkspaceRoot`, so trailing separators and separator
   * style do not split a project.
   */
  listForWorkspace(
    workspacePath: string,
    options?: SessionRecordListOptions,
  ): Promise<SessionRecord[]>;

  /** This host's records across all projects, newest first. */
  listAll(options?: SessionRecordListOptions): Promise<SessionRecord[]>;

  /**
   * Receipts for the copy-forward from legacy workspace stores: true when this
   * host already copied this source in this exact state (fingerprint).
   */
  hasMigrationSource(sourcePath: string, fingerprint: string): Promise<boolean>;

  recordMigrationSource(
    sourcePath: string,
    fingerprint: string,
    sessionsCopied: number,
  ): Promise<void>;
}

/**
 * Resolves once legacy sessions have been copied into the session store on
 * this start (or the copy gave up). The session metadata store waits on it
 * before its first read, so a list never shows a half-migrated store.
 */
export interface ISessionStoreGate {
  whenReady(): Promise<void>;
}

/**
 * Bulk per-session data (agent output, turn change-sets) kept in files keyed
 * by session, not by workspace. Values are JSON. Writes are atomic.
 */
export interface ISessionBlobStore {
  read<T>(sessionId: string, name: string): Promise<T | undefined>;
  write(sessionId: string, name: string, value: unknown): Promise<void>;
  remove(sessionId: string, name: string): Promise<void>;
  /** Remove every blob of a session. */
  removeAll(sessionId: string): Promise<void>;
}
