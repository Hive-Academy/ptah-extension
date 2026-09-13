/**
 * WorkspaceAwareStateStorage — IStateStorage proxy that delegates to
 * per-workspace IStateStorage instances based on the active workspace.
 *
 * Registered as PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, so all services that
 * inject workspace-scoped storage automatically get the active workspace's
 * storage without needing child containers.
 *
 * Key insight: RPC handler singletons inject WORKSPACE_STATE_STORAGE at
 * construction time. With child containers, they'd get the root container's
 * instance and never see workspace-specific data. This proxy solves that
 * by delegating at call-time to the active workspace's storage.
 *
 * The class is decoupled from `ElectronStateStorage` via the
 * `StateStorageFactory` type so this layer-1 library has no dependency on
 * `platform-electron` (a layer 0.5 implementation). Apps must inject a factory
 * that produces `IStateStorage` instances for a given storage directory.
 */

import { createHash } from 'crypto';
import {
  StateStorageCursorStaleError,
  StateStorageNotReadyError,
  StateStorageValueTooLargeError,
  hasStateStorageMaintenance,
  hasStateStorageReadiness,
  isAsyncStateStorage,
  jsonUtf8Bytes,
  omitJsonPaths,
  shrinkJsonStringLeaves,
  type IAsyncStateStorage,
  type IStateStorage,
  type IStateStorageMaintenance,
  type IStateStorageReadiness,
  type StateStorageArraySplitPlan,
  type StateStorageGetOptions,
  type StateStorageMigrationReceipt,
  type StateStorageReadinessState,
  type StateStorageSequencePage,
  type StateStorageSequenceReadOptions,
  type StateStorageSequenceWriteChunk,
  type StateStorageTruncatedItem,
} from '@ptah-extension/platform-core';

/**
 * Factory that produces an `IStateStorage` instance for a given storage
 * directory path. Implementations decide the on-disk format (e.g. Electron
 * uses `ElectronStateStorage` with `workspace-state.json`; CLI uses
 * `CliStateStorage`).
 */
export type StateStorageFactory = (storageDirPath: string) => IStateStorage;

interface DisposableStateStorage {
  dispose(): void | Promise<void>;
}

function hasStateStorageDisposal(
  storage: IStateStorage,
): storage is IStateStorage & DisposableStateStorage {
  return (
    typeof (storage as Partial<DisposableStateStorage>).dispose === 'function'
  );
}

const SYNC_SEQUENCE_CURSOR_PATTERN = /^s([0-9a-f]{16})\.(0|[1-9]\d*)$/;

function sequenceFingerprint(sequence: readonly unknown[]): string {
  return createHash('sha256')
    .update(JSON.stringify(sequence))
    .digest('hex')
    .slice(0, 16);
}

function readSyncSequencePage<T>(
  key: string,
  value: unknown,
  cursor: string | undefined,
  options: StateStorageSequenceReadOptions | undefined,
): StateStorageSequencePage<T> {
  if (value !== undefined && !Array.isArray(value)) {
    throw new Error(`State storage value is not a sequence: ${key}`);
  }
  const sequence: readonly unknown[] = value ?? [];
  const fingerprint =
    value === undefined ? null : sequenceFingerprint(sequence);
  let start = 0;
  if (cursor !== undefined) {
    const match = SYNC_SEQUENCE_CURSOR_PATTERN.exec(cursor);
    const index = match ? Number(match[2]) : Number.NaN;
    if (
      !match ||
      match[1] !== fingerprint ||
      !Number.isSafeInteger(index) ||
      index > sequence.length
    ) {
      throw new StateStorageCursorStaleError(key);
    }
    start = index;
  }
  const maxBytes = options?.maxBytes ?? Number.POSITIVE_INFINITY;
  const maxJsonBytes = options?.maxJsonBytes ?? Number.POSITIVE_INFINITY;
  const maxItemBytes = options?.maxItemBytes ?? Number.POSITIVE_INFINITY;
  const items: unknown[] = [];
  let truncatedItem: StateStorageTruncatedItem | null = null;
  let pageBytes = 2;
  let jsonBytes = options?.jsonEnvelopeBytes ?? 2;
  let index = start;
  while (index < sequence.length) {
    const item = sequence[index];
    const itemJson = jsonUtf8Bytes(item);
    const separator = items.length > 0 ? 1 : 0;
    if (
      pageBytes + separator + itemJson <= maxBytes &&
      jsonBytes + separator + itemJson <= maxJsonBytes &&
      itemJson <= maxItemBytes
    ) {
      items.push(item);
      pageBytes += separator + itemJson;
      jsonBytes += separator + itemJson;
      index++;
      continue;
    }
    if (items.length > 0) break;
    const shrunk = shrinkJsonStringLeaves(item, {
      maxEstimatorBytes: maxBytes - pageBytes,
      maxJsonBytes: Math.min(maxJsonBytes - jsonBytes, maxItemBytes),
      estimate: jsonUtf8Bytes,
    });
    if (shrunk === null) {
      throw new StateStorageValueTooLargeError(key, itemJson);
    }
    items.push(shrunk);
    jsonBytes += jsonUtf8Bytes(shrunk);
    truncatedItem = { index: 0, originalJsonBytes: itemJson };
    index++;
    break;
  }
  const done = index >= sequence.length;
  return {
    items: items as T[],
    nextCursor: done ? null : `s${fingerprint}.${index}`,
    done,
    approximateBytes: jsonBytes,
    ...(truncatedItem ? { truncatedItems: [truncatedItem] } : {}),
  };
}

export class WorkspaceAwareStateStorage
  implements
    IAsyncStateStorage,
    IStateStorageReadiness,
    IStateStorageMaintenance
{
  private readonly workspaces = new Map<string, IStateStorage>();
  private activeWorkspacePath: string | null = null;
  private readonly defaultStorage: IStateStorage;

  constructor(
    defaultStoragePath: string,
    private readonly storageFactory: StateStorageFactory,
  ) {
    this.defaultStorage = storageFactory(defaultStoragePath);
  }

  /**
   * Add a workspace with its own IStateStorage instance.
   * If the workspace already exists, this is a no-op.
   */
  addWorkspace(workspacePath: string, storageDirPath: string): void {
    if (this.workspaces.has(workspacePath)) {
      return;
    }
    this.workspaces.set(workspacePath, this.storageFactory(storageDirPath));
  }

  /**
   * Remove a workspace's storage instance, allowing it to be garbage collected.
   * If the removed workspace was active, resets to null (falls back to default).
   */
  removeWorkspace(workspacePath: string): void {
    const storage = this.workspaces.get(workspacePath);
    this.workspaces.delete(workspacePath);
    if (storage && hasStateStorageDisposal(storage)) {
      // degradation-audit: optional-capability - the workspace is already out
      // of the map and unreachable by the time this runs, so a failed dispose
      // costs a released handle and nothing a caller can act on. Removal must
      // not fail because a detached storage refused to close.
      void Promise.resolve(storage.dispose()).catch(() => undefined);
    }
    if (this.activeWorkspacePath === workspacePath) {
      this.activeWorkspacePath = null;
    }
  }

  /**
   * Switch the active workspace. All subsequent get/update/keys calls
   * will delegate to this workspace's storage.
   */
  setActiveWorkspace(workspacePath: string): void {
    const storage = this.workspaces.get(workspacePath);
    if (!storage) {
      throw new Error(
        `Cannot set active workspace: no storage registered for "${workspacePath}". Call addWorkspace() first.`,
      );
    }
    if (
      hasStateStorageReadiness(storage) &&
      storage.getReadinessState().status !== 'ready'
    ) {
      throw new StateStorageNotReadyError(
        `Workspace state storage is not ready for "${workspacePath}"`,
      );
    }
    this.activeWorkspacePath = workspacePath;
  }

  /** Await a registered delegate without changing the currently active one. */
  async whenWorkspaceReady(workspacePath: string): Promise<void> {
    const storage = this.workspaces.get(workspacePath);
    if (!storage) {
      throw new Error(`No state storage is registered for "${workspacePath}"`);
    }
    if (hasStateStorageReadiness(storage)) await storage.whenReady();
  }

  /**
   * Get the currently active workspace path, or null if none is set.
   */
  getActiveWorkspacePath(): string | null {
    return this.activeWorkspacePath;
  }

  /**
   * Get all registered workspace paths.
   */
  getAllWorkspacePaths(): string[] {
    return Array.from(this.workspaces.keys());
  }

  /**
   * Get a value from the active workspace's storage.
   * Falls back to default storage if no workspace is active.
   */
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.getActiveStorage().get<T>(key, defaultValue);
  }

  /**
   * Update a value in the active workspace's storage.
   * Falls back to default storage if no workspace is active.
   */
  async update(key: string, value: unknown): Promise<void> {
    await this.getActiveStorage().update(key, value);
  }

  async getAsync<T>(
    key: string,
    defaultValue?: T,
    options?: StateStorageGetOptions,
  ): Promise<T | undefined> {
    const storage = this.getActiveStorage();
    if (isAsyncStateStorage(storage)) {
      return await storage.getAsync(key, defaultValue, options);
    }
    const value = storage.get(key, defaultValue);
    return options?.projection && value !== undefined
      ? omitJsonPaths(value, options.projection.omit)
      : value;
  }

  async *readJsonSequence<T>(
    key: string,
    options?: StateStorageSequenceReadOptions,
  ): AsyncIterable<StateStorageSequencePage<T>> {
    const storage = this.getActiveStorage();
    if (isAsyncStateStorage(storage)) {
      yield* storage.readJsonSequence<T>(key, options);
      return;
    }
    let cursor = options?.cursor;
    do {
      const page = readSyncSequencePage<T>(
        key,
        storage.get<unknown>(key),
        cursor,
        options,
      );
      yield page;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  async replaceJsonSequence<T>(
    key: string,
    chunks: AsyncIterable<StateStorageSequenceWriteChunk<T>>,
  ): Promise<void> {
    const storage = this.getActiveStorage();
    if (isAsyncStateStorage(storage)) {
      await storage.replaceJsonSequence(key, chunks);
      return;
    }
    const items: T[] = [];
    for await (const chunk of chunks) items.push(...chunk.items);
    await storage.update(key, items);
  }

  getReadinessState(): StateStorageReadinessState {
    const storage = this.getActiveStorage();
    return hasStateStorageReadiness(storage)
      ? storage.getReadinessState()
      : { status: 'ready' };
  }

  async whenReady(): Promise<void> {
    const storage = this.getActiveStorage();
    if (hasStateStorageReadiness(storage)) await storage.whenReady();
  }

  async splitArrayValue(
    plan: StateStorageArraySplitPlan,
  ): Promise<StateStorageMigrationReceipt> {
    const storage = this.getActiveStorage();
    if (hasStateStorageMaintenance(storage)) {
      return await storage.splitArrayValue(plan);
    }
    throw new Error(
      'Active workspace state storage does not support maintenance operations',
    );
  }

  /**
   * Get all keys from the active workspace's storage.
   * Falls back to default storage if no workspace is active.
   */
  keys(): readonly string[] {
    return this.getActiveStorage().keys();
  }

  /**
   * Get the storage instance for a specific workspace path.
   * Returns undefined if no storage is registered for that path.
   */
  getStorageForWorkspace(workspacePath: string): IStateStorage | undefined {
    return this.workspaces.get(workspacePath);
  }

  /**
   * Resolve the active storage delegate.
   * Returns the active workspace's storage if set, otherwise the default.
   */
  private getActiveStorage(): IStateStorage {
    if (this.activeWorkspacePath) {
      const storage = this.workspaces.get(this.activeWorkspacePath);
      if (storage) {
        return storage;
      }
      throw new Error(
        `Active workspace "${this.activeWorkspacePath}" has no registered storage`,
      );
    }
    return this.defaultStorage;
  }
}
