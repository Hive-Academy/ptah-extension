import { safeErrorKind } from './safe-error-kind';

const PROMPT = 'SECRET-CONTINUATION finish batch 3';

function withCode(error: Error, code: unknown): Error {
  return Object.assign(error, { code });
}

describe('safeErrorKind (TASK_2026_655)', () => {
  it.each([
    ['Error', new Error(PROMPT)],
    ['TypeError', new TypeError(PROMPT)],
    ['RangeError', new RangeError(PROMPT)],
  ])('keeps the built-in name %s and never the message', (name, error) => {
    expect(safeErrorKind(error)).toBe(name);
  });

  it.each(['AbortError', 'TimeoutError'])('keeps the name %s', (name) => {
    const error = new Error(PROMPT);
    error.name = name;
    expect(safeErrorKind(error)).toBe(name);
  });

  it.each([
    'ENOENT',
    'EACCES',
    'ECONNRESET',
    'ABORT_ERR',
    'ERR_STREAM_DESTROYED',
  ])('keeps the system code %s', (code) => {
    expect(safeErrorKind(withCode(new Error(PROMPT), code))).toBe(
      `Error (${code})`,
    );
  });

  it('reduces a name that is not on the allowlist to unknown', () => {
    const error = new Error(PROMPT);
    error.name = `Quoting ${PROMPT}`;
    expect(safeErrorKind(error)).toBe('unknown');
  });

  it.each([
    `E_${PROMPT}`,
    PROMPT,
    'ESECRET-CONTINUATION',
    'ESECRET',
    'EFINISHBATCH3',
    'ERR_SECRET',
    'ECONNRESET ',
    `E${'A'.repeat(31)}`,
    'enoent',
    42,
  ])('drops the code %p', (code) => {
    expect(safeErrorKind(withCode(new Error('x'), code))).toBe('Error');
  });

  it.each([PROMPT, { message: PROMPT }, undefined, null, 7])(
    'reduces the non-Error %p to unknown',
    (value) => {
      expect(safeErrorKind(value)).toBe('unknown');
    },
  );

  it('never returns the prompt for any combination', () => {
    const error = withCode(new Error(PROMPT), `E_${PROMPT}`);
    error.name = PROMPT;
    expect(safeErrorKind(error)).not.toContain('SECRET');
  });
});
