/**
 * KnowledgeAgent corpus domain types.
 *
 * A "corpus" is a workspace-scoped, named snapshot of memory ids derived from
 * a persisted `mem:searchIndex` filter. Corpora power priming sessions where
 * the corpus contents are pre-loaded into the system prompt for fast Q&A.
 */
import type { MemoryType } from '../memory.types';

/**
 * Filter blob persisted on the corpus row and replayed by `rebuildCorpus`.
 * Field shapes mirror `MemSearchIndexFilter` for round-trip parity.
 */
export interface BuildCorpusParams {
  readonly name: string;
  readonly workspaceRoot?: string | null;
  readonly type?: readonly MemoryType[];
  readonly concepts?: readonly string[];
  readonly files?: readonly string[];
  readonly query?: string;
  readonly dateRange?: { readonly fromMs?: number; readonly toMs?: number };
  readonly limit?: number;
}

/**
 * Lightweight handle returned by `buildCorpus`, `list`, etc. Used as the
 * compact UI/RPC representation.
 */
export interface CorpusRef {
  readonly id: string;
  readonly name: string;
  readonly count: number;
  readonly builtAt: number;
  readonly rebuiltAt: number | null;
  readonly workspaceRoot: string | null;
}

/** Alias exposed for the upcoming Batch C2 RPC contract. */
export type CorpusListEntry = CorpusRef;

/**
 * Internal snapshot of a corpus row — includes the persisted filter blob and
 * primed-session bookkeeping. Not surfaced over RPC.
 */
export interface CorpusRecord extends CorpusRef {
  readonly queryJson: string;
  readonly primedSessionIds: readonly string[];
}
