/**
 * Shared parser for the persisted corpus filter blob (`CorpusRecord.queryJson`).
 *
 * Both `KnowledgeAgentService.rebuildCorpus` (replaying the saved filter) and
 * `CorpusSuggestionService.loadExistingCorpora` (dedupe) read the same blob;
 * this keeps their parse/fallback logic in one place so the two read paths
 * cannot silently diverge if the persisted shape changes.
 */
import type { BuildCorpusParams } from '@ptah-extension/memory-contracts';

/**
 * Parse a persisted corpus filter blob back into a {@link BuildCorpusParams}.
 * Returns `null` when the blob is unparseable or not a JSON object — callers
 * decide the fallback (skip the row, or default to `{ name }`).
 */
export function parseCorpusFilter(raw: string): BuildCorpusParams | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object') {
      return parsed as BuildCorpusParams;
    }
  } catch {
    /* unparseable → null */
  }
  return null;
}
