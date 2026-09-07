import { summarizeCliSdkError } from './sdk-error-summary';

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
});
