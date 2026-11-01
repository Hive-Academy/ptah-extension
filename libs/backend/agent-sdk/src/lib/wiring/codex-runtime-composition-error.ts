export type CodexRuntimeCompositionErrorCode =
  | 'partial-native-binding'
  | 'unstable-binding'
  | 'identity-lookup-disposed'
  | 'persisted-identity-unavailable'
  | 'session-thread-mismatch';

const messages: Record<CodexRuntimeCompositionErrorCode, string> = {
  'partial-native-binding':
    'Native runtime composition requires all four host bindings; missing tokens',
  'unstable-binding':
    'Runtime ports must be bound before resolving the agent adapter; bind a stable instance using registerInstance or a cached factory; use a fresh container for native activation',
  'identity-lookup-disposed': 'Session runtime identity lookup is disposed',
  'persisted-identity-unavailable': 'Persisted Codex identity is unavailable',
  'session-thread-mismatch': 'Codex session/thread identity mismatch',
};

export class CodexRuntimeCompositionError extends Error {
  constructor(
    readonly code: CodexRuntimeCompositionErrorCode,
    readonly token?: string,
  ) {
    super(
      `[CodexRuntimeComposition] ${messages[code]}${token ? `: ${token}` : ''}`,
    );
    this.name = 'CodexRuntimeCompositionError';
  }
}
