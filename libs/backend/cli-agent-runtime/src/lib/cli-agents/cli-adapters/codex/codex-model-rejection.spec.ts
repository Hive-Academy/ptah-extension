import {
  codexModelRejectionMessage,
  codexTextExcerpt,
} from './codex-model-rejection';

describe('codexModelRejectionMessage', () => {
  it.each([
    "The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account.",
    'model_not_found: The requested model does not exist',
    'unsupported_model',
    'The model `gpt-6-sol` does not exist or you do not have access to it.',
  ])('recognises a model rejection: %s', (text) => {
    expect(
      codexModelRejectionMessage(text, 'gpt-6-sol', 'setting', []),
    ).toBeDefined();
  });

  it.each([
    'The model is not available right now. Try again later.',
    'model capacity reached; this request is unsupported at the moment',
    'Reconnecting... 2/5 (stream disconnected before completion)',
    'The model ran. Later a file was not found.',
  ])('leaves other failures alone: %s', (text) => {
    expect(
      codexModelRejectionMessage(text, 'gpt-6-sol', 'setting', []),
    ).toBeUndefined();
  });

  it("ends with Codex's own words, redacted and capped", () => {
    const secret = 'sk-test-0123456789abcdef';
    const message = codexModelRejectionMessage(
      `model_not_found ${secret} ${'z'.repeat(400)}`,
      'gpt-6-sol',
      'request',
      [secret],
    );

    expect(message).toContain('named by the spawn request');
    expect(message).toContain('Codex said: "model_not_found [REDACTED]');
    expect(message).not.toContain(secret);
  });

  it('names Codex itself when no model was set', () => {
    expect(
      codexModelRejectionMessage('model_not_found', undefined, undefined, []),
    ).toBe(
      'Codex rejected its own default model. Set `agentOrchestration.codexModel` to a model your account offers. Codex said: "model_not_found"',
    );
  });
});

describe('codexTextExcerpt', () => {
  it('collapses whitespace and caps at 200 chars', () => {
    const excerpt = codexTextExcerpt(`a\n  b ${'c'.repeat(400)}`, []);
    expect(excerpt.startsWith('a b ')).toBe(true);
    expect(excerpt.length).toBe(200);
    expect(excerpt.endsWith('...')).toBe(true);
  });
});
