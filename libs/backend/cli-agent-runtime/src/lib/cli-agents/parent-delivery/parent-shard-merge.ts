import {
  type ParentCompletionKey,
  ParentCompletionKeySchema,
  ParentCompletionKeyShardSchema,
  ParentCompletionOutboxEntrySchema,
  ParentCompletionOutboxSchema,
} from './parent-envelope.schema';

/**
 * Merges validated completion keys of a tab's shard into the shard already stored under the
 * resolved session id (a resumed session can hold its own keys). A key already in the target
 * wins on a shared `dedupeKey`.
 */
function mergeByDedupeKey(
  target: readonly ParentCompletionKey[],
  moved: readonly ParentCompletionKey[],
): ParentCompletionKey[] {
  const seen = new Set(target.map((key) => key.dedupeKey));
  const merged = [...target];
  for (const key of moved) {
    if (seen.has(key.dedupeKey)) continue;
    seen.add(key.dedupeKey);
    merged.push(key);
  }
  return merged;
}

/**
 * Merges a tab's outbox shard into the session shard. Throws when either shard container is
 * malformed, so the caller keeps the tab shard.
 *
 * Unlike the key shard, only a VALID destination entry suppresses a moved entry with the same
 * `dedupeKey`: the outbox reader skips malformed entries, so letting one win would leave no
 * replayable copy. Malformed entries on either side are kept as they are. Each valid moved
 * entry is re-addressed to `sessionId`, because replay reads the entry's own
 * `parentSessionId`, not the shard key.
 */
export function mergeOutboxShards(
  target: unknown,
  moved: unknown,
  sessionId: string,
): { readonly version: 1; readonly entries: unknown[] } {
  const into = ParentCompletionOutboxSchema.parse(target ?? { version: 1, entries: [] });
  const from = ParentCompletionOutboxSchema.parse(moved);
  const seen = new Set<string>();
  for (const value of into.entries) {
    const parsed = ParentCompletionOutboxEntrySchema.safeParse(value);
    if (parsed.success) seen.add(parsed.data.dedupeKey);
  }
  const entries: unknown[] = [...into.entries];
  for (const value of from.entries) {
    const parsed = ParentCompletionOutboxEntrySchema.safeParse(value);
    if (!parsed.success) {
      entries.push(value);
      continue;
    }
    if (seen.has(parsed.data.dedupeKey)) continue;
    seen.add(parsed.data.dedupeKey);
    entries.push({ ...parsed.data, parentSessionId: sessionId });
  }
  return { version: 1, entries };
}

/**
 * Throws when either shard container OR any key in either shard is malformed, so the caller
 * keeps the tab shard. Keys fail closed: a malformed destination key could otherwise
 * suppress a valid tab key with the same `dedupeKey`, and the valid key would be lost when
 * the tab shard is deleted.
 */
export function mergeCompletionKeyShards(
  target: unknown,
  moved: unknown,
): { readonly version: 1; readonly keys: unknown[] } {
  const into = ParentCompletionKeyShardSchema.parse(target ?? { version: 1, keys: [] });
  const from = ParentCompletionKeyShardSchema.parse(moved);
  const intoKeys = into.keys.map((key) => ParentCompletionKeySchema.parse(key));
  const fromKeys = from.keys.map((key) => ParentCompletionKeySchema.parse(key));
  return { version: 1, keys: mergeByDedupeKey(intoKeys, fromKeys) };
}
