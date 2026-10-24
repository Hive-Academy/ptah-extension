/** Ports only: composition owns registration; this module never resolves services. */
export const CODEX_RUNTIME_TOKENS = {
  Runtime: Symbol.for('ptah.codex-runtime.Runtime'),
  ExecutableSource: Symbol.for('ptah.codex-runtime.ExecutableSource'),
  ApprovalSink: Symbol.for('ptah.codex-runtime.ApprovalSink'),
  ThreadIdentityStore: Symbol.for('ptah.codex-runtime.ThreadIdentityStore'),
  Clock: Symbol.for('ptah.codex-runtime.Clock'),
  Logger: Symbol.for('ptah.codex-runtime.Logger'),
  HomeAuthReader: Symbol.for('ptah.codex-runtime.HomeAuthReader'),
} as const;
