/** A context that has not reached an executable state. */
export class CodexContextStateError extends Error {
  constructor(readonly state: 'closed' | 'opening') {
    super('Codex context is not ready');
    this.name = 'CodexContextStateError';
  }
}
