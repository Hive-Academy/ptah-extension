export const MEMORY_CONTRACT_TOKENS = {
  MEMORY_READER: Symbol.for('PtahMemoryReader'),
  MEMORY_LISTER: Symbol.for('PtahMemoryLister'),
  CURATOR_LLM: Symbol.for('PtahCuratorLlm'),
  COMPACTION_CALLBACK_REGISTRY: Symbol.for('SdkCompactionCallbackRegistry'),
} as const;
