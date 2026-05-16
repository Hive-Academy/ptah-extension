/**
 * Unit tests for the sensitive-key redactor.
 */

import { DEFAULT_REDACTION, redact } from './redactor.js';

describe('redact', () => {
  it('returns scalars unchanged', () => {
    expect(redact('hello')).toBe('hello');
    expect(redact(7)).toBe(7);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  it('masks top-level sensitive keys', () => {
    const out = redact({ apiKey: 'secret-1', name: 'frank' });
    expect(out).toEqual({ apiKey: DEFAULT_REDACTION, name: 'frank' });
  });

  it('matches key pattern case-insensitively', () => {
    const out = redact({
      APIKEY: 'a',
      api_key: 'b',
      Token: 'c',
      MY_SECRET: 'd',
      Password: 'e',
      ok: 'kept',
    }) as Record<string, string>;
    expect(out['APIKEY']).toBe(DEFAULT_REDACTION);
    expect(out['api_key']).toBe(DEFAULT_REDACTION);
    expect(out['Token']).toBe(DEFAULT_REDACTION);
    expect(out['MY_SECRET']).toBe(DEFAULT_REDACTION);
    expect(out['Password']).toBe(DEFAULT_REDACTION);
    expect(out['ok']).toBe('kept');
  });

  it('walks nested objects recursively', () => {
    const out = redact({
      providers: {
        anthropic: { apiKey: 'sk-anthropic', endpoint: 'https://api.x' },
        gemini: { token: 'g-token', model: 'gemini-pro' },
      },
    });
    expect(out).toEqual({
      providers: {
        anthropic: { apiKey: DEFAULT_REDACTION, endpoint: 'https://api.x' },
        gemini: { token: DEFAULT_REDACTION, model: 'gemini-pro' },
      },
    });
  });

  it('walks arrays', () => {
    const out = redact([
      { name: 'a', secret: 's1' },
      { name: 'b', secret: 's2' },
    ]);
    expect(out).toEqual([
      { name: 'a', secret: DEFAULT_REDACTION },
      { name: 'b', secret: DEFAULT_REDACTION },
    ]);
  });

  it('honors the reveal flag (returns input untouched)', () => {
    const input = { apiKey: 'sk-real' };
    const out = redact(input, { reveal: true });
    expect(out).toBe(input);
    expect(out).toEqual({ apiKey: 'sk-real' });
  });

  it('honors a custom replacement token', () => {
    const out = redact({ token: 'real' }, { replacement: '***' });
    expect(out).toEqual({ token: '***' });
  });

  it('does not mutate the input', () => {
    const input = { apiKey: 'k', nested: { token: 't' } };
    const out = redact(input);
    expect(out).not.toBe(input);
    expect(input.apiKey).toBe('k');
    expect(input.nested.token).toBe('t');
  });

  it('redacts even when sensitive value is null or empty', () => {
    expect(redact({ apiKey: null })).toEqual({ apiKey: DEFAULT_REDACTION });
    expect(redact({ token: '' })).toEqual({ token: DEFAULT_REDACTION });
  });

  it('handles cycles without infinite-looping', () => {
    interface Node {
      name: string;
      apiKey: string;
      self?: Node;
    }
    const a: Node = { name: 'a', apiKey: 's' };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
  });
});
