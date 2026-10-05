/**
 * AgentModelSettings — the one reader/writer of `agentGeneration.models`
 * (TASK_2026_609 C6).
 *
 * Two layers hold the per-agent model map `{ [slug | '*']: { [provider]: id } }`:
 *   - machine:   the global key `agentGeneration.models`;
 *   - workspace: `workspace.<hash>.agentGeneration.models`, always addressed by
 *     an EXPLICIT workspace path, never by the ambient active folder.
 *
 * Classification and precedence live in `@ptah-extension/shared`
 * (`classifyAgentModelValue`, `resolveAgentModel`); this class only stores.
 *
 * ## Writes
 *
 * Each physical key has an in-process promise queue. Inside its turn an update
 * re-reads the raw key, copies the path it changes, sets or deletes one
 * `[slug][provider]` leaf and writes the result, so two concurrent updates to
 * different providers or slugs both persist and unrelated entries survive.
 * The store may hand back its cached object, so nothing read is mutated in
 * place: a failed write leaves both memory and disk as they were.
 *
 * Writers in other processes are out of scope (plan A-5), as for every key.
 * Register ONE instance per process: the queue only serialises callers that
 * share it.
 */

import {
  AGENT_MODEL_PROVIDERS,
  type AgentModelLayers,
  type AgentModelProvider,
  type AgentModelSettingsValue,
} from '@ptah-extension/shared';

import type { ISettingsStore } from '../ports/settings-store.interface';
import type { WorkspaceScopeResolver } from '../scope/workspace-scope-resolver';
import { BaseSettingsRepository } from './base-repository';

/** Machine-scope settings key; the workspace key is derived from it. */
export const AGENT_MODEL_SETTINGS_KEY = 'agentGeneration.models';

export type AgentModelScope = 'machine' | 'workspace';

type PlainRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is PlainRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Own-property define, so a slug such as `__proto__` becomes an ordinary key
 * instead of replacing the object's prototype.
 */
function defineOwn(target: PlainRecord, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** Shallow own-property copy; the result shares nothing mutable with `source`. */
function copyRecord(source: unknown): PlainRecord {
  const copy: PlainRecord = {};
  if (!isPlainRecord(source)) return copy;
  for (const [key, value] of Object.entries(source)) {
    defineOwn(copy, key, value);
  }
  return copy;
}

/**
 * The map after setting or clearing one leaf, or `undefined` when nothing is
 * left. A stored value that is not an object (hand-edited) carries nothing a
 * reader would use, so it is replaced rather than preserved.
 */
function applyLeaf(
  raw: unknown,
  slug: string,
  provider: AgentModelProvider,
  value: string | null,
): PlainRecord | undefined {
  const next = copyRecord(raw);
  const hasEntry = Object.prototype.hasOwnProperty.call(next, slug);
  const entry = copyRecord(hasEntry ? next[slug] : undefined);

  if (value === null) {
    delete entry[provider];
  } else {
    defineOwn(entry, provider, value);
  }

  if (Object.keys(entry).length === 0) {
    delete next[slug];
  } else {
    defineOwn(next, slug, entry);
  }

  return Object.keys(next).length === 0 ? undefined : next;
}

export class AgentModelSettings extends BaseSettingsRepository {
  private readonly resolver: WorkspaceScopeResolver;
  private readonly queues = new Map<string, Promise<void>>();

  constructor(store: ISettingsStore, resolver: WorkspaceScopeResolver) {
    super(store);
    this.resolver = resolver;
  }

  /**
   * Both raw layers for one workspace. Values are returned as stored; readers
   * go through `resolveAgentModel`, which tolerates any shape.
   *
   * @throws {Error} when `workspacePath` is empty or cannot be normalized.
   */
  layersForPath(workspacePath: string): AgentModelLayers {
    const workspace = this.resolver.inspectForPath<AgentModelSettingsValue>(
      AGENT_MODEL_SETTINGS_KEY,
      workspacePath,
    ).value;
    const machine = this.store.readGlobal<AgentModelSettingsValue>(
      AGENT_MODEL_SETTINGS_KEY,
    );
    return { workspace, machine };
  }

  /**
   * Set (`value` a non-blank string) or clear (`null` or blank) the model for
   * one agent slug (or `'*'`) and one provider in one layer. Every other slug
   * and provider in that layer is kept; the other layer is not touched. An
   * emptied slug entry is removed, and an emptied map removes the key.
   *
   * @throws {Error} when `slug` is empty, `provider` is unknown, or the scope
   *   is `'workspace'` and `workspacePath` is empty or cannot be normalized.
   *   Any write failure is rethrown with the stored value unchanged.
   */
  async update(
    workspacePath: string,
    slug: string,
    provider: AgentModelProvider,
    value: string | null,
    scope: AgentModelScope,
  ): Promise<void> {
    if (typeof slug !== 'string' || slug.trim() === '') {
      throw new Error('An agent slug is required to set its model.');
    }
    if (!(AGENT_MODEL_PROVIDERS as readonly string[]).includes(provider)) {
      throw new Error(`Unknown agent model provider '${String(provider)}'.`);
    }
    const leaf = value === null || value.trim() === '' ? null : value;

    // Resolve the physical key before queueing so a bad workspace path throws
    // to the caller without touching the store.
    const physicalKey =
      scope === 'workspace'
        ? this.resolver.inspectForPath(AGENT_MODEL_SETTINGS_KEY, workspacePath)
            .key
        : AGENT_MODEL_SETTINGS_KEY;

    await this.enqueue(physicalKey, async () => {
      const raw = this.store.readGlobal<unknown>(physicalKey);
      const next = applyLeaf(raw, slug, provider, leaf);
      if (scope === 'workspace') {
        await this.resolver.writeForPath(
          AGENT_MODEL_SETTINGS_KEY,
          workspacePath,
          next,
        );
      } else {
        await this.store.writeGlobal(AGENT_MODEL_SETTINGS_KEY, next);
      }
    });
  }

  /**
   * Run `task` after every earlier task on the same key has settled. A failed
   * task rejects only its own caller; the next one still runs. The map entry
   * is released once the last queued task settles.
   */
  private enqueue(key: string, task: () => Promise<void>): Promise<void> {
    // A stored tail never rejects (see below), so `task` always runs.
    const previous = this.queues.get(key) ?? Promise.resolve();
    const run = previous.then(task);
    // The tail swallows the rejection; `run` still carries it to the caller.
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(key, tail);
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return run;
  }
}
