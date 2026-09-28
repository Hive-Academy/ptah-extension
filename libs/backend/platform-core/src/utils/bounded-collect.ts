/**
 * Collect at most `limit` items of an async source, and stop the source there.
 *
 * The Electron and CLI file-system providers used to await fast-glob's array
 * form, which walks the whole tree and holds every match before a caller's
 * `maxResults` can slice it (TASK_2026_559 Batch 23b review r1 M1). A bounded
 * call now reads `walkGlobMatches` (one entry at a time) through this helper:
 * leaving the `for await` loop at the limit calls the generator's
 * `return()`, which closes every directory the walk holds open (a Node
 * readable stream would be destroyed the same way). Shared by the two
 * adapters for the same reason `glob-watch-plan.ts` is: the rule lives in
 * one place.
 *
 * @param source - Any async iterable; a Node readable stream is one.
 * @param limit - Most items to take (at least 1).
 */
export async function collectBounded<T>(
  source: AsyncIterable<T>,
  limit: number,
): Promise<T[]> {
  const items: T[] = [];
  if (limit < 1) return items;
  for await (const item of source) {
    items.push(item);
    if (items.length >= limit) break;
  }
  return items;
}
