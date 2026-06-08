export const MEMORY_CONTRACT_TOKENS = {
  MEMORY_READER: Symbol.for('PtahMemoryReader'),
  MEMORY_LISTER: Symbol.for('PtahMemoryLister'),
  CODE_SYMBOL_READER: Symbol.for('PtahCodeSymbolReader'),
  CURATOR_LLM: Symbol.for('PtahCuratorLlm'),
  COMPACTION_CALLBACK_REGISTRY: Symbol.for('SdkCompactionCallbackRegistry'),
  SYMBOL_SINK: Symbol.for('PtahSymbolSink'),
  TRANSCRIPT_READER: Symbol.for('memory-contracts.TranscriptReader'),
} as const;
