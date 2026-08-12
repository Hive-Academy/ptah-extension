import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import type {
  MemoryCuratorService,
  MemoryTriggerService,
} from '@ptah-extension/memory-curator';
import type {
  SkillSynthesisService,
  SkillTriggerService,
} from '@ptah-extension/skill-synthesis';
import type { CronScheduler } from '@ptah-extension/cron-scheduler';

/**
 * Console prefix used when the host does not supply one. Hosts that already
 * ship a recognisable prefix (the Electron main process uses
 * `[Ptah Electron]`) pass their own so log output is unchanged by this
 * library's introduction.
 */
export const DEFAULT_THOTH_LOG_PREFIX = '[Ptah Thoth]';

export interface BootThothRuntimeOptions {
  /**
   * Active workspace root, or `undefined` when no folder is open. Gates the
   * memory-enabled lookup, the code-symbol indexer wiring and the workspace
   * file index.
   */
  workspaceRoot: string | undefined;
  /** Console prefix. Defaults to {@link DEFAULT_THOTH_LOG_PREFIX}. */
  logPrefix?: string;
}

export interface StartThothCronOptions {
  /** Console prefix. Defaults to {@link DEFAULT_THOTH_LOG_PREFIX}. */
  logPrefix?: string;
}

/**
 * Long-lived handles produced by the Thoth boot. Every field is nullable:
 * a subsystem that is unregistered or failed to start leaves its slot `null`
 * and the host's teardown chain must tolerate that.
 *
 * Field names are load-bearing — hosts capture them directly for their LIFO
 * shutdown chain.
 */
export interface ThothRuntimeRefs {
  /**
   * SQLite connection service handle for orderly shutdown. Null when
   * persistence-sqlite registration failed.
   */
  sqliteConnection: SqliteConnectionService | null;
  /**
   * Memory curator service handle for orderly shutdown. Null when
   * memory-curator registration or `start()` failed.
   */
  memoryCurator: MemoryCuratorService | null;
  /**
   * Memory trigger service handle for orderly shutdown. Null when the
   * parent memory curator did not start or `start()` failed. Must be
   * stopped BEFORE the memory curator in the LIFO teardown chain.
   */
  memoryTrigger: MemoryTriggerService | null;
  /**
   * Skill synthesis service handle for orderly shutdown. Null when
   * persistence-sqlite is unavailable or `start()` failed.
   */
  skillSynthesis: SkillSynthesisService | null;
  /**
   * Skill trigger service handle for orderly shutdown. Null when the
   * parent skill synthesis did not start or `start()` failed. Must be
   * stopped BEFORE the skill synthesis in the LIFO teardown chain.
   */
  skillTrigger: SkillTriggerService | null;
  /**
   * Cron scheduler handle for orderly shutdown. Populated by
   * `startThothCron`, not by `bootThothRuntime`. Null when
   * persistence-sqlite is unavailable, croner is missing, or `start()`
   * failed.
   */
  cronScheduler: CronScheduler | null;
  /**
   * Chokidar file-system watcher for incremental code symbol re-indexing.
   * Null when SQLite is unavailable or CodeSymbolIndexer is not registered.
   * Must be closed on teardown to avoid keeping the process alive.
   */
  symbolWatcher: import('chokidar').FSWatcher | null;
  /**
   * Disposables for the vec + embedder status push-event bridges. Null when
   * SQLite/memory-curator failed to register so the bridge could not be
   * wired. Must be disposed in the teardown LIFO chain.
   */
  statusBridgeDisposables: ReadonlyArray<{ dispose: () => void }> | null;
}

export function emptyThothRuntimeRefs(): ThothRuntimeRefs {
  return {
    sqliteConnection: null,
    memoryCurator: null,
    memoryTrigger: null,
    skillSynthesis: null,
    skillTrigger: null,
    cronScheduler: null,
    symbolWatcher: null,
    statusBridgeDisposables: null,
  };
}
