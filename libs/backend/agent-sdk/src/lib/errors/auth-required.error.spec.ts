import {
  AuthRequiredError,
  CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE,
  isCodexNativeRuntimeRefusal,
} from './auth-required.error';

/** Named like the auth-providers class. agent-sdk must not import that library. */
class ProviderAuthError extends Error {
  readonly providerId: string;

  constructor(providerId: string, message: string) {
    super(message);
    this.name = 'ProviderAuthError';
    this.providerId = providerId;
  }
}

describe('isCodexNativeRuntimeRefusal', () => {
  it('holds the exact native-runtime refusal text', () => {
    expect(CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE).toBe(
      'Codex chat requires a host with the native Codex runtime.',
    );
  });

  it('is true for a codexNativeRuntimeRequired()-shaped AuthRequiredError', () => {
    const refusal = new AuthRequiredError(
      CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE,
      { providerId: 'openai-codex', recoveryHint: 'Use the desktop host.' },
    );

    expect(isCodexNativeRuntimeRefusal(refusal)).toBe(true);
    if (isCodexNativeRuntimeRefusal(refusal)) {
      expect(refusal.providerId).toBe('openai-codex');
    }
  });

  it('is false for Codex id with another message', () => {
    const notReady = new AuthRequiredError(
      'OpenAI Codex is not signed in.',
      { providerId: 'openai-codex' },
    );

    expect(isCodexNativeRuntimeRefusal(notReady)).toBe(false);
  });

  it('is false for another provider id with the refusal message', () => {
    const other = new AuthRequiredError(CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE, {
      providerId: 'anthropic',
    });

    expect(isCodexNativeRuntimeRefusal(other)).toBe(false);
  });

  it('is false for a plain Error with the refusal message', () => {
    expect(
      isCodexNativeRuntimeRefusal(
        new Error(CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE),
      ),
    ).toBe(false);
  });

  it('is false for a ProviderAuthError-named error', () => {
    const named = new ProviderAuthError(
      'openai-codex',
      CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE,
    );

    expect(named.name).toBe('ProviderAuthError');
    expect(isCodexNativeRuntimeRefusal(named)).toBe(false);
  });
});
