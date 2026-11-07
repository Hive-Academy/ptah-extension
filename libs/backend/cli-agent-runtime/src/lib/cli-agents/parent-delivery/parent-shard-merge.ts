import { z } from 'zod';
import {
  ParentCompletionKeyShardSchema,
  ParentCompletionOutboxEntrySchema,
  ParentCompletionOutboxSchema,
} from './parent-envelope.schema';

/** Only the dedupe key is read here; each entry is still validated by its own reader. */
const KeyedEntrySchema = z.object({ dedupeKey: z.string() }).passthrough();

/**
 * Key-shard merge. Merges the entries of a tab's completion shard into the shard already stored under the
 * resolved session id (a resumed session can hold its own outbox entries and keys). An entry
 * already in the target wins on a shared `dedupeKey`. An entry without a readable key is kept,
 * never dropped: it may be the only remaining dedupe record, and its reader fails closed on it.
 */
function mergeByDedupeKey(target: readonly unknown[], moved: readonly unknown[]): unknown[] {
  const seen = new Set<string>();
  for (const value of target) {
    const parsed = KeyedEntrySchema.safeParse(value);
    if (parsed.success) seen.add(parsed.data.dedupeKey);
  }
  const merged = [...target];
  for (const value of moved) {
    const parsed = KeyedEntrySchema.safeParse(value);
    if (parsed.success && seen.has(parsed.data.dedupeKey)) continue;
    if (parsed.success) seen.add(parsed.data.dedupeKey);
    merged.push(value);
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

/** Throws when either shard container is malformed, so the caller keeps the tab shard. */
export function mergeCompletionKeyShards(
  target: unknown,
  moved: unknown,
): { readonly version: 1; readonly keys: unknown[] } {
  const into = ParentCompletionKeyShardSchema.parse(target ?? { version: 1, keys: [] });
  const from = ParentCompletionKeyShardSchema.parse(moved);
  return { version: 1, keys: mergeByDedupeKey(into.keys, from.keys) };
}
