/**
 * maskKeyHint — the masked, display-only stored-key hint (TASK_2026_555 Batch 28c).
 */

import { KEY_HINT_MIN_LENGTH, maskKeyHint } from './mask-key-hint';

const BULLET = '\u2022';

describe('maskKeyHint', () => {
  it('is exactly four U+2022 bullets, one space, then the last 4 characters', () => {
    const hint = maskKeyHint('sk-moonshot-0123456789abcdef8f21');

    expect(hint).toBe(`${BULLET.repeat(4)} 8f21`);
    expect(Array.from(hint ?? '').map((c) => c.codePointAt(0))).toEqual([
      0x2022, 0x2022, 0x2022, 0x2022, 0x20, 0x38, 0x66, 0x32, 0x31,
    ]);
  });

  it('carries no mojibake of the bullet (UTF-8 read as Latin-1 / cp1252)', () => {
    const hint = maskKeyHint('abcdefghijkl') ?? '';

    for (const marker of ['\u00e2', '\u20ac', '\u00c2', '\u00c3', '\ufffd']) {
      expect(hint).not.toContain(marker);
    }
    expect(Buffer.from(hint, 'utf8').subarray(0, 3)).toEqual(
      Buffer.from([0xe2, 0x80, 0xa2]),
    );
  });

  it(`gives a hint from exactly ${KEY_HINT_MIN_LENGTH} characters`, () => {
    expect(KEY_HINT_MIN_LENGTH).toBe(12);
    expect(maskKeyHint('abcdefgh1234')).toBe(`${BULLET.repeat(4)} 1234`);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty key', ''],
    ['a whitespace-only key', '   \t\n  '],
    ['an 11-character key', 'abcdefg1234'],
    ['a short key padded with whitespace', '   short-key-1   '],
  ])('gives no hint for %s', (_label, secret) => {
    expect(maskKeyHint(secret)).toBeUndefined();
  });

  it('never throws for a non-string at runtime', () => {
    expect(maskKeyHint(42 as unknown as string)).toBeUndefined();
    expect(maskKeyHint({} as unknown as string)).toBeUndefined();
  });

  it('measures the trimmed key and hints its last 4 non-space characters', () => {
    expect(maskKeyHint('  abcdefghWXYZ  ')).toBe(`${BULLET.repeat(4)} WXYZ`);
  });

  it('counts code points, so the hint never splits a surrogate pair', () => {
    const hint = maskKeyHint('abcdefghijk\u{1F511}xyz') ?? '';

    expect(hint).toBe(`${BULLET.repeat(4)} \u{1F511}xyz`);
    const loneSurrogate =
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(loneSurrogate.test(hint)).toBe(false);
  });

  it.each([
    'abcdefghijkl',
    'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghij',
    'sk-or-v1-0123456789abcdef0123456789abcdef',
  ])('never contains more than the last 4 characters of %s', (secret) => {
    const hint = maskKeyHint(secret) ?? '';
    const visible = hint.slice(5);

    expect(visible).toBe(secret.slice(-4));
    expect(hint).not.toContain(secret.slice(-5));
    expect(hint).not.toContain(secret.slice(0, 5));
  });
});
