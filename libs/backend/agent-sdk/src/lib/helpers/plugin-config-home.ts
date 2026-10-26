/**
 * PluginConfigHome — one plugin configuration per harness root (D14).
 *
 * A multi-root host (Electron) keeps one state storage per OPENED folder, and
 * the plugin configuration used to live in whichever folder the user happened
 * to open. Two sub-folders of one repository then held two configurations, and
 * which one applied depended on which folder was open. The home moves that
 * configuration to ONE record per harness root, kept in global state storage
 * under `ptah.plugins.harnessConfig:<canonicalRootKey(root)>`, so it does not
 * depend on which folders are open.
 *
 * The folder records ("legacy records") are never written or deleted here.
 * They are read to decide what the home starts from:
 *
 * 1. Home record present → it governs. A legacy record that differs from it
 *    (and is not dismissed at its current `lastUpdated`) is reported as
 *    `differs`; it is kept, not applied.
 * 2. Home absent, no legacy record → nothing saved (empty default).
 * 3. Home absent, every legacy record equal → that configuration applies at
 *    once and one serialized write imports it (`origin: 'imported'`).
 * 4. Home absent, legacy records that differ → `conflict`. Nothing is
 *    written; reads use the latest `lastUpdated` (tie → lowest folder key)
 *    until the user adopts one. Lists are never merged.
 *
 * A plain class built by `PluginLoaderService.initialize`, not a DI service:
 * it exists only on a host that passes both home options.
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  PluginConfigHomeCandidate,
  PluginConfigHomeStatus,
  PluginConfigState,
} from '@ptah-extension/shared';
import type {
  IStateStorage,
  IWorkspaceScopedStateStorage,
} from '@ptah-extension/platform-core';
import { SdkError } from '../errors';

/** State storage key of a folder's (legacy) plugin configuration. */
export const PLUGIN_CONFIG_KEY = 'ptah.plugins.config';

/** Global state storage key prefix of a harness root's home record. */
export const PLUGIN_CONFIG_HOME_KEY_PREFIX = 'ptah.plugins.harnessConfig:';

/** The id lists a persisted `PluginConfigState` may carry. */
export const PLUGIN_CONFIG_LIST_FIELDS = [
  'enabledPluginIds',
  'disabledSkillIds',
  'disabledPluginIds',
  'disabledAgentIds',
  'enabledSkillIds',
] as const;

/** The shape every "no config to read" path returns. */
export function emptyPluginConfig(): PluginConfigState {
  return {
    enabledPluginIds: [],
    disabledSkillIds: [],
    disabledPluginIds: [],
    disabledAgentIds: [],
    lastUpdated: undefined,
  };
}

const PluginIdListSchema = z.array(z.string());

/**
 * A Zod field that reads as absent when its stored value is invalid, instead
 * of failing the whole record. This is a schema fallback, not a promise
 * handler.
 */
function absentWhenInvalid<T extends z.ZodTypeAny>(schema: T) {
  // degradation-audit: optional-capability - Zod schema fallback: an unusable optional field reads as absent; callers treat absent as the documented default
  return schema.optional().catch(undefined);
}

/**
 * `lastUpdated` is display and tie-break metadata, never policy: a stored value
 * that is not a string is discarded (read as absent) instead of failing a
 * config whose id lists are sound.
 */
const LastUpdatedSchema = absentWhenInvalid(z.string());

/**
 * A plugin config as it may be PERSISTED: `enabledPluginIds` is required, and
 * every other list may be absent because it did not exist when an older config
 * was saved (AC-3.2). A present list must be a list of strings. This is the
 * strict shape a policy reader and the home record trust.
 */
const StoredPluginConfigSchema = z.object({
  enabledPluginIds: PluginIdListSchema,
  disabledSkillIds: PluginIdListSchema.optional(),
  disabledPluginIds: PluginIdListSchema.optional(),
  disabledAgentIds: PluginIdListSchema.optional(),
  enabledSkillIds: PluginIdListSchema.optional(),
  lastUpdated: LastUpdatedSchema,
});

/**
 * The lenient shape the display reader accepts: an unusable optional list
 * reads as absent rather than discarding the whole config.
 */
const LenientPluginConfigSchema = StoredPluginConfigSchema.extend({
  disabledSkillIds: absentWhenInvalid(PluginIdListSchema),
  disabledPluginIds: absentWhenInvalid(PluginIdListSchema),
  disabledAgentIds: absentWhenInvalid(PluginIdListSchema),
  enabledSkillIds: absentWhenInvalid(PluginIdListSchema),
});

type StoredPluginConfig = z.infer<typeof StoredPluginConfigSchema>;

/**
 * A validated persisted config in the shape every reader returns. A missing
 * list reads as empty and `enabledSkillIds` appears only when it was stored, so
 * a config saved before a field existed reads exactly as it always did.
 */
function toPluginConfigState(stored: StoredPluginConfig): PluginConfigState {
  return {
    enabledPluginIds: stored.enabledPluginIds,
    disabledSkillIds: stored.disabledSkillIds ?? [],
    // Absent on every config persisted before harness plugins became
    // toggleable — read as "nothing explicitly disabled", which is exactly
    // the default-enabled behaviour those configs already had. No migration.
    disabledPluginIds: stored.disabledPluginIds ?? [],
    // Same idiom, same reason: absent on every config persisted before agents
    // became individually toggleable. No migration.
    disabledAgentIds: stored.disabledAgentIds ?? [],
    // TASK_2026_560: only an override of a global OFF, so absent means
    // "nothing overridden". Left out rather than defaulted to `[]` so a
    // pre-task config reads back unchanged.
    ...(stored.enabledSkillIds === undefined
      ? {}
      : { enabledSkillIds: stored.enabledSkillIds }),
    lastUpdated: stored.lastUpdated,
  };
}

/**
 * The strict read: the persisted value as a normalized config, or null when it
 * is not one a policy reader may trust (not an object, no `enabledPluginIds`
 * list, or a present id list that is not a list of strings).
 */
export function parsePluginConfig(stored: unknown): PluginConfigState | null {
  const parsed = StoredPluginConfigSchema.safeParse(stored);
  return parsed.success ? toPluginConfigState(parsed.data) : null;
}

/**
 * The lenient read every display path uses: anything without a usable
 * `enabledPluginIds` list reads as the empty default, and an unusable optional
 * list reads as absent.
 */
export function normalizePluginConfig(stored: unknown): PluginConfigState {
  const parsed = LenientPluginConfigSchema.safeParse(stored);
  return parsed.success ? toPluginConfigState(parsed.data) : emptyPluginConfig();
}

/** `realpath` of `root` (the resolved path when it cannot be read), folded on win32. */
export function canonicalRootKey(root: string): string {
  let canonical = path.resolve(root);
  try {
    canonical = fs.realpathSync.native(canonical);
  } catch {
    // degradation-audit: optional-capability - a missing or unreadable
    // folder still compares by its resolved path, which is the key it had.
  }
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

/** The five lists as sorted sets; absent `enabledSkillIds` reads as `[]`. */
function comparableLists(config: PluginConfigState): string {
  const sortedSet = (list: readonly string[] | undefined): string[] =>
    [...new Set(list ?? [])].sort((a, b) => Number(a > b) - Number(a < b));
  return JSON.stringify(
    PLUGIN_CONFIG_LIST_FIELDS.map((field) => sortedSet(config[field])),
  );
}

/** Equal when the five lists hold the same ids; `lastUpdated` is ignored. */
export function pluginConfigsEqual(
  a: PluginConfigState,
  b: PluginConfigState,
): boolean {
  return comparableLists(a) === comparableLists(b);
}

/** The persisted home record, as stored; its config is the strict shape. */
const PluginConfigHomeRecordSchema = z.object({
  version: z.literal(1),
  harnessRoot: z.string(),
  config: StoredPluginConfigSchema,
  origin: z.enum(['saved', 'imported', 'adopted']),
  sourceFolders: z.array(z.string()),
  dismissed: z.record(z.string(), z.string()),
});

/** How the home record came to exist. */
export type PluginConfigHomeOrigin = z.infer<
  typeof PluginConfigHomeRecordSchema
>['origin'];

/** The persisted home record of one harness root. */
export interface PluginConfigHomeRecord {
  version: 1;
  harnessRoot: string;
  config: PluginConfigState;
  origin: PluginConfigHomeOrigin;
  /** Folders whose legacy record this record was imported or adopted from. */
  sourceFolders: string[];
  /** Folder key → the legacy `lastUpdated` the user dismissed. */
  dismissed: Record<string, string>;
}

/** What the home storage holds for one root. */
type HomeRecordRead =
  | { kind: 'absent' }
  | { kind: 'malformed' }
  | { kind: 'record'; record: PluginConfigHomeRecord };

/** One folder under the root whose storage has a plugin config present. */
interface LegacyCandidate {
  folder: string;
  key: string;
  /** The stored value, passed through unchanged to a reader that uses it. */
  raw: unknown;
  wellFormed: boolean;
  config: PluginConfigState;
  lastUpdated?: string;
}

/** The governing answer for one root, before any write. */
type HomeResolution =
  | { kind: 'record'; record: PluginConfigHomeRecord }
  | { kind: 'malformed' }
  | { kind: 'empty' }
  | { kind: 'import'; candidates: LegacyCandidate[] }
  | { kind: 'unreadable'; candidate: LegacyCandidate }
  | {
      kind: 'conflict';
      governing: LegacyCandidate;
      candidates: LegacyCandidate[];
    };

/**
 * Returned by the home view for a malformed home record. It has no
 * `enabledPluginIds`, so the strict reader reports `error` and the lenient
 * reader returns the empty default, exactly as for a malformed folder record.
 */
const MALFORMED_HOME_VALUE = Object.freeze({ malformedPluginConfigHome: true });

function parseHomeRecord(value: unknown): HomeRecordRead {
  if (value === undefined || value === null) return { kind: 'absent' };
  const parsed = PluginConfigHomeRecordSchema.safeParse(value);
  if (!parsed.success) return { kind: 'malformed' };
  return {
    kind: 'record',
    record: { ...parsed.data, config: toPluginConfigState(parsed.data.config) },
  };
}

/** Latest `lastUpdated` wins; a tie goes to the lowest folder key. */
function governingCandidate(candidates: LegacyCandidate[]): LegacyCandidate {
  return candidates.reduce((best, next) => {
    const bestStamp = best.lastUpdated ?? '';
    const nextStamp = next.lastUpdated ?? '';
    if (nextStamp > bestStamp) return next;
    if (nextStamp === bestStamp && next.key < best.key) return next;
    return best;
  });
}

function candidateSummary(
  candidate: LegacyCandidate,
  differsFromHome: boolean,
): PluginConfigHomeCandidate {
  const { config } = candidate;
  return {
    folder: candidate.folder,
    ...(candidate.lastUpdated === undefined
      ? {}
      : { lastUpdated: candidate.lastUpdated }),
    enabledCount:
      config.enabledPluginIds.length + (config.enabledSkillIds?.length ?? 0),
    disabledCount:
      config.disabledSkillIds.length +
      (config.disabledPluginIds?.length ?? 0) +
      (config.disabledAgentIds?.length ?? 0),
    differsFromHome,
  };
}

export interface PluginConfigHomeOptions {
  /** The host's per-folder storage; read only. */
  folderStorage: IWorkspaceScopedStateStorage;
  /** Global state storage holding the home records. */
  homeStorage: IStateStorage;
  /** The harness root a folder belongs to (injected: no harness-sync edge). */
  harnessRootOf: (folder: string) => string;
  logger: Logger;
}

export class PluginConfigHome {
  /** Per record key: the tail of the write chain. Writes never overlap. */
  private readonly writeChains = new Map<string, Promise<void>>();

  /** Record keys with an import queued or running, so a read queues one. */
  private readonly pendingImports = new Set<string>();

  constructor(private readonly options: PluginConfigHomeOptions) {}

  /**
   * The harness root of `folder`. A `harnessRootOf` that throws is answered
   * with `folder` itself, so a reader never fails on the mapping.
   */
  harnessRootFor(folder: string): string {
    try {
      return path.resolve(this.options.harnessRootOf(folder));
    } catch (error: unknown) {
      this.options.logger.warn(
        '[PluginConfigHome] harnessRootOf failed; the folder is its own harness root',
        {
          folder,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return path.resolve(folder);
    }
  }

  /**
   * The `IStateStorage` view of `root`'s home over the single key
   * `ptah.plugins.config`. `get` returns the governing config (passing a
   * chosen legacy record through unchanged) and `update` writes the home
   * record. Any other key throws.
   */
  viewFor(root: string): IStateStorage {
    const assertKey = (key: string): void => {
      if (key !== PLUGIN_CONFIG_KEY) {
        throw new SdkError(
          `The plugin configuration home serves only ${PLUGIN_CONFIG_KEY}, not ${key}`,
        );
      }
    };
    return {
      get: <T>(key: string, defaultValue?: T): T | undefined => {
        assertKey(key);
        const value = this.governingValue(root);
        return value === undefined ? defaultValue : (value as T);
      },
      update: async (key: string, value: unknown): Promise<void> => {
        assertKey(key);
        const config = parsePluginConfig(value);
        if (config === null) {
          throw new SdkError(
            'Refusing to save a malformed plugin configuration',
          );
        }
        await this.save(root, config);
      },
      keys: (): readonly string[] =>
        this.governingValue(root) === undefined ? [] : [PLUGIN_CONFIG_KEY],
    };
  }

  /**
   * The notice for `root`, or null when nothing needs the user: the home
   * governs and nothing differs, nothing is saved anywhere, or the home record
   * is malformed (reported by the strict read instead). Never a config body.
   */
  status(root: string): PluginConfigHomeStatus | null {
    const harnessRoot = path.resolve(root);
    const resolution = this.resolve(harnessRoot);

    switch (resolution.kind) {
      case 'empty':
      case 'malformed':
      case 'unreadable':
        return null;
      case 'import':
        // `imported` only once the import is actually under way; a failed
        // import clears this and reports nothing until a read retries it.
        return this.pendingImports.has(this.recordKey(harnessRoot))
          ? {
              harnessRoot,
              state: 'imported',
              candidates: resolution.candidates.map((candidate) =>
                candidateSummary(candidate, false),
              ),
            }
          : null;
      case 'conflict':
        return {
          harnessRoot,
          state: 'conflict',
          governingFolder: resolution.governing.folder,
          candidates: resolution.candidates.map((candidate) =>
            candidateSummary(
              candidate,
              !this.candidateEquals(candidate, resolution.governing.config),
            ),
          ),
        };
      case 'record': {
        const { record } = resolution;
        const visible = this.candidatesOf(harnessRoot).filter(
          (candidate) =>
            record.dismissed[candidate.key] !== (candidate.lastUpdated ?? ''),
        );
        const candidates = visible.map((candidate) =>
          candidateSummary(
            candidate,
            !this.candidateEquals(candidate, record.config),
          ),
        );
        if (candidates.some((candidate) => candidate.differsFromHome)) {
          return { harnessRoot, state: 'differs', candidates };
        }
        const sourceKeys = new Set(record.sourceFolders.map(canonicalRootKey));
        if (
          record.origin === 'imported' &&
          visible.some((candidate) => sourceKeys.has(candidate.key))
        ) {
          return { harnessRoot, state: 'imported', candidates };
        }
        return null;
      }
    }
  }

  /**
   * Make `folder`'s legacy config the home of `root`, exactly (no union).
   *
   * @throws SdkError when `folder` holds no well-formed config under `root`,
   *   or when the record cannot be written (the record is then unchanged).
   */
  adopt(root: string, folder: string): Promise<void> {
    const harnessRoot = path.resolve(root);
    const recordKey = this.recordKey(harnessRoot);
    return this.enqueue(recordKey, async () => {
      const candidate = this.presentCandidate(harnessRoot, folder);
      if (!candidate.wellFormed) {
        throw new SdkError(
          `The plugin settings saved in ${folder} cannot be read, so they cannot be adopted`,
        );
      }
      const current = this.readRecord(harnessRoot);
      await this.writeRecord(recordKey, {
        version: 1,
        harnessRoot,
        config: candidate.config,
        origin: 'adopted',
        sourceFolders: [candidate.folder],
        dismissed: current.kind === 'record' ? current.record.dismissed : {},
      });
    });
  }

  /**
   * Hide `folder`'s notice until its legacy `lastUpdated` changes.
   *
   * @throws SdkError when `folder` holds no config under `root`, when `root`
   *   has no home record to record the dismissal in (a conflict is resolved by
   *   adopting), or when the record cannot be written.
   */
  dismiss(root: string, folder: string): Promise<void> {
    const harnessRoot = path.resolve(root);
    const recordKey = this.recordKey(harnessRoot);
    return this.enqueue(recordKey, async () => {
      const candidate = this.presentCandidate(harnessRoot, folder);
      const current = this.readRecord(harnessRoot);
      if (current.kind !== 'record') {
        throw new SdkError(
          `${harnessRoot} has no plugin settings of its own yet; choose the folder whose settings to use`,
        );
      }
      await this.writeRecord(recordKey, {
        ...current.record,
        dismissed: {
          ...current.record.dismissed,
          [candidate.key]: candidate.lastUpdated ?? '',
        },
      });
    });
  }

  /** A save through the view: the submitted config becomes the home. */
  private save(harnessRoot: string, config: PluginConfigState): Promise<void> {
    const recordKey = this.recordKey(harnessRoot);
    return this.enqueue(recordKey, async () => {
      const current = this.readRecord(harnessRoot);
      const base = current.kind === 'record' ? current.record : undefined;
      await this.writeRecord(recordKey, {
        version: 1,
        harnessRoot,
        config,
        origin: 'saved',
        sourceFolders: base?.sourceFolders ?? [],
        dismissed: base?.dismissed ?? {},
      });
    });
  }

  /** The value the view's `get` answers with; may queue the one-time import. */
  private governingValue(root: string): unknown {
    const harnessRoot = path.resolve(root);
    const resolution = this.resolve(harnessRoot);
    switch (resolution.kind) {
      case 'record':
        return resolution.record.config;
      case 'malformed':
        return MALFORMED_HOME_VALUE;
      case 'empty':
        return undefined;
      case 'import':
        this.queueImport(harnessRoot, resolution.candidates);
        return resolution.candidates[0].raw;
      case 'unreadable':
        return resolution.candidate.raw;
      case 'conflict':
        return resolution.governing.raw;
    }
  }

  /** The conflict rule for `harnessRoot`, from one read of each storage. */
  private resolve(harnessRoot: string): HomeResolution {
    const record = this.readRecord(harnessRoot);
    if (record.kind === 'record') return record;
    if (record.kind === 'malformed') return record;

    const candidates = this.candidatesOf(harnessRoot);
    if (candidates.length === 0) return { kind: 'empty' };

    const first = candidates[0];
    const allEqual = candidates.every((candidate) =>
      this.candidateEquals(candidate, first.config),
    );
    if (first.wellFormed && allEqual) return { kind: 'import', candidates };
    if (candidates.length === 1) {
      // A sole record that cannot be read is passed through to the strict
      // reader (policy unknown) and is never imported as an empty config.
      return { kind: 'unreadable', candidate: first };
    }
    return {
      kind: 'conflict',
      governing: governingCandidate(candidates),
      candidates,
    };
  }

  /** A malformed legacy record equals nothing, so it is never imported. */
  private candidateEquals(
    candidate: LegacyCandidate,
    config: PluginConfigState,
  ): boolean {
    return candidate.wellFormed && pluginConfigsEqual(candidate.config, config);
  }

  /**
   * Every registered folder of `harnessRoot` whose storage has the plugin
   * config PRESENT (neither `undefined` nor `null`). An intentionally saved
   * empty config is present. Ordered by folder key.
   */
  private candidatesOf(harnessRoot: string): LegacyCandidate[] {
    const rootKey = canonicalRootKey(harnessRoot);
    const candidates: LegacyCandidate[] = [];
    for (const folder of this.options.folderStorage.getAllWorkspacePaths()) {
      if (canonicalRootKey(this.harnessRootFor(folder)) !== rootKey) continue;
      const raw = this.options.folderStorage
        .getStorageForWorkspace(folder)
        ?.get<unknown>(PLUGIN_CONFIG_KEY);
      if (raw === undefined || raw === null) continue;
      const parsed = parsePluginConfig(raw);
      const config = parsed ?? emptyPluginConfig();
      candidates.push({
        folder,
        key: canonicalRootKey(folder),
        raw,
        wellFormed: parsed !== null,
        config,
        ...(typeof config.lastUpdated === 'string'
          ? { lastUpdated: config.lastUpdated }
          : {}),
      });
    }
    return candidates.sort(
      (a, b) => Number(a.key > b.key) - Number(a.key < b.key),
    );
  }

  /** @throws SdkError when `folder` is not a present candidate of the root. */
  private presentCandidate(
    harnessRoot: string,
    folder: string,
  ): LegacyCandidate {
    const wanted = canonicalRootKey(folder);
    const candidate = this.candidatesOf(harnessRoot).find(
      (entry) => entry.key === wanted,
    );
    if (candidate === undefined) {
      throw new SdkError(
        `${folder} has no saved plugin settings under ${harnessRoot}`,
      );
    }
    return candidate;
  }

  private recordKey(harnessRoot: string): string {
    return `${PLUGIN_CONFIG_HOME_KEY_PREFIX}${canonicalRootKey(harnessRoot)}`;
  }

  private readRecord(harnessRoot: string): HomeRecordRead {
    return parseHomeRecord(
      this.options.homeStorage.get<unknown>(this.recordKey(harnessRoot)),
    );
  }

  /** @throws SdkError when the home storage rejects the write. */
  private async writeRecord(
    recordKey: string,
    record: PluginConfigHomeRecord,
  ): Promise<void> {
    try {
      await this.options.homeStorage.update(recordKey, record);
    } catch (error: unknown) {
      throw new SdkError(
        `Could not save the plugin settings for ${record.harnessRoot}`,
        { cause: error },
      );
    }
  }

  /**
   * Queue the one-time import of an agreed legacy config. The write runs only
   * while the record is still absent, so a repeat is a no-op. A failure is
   * logged; reads keep returning the legacy config and the next read retries.
   */
  private queueImport(
    harnessRoot: string,
    candidates: readonly LegacyCandidate[],
  ): void {
    const recordKey = this.recordKey(harnessRoot);
    if (this.pendingImports.has(recordKey)) return;
    this.pendingImports.add(recordKey);

    const sourceFolders = candidates.map((candidate) => candidate.folder);
    const config = candidates[0].config;
    void this.enqueue(recordKey, async () => {
      if (this.readRecord(harnessRoot).kind !== 'absent') return;
      await this.writeRecord(recordKey, {
        version: 1,
        harnessRoot,
        config,
        origin: 'imported',
        sourceFolders,
        dismissed: {},
      });
      this.options.logger.info(
        '[PluginConfigHome] Imported folder plugin settings as the harness root home',
        { harnessRoot, sourceFolders },
      );
    }).then(
      () => {
        this.pendingImports.delete(recordKey);
      },
      (error: unknown) => {
        this.pendingImports.delete(recordKey);
        this.options.logger.warn(
          '[PluginConfigHome] Plugin settings import failed; the folder settings still apply and the import is retried on the next read',
          {
            harnessRoot,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      },
    );
  }

  /**
   * Run `task` after every earlier write to `recordKey`. The returned promise
   * carries the task's own outcome; the chain itself never rejects, so one
   * failed write does not block the next.
   */
  private enqueue(recordKey: string, task: () => Promise<void>): Promise<void> {
    const previous = this.writeChains.get(recordKey) ?? Promise.resolve();
    const run = previous.then(task);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.writeChains.set(recordKey, tail);
    void tail.then(() => {
      if (this.writeChains.get(recordKey) === tail) {
        this.writeChains.delete(recordKey);
      }
    });
    return run;
  }
}
