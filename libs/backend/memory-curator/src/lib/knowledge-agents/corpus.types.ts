/**
 * KnowledgeAgent corpus domain types.
 *
 * A "corpus" is a workspace-scoped, named snapshot of memory ids derived from
 * a persisted `mem:searchIndex` filter. Corpora power priming sessions where
 * the corpus contents are pre-loaded into the system prompt for fast Q&A.
 */
import type { CorpusRef } from '@ptah-extension/memory-contracts';

/**
 * The corpus DTOs are the single source of truth in `@ptah-extension/memory-contracts`
 * (the zero-dep port lib both `memory-curator` and `vscode-lm-tools` import).
 * Re-exported here so every existing intra-lib import (`./corpus.types`) and the
 * public barrel keep resolving unchanged.
 */
export type {
  BuildCorpusParams,
  CorpusRef,
  CorpusListEntry,
} from '@ptah-extension/memory-contracts';

/**
 * Internal snapshot of a corpus row — includes the persisted filter blob and
 * primed-session bookkeeping. Not surfaced over RPC.
 */
export interface CorpusRecord extends CorpusRef {
  readonly queryJson: string;
  readonly primedSessionIds: readonly string[];
}
