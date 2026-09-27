/**
 * GoVetConsentStore — the per-workspace opt-in that authorises `go vet`
 * (TASK_2026_559 Batch 37a; O2 §1, User Decisions 19 and 25).
 *
 * Consent lives in HOST-owned per-workspace state: the storage
 * `getStorageForWorkspace(root)` returns, under
 * {@link GO_VET_CONSENT_KEY}. That file sits in the host user-data directory,
 * never in the repository, and no repository file (`.ptah/`, `.vscode/`,
 * `go.mod`, settings) is ever read for consent.
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

import * as fs from 'fs';
import * as path from 'path';
import {
  isPathWithinRoots,
  isWorkspaceScopedStateStorage,
} from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { isSameGoBinary, type GoBinaryIdentity } from './go-binary-resolver';

/** The host-state key; the only place consent is ever read or written. */
export const GO_VET_CONSENT_KEY = 'ptah.diagnostics.goVet.consent';

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
  | { readonly state: 'on'; readonly record: GoVetConsentRecord }
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
  const keys = Object.keys(value).sort();
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
      const storage = this.storageFor(workspaceRoot);
      if (storage === null) return OFF;
      const record = parseGoVetConsentRecord(storage.get(GO_VET_CONSENT_KEY));
      if (record === null) return OFF;
      return this.judge(workspaceRoot, record, currentGoBinary);
    } catch (error: unknown) {
      // Consent fails closed: a store that is not ready, or any other throw,
      // means go vet does not run.
      void error;
      return OFF;
    }
  }

  /**
   * Record consent for `workspaceRoot` and the binary it will run. Throws
   * (fixed text) when the root has no host storage or the user-data directory
   * lies inside it; the caller reads back through {@link read}.
   */
  async grant(
    workspaceRoot: string,
    goBinary: GoBinaryIdentity,
    now: Date = new Date(),
  ): Promise<void> {
    const storage = this.requireStorage(workspaceRoot);
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
    await storage.update(GO_VET_CONSENT_KEY, record);
  }

  /** Delete the key (`update(key, undefined)` removes it in both hosts). */
  async revoke(workspaceRoot: string): Promise<void> {
    await this.requireStorage(workspaceRoot).update(
      GO_VET_CONSENT_KEY,
      undefined,
    );
  }

  private requireStorage(workspaceRoot: string): IStateStorage {
    const storage = this.storageFor(workspaceRoot);
    if (storage === null) {
      throw new Error('go vet consent: no host storage for this workspace');
    }
    return storage;
  }

  private judge(
    workspaceRoot: string,
    record: GoVetConsentRecord,
    currentGoBinary: GoBinaryIdentity | null,
  ): GoVetConsentState {
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
    return { state: 'on', record };
  }

  /**
   * The root's OWN storage, or `null`. Lookup copies the plugin loader's
   * (`plugin-loader.service.ts` `storageFor`): `path.resolve`, exact key,
   * then on win32 a case-folded match over `getAllWorkspacePaths()`. Unlike
   * it, a storage with one scope is `null` too: consent is only ever read
   * from a root-addressed store.
   */
  private storageFor(workspaceRoot: string): IStateStorage | null {
    const storage = this.storage;
    if (!isWorkspaceScopedStateStorage(storage)) return null;
    const wanted = path.resolve(workspaceRoot);
    if (this.userDataInside(wanted)) return null;

    const exact = storage.getStorageForWorkspace(wanted);
    if (exact !== undefined) return exact;
    if (this.platform === 'win32') {
      const folded = wanted.toLowerCase();
      for (const registered of storage.getAllWorkspacePaths()) {
        if (path.resolve(registered).toLowerCase() === folded) {
          return storage.getStorageForWorkspace(registered) ?? null;
        }
      }
    }
    return null;
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
