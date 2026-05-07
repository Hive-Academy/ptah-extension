export interface ICompactionCallbackRegistry {
  register(
    callback: (data: { sessionId: string; transcript?: string }) => void,
  ): () => void;
}
