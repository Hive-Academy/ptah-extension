/**
 * CustomProviderStore — the ONE reader/writer of `provider.custom.entries`.
 *
 * Owns the user-defined provider entries persisted in `~/.ptah/settings.json`
 * (TASK_2026_236) and, on every read and every mutation, re-populates the
 * module-level cache in `@ptah-extension/shared` via `setCustomProviderEntries`
 * so that `getAnthropicProvider()` / `getAllAnthropicProviders()` resolve custom
 * ids everywhere in the process.
 *
 * ## Why it lives in settings-core
 *
 * It is a settings repository: `ISettingsStore` in, one settings key out,
 * exactly like `TasksSettings` and `GatewaySettings` next to it. The two
 * alternatives were worse:
 *   - `auth-providers` owns AUTH, not persistence, and its bootstrap is the
 *     CONSUMER of this store rather than its home.
 *   - `platform-core` must stay interface-only (its own CLAUDE.md), and it
 *     already carries three concrete-service leaks that the audit flagged.
 *
 * ## Secrets
 *
 * The API key is NEVER part of an entry. It stays in SecretStorage under
 * `AuthSecretsService.setProviderKey(id, …)`. This class does not accept, hold,
 * or persist a key — the RPC layer routes it separately. That separation is
 * what makes `provider.custom.entries` safe to hand-edit and safe to log.
 *
 * ## Hand-edited files must not brick provider selection
 *
 * `load()` and `list()` NEVER throw on malformed data. A single bad entry is
 * dropped and reported through `CustomProviderLoadResult.dropped`; the rest of
 * the array still reaches the cache. Throwing here would take the entire
 * provider picker down because one line of JSON was mistyped by hand.
 */

import {
  CustomProviderEntriesSchema,
  CustomProviderEntryInputSchema,
  CustomProviderEntrySchema,
  CUSTOM_PROVIDER_ID_PATTERN,
  isBuiltInProviderId,
  setCustomProviderEntries,
  type CustomProviderEntry,
  type CustomProviderEntryChanges,
  type CustomProviderEntryInput,
  type RejectedCustomProviderEntry,
} from '@ptah-extension/shared';

import type { ISettingsStore } from '../ports/settings-store.interface';
import { BaseSettingsRepository } from './base-repository';

/** The settings key holding the whole array. */
export const CUSTOM_PROVIDER_ENTRIES_KEY = 'provider.custom.entries';

/**
 * Minimal logging surface.
 *
 * settings-core does not depend on `vscode-core`, so it cannot take the real
 * `Logger`. A structural one-method port keeps the dependency direction intact
 * and lets callers pass the real logger without an adapter.
 */
export interface CustomProviderStoreLogger {
  warn(message: string, ...args: unknown[]): void;
}

/** Outcome of {@link CustomProviderStore.load}. */
export interface CustomProviderLoadResult {
  /** Entries that survived validation and are now in the shared cache. */
  readonly entries: readonly CustomProviderEntry[];
  /** Entries that were skipped, with the reason each was skipped. */
  readonly dropped: readonly RejectedCustomProviderEntry[];
}

/**
 * Thrown for CALLER errors on a mutation (duplicate id, unknown id, reserved
 * id, bad charset). Distinct from the non-throwing read path: a mutation with
 * bad input has an interactive caller who needs to be told what to fix.
 */
export class CustomProviderStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomProviderStoreError';
  }
}

export class CustomProviderStore extends BaseSettingsRepository {
  private readonly logger?: CustomProviderStoreLogger;

  constructor(store: ISettingsStore, logger?: CustomProviderStoreLogger) {
    super(store);
    this.logger = logger;
  }

  /**
   * Read `provider.custom.entries` from disk, validate it, and publish the
   * survivors to the shared registry cache.
   *
   * Call this ONCE at app bootstrap (and again on a settings change) before
   * anything resolves a provider by id. Until it runs, `getAnthropicProvider()`
   * knows only the built-ins.
   */
  load(): CustomProviderLoadResult {
    const raw = this.store.readGlobal<unknown>(CUSTOM_PROVIDER_ENTRIES_KEY);
    const dropped: RejectedCustomProviderEntry[] = [];

    const candidates = this.coerceToArray(raw, dropped);

    // Per-element parse (not a whole-array parse) so ONE malformed entry does
    // not discard its valid siblings.
    const parsed: CustomProviderEntry[] = [];
    for (const candidate of candidates) {
      const result = CustomProviderEntrySchema.safeParse(candidate);
      if (result.success) {
        parsed.push(result.data);
        continue;
      }
      dropped.push({
        id: readCandidateId(candidate),
        reason: formatIssues(result.error.issues),
      });
    }

    // The shared setter applies the remaining rules (built-in shadowing,
    // duplicate ids) and is the single place the cache is written.
    const { accepted, rejected } = setCustomProviderEntries(parsed);
    dropped.push(...rejected);

    for (const entry of dropped) {
      this.logger?.warn(
        `[CustomProviderStore] Dropped custom provider entry '${entry.id}': ${entry.reason}`,
      );
    }

    return { entries: accepted, dropped };
  }

  /**
   * The currently valid entries, re-read from disk.
   *
   * Reads go through `load()` so a settings file edited outside the process is
   * picked up and the shared cache stays consistent with what callers see.
   */
  list(): readonly CustomProviderEntry[] {
    return this.load().entries;
  }

  /** One entry by id, or undefined. */
  get(id: string): CustomProviderEntry | undefined {
    return this.list().find((entry) => entry.id === id);
  }

  /**
   * Create an entry.
   *
   * @throws {CustomProviderStoreError} when the id is malformed, reserved by a
   *   built-in provider, or already used by another custom entry.
   */
  async add(input: CustomProviderEntryInput): Promise<CustomProviderEntry> {
    const parsed = CustomProviderEntryInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new CustomProviderStoreError(formatIssues(parsed.error.issues));
    }

    const existing = this.list();
    this.assertIdAssignable(parsed.data.id, existing);

    const entry: CustomProviderEntry = {
      ...parsed.data,
      createdAt: new Date().toISOString(),
    };

    await this.persist([...existing, entry]);
    return entry;
  }

  /**
   * Apply a partial edit to an existing entry.
   *
   * `id` is immutable — the entry's API key is filed under it in SecretStorage,
   * so a rename would orphan the secret rather than move it.
   *
   * @throws {CustomProviderStoreError} when the id is unknown, when `changes`
   *   carries a different id, or when the merged entry fails validation.
   */
  async update(
    id: string,
    changes: CustomProviderEntryChanges,
  ): Promise<CustomProviderEntry> {
    const existing = this.list();
    const current = existing.find((entry) => entry.id === id);
    if (!current) {
      throw new CustomProviderStoreError(
        `No custom provider entry with id '${id}'`,
      );
    }

    if (changes.id !== undefined && changes.id !== id) {
      throw new CustomProviderStoreError(
        `A custom provider id cannot be changed ('${id}' → '${changes.id}'). ` +
          `Remove the entry and add a new one — the API key is stored under the id.`,
      );
    }

    const merged = CustomProviderEntrySchema.safeParse({
      ...current,
      ...stripUndefined(changes),
      id,
      createdAt: current.createdAt,
    });
    if (!merged.success) {
      throw new CustomProviderStoreError(formatIssues(merged.error.issues));
    }

    const next = existing.map((entry) =>
      entry.id === id ? merged.data : entry,
    );
    await this.persist(next);
    return merged.data;
  }

  /**
   * Delete an entry.
   *
   * Deleting the STORED SECRET is the RPC layer's job (it owns
   * `IAuthSecretsService`); this returns whether anything was removed so the
   * caller knows whether to bother.
   *
   * @returns true when an entry was removed, false when the id was unknown.
   */
  async remove(id: string): Promise<boolean> {
    const existing = this.list();
    const next = existing.filter((entry) => entry.id !== id);
    if (next.length === existing.length) {
      return false;
    }
    await this.persist(next);
    return true;
  }

  /**
   * Write the array and re-publish the cache in one step, so the in-memory
   * registry can never lag the file.
   */
  private async persist(
    entries: readonly CustomProviderEntry[],
  ): Promise<void> {
    const validated = CustomProviderEntriesSchema.parse(entries);
    await this.store.writeGlobal(CUSTOM_PROVIDER_ENTRIES_KEY, validated);
    const { rejected } = setCustomProviderEntries(validated);
    for (const entry of rejected) {
      this.logger?.warn(
        `[CustomProviderStore] Entry '${entry.id}' was persisted but rejected by the registry: ${entry.reason}`,
      );
    }
  }

  private assertIdAssignable(
    id: string,
    existing: readonly CustomProviderEntry[],
  ): void {
    if (!CUSTOM_PROVIDER_ID_PATTERN.test(id)) {
      throw new CustomProviderStoreError(
        `Provider id '${id}' is invalid — use lower-case letters, digits and dashes only, starting with a letter or digit.`,
      );
    }
    if (isBuiltInProviderId(id)) {
      throw new CustomProviderStoreError(
        `Provider id '${id}' is reserved by a built-in provider. Pick a different id.`,
      );
    }
    if (existing.some((entry) => entry.id === id)) {
      throw new CustomProviderStoreError(
        `A custom provider with id '${id}' already exists.`,
      );
    }
  }

  /**
   * Tolerate a settings value that is not an array at all (the file is
   * hand-editable, so `null`, an object, or a JSON string are all reachable).
   */
  private coerceToArray(
    raw: unknown,
    dropped: RejectedCustomProviderEntry[],
  ): unknown[] {
    if (raw === undefined || raw === null) return [];
    if (Array.isArray(raw)) return raw;
    dropped.push({
      id: '<unknown>',
      reason: `'${CUSTOM_PROVIDER_ENTRIES_KEY}' must be an array; found ${typeof raw}. Ignoring it.`,
    });
    return [];
  }
}

/** Best-effort id extraction from a candidate that failed validation. */
function readCandidateId(candidate: unknown): string {
  if (candidate && typeof candidate === 'object' && 'id' in candidate) {
    const value = (candidate as { id: unknown }).id;
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '<unknown>';
}

/** Flatten Zod issues into one user-facing line. */
function formatIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
): string {
  return issues
    .map((issue) => `${issue.path.join('.') || 'entry'}: ${issue.message}`)
    .join('; ');
}

/**
 * Drop explicitly-undefined keys so a partial edit does not blank a field that
 * the caller merely did not mention.
 */
function stripUndefined(
  changes: CustomProviderEntryChanges,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
