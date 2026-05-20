export interface ICompactionCallbackRegistry {
  register(
    callback: (data: {
      sessionId: string;
      trigger: 'manual' | 'auto';
      timestamp: number;
      preTokens: number;
      cwd?: string | null;
    }) => void,
  ): () => void;
}
