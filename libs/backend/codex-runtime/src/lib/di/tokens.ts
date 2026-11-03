/** Ports only: composition owns registration; this module never resolves services. */
export const CODEX_RUNTIME_TOKENS = {
  ParityGate: Symbol.for('ptah.codex-runtime.ParityGate'),
  DevRouteOverride: Symbol.for('ptah.codex-runtime.DevRouteOverride'),
  Runtime: Symbol.for('ptah.codex-runtime.Runtime'),
  ExecutableSource: Symbol.for('ptah.codex-runtime.ExecutableSource'),
  ApprovalSink: Symbol.for('ptah.codex-runtime.ApprovalSink'),
  ThreadIdentityStore: Symbol.for('ptah.codex-runtime.ThreadIdentityStore'),
  Clock: Symbol.for('ptah.codex-runtime.Clock'),
  Logger: Symbol.for('ptah.codex-runtime.Logger'),
  HomeAuthReader: Symbol.for('ptah.codex-runtime.HomeAuthReader'),
} as const;
