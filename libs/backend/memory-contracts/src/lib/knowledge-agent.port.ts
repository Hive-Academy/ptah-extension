/**
 * Knowledge-agent port — the corpus-operations contract shared across the lib
 * boundary between `memory-curator` (which implements it) and `vscode-lm-tools`
 * (which consumes it through the `execute_code` sandbox namespace).
 *
 * A "corpus" is a workspace-scoped, named snapshot of memory ids derived from a
 * persisted `mem:searchIndex` filter. The port exposes ONLY the four
 * agent-callable operations (`buildCorpus`, `listCorpora`, `rebuildCorpus`,
 * `primeCorpus`); the concrete `KnowledgeAgentService` keeps additional
 * lifecycle methods (`queryCorpus`/`reprimeCorpus`/`deleteCorpus`) that are not
 * part of this contract.
 *
 * Zero-dep: references only `MemoryType` from the sibling `curator-llm.port`.
 */
import type { MemoryType } from './curator-llm.port';

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

/** Alias exposed for the corpus RPC/agent contracts. */
export type CorpusListEntry = CorpusRef;

/** Result of `rebuildCorpus` — membership diff after replaying the filter. */
export interface CorpusRebuildResult {
  readonly added: number;
  readonly removed: number;
}

/** Result of `primeCorpus` — the id of the opened priming session. */
export interface CorpusPrimeResult {
  readonly sessionId: string;
}

/**
 * Agent-callable corpus operations. Implemented by `KnowledgeAgentService` in
 * `memory-curator`; consumed by the `ptah.corpus` code-execution namespace in
 * `vscode-lm-tools` via the `KNOWLEDGE_AGENT_TOKEN`.
 */
export interface IKnowledgeAgent {
  buildCorpus(params: BuildCorpusParams): Promise<CorpusRef>;
  listCorpora(workspaceRoot?: string | null): readonly CorpusListEntry[];
  rebuildCorpus(name: string): Promise<CorpusRebuildResult>;
  primeCorpus(name: string): Promise<CorpusPrimeResult>;
}
