import { classifyToolResult } from './call-recorder';

const classify = (text: string, isError = false) =>
  classifyToolResult(text, isError, 'D:/workspace');

describe('classifyToolResult coverage reasons', () => {
  it.each([
    ['only an unrecognised extension', ['unrecognised?']],
    [
      'a capped list whose later reasons rule out a hidden unknown',
      ['updating', 'unrecognised?', 'unchecked'],
    ],
    [
      'a capped list beginning at an unrecognised extension',
      ['unrecognised?', 'unchecked', 'failed'],
    ],
  ])('does not mark %s as unknown coverage', (_case, reasons) => {
    expect(classify(JSON.stringify({ coverage: { reasons } })).errorClass).toBe(
      null,
    );
  });

  it('does not mark a clean answer with an empty reasons array', () => {
    expect(
      classify(JSON.stringify({ coverage: { clean: true, reasons: [] } }))
        .errorClass,
    ).toBe(null);
  });

  it.each([
    ['unknown reasons', ['census?', 'unchecked?', 'failed?']],
    ['a mixed unknown reason', ['unchecked?', 'unrecognised?']],
    ['an explicit resolution unknown', ['updating', 'stale', 'resolution?']],
    ['a non-string reason', ['updating', null]],
  ])('marks %s as unknown coverage', (_case, reasons) => {
    expect(classify(JSON.stringify({ coverage: { reasons } })).errorClass).toBe(
      'unknown-coverage',
    );
  });

  it('keeps an unknown census unknown with only unrecognised extensions', () => {
    expect(
      classify(
        JSON.stringify({
          coverage: { census: 'unknown', reasons: ['unrecognised?'] },
        }),
      ).errorClass,
    ).toBe('unknown-coverage');
  });

  it('conservatively keeps a cut reasons body unknown', () => {
    expect(
      classify(
        '{"coverage":{"reasons":["unrecognised?"\n[reduced: none — partial, cut mid-line]',
      ).errorClass,
    ).toBe('unknown-coverage');
  });

  it.each([
    ['can hide a later unknown code', ['updating', 'stale', 'truncated']],
    ['has an explicit unknown code', ['census?', 'updating', 'stale']],
    ['ends with an unlisted code', ['updating', 'unrecognised?', 'future']],
  ])('treats a capped array that %s as unknown', (_case, reasons) => {
    expect(
      classify(
        JSON.stringify({
          coverage: { reasons },
        }),
      ).errorClass,
    ).toBe('unknown-coverage');
  });

  it.each([
    ['unrecognised extension', ['updating', 'unrecognised?']],
    ['settled reason', ['updating', 'stale']],
    ['capped settled reason', ['updating', 'stale', 'unchecked']],
  ])('keeps fewer than three reasons with a %s clean', (_case, reasons) => {
    expect(
      classify(
        JSON.stringify({
          coverage: { reasons },
        }),
      ).errorClass,
    ).toBe(null);
  });

  it('reads every reasons array in a multi-array body', () => {
    expect(
      classify(
        '{"coverage":{"reasons":["unrecognised?"]},"later":{"reasons":["stale?"]}}',
      ).errorClass,
    ).toBe('unknown-coverage');
  });

  it('reads pretty-printed arrays and escaped reason strings', () => {
    const text = JSON.stringify(
      {
        coverage: {
          reasons: ['unrecognised?', 'a "quoted" ], comma,'],
        },
      },
      null,
      2,
    );
    expect(classify(text).errorClass).toBe(null);
  });

  it('reads brackets and commas inside a reason and stops before a trailer', () => {
    expect(
      classify(
        '{"coverage":{"reasons":["unrecognised?", "literal ], comma,"]}}\n[reduced: partial]',
      ).errorClass,
    ).toBe(null);
  });

  it.each<
    readonly [
      string,
      string,
      boolean,
      'building' | 'tool-error' | 'unavailable',
    ]
  >([
    ['building', '{"status":"building"}', false, 'building'],
    ['tool error', '{"coverage":{"clean":true}}', true, 'tool-error'],
    ['unavailable', '{"status":"unavailable"}', false, 'unavailable'],
  ])('keeps %s classification unchanged', (_case, text, isError, expected) => {
    expect(classify(text, isError).errorClass).toBe(expected);
  });
});
