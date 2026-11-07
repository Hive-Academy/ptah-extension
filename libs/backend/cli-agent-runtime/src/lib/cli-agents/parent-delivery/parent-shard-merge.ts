import { z } from 'zod';
import {
  ParentCompletionKeyShardSchema,
  ParentCompletionOutboxSchema,
} from './parent-envelope.schema';

/** Only the dedupe key is read here; each entry is still validated by its own reader. */
const KeyedEntrySchema = z.object({ dedupeKey: z.string() }).passthrough();

/**
 * Merges the entries of a tab's completion shard into the shard already stored under the
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

/** Throws when either shard container is malformed, so the caller keeps the tab shard. */
export function mergeOutboxShards(
  target: unknown,
  moved: unknown,
): { readonly version: 1; readonly entries: unknown[] } {
  const into = ParentCompletionOutboxSchema.parse(target ?? { version: 1, entries: [] });
  const from = ParentCompletionOutboxSchema.parse(moved);
  return { version: 1, entries: mergeByDedupeKey(into.entries, from.entries) };
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
