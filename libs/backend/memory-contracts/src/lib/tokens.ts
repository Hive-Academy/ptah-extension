export const MEMORY_CONTRACT_TOKENS = {
  MEMORY_READER: Symbol.for('PtahMemoryReader'),
  MEMORY_LISTER: Symbol.for('PtahMemoryLister'),
  CODE_SYMBOL_READER: Symbol.for('PtahCodeSymbolReader'),
  CURATOR_LLM: Symbol.for('PtahCuratorLlm'),
  COMPACTION_CALLBACK_REGISTRY: Symbol.for('SdkCompactionCallbackRegistry'),
  SYMBOL_SINK: Symbol.for('PtahSymbolSink'),
  TRANSCRIPT_READER: Symbol.for('memory-contracts.TranscriptReader'),
  KNOWLEDGE_AGENT: Symbol.for('PtahKnowledgeAgentService'),
} as const;

/**
 * Named token for injectors of the knowledge-agent port. Declared as its own
 * `Symbol.for('PtahKnowledgeAgentService')` literal (NOT a reference to
 * `MEMORY_CONTRACT_TOKENS.KNOWLEDGE_AGENT`) so the static di-lint alias resolver
 * can trace it — same dual-literal convention as `CURATOR_LLM`. `Symbol.for` is
 * globally interned, so this and `MEMORY_TOKENS.KNOWLEDGE_AGENT_SERVICE` remain
 * the same runtime symbol.
 * @warning keep the description string in sync with
 * `memory-curator/src/lib/di/tokens.ts` `KNOWLEDGE_AGENT_SERVICE`.
 */
export const KNOWLEDGE_AGENT_TOKEN = Symbol.for('PtahKnowledgeAgentService');
