import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
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

export type ElectronStateInitialization =
  | { readonly kind: 'current'; readonly manifest: ElectronStateManifest }
  | { readonly kind: 'legacy'; readonly legacyFilePath: string };

export type ElectronStateCommitPhase = 'pre-publication' | 'post-publication';

export type ElectronStateCommitChanges = ReadonlyMap<
  string,
  JsonValue | undefined
>;

export class ElectronStateCommitError extends Error {
  override readonly name = 'ElectronStateCommitError';

  constructor(
    readonly phase: ElectronStateCommitPhase,
    readonly generation: number,
    readonly failure: unknown,
  ) {
    super(`State commit of generation ${generation} failed (${phase})`);
  }
}

export interface ElectronStateInitialSink {
  put(key: string, value: JsonValue): Promise<void>;
}

interface GenerationWriter extends ElectronStateInitialSink {
  remove(key: string): void;
}

interface CommitInput {
  readonly produce: (writer: GenerationWriter) => Promise<void>;
  readonly previous: ElectronStateManifest | null;
  readonly sourceV1Sha256: string;
  readonly commitKind: 'migration' | 'mutation';
}

type CurrentLoadResult =
  | { readonly kind: 'valid'; readonly manifest: ElectronStateManifest }
  | { readonly kind: 'retry-v1' }
  | {
      readonly kind: 'recovery-required';
      readonly reason: StateStorageRecoveryReason;
    };

const MANIFEST_NAME_PATTERN = /^manifest\.(\d+)\.json$/;
const BLOB_NAME_PATTERN = /^[a-f0-9]{64}\.(\d+)\.json$/;

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

function writeChanges(
  changes: ElectronStateCommitChanges,
): CommitInput['produce'] {
  return async (writer) => {
    for (const [key, value] of changes) {
      if (value === undefined) writer.remove(key);
      else await writer.put(key, value);
    }
  };
}

async function streamSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
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
  private highestOccupiedGeneration = 0;

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

  async initialize(): Promise<ElectronStateInitialization> {
    const currentResult = await this.tryLoadCurrent();
    if (currentResult.kind === 'recovery-required') {
      throw new StateStorageRecoveryRequiredError(currentResult.reason);
    }
    if (currentResult.kind === 'valid') {
      await this.scanOccupiedGenerations();
      return { kind: 'current', manifest: currentResult.manifest };
    }
    return { kind: 'legacy', legacyFilePath: this.legacyFilePath };
  }

  async readValue(blob: ElectronStateBlob): Promise<JsonValue> {
    const blobPath = path.join(this.v2RootPath, blob.relativePath);
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(blobPath);
    } catch {
      throw new StateStorageRecoveryRequiredError('blob-missing');
    }
    if (bytes.byteLength !== blob.byteLength) {
      throw new StateStorageRecoveryRequiredError('blob-length-mismatch');
    }
    if (sha256(bytes) !== blob.sha256) {
      throw new StateStorageRecoveryRequiredError('blob-hash-mismatch');
    }
    const parsed = electronStateJsonValueSchema.safeParse(
      this.parseBlobText(bytes),
    );
    if (!parsed.success) {
      throw new StateStorageRecoveryRequiredError('blob-hash-mismatch');
    }
    return parsed.data;
  }

  async readPointer(): Promise<ElectronStateCurrentPointer> {
    return electronStateCurrentPointerSchema.parse(
      await readJsonFile(this.currentPath),
    );
  }

  async loadPublishedManifest(
    pointer: ElectronStateCurrentPointer,
  ): Promise<ElectronStateManifest> {
    const manifestBytes = await fs.readFile(
      path.join(this.v2RootPath, pointer.manifestRelativePath),
    );
    if (sha256(manifestBytes) !== pointer.manifestSha256) {
      throw new StateStorageRecoveryRequiredError('manifest-invalid');
    }
    const manifest = electronStateManifestSchema.parse(
      JSON.parse(manifestBytes.toString('utf8')) as unknown,
    );
    if (!manifestMatchesCurrentPointer(manifest, pointer)) {
      throw new StateStorageRecoveryRequiredError('manifest-invalid');
    }
    for (const blob of Object.values(manifest.values)) {
      if (blob.generation !== manifest.generation) continue;
      const reason = await this.verifyBlob(blob);
      if (reason) throw new StateStorageRecoveryRequiredError(reason);
    }
    return manifest;
  }

  async commitInitialStream(
    sourceV1Sha256: string,
    produce: (sink: ElectronStateInitialSink) => Promise<void>,
  ): Promise<ElectronStateManifest> {
    await this.quarantineIncompleteV2();
    await this.scanOccupiedGenerations();
    return await this.commit({
      produce: (writer) =>
        produce({ put: (key, value) => writer.put(key, value) }),
      previous: null,
      sourceV1Sha256,
      commitKind: 'migration',
    });
  }

  async commitMutation(
    changes: ElectronStateCommitChanges,
    previous: ElectronStateManifest,
  ): Promise<ElectronStateManifest> {
    return await this.commit({
      produce: writeChanges(changes),
      previous,
      sourceV1Sha256: previous.sourceV1Sha256,
      commitKind: 'mutation',
    });
  }

  async commitMigration(
    changes: ElectronStateCommitChanges,
    previous: ElectronStateManifest,
  ): Promise<ElectronStateManifest> {
    if (previous.mutationEpoch > 0) {
      return await this.commitMutation(changes, previous);
    }
    return await this.commit({
      produce: writeChanges(changes),
      previous,
      sourceV1Sha256: previous.sourceV1Sha256,
      commitKind: 'migration',
    });
  }

  private parseBlobText(bytes: Buffer): unknown {
    try {
      return JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
      throw new StateStorageRecoveryRequiredError('blob-hash-mismatch');
    }
  }

  private async tryLoadCurrent(): Promise<CurrentLoadResult> {
    if (!(await exists(this.v2RootPath))) return { kind: 'retry-v1' };

    let pointer: ElectronStateCurrentPointer | null = null;
    try {
      pointer = await this.readPointer();
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

    for (const blob of Object.values(manifest.values)) {
      const reason = await this.verifyBlob(blob);
      if (reason) return this.invalidCurrent(pointer, reason);
    }
    return { kind: 'valid', manifest };
  }

  private async verifyBlob(
    blob: ElectronStateBlob,
  ): Promise<StateStorageRecoveryReason | null> {
    const blobPath = path.join(this.v2RootPath, blob.relativePath);
    let byteLength: number | null = null;
    try {
      byteLength = (await fs.stat(blobPath)).size;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (byteLength === null) return 'blob-missing';
    if (byteLength !== blob.byteLength) return 'blob-length-mismatch';
    const digest = await streamSha256(blobPath);
    return digest === blob.sha256 ? null : 'blob-hash-mismatch';
  }

  private invalidCurrent(
    pointer: ElectronStateCurrentPointer,
    reason: StateStorageRecoveryReason,
  ): CurrentLoadResult {
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
      if (!MANIFEST_NAME_PATTERN.test(name)) continue;
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

  private async scanOccupiedGenerations(): Promise<void> {
    const occupied = await Promise.all([
      this.highestGenerationIn(this.manifestsPath, MANIFEST_NAME_PATTERN),
      this.highestGenerationIn(this.valuesPath, BLOB_NAME_PATTERN),
    ]);
    this.highestOccupiedGeneration = Math.max(
      this.highestOccupiedGeneration,
      ...occupied,
    );
  }

  private async highestGenerationIn(
    directory: string,
    pattern: RegExp,
  ): Promise<number> {
    let names: string[];
    try {
      names = await fs.readdir(directory);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw error;
    }
    let highest = 0;
    for (const name of names) {
      const match = pattern.exec(name);
      if (!match) continue;
      const generation = Number.parseInt(match[1], 10);
      if (Number.isSafeInteger(generation) && generation > highest) {
        highest = generation;
      }
    }
    return highest;
  }

  private async quarantineIncompleteV2(): Promise<void> {
    if (!(await exists(this.v2RootPath))) return;
    const quarantinePath = `${this.v2RootPath}.quarantine.${randomUUID()}`;
    await fs.rename(this.v2RootPath, quarantinePath);
  }

  private async commit(input: CommitInput): Promise<ElectronStateManifest> {
    const generation =
      Math.max(
        input.previous?.generation ?? 0,
        this.highestOccupiedGeneration,
      ) + 1;
    this.highestOccupiedGeneration = generation;
    let phase: ElectronStateCommitPhase = 'pre-publication';
    try {
      return await this.writeGeneration(input, generation, () => {
        phase = 'post-publication';
      });
    } catch (error: unknown) {
      throw new ElectronStateCommitError(phase, generation, error);
    }
  }

  private async writeGeneration(
    input: CommitInput,
    generation: number,
    onPublishing: () => void,
  ): Promise<ElectronStateManifest> {
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
    const written = new Set<string>();
    await input.produce({
      put: async (key, value) => {
        if (written.has(key)) {
          throw new Error('A generation cannot write the same key twice');
        }
        written.add(key);
        blobs[key] = await this.writeBlob(key, value, generation, operationId);
      },
      remove: (key) => {
        delete blobs[key];
      },
    });

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
      manifestRelativePath: `manifests/${manifestName}`,
      manifestSha256: sha256(manifestBytes),
    };
    electronStateCurrentPointerSchema.parse(pointer);
    const pointerBytes = Buffer.from(JSON.stringify(pointer), 'utf8');
    await this.writeFlushRenameVerify(
      `${this.currentPath}.${operationId}.tmp`,
      this.currentPath,
      pointerBytes,
      'current',
      onPublishing,
    );
    await this.sweepStagingAfterCommit();
    return manifest;
  }

  private async writeBlob(
    key: string,
    value: JsonValue,
    generation: number,
    operationId: string,
  ): Promise<ElectronStateBlob> {
    const bytes = Buffer.from(JSON.stringify(value), 'utf8');
    const fileName = `${sha256(Buffer.from(key, 'utf8'))}.${generation}.json`;
    const finalPath = path.join(this.valuesPath, fileName);
    await this.writeFlushRenameVerify(
      `${finalPath}.${operationId}.tmp`,
      finalPath,
      bytes,
      'blob',
    );
    return {
      relativePath: `values/${fileName}`,
      generation,
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
    };
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
    beforeRename?: () => void,
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
    beforeRename?.();
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
