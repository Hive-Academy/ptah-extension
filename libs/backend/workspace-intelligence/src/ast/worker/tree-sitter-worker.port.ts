/**
 * Host port for the tree-sitter worker process. The Electron host forks it in
 * a `utilityProcess`; a host that registers no factory (VS Code, CLI) keeps
 * parsing in-process.
 */
export interface ITreeSitterWorkerProcess {
  postMessage(message: unknown): void;
  on(event: 'message', callback: (message: unknown) => void): void;
  on(event: 'exit', callback: (code: number | null) => void): void;
  kill(): void;
}

/** Host implementation that forks the tree-sitter worker process. */
export interface ITreeSitterWorkerFactory {
  spawn(): ITreeSitterWorkerProcess;
}
