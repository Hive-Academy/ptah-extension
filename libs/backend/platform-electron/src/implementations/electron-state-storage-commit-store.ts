import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  StateStorageRecoveryRequiredError,
  type StateStorageRecoveryReason,
} from '@ptah-extension/platform-core';
import {
  electronStateCurrentPointerSchema,
  electronStateManifestSchema,
  manifestMatchesCurrentPointer,
  type ElectronStateBlob,
  type ElectronStateCurrentPointer,
  type ElectronStateManifest,
} from './electron-state-storage-manifest';
import {
  electronStateJsonRecordSchema,
  electronStateJsonValueSchema,
  type JsonValue,
} from './electron-state-storage-worker-protocol';

export type ElectronStateDurableStep =
  | 'blob-written'
  | 'blob-flushed'
  | 'blob-renamed'
  | 'blob-verified'
  | 'manifest-written'
  | 'manifest-flushed'
  | 'manifest-renamed'
  | 'manifest-verified'
  | 'current-written'
  | 'current-flushed'
  | 'current-renamed'
  | 'current-verified';

export interface ElectronStateFaultInjector {
  after(step: ElectronStateDurableStep): void | Promise<void>;
}

export interface LoadedElectronState {
  readonly values: Record<string, JsonValue>;
  readonly manifest: ElectronStateManifest;
}

interface CommitInput {
  readonly values: Record<string, JsonValue>;
  readonly changedKeys: ReadonlySet<string>;
  readonly previous: ElectronStateManifest | null;
  readonly sourceV1Sha256: string;
  readonly commitKind: 'migration' | 'mutation';
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function exists(filePath: string): Promise<boolean> {
  // degradation-audit: optional-capability - a rejection from `access` IS the
  // answer this probe asked for: the path is not there. There is no second
  // signal to lose, and every caller branches on the boolean.
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
}

/**
 * Worker-owned v2 persistence. File flushes and same-directory renames make
 * process-crash states identifiable; Node does not expose Windows
 * MOVEFILE_WRITE_THROUGH, so this intentionally makes no power-loss claim.
 */
export class ElectronStateCommitStore {
  private readonly manifestsPath: string;
  private readonly valuesPath: string;
  private readonly stagingPath: string;
  private readonly currentPath: string;

  constructor(
    private readonly legacyFilePath: string,
    private readonly v2RootPath: string,
    private readonly faultInjector?: ElectronStateFaultInjector,
  ) {
    this.manifestsPath = path.join(v2RootPath, 'manifests');
    this.valuesPath = path.join(v2RootPath, 'values');
    this.stagingPath = path.join(v2RootPath, 'staging');
    this.currentPath = path.join(v2RootPath, 'CURRENT');
  }

  async initialize(): Promise<LoadedElectronState> {
    const currentResult = await this.tryLoadCurrent();
    if (currentResult.kind === 'valid') return currentResult.loaded;
    if (currentResult.kind === 'recovery-required') {
      throw new StateStorageRecoveryRequiredError(currentResult.reason);
    }

    const { values, sourceSha256 } = await this.loadLegacy();
    await this.quarantineIncompleteV2();
    const manifest = await this.commit({
      values,
      changedKeys: new Set(Object.keys(values)),
      previous: null,
      sourceV1Sha256: sourceSha256,
      commitKind: 'migration',
    });
    return { values, manifest };
  }

  async commitMutation(
    values: Record<string, JsonValue>,
    changedKeys: ReadonlySet<string>,
    previous: ElectronStateManifest,
  ): Promise<ElectronStateManifest> {
    return await this.commit({
      values,
      changedKeys,
      previous,
      sourceV1Sha256: previous.sourceV1Sha256,
      commitKind: 'mutation',
    });
  }

  async commitMigration(
    values: Record<string, JsonValue>,
    changedKeys: ReadonlySet<string>,
    previous: ElectronStateManifest,
  ): Promise<ElectronStateManifest> {
    if (previous.mutationEpoch > 0) {
      return await this.commitMutation(values, changedKeys, previous);
    }
    return await this.commit({
      values,
      changedKeys,
      previous,
      sourceV1Sha256: previous.sourceV1Sha256,
      commitKind: 'migration',
    });
  }

  private async tryLoadCurrent(): Promise<
    | { readonly kind: 'valid'; readonly loaded: LoadedElectronState }
    | { readonly kind: 'retry-v1' }
    | {
        readonly kind: 'recovery-required';
        readonly reason: StateStorageRecoveryReason;
      }
  > {
    if (!(await exists(this.v2RootPath))) return { kind: 'retry-v1' };

    let pointer: ElectronStateCurrentPointer | null = null;
    try {
      pointer = electronStateCurrentPointerSchema.parse(
        await readJsonFile(this.currentPath),
      );
    } catch {
      return (await this.hasCommittedMutation())
        ? { kind: 'recovery-required', reason: 'current-pointer-invalid' }
        : { kind: 'retry-v1' };
    }

    let manifest: ElectronStateManifest;
    const manifestPath = path.join(
      this.v2RootPath,
      pointer.manifestRelativePath,
    );
    try {
      const manifestBytes = await fs.readFile(manifestPath);
      if (sha256(manifestBytes) !== pointer.manifestSha256) {
        return this.invalidCurrent(pointer, 'manifest-invalid');
      }
      manifest = electronStateManifestSchema.parse(
        JSON.parse(manifestBytes.toString('utf8')) as unknown,
      );
      if (!manifestMatchesCurrentPointer(manifest, pointer)) {
        return this.invalidCurrent(pointer, 'manifest-invalid');
      }
    } catch {
      return this.invalidCurrent(pointer, 'manifest-invalid');
    }

    const values: Record<string, JsonValue> = {};
    for (const [key, blob] of Object.entries(manifest.values)) {
      const blobPath = path.join(this.v2RootPath, blob.relativePath);
      let bytes: Buffer;
      try {
        bytes = await fs.readFile(blobPath);
      } catch {
        return this.invalidCurrent(pointer, 'blob-missing');
      }
      if (bytes.byteLength !== blob.byteLength) {
        return this.invalidCurrent(pointer, 'blob-length-mismatch');
      }
      if (sha256(bytes) !== blob.sha256) {
        return this.invalidCurrent(pointer, 'blob-hash-mismatch');
      }
      try {
        values[key] = electronStateJsonValueSchema.parse(
          JSON.parse(bytes.toString('utf8')) as unknown,
        );
      } catch {
        return this.invalidCurrent(pointer, 'blob-hash-mismatch');
      }
    }
    return { kind: 'valid', loaded: { values, manifest } };
  }

  private invalidCurrent(
    pointer: ElectronStateCurrentPointer,
    reason: StateStorageRecoveryReason,
  ):
    | { readonly kind: 'retry-v1' }
    | {
        readonly kind: 'recovery-required';
        readonly reason: StateStorageRecoveryReason;
      } {
    return pointer.mutationEpoch > 0
      ? { kind: 'recovery-required', reason }
      : { kind: 'retry-v1' };
  }

  private async hasCommittedMutation(): Promise<boolean> {
    let names: string[];
    try {
      names = await fs.readdir(this.manifestsPath);
    } catch {
      // degradation-audit: optional-capability - an unreadable manifests
      // directory is not evidence that a mutation ever committed, which is the
      // only question this predicate answers. The caller treats `false` as
      // "safe to retry from v1", the conservative branch.
      return false;
    }
    for (const name of names) {
      if (!/^manifest\.\d+\.json$/.test(name)) continue;
      try {
        const parsed = electronStateManifestSchema.parse(
          await readJsonFile(path.join(this.manifestsPath, name)),
        );
        if (parsed.mutationEpoch > 0) return true;
      } catch {
        // An invalid unreachable manifest is not commit evidence by itself.
      }
    }
    return false;
  }

  private async loadLegacy(): Promise<{
    values: Record<string, JsonValue>;
    sourceSha256: string;
  }> {
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(this.legacyFilePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        bytes = Buffer.from('{}', 'utf8');
      } else {
        throw error;
      }
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
      throw new StateStorageRecoveryRequiredError('migration-failed');
    }
    const result = electronStateJsonRecordSchema.safeParse(parsed);
    if (!result.success) {
      throw new StateStorageRecoveryRequiredError('migration-failed');
    }
    return {
      values: result.data,
      sourceSha256: sha256(bytes),
    };
  }

  private async quarantineIncompleteV2(): Promise<void> {
    if (!(await exists(this.v2RootPath))) return;
    const quarantinePath = `${this.v2RootPath}.quarantine.${randomUUID()}`;
    await fs.rename(this.v2RootPath, quarantinePath);
  }

  private async commit(input: CommitInput): Promise<ElectronStateManifest> {
    const generation = (input.previous?.generation ?? 0) + 1;
    const mutationEpoch =
      input.commitKind === 'mutation'
        ? (input.previous?.mutationEpoch ?? 0) + 1
        : 0;
    const operationId = randomUUID();
    await fs.mkdir(this.stagingPath, { recursive: true });
    await fs.mkdir(this.valuesPath, { recursive: true });
    await fs.mkdir(this.manifestsPath, { recursive: true });

    const blobs: Record<string, ElectronStateBlob> = {
      ...(input.previous?.values ?? {}),
    };
    for (const key of input.changedKeys) {
      if (!(key in input.values)) {
        delete blobs[key];
        continue;
      }
      const bytes = Buffer.from(JSON.stringify(input.values[key]), 'utf8');
      const fileName = `${sha256(Buffer.from(key, 'utf8'))}.${generation}.json`;
      const relativePath = `values/${fileName}`;
      const finalPath = path.join(this.valuesPath, fileName);
      await this.writeFlushRenameVerify(
        `${finalPath}.${operationId}.tmp`,
        finalPath,
        bytes,
        'blob',
      );
      blobs[key] = {
        relativePath,
        generation,
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
      };
    }

    const manifest: ElectronStateManifest = {
      schemaVersion: 2,
      generation,
      previousGeneration: input.previous?.generation ?? null,
      commitId: randomUUID(),
      commitKind: input.commitKind,
      committedAtEpochMs: Date.now(),
      sourceV1Sha256: input.sourceV1Sha256,
      mutationEpoch,
      values: blobs,
    };
    electronStateManifestSchema.parse(manifest);
    const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
    const manifestName = `manifest.${generation}.json`;
    const manifestRelativePath = `manifests/${manifestName}`;
    await this.writeFlushRenameVerify(
      `${path.join(this.manifestsPath, manifestName)}.${operationId}.tmp`,
      path.join(this.manifestsPath, manifestName),
      manifestBytes,
      'manifest',
    );

    const pointer: ElectronStateCurrentPointer = {
      schemaVersion: 1,
      generation,
      commitId: manifest.commitId,
      mutationEpoch,
      manifestRelativePath,
      manifestSha256: sha256(manifestBytes),
    };
    electronStateCurrentPointerSchema.parse(pointer);
    const pointerBytes = Buffer.from(JSON.stringify(pointer), 'utf8');
    await this.writeFlushRenameVerify(
      `${this.currentPath}.${operationId}.tmp`,
      this.currentPath,
      pointerBytes,
      'current',
    );
    await this.sweepStagingAfterCommit();
    return manifest;
  }

  private async sweepStagingAfterCommit(): Promise<void> {
    await Promise.all(
      [this.v2RootPath, this.manifestsPath, this.valuesPath].map(
        async (directory) => {
          let entries: string[];
          try {
            entries = await fs.readdir(directory);
          } catch {
            // degradation-audit: optional-capability - this sweep runs AFTER
            // the commit is durable. A directory that cannot be listed leaves
            // stale `.tmp` files behind and nothing else; the next commit
            // sweeps them again.
            return;
          }
          // degradation-audit: optional-capability - removing a leftover
          // staging file is best effort for the same reason: the commit has
          // already landed, and a file that survives is retried next sweep.
          await Promise.all(
            entries
              .filter((entry) => entry.endsWith('.tmp'))
              .map((entry) =>
                fs
                  .rm(path.join(directory, entry), { force: true })
                  .catch(() => undefined),
              ),
          );
        },
      ),
    );
  }

  private async writeFlushRenameVerify(
    temporaryPath: string,
    finalPath: string,
    bytes: Buffer,
    kind: 'blob' | 'manifest' | 'current',
  ): Promise<void> {
    const handle = await fs.open(temporaryPath, 'wx');
    try {
      await handle.writeFile(bytes);
      await this.faultInjector?.after(`${kind}-written`);
      await handle.sync();
      await this.faultInjector?.after(`${kind}-flushed`);
    } finally {
      await handle.close();
    }
    await fs.rename(temporaryPath, finalPath);
    await this.faultInjector?.after(`${kind}-renamed`);
    const verified = await fs.readFile(finalPath);
    if (
      verified.byteLength !== bytes.byteLength ||
      sha256(verified) !== sha256(bytes)
    ) {
      throw new Error(`${kind} verification failed`);
    }
    await this.faultInjector?.after(`${kind}-verified`);
  }
}
