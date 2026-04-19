/**
 * Prompt Cache Service
 *
 * TASK_2025_137 Batch 3: Smart caching for generated prompt designs
 * with file-based invalidation and VS Code globalState persistence.
 *
 * Features:
 * - Dual-layer cache (in-memory + persisted)
 * - Automatic invalidation on config file changes
 * - Manual regeneration support
 * - 7-day TTL with grace period
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  PromptDesignerOutput,
  CachedPromptDesign,
} from './prompt-designer.types';
import {
  computeHash,
  generateCacheKey,
  extractDependencyInfo,
  isCacheExpired,
  isInvalidationTrigger,
  getInvalidationReason,
  createInvalidationEvent,
  DEFAULT_CACHE_TTL_MS,
  CACHE_CONFIG_VERSION,
  type CacheKeyComponents,
  type InvalidationEvent,
  type InvalidationReason,
} from './cache-invalidation';

/**
 * VS Code ExtensionContext interface (minimal)
 */
interface IExtensionContext {
  globalState: {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void>;
  };
}

/**
 * FileSystemManager interface for file watching
 */
interface IFileSystemManager {
  createWatcher(config: {
    id: string;
    pattern: string;
    ignoreCreateEvents?: boolean;
    ignoreDeleteEvents?: boolean;
  }): IFileWatcher;
  disposeWatcher(watcherId: string): boolean;
  readFile(path: string): Promise<{ isOk: () => boolean; value?: string }>;
}

/**
 * File watcher interface
 */
interface IFileWatcher {
  onDidChange(callback: (uri: { fsPath: string }) => void): void;
  onDidCreate(callback: (uri: { fsPath: string }) => void): void;
  onDidDelete(callback: (uri: { fsPath: string }) => void): void;
}

/**
 * Storage key prefix for globalState
 */
const STORAGE_KEY_PREFIX = 'ptah.promptDesign.cache';

/**
 * Watcher ID for cache invalidation
 */
const CACHE_WATCHER_ID = 'prompt-design-cache-invalidation';

/**
 * Maximum number of entries in the in-memory cache.
 * Uses LRU eviction via Map insertion order when limit is reached.
 */
const MAX_CACHE_ENTRIES = 20;

/**
 * Configuration for the cache service
 */
export interface PromptCacheConfig {
  /** Time-to-live in milliseconds (default: 7 days) */
  ttlMs: number;
  /** Enable file watching for auto-invalidation */
  enableFileWatching: boolean;
  /** Grace period after TTL before hard expiration (default: 1 day) */
  gracePeriodMs: number;
}

/**
 * Default cache configuration
 */
export const DEFAULT_CACHE_CONFIG: PromptCacheConfig = {
  ttlMs: DEFAULT_CACHE_TTL_MS,
  enableFileWatching: true,
  gracePeriodMs: 24 * 60 * 60 * 1000, // 1 day
};

/**
 * Cache entry stored in memory
 */
interface InMemoryCacheEntry {
  output: PromptDesignerOutput;
  cacheKey: string;
  cachedAt: number;
  workspacePath: string;
  dependencyHash: string;
}

/**
 * Persisted cache structure in globalState
 */
interface PersistedCacheData {
  entries: Record<string, CachedPromptDesign>;
  version: string;
}

/**
 * PromptCacheService - Smart caching for prompt designs
 *
 * Provides:
 * - Fast in-memory access for active sessions
 * - Persistent storage across VS Code restarts
 * - Automatic invalidation on workspace changes
 * - Manual regeneration trigger
 */
@injectable()
export class PromptCacheService {
  private config: PromptCacheConfig = DEFAULT_CACHE_CONFIG;
  private inMemoryCache: Map<string, InMemoryCacheEntry> = new Map();
  private watcherInitialized = false;
  private invalidationCallbacks: Set<(event: InvalidationEvent) => void> =
    new Set();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: IExtensionContext,
    @inject(TOKENS.FILE_SYSTEM_MANAGER)
    private readonly fileManager: IFileSystemManager,
  ) {}

  /**
   * Configure the cache service
   */
  configure(config: Partial<PromptCacheConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.debug('PromptCacheService: Configuration updated', {
      ttlMs: this.config.ttlMs,
      enableFileWatching: this.config.enableFileWatching,
    });
  }

  /**
   * Get cached prompt design for a workspace
   *
   * @param workspacePath - Workspace to get cache for
   * @param dependencyHash - Current dependency hash
   * @returns Cached output or null if not found/expired
   */
  async get(
    workspacePath: string,
    dependencyHash: string,
  ): Promise<PromptDesignerOutput | null> {
    const cacheKey = this.buildCacheKey(workspacePath, dependencyHash);

    // Check in-memory cache first
    const memoryEntry = this.inMemoryCache.get(cacheKey);
    if (memoryEntry && !this.isExpired(memoryEntry.cachedAt)) {
      this.logger.debug('PromptCacheService: Memory cache hit', { cacheKey });
      // LRU touch: delete and re-insert to move to end (most recently used)
      this.inMemoryCache.delete(cacheKey);
      this.inMemoryCache.set(cacheKey, memoryEntry);
      return memoryEntry.output;
    }

    // Check persisted cache
    const persisted = await this.loadFromStorage(cacheKey);
    if (persisted && !this.isExpired(persisted.cachedAt)) {
      this.logger.debug('PromptCacheService: Storage cache hit', { cacheKey });

      // Promote to in-memory cache (enforce LRU limit)
      this.ensureCapacity();
      this.inMemoryCache.set(cacheKey, {
        output: persisted.output,
        cacheKey,
        cachedAt: persisted.cachedAt,
        workspacePath,
        dependencyHash,
      });

      return persisted.output;
    }

    // Check for stale cache with grace period
    if (persisted && this.isInGracePeriod(persisted.cachedAt)) {
      this.logger.info(
        'PromptCacheService: Using stale cache in grace period',
        {
          cacheKey,
          age: Date.now() - persisted.cachedAt,
        },
      );
      return persisted.output;
    }

    this.logger.debug('PromptCacheService: Cache miss', { cacheKey });
    return null;
  }

  /**
   * Store prompt design in cache
   *
   * @param workspacePath - Workspace path
   * @param dependencyHash - Current dependency hash
   * @param output - Generated output to cache
   */
  async set(
    workspacePath: string,
    dependencyHash: string,
    output: PromptDesignerOutput,
  ): Promise<void> {
    const cacheKey = this.buildCacheKey(workspacePath, dependencyHash);
    const cachedAt = Date.now();

    // Enforce capacity before inserting
    this.ensureCapacity();

    // Store in memory
    this.inMemoryCache.set(cacheKey, {
      output,
      cacheKey,
      cachedAt,
      workspacePath,
      dependencyHash,
    });

    // Persist to storage
    await this.saveToStorage(cacheKey, {
      output,
      inputHash: dependencyHash,
      cachedAt,
      ttl: this.config.ttlMs,
    });

    this.logger.info('PromptCacheService: Cached prompt design', {
      cacheKey,
      totalTokens: output.totalTokens,
    });

    // Initialize file watcher if enabled
    if (this.config.enableFileWatching && !this.watcherInitialized) {
      this.initializeFileWatcher(workspacePath);
    }
  }

  /**
   * Invalidate cache for a workspace
   *
   * @param workspacePath - Workspace to invalidate
   * @param reason - Reason for invalidation
   */
  async invalidate(
    workspacePath: string,
    reason: InvalidationReason = 'manual',
  ): Promise<void> {
    // Find and remove matching entries from memory
    const keysToRemove: string[] = [];
    for (const [key, entry] of this.inMemoryCache) {
      if (entry.workspacePath === workspacePath) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => this.inMemoryCache.delete(key));

    // Remove from persistent storage
    await this.removeFromStorage(workspacePath);

    this.logger.info('PromptCacheService: Cache invalidated', {
      workspacePath,
      reason,
      entriesRemoved: keysToRemove.length,
    });

    // Notify callbacks
    const event = createInvalidationEvent(reason, workspacePath);
    this.notifyInvalidation(event);
  }

  /**
   * Register callback for invalidation events
   *
   * @param callback - Function to call on invalidation
   * @returns Unsubscribe function
   */
  onInvalidation(callback: (event: InvalidationEvent) => void): () => void {
    this.invalidationCallbacks.add(callback);
    return () => this.invalidationCallbacks.delete(callback);
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    memoryEntries: number;
    oldestEntry: number | null;
    newestEntry: number | null;
  } {
    const entries = Array.from(this.inMemoryCache.values());
    const timestamps = entries.map((e) => e.cachedAt);

    return {
      memoryEntries: entries.length,
      oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : null,
      newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : null,
    };
  }

  /**
   * Clear all cached entries
   */
  async clearAll(): Promise<void> {
    this.inMemoryCache.clear();

    // Clear persisted data
    await this.context.globalState.update(STORAGE_KEY_PREFIX, undefined);

    this.logger.info('PromptCacheService: All caches cleared');
  }

  /**
   * Compute dependency hash for a workspace
   *
   * @param workspacePath - Workspace path
   * @returns Dependency hash or null if package.json not found
   */
  async computeDependencyHash(workspacePath: string): Promise<string | null> {
    const packageJsonPath = `${workspacePath}/package.json`;

    try {
      const result = await this.fileManager.readFile(packageJsonPath);
      if (!result.isOk() || !result.value) {
        return null;
      }

      const depInfo = extractDependencyInfo(result.value);
      return depInfo ? computeHash(depInfo) : null;
    } catch {
      return null;
    }
  }

  /**
   * Build cache key from components
   */
  private buildCacheKey(workspacePath: string, dependencyHash: string): string {
    const components: CacheKeyComponents = {
      workspacePath,
      dependencyHash,
      configVersion: CACHE_CONFIG_VERSION,
    };
    return generateCacheKey(components);
  }

  /**
   * Ensure in-memory cache has room for a new entry.
   * Sweeps expired entries first, then applies LRU eviction if still at capacity.
   * Called from both set() and get() storage promotion paths.
   */
  private ensureCapacity(): void {
    this.sweepExpiredEntries();
    if (this.inMemoryCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.inMemoryCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.inMemoryCache.delete(oldestKey);
        this.logger.debug('PromptCacheService: LRU evicted oldest entry', {
          evictedKey: oldestKey,
        });
      }
    }
  }

  /**
   * Sweep expired entries from the in-memory cache.
   * Called before inserting new entries to reclaim space proactively.
   */
  private sweepExpiredEntries(): void {
    const keysToRemove: string[] = [];
    for (const [key, entry] of this.inMemoryCache) {
      if (this.isExpired(entry.cachedAt)) {
        keysToRemove.push(key);
      }
    }
    if (keysToRemove.length > 0) {
      for (const key of keysToRemove) {
        this.inMemoryCache.delete(key);
      }
      this.logger.debug('PromptCacheService: Swept expired entries', {
        removedCount: keysToRemove.length,
      });
    }
  }

  /**
   * Check if cache entry has expired
   */
  private isExpired(cachedAt: number): boolean {
    return isCacheExpired(cachedAt, this.config.ttlMs);
  }

  /**
   * Check if cache entry is in grace period
   */
  private isInGracePeriod(cachedAt: number): boolean {
    const totalExpiry = this.config.ttlMs + this.config.gracePeriodMs;
    return !isCacheExpired(cachedAt, totalExpiry);
  }

  /**
   * Load cache entry from persistent storage
   */
  private async loadFromStorage(
    cacheKey: string,
  ): Promise<CachedPromptDesign | null> {
    const data =
      this.context.globalState.get<PersistedCacheData>(STORAGE_KEY_PREFIX);

    if (!data || data.version !== CACHE_CONFIG_VERSION) {
      return null;
    }

    return data.entries[cacheKey] || null;
  }

  /**
   * Save cache entry to persistent storage
   */
  private async saveToStorage(
    cacheKey: string,
    entry: CachedPromptDesign,
  ): Promise<void> {
    const existingData = this.context.globalState.get<PersistedCacheData>(
      STORAGE_KEY_PREFIX,
    ) || { entries: {}, version: CACHE_CONFIG_VERSION };

    // Ensure version matches
    if (existingData.version !== CACHE_CONFIG_VERSION) {
      // Clear old version data
      existingData.entries = {};
      existingData.version = CACHE_CONFIG_VERSION;
    }

    existingData.entries[cacheKey] = entry;

    await this.context.globalState.update(STORAGE_KEY_PREFIX, existingData);
  }

  /**
   * Remove workspace entries from persistent storage
   */
  private async removeFromStorage(workspacePath: string): Promise<void> {
    const data =
      this.context.globalState.get<PersistedCacheData>(STORAGE_KEY_PREFIX);

    if (!data) {
      return;
    }

    // Remove entries matching workspace path
    const workspaceHash = computeHash(workspacePath);
    const keysToRemove = Object.keys(data.entries).filter((key) =>
      key.includes(workspaceHash),
    );

    keysToRemove.forEach((key) => delete data.entries[key]);

    await this.context.globalState.update(STORAGE_KEY_PREFIX, data);
  }

  /**
   * Initialize file watcher for invalidation triggers
   */
  private initializeFileWatcher(workspacePath: string): void {
    if (this.watcherInitialized) {
      return;
    }

    try {
      // Create watcher for all trigger patterns
      // Note: VS Code file watchers support glob patterns
      const watcher = this.fileManager.createWatcher({
        id: CACHE_WATCHER_ID,
        pattern: `${workspacePath}/**/{package.json,tsconfig.json,angular.json,nx.json,.eslintrc.*}`,
        ignoreCreateEvents: false,
        ignoreDeleteEvents: false,
      });

      // Handle file changes
      const handleChange = (uri: { fsPath: string }) => {
        if (isInvalidationTrigger(uri.fsPath)) {
          const reason = getInvalidationReason(uri.fsPath);
          this.logger.info('PromptCacheService: Invalidation triggered', {
            file: uri.fsPath,
            reason,
          });
          this.invalidate(workspacePath, reason || 'file_changed');
        }
      };

      watcher.onDidChange(handleChange);
      watcher.onDidCreate(handleChange);
      watcher.onDidDelete(handleChange);

      this.watcherInitialized = true;
      this.logger.debug('PromptCacheService: File watcher initialized', {
        workspacePath,
      });
    } catch (error) {
      this.logger.warn(
        'PromptCacheService: Failed to initialize file watcher',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /**
   * Notify all invalidation callbacks
   */
  private notifyInvalidation(event: InvalidationEvent): void {
    this.invalidationCallbacks.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        this.logger.error('PromptCacheService: Invalidation callback error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.fileManager.disposeWatcher(CACHE_WATCHER_ID);
    this.inMemoryCache.clear();
    this.invalidationCallbacks.clear();
    this.watcherInitialized = false;
  }
}
