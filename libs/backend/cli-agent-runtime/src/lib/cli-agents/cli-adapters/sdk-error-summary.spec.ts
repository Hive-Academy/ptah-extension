import { redactSecrets, summarizeCliSdkError } from './sdk-error-summary';

describe('summarizeCliSdkError', () => {
  it('recognises a usage limit and keeps the retry time', () => {
    const error = new Error(
      "Codex SDK Error: Codex Exec exited with code 1: stream error: You've hit your usage limit. Upgrade to Pro (https://openai.com/chatgpt/pricing) or try again at 5:05 PM.",
    );

    expect(summarizeCliSdkError(error, 'Codex')).toBe(
      'Codex usage limit reached. Try again at 5:05 PM.',
    );
  });

  it('recognises a usage limit with no retry time', () => {
    const error = new Error("You've hit your usage limit. Upgrade to Pro.");

    expect(summarizeCliSdkError(error, 'Codex')).toBe(
      'Codex usage limit reached.',
    );
  });

  it('caps a message carrying an embedded output dump and keeps the exit-code headline', () => {
    const dump = Array.from(
      { length: 60 },
      (_, index) => `src/file-${index}.ts:12:  const value = compute();`,
    ).join('\n');
    const raw = `Codex Exec exited with code 1: Reading prompt from stdin...\nERROR codex_core::tools::router tool call failed\nTotal output lines: 500 Output: ${dump}`;
    expect(raw.length).toBeGreaterThan(2000);

    const summary = summarizeCliSdkError(new Error(raw), 'Codex');

    expect(summary).toBe(
      'Codex SDK Error: Codex Exec exited with code 1: Reading prompt from stdin... [output truncated]',
    );
    expect(summary.length).toBeLessThanOrEqual(600);
    expect(summary).not.toContain('src/file-0.ts');
  });

  it('cuts the dump when the Output: marker is on the first line', () => {
    const raw = `Codex Exec exited with code 1: Output: ${'x'.repeat(3000)}`;

    const summary = summarizeCliSdkError(new Error(raw), 'Codex');

    expect(summary).toBe(
      'Codex SDK Error: Codex Exec exited with code 1: [output truncated]',
    );
  });

  it('caps a single unbroken headline at ~500 characters', () => {
    const raw = `Codex Exec failed: ${'y'.repeat(2000)}`;

    const summary = summarizeCliSdkError(new Error(raw), 'Codex');

    expect(summary.endsWith('... [output truncated]')).toBe(true);
    // 500-char headline + the `Codex SDK Error: ` prefix + the truncation note.
    expect(summary.length).toBeLessThanOrEqual(540);
  });

  it('passes a short ordinary error through unchanged', () => {
    const summary = summarizeCliSdkError(new Error('agent boom'), 'Cursor');

    expect(summary).toBe('Cursor SDK Error: agent boom');
  });

  it('stringifies a non-Error rejection value', () => {
    expect(summarizeCliSdkError('plain string failure', 'Codex')).toBe(
      'Codex SDK Error: plain string failure',
    );
    expect(summarizeCliSdkError(undefined, 'Codex')).toBe(
      'Codex SDK Error: undefined',
    );
    expect(summarizeCliSdkError(new Error(''), 'Codex')).toBe(
      'Codex SDK Error: Unknown error',
    );
  });

  it('leaves a two-argument call untouched (Codex call sites)', () => {
    expect(summarizeCliSdkError(new Error('agent boom'), 'Codex')).toBe(
      'Codex SDK Error: agent boom',
    );
  });
});

describe('redactSecrets', () => {
  it('replaces every literal occurrence with the fixed marker', () => {
    const text =
      'auth failed for key sk-cursor-secret-551; request used sk-cursor-secret-551';

    expect(redactSecrets(text, ['sk-cursor-secret-551'])).toBe(
      'auth failed for key [REDACTED]; request used [REDACTED]',
    );
  });

  it('redacts each secret in the order given', () => {
    const text = 'one alpha-key and one beta-key';

    expect(redactSecrets(text, ['beta-key', 'alpha-key'])).toBe(
      'one [REDACTED] and one [REDACTED]',
    );
  });

  it('ignores blank secrets and leaves the text unchanged without any', () => {
    expect(redactSecrets('unchanged', [])).toBe('unchanged');
    expect(redactSecrets('unchanged', ['   ', ''])).toBe('unchanged');
  });

  it('replaces a value that contains regex metacharacters literally', () => {
    expect(redactSecrets('token a.b*c+ used', ['a.b*c+'])).toBe(
      'token [REDACTED] used',
    );
  });
});

describe('summarizeCliSdkError — secret redaction (551)', () => {
  const KEY = 'sk-cursor-secret-551';

  it('redacts the key from the kept headline', () => {
    const summary = summarizeCliSdkError(
      new Error(`auth failed: invalid API key ${KEY}`),
      'Cursor',
      [KEY],
    );

    expect(summary).toBe(
      'Cursor SDK Error: auth failed: invalid API key [REDACTED]',
    );
    expect(summary).not.toContain(KEY);
  });

  it('redacts before the headline is cut, so the marker survives the cap', () => {
    const raw = `failure for ${KEY}: ${'y'.repeat(2000)}`;

    const summary = summarizeCliSdkError(new Error(raw), 'Cursor', [KEY]);

    expect(summary).not.toContain(KEY);
    expect(summary).toContain('[REDACTED]');
  });

  it('keeps the usage-limit wording while redacting the key', () => {
    const summary = summarizeCliSdkError(
      new Error(`usage limit reached for ${KEY}. try again at 5:05 PM.`),
      'Cursor',
      [KEY],
    );

    expect(summary).toBe('Cursor usage limit reached. Try again at 5:05 PM.');
    expect(summary).not.toContain(KEY);
  });
});
