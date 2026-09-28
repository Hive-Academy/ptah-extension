/**
 * GoVetConsentStore — the per-workspace opt-in that authorises `go vet`
 * (TASK_2026_559 Batch 37a; O2 §1, User Decisions 19 and 25).
 *
 * Consent is HOST-owned: one record file per workspace under the host
 * user-data directory (`<userData>/go-vet-consent/<sha256(root)>.json`),
 * never in the repository, and no repository file (`.ptah/`, `.vscode/`,
 * `go.mod`, settings) is ever read for consent. Only a root the host
 * registered in its workspace-scoped storage (`getStorageForWorkspace(root)`)
 * can hold consent.
 *
 * Durable and fresh (Lane K closing review findings 1-2): the record is its
 * OWN file, read from disk at every decision — never from a storage object's
 * in-memory snapshot — so a revoke by any process (a second CLI, the desktop
 * app) takes effect on the next `go vet` decision, and no write of another
 * state key can re-persist it. A grant is written to a temporary file and
 * renamed into place: it becomes visible only once durably committed, and a
 * failed write leaves nothing a reader could see (the effective state stays
 * what the disk says).
 *
 * Every read FAILS CLOSED: a storage that is not workspace-scoped, a root the
 * host never registered, a missing or malformed record, a user-data directory
 * inside the root, or any throw (`StateStorageNotReadyError` included) is
 * `off`. A root that is not registered never falls back to the active
 * workspace's storage (`workspace-scoped-state-storage.interface.ts`).
 *
 * A stored record ENDS (Decision 25) when the workspace folder moved
 * (`root-moved`: its realpath changed), was replaced (`root-replaced`: its
 * `dev:ino` identity changed) or the resolved Go binary changed
 * (`go-changed`: canonical path, size or mtime). `stale` is not auto-deleted;
 * the checker treats it exactly like `off`.
 */

import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import {
  isPathWithinRoots,
  isWorkspaceScopedStateStorage,
} from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { isSameGoBinary, type GoBinaryIdentity } from './go-binary-resolver';

/** Directory under the host user-data directory holding the record files. */
export const GO_VET_CONSENT_DIR = 'go-vet-consent';

/** The stored grant (O2 §1.2). */
export interface GoVetConsentRecord {
  readonly v: 1;
  /** `realpath(root)` at grant. */
  readonly rootRealpath: string;
  /** `${dev}:${ino}` of the root at grant; `null` when the volume reports ino 0. */
  readonly rootId: string | null;
  /** The canonical binary accepted at grant. */
  readonly goBinary: GoBinaryIdentity;
  /** ISO time, display only. */
  readonly grantedAt: string;
}

export type GoVetConsentStaleReason =
  'root-moved' | 'root-replaced' | 'go-changed';

export type GoVetConsentState =
  | { readonly state: 'off' }
  | {
      readonly state: 'on';
      readonly record: GoVetConsentRecord;
      /**
       * The record file and the SHA-256 of the exact bytes judged `on`: the
       * spawner re-checks both on the thread that creates the process, so a
       * revoke or re-grant after this read stops the launch (closing review
       * r2 finding 1).
       */
      readonly recordFile: string;
      readonly recordSha256: string;
    }
  | { readonly state: 'stale'; readonly reason: GoVetConsentStaleReason };

/** The root facts a record binds; injectable for the specs. */
export interface ConsentRootFileSystem {
  /** Canonical path of the root; throws when it does not resolve. */
  realpath(target: string): string;
  /** `${dev}:${ino}`, or `null` when the volume reports ino 0. */
  rootId(target: string): string | null;
}

export interface GoVetConsentStoreOptions {
  /**
   * The host user-data directory the workspace storages live in. When it
   * resolves inside a checked root, consent for that root is `off`: the
   * repository would then hold its own consent file.
   */
  readonly userDataPath: string;
  readonly platform?: NodeJS.Platform;
  readonly fileSystem?: ConsentRootFileSystem;
}

const OFF: GoVetConsentState = { state: 'off' };

const NODE_ROOT_FILE_SYSTEM: ConsentRootFileSystem = {
  realpath: (target) => fs.realpathSync.native(target),
  rootId: (target) => {
    const stats = fs.statSync(target, { bigint: true });
    return stats.ino === BigInt(0) ? null : `${stats.dev}:${stats.ino}`;
  },
};

const RECORD_KEYS = ['goBinary', 'grantedAt', 'rootId', 'rootRealpath', 'v'];
const BINARY_KEYS = ['mtimeMs', 'path', 'size'];

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Strict parse: exact keys, exact types, `v === 1`; anything else is `null`. */
export function parseGoVetConsentRecord(
  value: unknown,
): GoVetConsentRecord | null {
  if (!isPlainObject(value) || !hasExactKeys(value, RECORD_KEYS)) return null;
  const { v, rootRealpath, rootId, goBinary, grantedAt } = value;
  if (v !== 1) return null;
  if (typeof rootRealpath !== 'string' || rootRealpath.length === 0) {
    return null;
  }
  if (rootId !== null && (typeof rootId !== 'string' || rootId.length === 0)) {
    return null;
  }
  if (typeof grantedAt !== 'string') return null;
  if (!isPlainObject(goBinary) || !hasExactKeys(goBinary, BINARY_KEYS)) {
    return null;
  }
  if (
    typeof goBinary['path'] !== 'string' ||
    goBinary['path'].length === 0 ||
    !isFiniteNonNegative(goBinary['size']) ||
    !isFiniteNonNegative(goBinary['mtimeMs'])
  ) {
    return null;
  }
  return {
    v: 1,
    rootRealpath,
    rootId,
    goBinary: {
      path: goBinary['path'],
      size: goBinary['size'],
      mtimeMs: goBinary['mtimeMs'],
    },
    grantedAt,
  };
}

export class GoVetConsentStore {
  private readonly platform: NodeJS.Platform;
  private readonly fileSystem: ConsentRootFileSystem;

  constructor(
    private readonly storage: IStateStorage,
    private readonly options: GoVetConsentStoreOptions,
  ) {
    this.platform = options.platform ?? process.platform;
    this.fileSystem = options.fileSystem ?? NODE_ROOT_FILE_SYSTEM;
  }

  /**
   * The consent for `workspaceRoot`, judged against the binary the caller
   * resolved NOW (`null` when none resolves). Never throws; never cached.
   */
  read(
    workspaceRoot: string,
    currentGoBinary: GoBinaryIdentity | null,
  ): GoVetConsentState {
    try {
      if (!this.isRegistered(workspaceRoot)) return OFF;
      const recordFile = this.recordFile(workspaceRoot);
      const bytes = fs.readFileSync(recordFile);
      const record = parseGoVetConsentRecord(
        JSON.parse(bytes.toString('utf8')),
      );
      if (record === null) return OFF;
      const judged = this.judge(workspaceRoot, record, currentGoBinary);
      if (judged !== null) return judged;
      return {
        state: 'on',
        record,
        recordFile,
        recordSha256: createHash('sha256').update(bytes).digest('hex'),
      };
    } catch (error: unknown) {
      // Consent fails closed: no record file, an unreadable or malformed one,
      // a store that is not ready, or any other throw means go vet does not
      // run.
      void error;
      return OFF;
    }
  }

  /**
   * Record consent for `workspaceRoot` and the binary it will run: written
   * to a temporary file, then renamed over the record, so it is visible only
   * once committed. Throws (fixed text, or the file-system error) when the
   * root is not registered, the user-data directory lies inside it, or the
   * write fails — nothing is published then. The caller reads back through
   * {@link read}.
   */
  async grant(
    workspaceRoot: string,
    goBinary: GoBinaryIdentity,
    now: Date = new Date(),
  ): Promise<void> {
    this.requireRegistered(workspaceRoot);
    const rootRealpath = this.fileSystem.realpath(workspaceRoot);
    const record: GoVetConsentRecord = {
      v: 1,
      rootRealpath,
      rootId: this.fileSystem.rootId(workspaceRoot),
      goBinary: {
        path: goBinary.path,
        size: goBinary.size,
        mtimeMs: goBinary.mtimeMs,
      },
      grantedAt: now.toISOString(),
    };
    const target = this.recordFile(workspaceRoot);
    await fsPromises.mkdir(path.dirname(target), { recursive: true });
    const suffix = `${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    const temporary = `${target}.${suffix}`;
    try {
      await fsPromises.writeFile(temporary, JSON.stringify(record), {
        encoding: 'utf8',
        flag: 'wx',
      });
      await fsPromises.rename(temporary, target);
    } finally {
      await fsPromises.rm(temporary, { force: true });
    }
  }

  /** Delete the record file; an absent record is already revoked. */
  async revoke(workspaceRoot: string): Promise<void> {
    this.requireRegistered(workspaceRoot);
    await fsPromises.rm(this.recordFile(workspaceRoot), { force: true });
  }

  /**
   * Does a record file exist for `workspaceRoot` now? The revoke read-back:
   * `true` also when existence cannot be established, so an uncertain revoke
   * is never reported as done.
   */
  hasRecord(workspaceRoot: string): boolean {
    try {
      fs.statSync(this.recordFile(workspaceRoot));
      return true;
    } catch (error: unknown) {
      return !(isErrnoException(error) && error.code === 'ENOENT');
    }
  }

  /**
   * The identity a user confirms (Lane K closing review finding 4): the
   * root's real path and `dev:ino`, and the binary a grant would record,
   * each hashed. GET hands it out with what it displays; SET refuses when
   * the part for the root (`workspace-changed`) or for the binary
   * (`go-changed`) no longer matches. `null` when the root does not resolve.
   */
  confirmToken(
    workspaceRoot: string,
    goBinary: GoBinaryIdentity | null,
  ): string | null {
    try {
      return `${this.rootToken(workspaceRoot)}.${binaryToken(goBinary)}`;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - a root that does not
      // resolve has no identity to confirm; SET then refuses.
      void error;
      return null;
    }
  }

  /** The root part of {@link confirmToken} for a stored record. */
  recordRootToken(record: GoVetConsentRecord): string {
    return hashParts([
      this.fold(record.rootRealpath),
      record.rootId ?? 'no-id',
    ]);
  }

  private rootToken(workspaceRoot: string): string {
    return hashParts([
      this.fold(this.fileSystem.realpath(workspaceRoot)),
      this.fileSystem.rootId(workspaceRoot) ?? 'no-id',
    ]);
  }

  private fold(value: string): string {
    return this.platform === 'win32' ? value.toLowerCase() : value;
  }

  /** The root's record file, named by a hash of its resolved path. */
  private recordFile(workspaceRoot: string): string {
    const key = this.fold(path.resolve(workspaceRoot));
    return path.join(
      this.options.userDataPath,
      GO_VET_CONSENT_DIR,
      `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`,
    );
  }

  private requireRegistered(workspaceRoot: string): void {
    if (!this.isRegistered(workspaceRoot)) {
      throw new Error('go vet consent: no host storage for this workspace');
    }
  }

  private judge(
    workspaceRoot: string,
    record: GoVetConsentRecord,
    currentGoBinary: GoBinaryIdentity | null,
  ): Exclude<GoVetConsentState, { state: 'on' }> | null {
    const realpath = this.fileSystem.realpath(workspaceRoot);
    const samePath =
      this.platform === 'win32'
        ? realpath.toLowerCase() === record.rootRealpath.toLowerCase()
        : realpath === record.rootRealpath;
    if (!samePath) return { state: 'stale', reason: 'root-moved' };
    const rootId = this.fileSystem.rootId(workspaceRoot);
    if (rootId !== null && record.rootId !== null && rootId !== record.rootId) {
      return { state: 'stale', reason: 'root-replaced' };
    }
    if (
      currentGoBinary === null ||
      !isSameGoBinary(record.goBinary, currentGoBinary, this.platform)
    ) {
      return { state: 'stale', reason: 'go-changed' };
    }
    return null;
  }

  /**
   * Did the host register this root? Lookup copies the plugin loader's
   * (`plugin-loader.service.ts` `storageFor`): `path.resolve`, exact key,
   * then on win32 a case-folded match over `getAllWorkspacePaths()`. A
   * storage with one scope answers `false`: consent exists only for a root
   * the host addressed. A user-data directory inside the root is `false` too.
   */
  private isRegistered(workspaceRoot: string): boolean {
    const storage = this.storage;
    if (!isWorkspaceScopedStateStorage(storage)) return false;
    const wanted = path.resolve(workspaceRoot);
    if (this.userDataInside(wanted)) return false;

    if (storage.getStorageForWorkspace(wanted) !== undefined) return true;
    if (this.platform === 'win32') {
      const folded = wanted.toLowerCase();
      for (const registered of storage.getAllWorkspacePaths()) {
        if (path.resolve(registered).toLowerCase() === folded) {
          return storage.getStorageForWorkspace(registered) !== undefined;
        }
      }
    }
    return false;
  }

  /** Is the host user-data directory the root or inside it (either spelling)? */
  private userDataInside(root: string): boolean {
    const roots = [root];
    const canonicalRoot = this.fileSystem.realpath(root);
    if (canonicalRoot !== root) roots.push(canonicalRoot);
    const userData = path.resolve(this.options.userDataPath);
    if (isPathWithinRoots(userData, roots, this.platform)) return true;
    let canonicalUserData: string;
    try {
      canonicalUserData = this.fileSystem.realpath(userData);
    } catch (error: unknown) {
      // A user-data directory that does not exist yet holds no consent file;
      // its lexical spelling was already checked above.
      void error;
      canonicalUserData = userData;
    }
    return isPathWithinRoots(canonicalUserData, roots, this.platform);
  }
}

function hashParts(parts: readonly string[]): string {
  return createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, 24);
}

/** The binary part of {@link GoVetConsentStore.confirmToken}. */
function binaryToken(goBinary: GoBinaryIdentity | null): string {
  return goBinary === null
    ? hashParts(['no-go-binary'])
    : hashParts([
        goBinary.path,
        String(goBinary.size),
        String(goBinary.mtimeMs),
      ]);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  // Structural: a Node fs error from another realm (a test VM) is not an
  // `instanceof Error` of this one.
  return typeof error === 'object' && error !== null && 'code' in error;
}
